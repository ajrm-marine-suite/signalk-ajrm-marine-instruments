"use strict";

const packageInfo = require("../package.json");
const { buildInstrumentState } = require("./lib/instruments");

const PLUGIN_ID = "signalk-ajrm-marine-instruments";
const PILOT_HELM_ANGLE_PATH = "plugins.ajrmMarineInstruments.pilotHelmAngle";

module.exports = function ajrmMarineInstruments(app) {
  const plugin = {};
  let options = normalizeOptions({});
  let unsubscribes = [];
  let lastPublishedPilotHelmAngle = Symbol("not-published");

  plugin.id = PLUGIN_ID;
  plugin.name = "AJRM Marine Instruments";
  plugin.description = "Attractive, large-format Signal K instrument displays.";

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
    },
  };

  plugin.start = (pluginOptions = {}) => {
    options = normalizeOptions(pluginOptions);
    subscribeToPilotHelmInputs();
    publishPilotHelmAngle();
    app.setPluginStatus(`Started v${packageInfo.version}`);
  };

  plugin.stop = () => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    publishPilotHelmValue(null);
  };

  plugin.registerWithRouter = function registerWithRouter(router) {
    router.get("/status", (_req, res) => {
      try {
        res.json({
          ...buildInstrumentState(app, { ...options, version: packageInfo.version }),
          controls: {
            refreshIntervalSeconds: options.refreshIntervalSeconds,
          },
        });
      } catch (error) {
        app.error(`[${PLUGIN_ID}] status error: ${error.stack || error.message}`);
        res.status(500).json({ ok: false, error: error.message });
      }
    });

  };

  return plugin;

  function subscribeToPilotHelmInputs() {
    if (!app.subscriptionmanager?.subscribe) return;
    app.subscriptionmanager.subscribe(
      {
        context: "vessels.self",
        subscribe: [
          { path: "steering.rudderAngle", policy: "instant", format: "delta" },
          { path: "steering.autopilot.state", policy: "instant", format: "delta" },
        ],
      },
      unsubscribes,
      (error) => app.error?.(`[${PLUGIN_ID}] subscription error: ${error}`),
      () => publishPilotHelmAngle(),
    );
  }

  function publishPilotHelmAngle() {
    try {
      const state = buildInstrumentState(app, { ...options, version: packageInfo.version });
      publishPilotHelmValue(state.rudder?.angleRadians ?? null);
    } catch (error) {
      app.error?.(`[${PLUGIN_ID}] pilot helm projection error: ${error.stack || error.message}`);
      publishPilotHelmValue(null);
    }
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
          value.engineRoomTemperaturePath ||
          "environment.inside.engineRoom.temperature",
      ).trim(),
    };
  }

  function clampInt(value, fallback, min, max) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

};

module.exports.PILOT_HELM_ANGLE_PATH = PILOT_HELM_ANGLE_PATH;
