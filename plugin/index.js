/**
 * Signal K server entry point for AJRM Marine Instruments; registers lifecycle, subscriptions, routes, and status.
 */

"use strict";

const packageInfo = require("../package.json");
const openApi = require("./openApi.json");
const { buildInstrumentState } = require("./lib/instruments");
const createInstrumentAlerts = require("./alerts");

const PLUGIN_ID = "signalk-ajrm-marine-instruments";
const AJRM_MARINE_INSTRUMENTS_API_REGISTRY = Symbol.for("mcdonaldajr.ajrmMarineInstrumentsApi");
const PILOT_HELM_ANGLE_PATH = "plugins.ajrmMarineInstruments.pilotHelmAngle";
const CROSS_TRACK_ERROR_PATH = "plugins.ajrmMarineInstruments.crossTrackError";
const AUTOPILOT_ENGAGED_STATES = Object.freeze(["auto", "heading", "wind", "route"]);
const DEFAULT_VISIBLE_INSTRUMENTS = Object.freeze({
  depth: true,
  wind: true,
  speedOverGround: true,
  courseOverGround: true,
  heading: true,
  crossTrackError: true,
  pilotHelm: true,
  gps: true,
  exhaustTemperature: true,
  waterTemperature: true,
});

module.exports = function ajrmMarineInstruments(app) {
  const plugin = {};
  const alertProvider = createInstrumentAlerts(app);
  let options = normalizeOptions({});
  let unsubscribes = [];
  let lastPublishedPilotHelmAngle = Symbol("not-published");
  let lastPublishedCrossTrackError = Symbol("not-published");
  let running = false;

  plugin.id = PLUGIN_ID;
  plugin.name = "AJRM Marine Instruments";
  plugin.description =
    "Large-format Signal K instruments with integrated threshold and trend notifications.";

  plugin.schema = {
    type: "object",
    properties: {
      refreshIntervalSeconds: {
        type: "integer",
        title: "Web refresh interval",
        default: 3,
        minimum: 1,
        maximum: 60,
      },
      depthSource: {
        type: "string",
        title: "Depth source",
        default: "belowKeel",
        enum: ["belowKeel", "belowTransducer", "belowSurface"],
      },
      exhaustWaterTemperaturePath: {
        type: "string",
        title: "Exhaust water temperature path",
        default: "environment.inside.engineRoom.temperature",
      },
      visibleInstruments: {
        type: "object",
        title: "Displayed instruments",
        description: "Untick instruments that are not fitted or are not useful on this vessel.",
        additionalProperties: false,
        default: { ...DEFAULT_VISIBLE_INSTRUMENTS },
        properties: {
          depth: instrumentVisibilitySchema("Depth"),
          wind: instrumentVisibilitySchema("Wind (large combined instrument)"),
          speedOverGround: instrumentVisibilitySchema("Speed over ground (SOG)"),
          courseOverGround: instrumentVisibilitySchema("Course over ground (COG)"),
          heading: instrumentVisibilitySchema("Heading"),
          crossTrackError: instrumentVisibilitySchema("Cross-track error (XTE)"),
          pilotHelm: instrumentVisibilitySchema("Pilot helm (tiller pilot)"),
          gps: instrumentVisibilitySchema("GPS position and quality"),
          exhaustTemperature: instrumentVisibilitySchema("Exhaust temperature"),
          waterTemperature: instrumentVisibilitySchema("Water temperature"),
        },
      },
      instrumentAlerts: {
        ...alertProvider.schema,
        title: "Instrument alerts and anchoring depth callouts",
        description:
          "Startup defaults for the integrated alert provider. Live edits are made in the Alerts view and persisted separately.",
      },
    },
  };

  plugin.start = (pluginOptions = {}) => {
    stopSubscriptions();
    running = true;
    options = normalizeOptions(pluginOptions);
    lastPublishedPilotHelmAngle = Symbol("not-published");
    lastPublishedCrossTrackError = Symbol("not-published");
    subscribeToProjectionInputs();
    publishInstrumentProjections();
    alertProvider.start(pluginOptions.instrumentAlerts || {});
    const api = {
      pluginId: plugin.id,
      version: packageInfo.version,
      status: () => buildRuntimeStatus(),
    };
    app.ajrmMarineInstrumentsApi = api;
    globalThis[AJRM_MARINE_INSTRUMENTS_API_REGISTRY] = api;
    app.setPluginStatus(`Started v${packageInfo.version}`);
  };

  plugin.stop = () => {
    alertProvider.stop();
    running = false;
    stopSubscriptions();
    publishPilotHelmValue(null);
    publishCrossTrackErrorValue(null);
    if (app.ajrmMarineInstrumentsApi?.pluginId === plugin.id) {
      delete app.ajrmMarineInstrumentsApi;
    }
    if (globalThis[AJRM_MARINE_INSTRUMENTS_API_REGISTRY]?.pluginId === plugin.id) {
      delete globalThis[AJRM_MARINE_INSTRUMENTS_API_REGISTRY];
    }
    app.setPluginStatus?.("Stopped");
  };

  plugin.registerWithRouter = function registerWithRouter(router) {
    router.get("/status", (_req, res) => {
      try {
        res.json(buildRuntimeStatus());
      } catch (error) {
        app.error(`[${PLUGIN_ID}] status error: ${error.stack || error.message}`);
        res.status(500).json({ ok: false, error: error.message });
      }
    });

    alertProvider.registerWithRouter(scopedRouter(router, "/alerts"));

  };

  plugin.getOpenApi = () => openApi;

  return plugin;

  function buildRuntimeStatus() {
    return {
      ...buildInstrumentState(app, { ...options, version: packageInfo.version }),
      controls: {
        refreshIntervalSeconds: options.refreshIntervalSeconds,
        visibleInstruments: { ...options.visibleInstruments },
      },
      alerts: alertProvider.getStatus(),
      derivedPaths: {
        contract: "ajrm-marine-instruments-derived-paths-v1",
        contractVersion: 1,
        pilotHelmAngle: {
          path: PILOT_HELM_ANGLE_PATH,
          unit: "rad",
          nullable: true,
          nullUnlessAutopilotEngaged: true,
          autopilotEngagedStates: [...AUTOPILOT_ENGAGED_STATES],
        },
        crossTrackError: {
          path: CROSS_TRACK_ERROR_PATH,
          unit: "m",
          nullable: true,
          signed: true,
          negativeDirection: "port",
          positiveDirection: "starboard",
          zeroMeaning: "on-route",
        },
      },
    };
  }

  function subscribeToProjectionInputs() {
    if (!app.subscriptionmanager?.subscribe) return;
    app.subscriptionmanager.subscribe(
      {
        context: "vessels.self",
        subscribe: [
          { path: "steering.rudderAngle", policy: "instant", format: "delta" },
          { path: "steering.autopilot.state", policy: "instant", format: "delta" },
          { path: "navigation.course.calcValues.crossTrackError", policy: "instant", format: "delta" },
          { path: "navigation.courseGreatCircle.crossTrackError", policy: "instant", format: "delta" },
          { path: "navigation.courseRhumbline.crossTrackError", policy: "instant", format: "delta" },
        ],
      },
      unsubscribes,
      (error) => app.error?.(`[${PLUGIN_ID}] subscription error: ${error}`),
      () => publishInstrumentProjections(),
    );
  }

  function publishInstrumentProjections() {
    if (!running) return;
    try {
      const state = buildInstrumentState(app, { ...options, version: packageInfo.version });
      publishPilotHelmValue(state.rudder?.angleRadians ?? null);
      publishCrossTrackErrorValue(state.navigation?.crossTrackErrorMeters ?? null);
    } catch (error) {
      app.error?.(`[${PLUGIN_ID}] instrument projection error: ${error.stack || error.message}`);
      publishPilotHelmValue(null);
      publishCrossTrackErrorValue(null);
    }
  }

  function publishCrossTrackErrorValue(value) {
    if (Object.is(value, lastPublishedCrossTrackError)) return;
    lastPublishedCrossTrackError = value;
    publishValue(CROSS_TRACK_ERROR_PATH, value);
  }

  function publishValue(path, value) {
    app.handleMessage?.(PLUGIN_ID, {
      context: "vessels.self",
      updates: [
        {
          timestamp: new Date().toISOString(),
          values: [{ path, value }],
        },
      ],
    });
  }

  function stopSubscriptions() {
    for (const unsubscribe of unsubscribes.splice(0)) {
      try {
        unsubscribe();
      } catch {
        // Signal K unsubscribe callbacks are best-effort during restart/stop.
      }
    }
  }

  function scopedRouter(router, prefix) {
    return {
      get(route, ...handlers) { router.get(`${prefix}${route}`, ...handlers); },
      put(route, ...handlers) { router.put(`${prefix}${route}`, ...handlers); },
      post(route, ...handlers) { router.post(`${prefix}${route}`, ...handlers); },
    };
  }

  function publishPilotHelmValue(value) {
    if (Object.is(value, lastPublishedPilotHelmAngle)) return;
    lastPublishedPilotHelmAngle = value;
    app.handleMessage?.(PLUGIN_ID, {
      context: "vessels.self",
      updates: [
        {
          timestamp: new Date().toISOString(),
          values: [{ path: PILOT_HELM_ANGLE_PATH, value }],
        },
      ],
    });
  }

  function normalizeOptions(value) {
    return {
      refreshIntervalSeconds: clampInt(value.refreshIntervalSeconds, 3, 1, 60),
      depthSource: ["belowKeel", "belowTransducer", "belowSurface"].includes(value.depthSource)
        ? value.depthSource
        : "belowKeel",
      exhaustWaterTemperaturePath: String(
        value.exhaustWaterTemperaturePath ||
          "environment.inside.engineRoom.temperature",
      ).trim(),
      visibleInstruments: normalizeVisibleInstruments(value.visibleInstruments),
    };
  }

  function normalizeVisibleInstruments(value) {
    const configured = value && typeof value === "object" ? value : {};
    return Object.fromEntries(
      Object.keys(DEFAULT_VISIBLE_INSTRUMENTS).map((key) => [key, configured[key] !== false]),
    );
  }

  function clampInt(value, fallback, min, max) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

};

function instrumentVisibilitySchema(title) {
  return { type: "boolean", title, default: true };
}

module.exports.PILOT_HELM_ANGLE_PATH = PILOT_HELM_ANGLE_PATH;
module.exports.CROSS_TRACK_ERROR_PATH = CROSS_TRACK_ERROR_PATH;
module.exports.DEFAULT_VISIBLE_INSTRUMENTS = DEFAULT_VISIBLE_INSTRUMENTS;
