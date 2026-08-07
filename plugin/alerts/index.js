"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packageInfo = require("../../package.json");
const {
  createMonitorState,
  evaluateMonitor,
  safeId,
} = require("../lib/monitor-engine");
const {
  activeEnvelope,
  eventEnvelope,
  resetProviderSession,
} = require("../lib/notifications-plus-envelope");

const PLUGIN_ID = "signalk-ajrm-marine-instruments";
const SETTINGS_FILE = "ajrm-marine-instrument-alerts-settings.json";
const NOTIFICATION_ROOT = "notifications.ajrmMarineInstrumentAlerts";
const AJRM_MARINE_TRAFFIC_API_REGISTRY = Symbol.for("ajrmMarineTrafficApi");
const DEPTH_CALLOUT_NOTIFICATION_PATH =
  "notifications.environment.depth.callout";
const DEPTH_CALLOUT_CLEAR_MILLISECONDS = 30_000;
const XTE_MONITOR_PATH = "plugins.ajrmMarineInstruments.crossTrackError";
const LEVEL_SCHEMA = {
  type: "object",
  properties: {
    enabled: { type: "boolean", title: "Enable this level", default: true },
    minimum: {
      type: ["number", "null"],
      title: "Trigger at or below",
      description: "Leave empty to disable the low-value trigger.",
    },
    maximum: {
      type: ["number", "null"],
      title: "Trigger at or above",
      description: "Leave empty to disable the high-value trigger.",
    },
    risePerMinute: {
      type: ["number", "null"],
      title: "Trigger above rise per minute",
      minimum: 0,
    },
    fallPerMinute: {
      type: ["number", "null"],
      title: "Trigger above fall per minute",
      minimum: 0,
    },
    repeatSeconds: {
      type: "integer",
      title: "Repeat interval (seconds)",
      minimum: 1,
      maximum: 86400,
    },
  },
};

function levelSchema(title) {
  return {
    ...JSON.parse(JSON.stringify(LEVEL_SCHEMA)),
    title,
  };
}

const DEFAULT_XTE_MONITOR = {
  id: "cross-track-error",
  label: "Cross track error",
  path: XTE_MONITOR_PATH,
  unit: "metres",
  conversion: "none",
  directionMode: "portStarboard",
  absoluteValue: true,
  decimals: 1,
  enabled: false,
  rateWindowSeconds: 60,
  minimumRateSampleSeconds: 10,
  hysteresis: 5,
  rateHysteresisPerMinute: 0,
  levels: {
    information: { enabled: true, maximum: 25, repeatSeconds: 300 },
    warning: { enabled: true, maximum: 50, repeatSeconds: 60 },
    danger: { enabled: true, maximum: 100, repeatSeconds: 15 },
  },
};

const DEFAULT_MONITORS = [
  {
    id: "depth-below-keel",
    label: "Depth below keel",
    path: "environment.depth.belowKeel",
    unit: "metres",
    conversion: "none",
    decimals: 1,
    enabled: true,
    rateWindowSeconds: 60,
    minimumRateSampleSeconds: 10,
    hysteresis: 0.2,
    rateHysteresisPerMinute: 0.1,
    levels: {
      information: { enabled: true, minimum: 5, repeatSeconds: 300 },
      warning: { enabled: true, minimum: 3, repeatSeconds: 60 },
      danger: { enabled: true, minimum: 2, repeatSeconds: 15 },
    },
  },
  {
    id: "engine-room-temperature",
    label: "Engine room temperature",
    path: "environment.inside.engineRoom.temperature",
    unit: "degrees Celsius",
    conversion: "kelvinToCelsius",
    decimals: 1,
    enabled: false,
    rateWindowSeconds: 60,
    minimumRateSampleSeconds: 15,
    hysteresis: 1,
    rateHysteresisPerMinute: 0.2,
    levels: {
      information: { enabled: true, maximum: 60, risePerMinute: 1, repeatSeconds: 300 },
      warning: { enabled: true, maximum: 75, risePerMinute: 2, repeatSeconds: 60 },
      danger: { enabled: true, maximum: 90, risePerMinute: 4, repeatSeconds: 15 },
    },
  },
  DEFAULT_XTE_MONITOR,
];

const DEFAULT_DEPTH_CALLOUT = {
  supported: true,
  enabled: false,
  path: "environment.depth.belowKeel",
  sourcePath: "environment.depth.belowKeel",
  unit: "meters",
  sayUnits: false,
  coarseStepMeters: 1,
  fineStepMeters: 0.1,
  fineBelowMeters: 3,
  hysteresisMeters: 0.05,
  minimumIntervalSeconds: 5,
  repeatSameBucketSeconds: 30,
  targetMinimumMeters: 2,
  targetMaximumMeters: 3,
  audio: true,
};

module.exports = function ajrmMarineInstrumentAlerts(app) {
  const plugin = {};
  let options = normalizeOptions({});
  let states = new Map();
  let unsubscribes = [];
  let recentEvents = [];
  let depthCalloutState = createDepthCalloutState();
  let depthCalloutClearTimer = null;
  let running = false;

  plugin.id = PLUGIN_ID;
  plugin.name = "AJRM Marine Instrument Alerts";
  plugin.description =
    "Monitors Signal K values and announces configurable information, warning, danger, and rate-of-change triggers.";

  plugin.schema = {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        title: "Enable AJRM Marine Instrument Alerts",
        default: false,
      },
      monitors: {
        type: "array",
        title: "Monitored instruments and startup defaults",
        description:
          "The AJRM Marine Instrument Alerts web app provides the easiest way to edit these rules while Signal K is running.",
        default: DEFAULT_MONITORS,
        items: {
          type: "object",
          required: ["id", "label", "path"],
          properties: {
            id: { type: "string", title: "Stable monitor ID" },
            label: { type: "string", title: "Spoken label" },
            path: { type: "string", title: "Signal K path" },
            unit: { type: "string", title: "Spoken/display unit" },
            conversion: {
              type: "string",
              title: "Signal K unit conversion",
              enum: ["none", "kelvinToCelsius", "metersPerSecondToKnots", "radiansToDegrees"],
              default: "none",
            },
            directionMode: {
              type: "string",
              title: "Direction wording",
              description: "Optionally append Port or Starboard from the signed value.",
              enum: ["none", "portStarboard"],
              default: "none",
            },
            scale: { type: "number", title: "Additional scale", default: 1 },
            offset: { type: "number", title: "Additional offset", default: 0 },
            absoluteValue: {
              type: "boolean",
              title: "Monitor absolute value",
              description: "Treat equal positive and negative values as the same magnitude.",
              default: false,
            },
            decimals: {
              type: "integer",
              title: "Spoken/display decimal places",
              default: 1,
              minimum: 0,
              maximum: 4,
            },
            enabled: { type: "boolean", title: "Monitor enabled", default: true },
            rateWindowSeconds: {
              type: "integer",
              title: "Rate calculation window (seconds)",
              default: 60,
              minimum: 10,
              maximum: 3600,
            },
            minimumRateSampleSeconds: {
              type: "integer",
              title: "Minimum rate sample duration (seconds)",
              default: 10,
              minimum: 1,
              maximum: 600,
            },
            hysteresis: {
              type: "number",
              title: "Value hysteresis",
              default: 0,
              minimum: 0,
            },
            rateHysteresisPerMinute: {
              type: "number",
              title: "Rate hysteresis per minute",
              default: 0,
              minimum: 0,
            },
            levels: {
              type: "object",
              title: "Severity rules",
              properties: {
                information: levelSchema("Information"),
                warning: levelSchema("Warning"),
                danger: levelSchema("Danger"),
              },
            },
          },
        },
      },
      depthCallout: {
        type: "object",
        title: "Anchoring depth callout",
        description:
          "Optional sparse depth readout for anchoring. It announces depth changes only within the configured target depth band.",
        properties: {
          enabled: { type: "boolean", title: "Enable depth callouts", default: false },
          path: { type: "string", title: "Depth Signal K path", default: DEFAULT_DEPTH_CALLOUT.path },
          sayUnits: { type: "boolean", title: "Say meters in each callout", default: false },
          fineBelowMeters: { type: "number", title: "Use tenths below", default: 3, minimum: 0 },
          minimumIntervalSeconds: { type: "integer", title: "Minimum time between callouts", default: 5, minimum: 1 },
          repeatSameBucketSeconds: { type: "integer", title: "Repeat unchanged depth after", default: 30, minimum: 5 },
          targetMinimumMeters: { type: "number", title: "Target minimum depth", default: 2, minimum: 0 },
          targetMaximumMeters: { type: "number", title: "Target maximum depth", default: 3, minimum: 0 },
        },
      },
    },
  };

  plugin.start = (pluginOptions = {}) => {
    shutdownRuntime({ clearNotifications: running });
    running = true;
    resetProviderSession();
    options = normalizeOptions({
      ...pluginOptions,
      ...loadRuntimeSettings(),
    });
    resetStates();
    clearDepthCalloutNotification("plugin-started", null, {
      force: true,
    });
    subscribeToMonitors();
    seedCurrentValues();
    publishStatusProjection();
    app.setPluginStatus(`Started v${packageInfo.version}; ${enabledMonitorCount()} monitor(s)`);
  };

  plugin.stop = () => {
    shutdownRuntime({ clearNotifications: true });
    app.setPluginStatus?.("Stopped");
  };

  plugin.registerWithRouter = (router) => {
    router.get("/status", (_req, res) => {
      res.json(statusResponse());
    });

    router.get("/settings", (_req, res) => {
      res.json(settingsResponse());
    });

    router.put("/settings", requireWriteAccess((req, res) => {
      try {
        const next = normalizeOptions(req.body || {});
        unsubscribeAll();
        clearPublishedNotifications();
        options = next;
        saveRuntimeSettings();
        resetStates();
        subscribeToMonitors();
        seedCurrentValues();
        publishStatusProjection();
        app.setPluginStatus(`Started v${packageInfo.version}; ${enabledMonitorCount()} monitor(s)`);
        res.json(settingsResponse());
      } catch (error) {
        app.error(`[${PLUGIN_ID}] settings error: ${error.stack || error.message}`);
        res.status(400).json({ ok: false, error: error.message });
      }
    }));

    router.post("/depth-callout/drop", requireWriteAccess((_req, res) => {
      const depth = depthCalloutState.lastDepthMeters;
      if (!Number.isFinite(depth)) {
        res.status(409).json({ ok: false, error: "No recent depth is available." });
        return;
      }
      const trafficProfile = selectTrafficAnchorProfile();
      const message = `Anchor dropped in ${formatDepth(depth, true)}.`;
      publishDepthCallout({
        depthMeters: depth,
        timestamp: Date.now(),
        message,
        forced: true,
        kind: "anchor-dropped",
      });
      depthCalloutState = {
        ...depthCalloutState,
        anchorDropActive: true,
        lastAnnouncement: {
          message,
          kind: "anchor-dropped",
          ts: new Date().toISOString(),
        },
        lastAnchorDrop: {
          depthMeters: depth,
          message,
          trafficProfile,
          ts: new Date().toISOString(),
        },
      };
      publishStatusProjection();
      res.json({ ok: true, depthMeters: depth, trafficProfile });
    }));
  };

  plugin.getStatus = () => statusResponse();

  return plugin;

  function normalizeOptions(value) {
    const configuredMonitors = Array.isArray(value.monitors) ? value.monitors : DEFAULT_MONITORS;
    const monitors = includeXteMonitor(configuredMonitors);
    const normalized = monitors.map(normalizeMonitor).filter((monitor) => monitor.path);
    return {
      enabled: value.enabled === true,
      monitors: uniqueMonitorIds(normalized),
      depthCallout: normalizeDepthCallout(value.depthCallout),
    };
  }

  function includeXteMonitor(monitors) {
    const present = monitors.some((monitor) =>
      monitor?.id === DEFAULT_XTE_MONITOR.id || monitor?.path === XTE_MONITOR_PATH
    );
    return present ? monitors : [...monitors, DEFAULT_XTE_MONITOR];
  }

  function normalizeMonitor(value, index) {
    const id = safeId(value?.id || value?.label || value?.path || `monitor-${index + 1}`);
    return {
      id,
      label: String(value?.label || value?.path || `Monitor ${index + 1}`).trim(),
      path: String(value?.path || "").trim(),
      unit: String(value?.unit || "").trim(),
      conversion: [
        "none",
        "kelvinToCelsius",
        "metersPerSecondToKnots",
        "radiansToDegrees",
      ].includes(value?.conversion)
        ? value.conversion
        : "none",
      directionMode: normalizeDirectionMode(value, id),
      scale: finiteOr(value?.scale, 1),
      offset: finiteOr(value?.offset, 0),
      absoluteValue: value?.absoluteValue === true,
      decimals: clampInteger(value?.decimals, 1, 0, 4),
      enabled: value?.enabled !== false,
      rateWindowSeconds: clampInteger(value?.rateWindowSeconds, 60, 10, 3600),
      minimumRateSampleSeconds: clampInteger(value?.minimumRateSampleSeconds, 10, 1, 600),
      hysteresis: clampNumber(value?.hysteresis, 0, 0, 1000000),
      rateHysteresisPerMinute: clampNumber(
        value?.rateHysteresisPerMinute,
        0,
        0,
        1000000,
      ),
      levels: {
        information: normalizeLevel(value?.levels?.information, 300),
        warning: normalizeLevel(value?.levels?.warning, 60),
        danger: normalizeLevel(value?.levels?.danger, 15),
      },
    };
  }

  function normalizeDirectionMode(value, id) {
    if (["none", "portStarboard"].includes(value?.directionMode)) {
      return value.directionMode;
    }
    if (id === DEFAULT_XTE_MONITOR.id || value?.path === XTE_MONITOR_PATH) {
      return "portStarboard";
    }
    return "none";
  }

  function normalizeLevel(value, defaultRepeatSeconds) {
    return {
      enabled: value?.enabled !== false,
      minimum: optionalNumber(value?.minimum),
      maximum: optionalNumber(value?.maximum),
      risePerMinute: optionalPositiveNumber(value?.risePerMinute),
      fallPerMinute: optionalPositiveNumber(value?.fallPerMinute),
      repeatSeconds: clampInteger(value?.repeatSeconds, defaultRepeatSeconds, 1, 86400),
    };
  }

  function normalizeDepthCallout(value = {}) {
    const pathValue = String(value.path || value.sourcePath || DEFAULT_DEPTH_CALLOUT.path).trim();
    return {
      supported: true,
      available: true,
      enabled: value.enabled === true,
      path: pathValue || DEFAULT_DEPTH_CALLOUT.path,
      sourcePath: pathValue || DEFAULT_DEPTH_CALLOUT.path,
      unit: "meters",
      sayUnits: value.sayUnits === true,
      coarseStepMeters: clampNumber(value.coarseStepMeters, DEFAULT_DEPTH_CALLOUT.coarseStepMeters, 0.1, 10),
      fineStepMeters: clampNumber(value.fineStepMeters, DEFAULT_DEPTH_CALLOUT.fineStepMeters, 0.01, 2),
      fineBelowMeters: clampNumber(value.fineBelowMeters, DEFAULT_DEPTH_CALLOUT.fineBelowMeters, 0, 100),
      hysteresisMeters: clampNumber(value.hysteresisMeters, DEFAULT_DEPTH_CALLOUT.hysteresisMeters, 0, 10),
      minimumIntervalSeconds: clampInteger(
        value.minimumIntervalSeconds,
        DEFAULT_DEPTH_CALLOUT.minimumIntervalSeconds,
        1,
        3600,
      ),
      repeatSameBucketSeconds: clampInteger(
        value.repeatSameBucketSeconds,
        DEFAULT_DEPTH_CALLOUT.repeatSameBucketSeconds,
        5,
        86400,
      ),
      targetMinimumMeters: clampNumber(value.targetMinimumMeters, DEFAULT_DEPTH_CALLOUT.targetMinimumMeters, 0, 200),
      targetMaximumMeters: clampNumber(value.targetMaximumMeters, DEFAULT_DEPTH_CALLOUT.targetMaximumMeters, 0, 200),
      audio: value.audio !== false,
    };
  }

  function uniqueMonitorIds(monitors) {
    const used = new Set();
    return monitors.map((monitor, index) => {
      let id = monitor.id || `monitor-${index + 1}`;
      let suffix = 2;
      while (used.has(id)) id = `${monitor.id}-${suffix++}`;
      used.add(id);
      return { ...monitor, id };
    });
  }

  function subscribeToMonitors() {
    if (!options.enabled || !app.subscriptionmanager?.subscribe) return;
    const paths = [
      ...options.monitors.filter((item) => item.enabled).map((item) => item.path),
      ...(options.depthCallout.enabled ? [options.depthCallout.path] : []),
    ];
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (uniquePaths.length === 0) return;
    app.subscriptionmanager.subscribe(
      {
        context: "vessels.self",
        subscribe: uniquePaths.map((monitorPath) => ({
          path: monitorPath,
          policy: "instant",
          format: "delta",
        })),
      },
      unsubscribes,
      (error) => app.error(`[${PLUGIN_ID}] subscription error: ${error}`),
      handleDelta,
    );
  }

  function handleDelta(delta) {
    if (!running) return;
    const fallbackTimestamp = Date.now();
    for (const update of delta?.updates || []) {
      const timestamp = Date.parse(update.timestamp) || fallbackTimestamp;
      for (const value of update.values || []) {
        for (const monitor of options.monitors) {
          if (monitor.enabled && monitor.path === value.path) {
            evaluateValue(monitor, value.value, timestamp);
          }
        }
        if (options.depthCallout.enabled && options.depthCallout.path === value.path) {
          evaluateDepthCallout(value.value, timestamp);
        }
      }
    }
  }

  function seedCurrentValues() {
    if (!options.enabled || typeof app.getSelfPath !== "function") return;
    const timestamp = Date.now();
    for (const monitor of options.monitors) {
      if (!monitor.enabled) continue;
      const value = app.getSelfPath(monitor.path);
      if (value != null) evaluateValue(monitor, value, timestamp);
    }
    if (options.depthCallout.enabled) {
      const value = app.getSelfPath(options.depthCallout.path);
      if (value != null) evaluateDepthCallout(value, timestamp);
    }
  }

  function evaluateValue(monitor, rawValue, timestamp) {
    const previous = states.get(monitor.id) || createMonitorState();
    const result = evaluateMonitor({ monitor, rawValue, timestamp, state: previous });
    states.set(monitor.id, result.state);
    if (result.event) publishAnnouncement(monitor, result.event);
    if (result.cleared) clearNotification(monitor.id);
  }

  function publishAnnouncement(monitor, event) {
    const notificationState =
      event.level === "danger" ? "alarm" : event.level === "warning" ? "warn" : "alert";
    recentEvents = [event, ...recentEvents].slice(0, 50);
    const ajrmMarineNotifications = activeEnvelope(monitor, event);
    app.handleMessage(PLUGIN_ID, {
      context: "vessels.self",
      updates: [
        {
          values: [
            {
              path: standardNotificationPath(monitor),
              value: {
                state: notificationState,
                method: ["visual", "sound"],
                message: event.message,
                data: {
                  category: "instrument-alert",
                  monitorId: monitor.id,
                  sourcePath: monitor.path,
                  level: event.level,
                  value: event.value,
                  unit: event.unit,
                  ratePerMinute: event.ratePerMinute,
                  ajrmMarineNotifications,
                  announcement: {
                    id: event.id,
                    ts: event.ts,
                    shouldAnnounce: true,
                    localPlayback: true,
                    streamOutput: true,
                  },
                  alertEvent: {
                    id: event.id,
                    ts: event.ts,
                    vesselName: monitor.label,
                    displayName: monitor.label,
                    state: notificationState,
                    category: "instrument-alert",
                    message: event.message,
                    methods: ["visual", "sound"],
                    shouldAnnounce: true,
                    uiSeverity: event.level,
                    uiLabel: monitor.label,
                  },
                },
              },
            },
          ],
        },
      ],
    });
  }

  function evaluateDepthCallout(rawValue, timestamp) {
    const depthMeters = Number(rawValue?.value ?? rawValue);
    if (!Number.isFinite(depthMeters) || depthMeters < 0) return;
    const now = Number.isFinite(timestamp) ? timestamp : Date.now();
    const bucket = depthCalloutBucket(depthMeters, options.depthCallout);
    const previous = depthCalloutState;
    depthCalloutState = {
      ...previous,
      lastDepthMeters: depthMeters,
      lastUpdatedAt: new Date(now).toISOString(),
      currentBucket: bucket,
    };
    if (!depthWithinCalloutWindow(depthMeters, options.depthCallout)) {
      if (clearDepthCalloutNotification("depth-above-callout-band")) {
        publishStatusProjection();
      }
      return;
    }
    const step = depthCalloutStep(depthMeters, options.depthCallout);
    const depthChangedEnough =
      previous.lastAnnouncedBucket == null ||
      Math.abs(bucket - previous.lastAnnouncedBucket) >= step - options.depthCallout.hysteresisMeters;
    const intervalElapsed =
      !previous.lastAnnouncedAt ||
      now - previous.lastAnnouncedAt >= options.depthCallout.minimumIntervalSeconds * 1000;
    const repeatElapsed =
      previous.lastAnnouncedBucket === bucket &&
      previous.lastAnnouncedAt &&
      now - previous.lastAnnouncedAt >= options.depthCallout.repeatSameBucketSeconds * 1000;
    if ((!depthChangedEnough || !intervalElapsed) && !repeatElapsed) return;
    const message = `Depth ${formatDepth(depthMeters, options.depthCallout.sayUnits)}.`;
    publishDepthCallout({
      depthMeters,
      timestamp: now,
      message,
      forced: false,
      kind: "depth-callout",
    });
    depthCalloutState = {
      ...depthCalloutState,
      lastAnnouncedBucket: bucket,
      lastAnnouncedAt: now,
      lastAnnouncement: {
        message,
        kind: "depth-callout",
        ts: new Date(now).toISOString(),
      },
    };
    publishStatusProjection();
  }

  function publishDepthCallout({ depthMeters, timestamp, message, forced, kind }) {
    const event = {
      id: `${kind}-${new Date(timestamp).toISOString()}`,
      ts: new Date(timestamp).toISOString(),
      level: "information",
      message,
      value: round(depthMeters, 1),
      unit: options.depthCallout.unit,
      ratePerMinute: null,
    };
    recentEvents = [event, ...recentEvents].slice(0, 50);
    const monitor = {
      id: "anchoring-depth-callout",
      label: "Depth",
      path: options.depthCallout.path,
    };
    const ajrmMarineNotifications = eventEnvelope(monitor, event, {
      category: "instrument-depth-callout",
      expiresSeconds: DEPTH_CALLOUT_CLEAR_MILLISECONDS / 1000,
      context: {
        depthMeters,
        forced: forced === true,
        kind,
      },
    });
    app.handleMessage(PLUGIN_ID, {
      context: "vessels.self",
      updates: [
        {
          values: [
            {
              path: DEPTH_CALLOUT_NOTIFICATION_PATH,
              value: {
                state: "alert",
                method: ["sound"],
                message,
                data: {
                  category: "instrument-depth-callout",
                  sourcePath: options.depthCallout.path,
                  depthMeters,
                  forced,
                  ajrmMarineNotifications,
                  announcement: {
                    id: event.id,
                    ts: event.ts,
                    shouldAnnounce: true,
                    localPlayback: true,
                    streamOutput: true,
                  },
                  alertEvent: {
                    id: event.id,
                    ts: event.ts,
                    vesselName: "Depth",
                    displayName: "Depth",
                    state: "alert",
                    category: "instrument-depth-callout",
                    message,
                    methods: ["sound"],
                    shouldAnnounce: true,
                    uiSeverity: "information",
                    uiLabel: "Depth",
                  },
                },
              },
            },
          ],
        },
      ],
    });
    armDepthCalloutClear(event.id);
  }

  function armDepthCalloutClear(eventId) {
    if (depthCalloutClearTimer) {
      clearTimeout(depthCalloutClearTimer);
      depthCalloutClearTimer = null;
    }
    const clearsAt = new Date(
      Date.now() + DEPTH_CALLOUT_CLEAR_MILLISECONDS,
    ).toISOString();
    depthCalloutState = {
      ...depthCalloutState,
      activeNotificationId: eventId,
      notificationClearsAt: clearsAt,
    };
    depthCalloutClearTimer = setTimeout(() => {
      if (!running) return;
      depthCalloutClearTimer = null;
      clearDepthCalloutNotification("expired", eventId);
      publishStatusProjection();
    }, DEPTH_CALLOUT_CLEAR_MILLISECONDS);
    depthCalloutClearTimer.unref?.();
  }

  function clearDepthCalloutNotification(
    reason,
    expectedEventId = null,
    { force = false } = {},
  ) {
    if (
      expectedEventId &&
      depthCalloutState.activeNotificationId !== expectedEventId
    ) {
      return false;
    }
    if (depthCalloutClearTimer) {
      clearTimeout(depthCalloutClearTimer);
      depthCalloutClearTimer = null;
    }
    if (!depthCalloutState.activeNotificationId && force !== true) return false;
    app.handleMessage(PLUGIN_ID, {
      context: "vessels.self",
      updates: [
        {
          values: [
            {
              path: DEPTH_CALLOUT_NOTIFICATION_PATH,
              value: null,
            },
          ],
        },
      ],
    });
    depthCalloutState = {
      ...depthCalloutState,
      activeNotificationId: null,
      notificationClearsAt: null,
      lastClearedAt: new Date().toISOString(),
      lastClearReason: reason,
    };
    return true;
  }

  function clearNotification(monitorId) {
    app.handleMessage(PLUGIN_ID, {
      context: "vessels.self",
      updates: [
        {
          values: [
            {
              path:
                options.monitors.find((monitor) => monitor.id === monitorId)
                  ? standardNotificationPath(
                      options.monitors.find((monitor) => monitor.id === monitorId),
                    )
                  : `${NOTIFICATION_ROOT}.${monitorId}`,
              value: null,
            },
          ],
        },
      ],
    });
  }

  function clearPublishedNotifications() {
    for (const monitor of options.monitors) clearNotification(monitor.id);
    clearDepthCalloutNotification("plugin-stopped-or-reconfigured");
  }

  function resetStates() {
    if (depthCalloutClearTimer) {
      clearTimeout(depthCalloutClearTimer);
      depthCalloutClearTimer = null;
    }
    states = new Map(options.monitors.map((monitor) => [monitor.id, createMonitorState()]));
    depthCalloutState = createDepthCalloutState();
    recentEvents = [];
  }

  function unsubscribeAll() {
    for (const unsubscribe of unsubscribes) {
      try {
        unsubscribe();
      } catch {
        // Signal K unsubscribe callbacks are best-effort during shutdown/reconfigure.
      }
    }
    unsubscribes = [];
  }

  function shutdownRuntime({ clearNotifications }) {
    if (clearNotifications) clearPublishedNotifications();
    running = false;
    unsubscribeAll();
    if (depthCalloutClearTimer) {
      clearTimeout(depthCalloutClearTimer);
      depthCalloutClearTimer = null;
    }
  }

  function requireWriteAccess(handler) {
    return function writeAccessHandler(req, res) {
      const permission = req.skPrincipal?.permissions;
      if (
        permission === "admin" ||
        permission === "readwrite" ||
        (permission === undefined && req.skIsAuthenticated !== false)
      ) {
        return handler(req, res);
      }
      res.status(403).json({
        ok: false,
        error: "Instrument Alert controls require Signal K read/write or admin access.",
      });
      return undefined;
    };
  }

  function settingsResponse() {
    return {
      ok: true,
      plugin: PLUGIN_ID,
      version: packageInfo.version,
      enabled: options.enabled,
      monitors: options.monitors,
      depthCallout: options.depthCallout,
    };
  }

  function statusResponse() {
    const trafficProfile = currentTrafficProfileStatus();
    resetAnchorDropAfterProfileChange(trafficProfile);
    return {
      ok: true,
      plugin: PLUGIN_ID,
      version: packageInfo.version,
      enabled: options.enabled,
      timestamp: new Date().toISOString(),
      capabilities: {
        anchoringDepthCallout: true,
        anchorDroppedSelectsTrafficProfile: true,
      },
      monitors: options.monitors.map((monitor) => ({
        ...monitor,
        state: publicState(states.get(monitor.id) || createMonitorState()),
      })),
      depthCallout: publicDepthCalloutStatus(),
      trafficProfile,
      recentEvents,
    };
  }

  function publishStatusProjection() {
    if (typeof app.handleMessage !== "function") return;
    app.handleMessage(PLUGIN_ID, {
      context: "vessels.self",
      updates: [
        {
          values: [
            {
              path: "plugins.ajrmMarineInstrumentAlerts",
              value: statusResponse(),
            },
          ],
        },
      ],
    });
  }

  function publicDepthCalloutStatus() {
    return {
      ...options.depthCallout,
      available: true,
      anchorDroppedSelectsTrafficProfile: true,
      active: options.enabled && options.depthCallout.enabled,
      lastDepthMeters: depthCalloutState.lastDepthMeters,
      lastUpdatedAt: depthCalloutState.lastUpdatedAt,
      lastAnnouncement: depthCalloutState.lastAnnouncement,
      lastAnchorDrop: depthCalloutState.lastAnchorDrop,
      anchorDropActive: depthCalloutState.anchorDropActive === true,
      notificationActive: Boolean(depthCalloutState.activeNotificationId),
      notificationClearsAt: depthCalloutState.notificationClearsAt,
      lastNotificationClearedAt: depthCalloutState.lastClearedAt,
      lastNotificationClearReason: depthCalloutState.lastClearReason,
    };
  }

  function publicState(state) {
    const { samples: _samples, ...publicFields } = state;
    return publicFields;
  }

  function enabledMonitorCount() {
    return options.enabled ? options.monitors.filter((monitor) => monitor.enabled).length : 0;
  }

  function selectTrafficAnchorProfile() {
    const api = trafficApi();
    if (!api || typeof api.setProfile !== "function") {
      return {
        requested: "anchor",
        available: false,
        ok: false,
        message: "AJRM Marine Traffic profile API is not available.",
      };
    }
    try {
      const profiles = api.setProfile("anchor");
      return {
        requested: "anchor",
        available: true,
        ok: true,
        profile: profiles?.current || "anchor",
      };
    } catch (error) {
      return {
        requested: "anchor",
        available: true,
        ok: false,
        error: error.message,
      };
    }
  }

  function trafficApi() {
    return app.ajrmMarineTrafficApi || globalThis[AJRM_MARINE_TRAFFIC_API_REGISTRY] || null;
  }

  function currentTrafficProfileStatus() {
    const api = trafficApi();
    if (!api || typeof api.status !== "function") {
      return { available: false, current: null };
    }
    try {
      const status = api.status();
      const current = String(status?.profiles?.current || status?.profile || "").trim().toLowerCase() || null;
      return { available: true, current };
    } catch (error) {
      return { available: true, current: null, error: error.message };
    }
  }

  function resetAnchorDropAfterProfileChange(trafficProfile) {
    if (
      depthCalloutState.anchorDropActive === true &&
      trafficProfile?.current &&
      trafficProfile.current !== "anchor"
    ) {
      depthCalloutState = {
        ...depthCalloutState,
        anchorDropActive: false,
      };
    }
  }

  function loadRuntimeSettings() {
    try {
      const filePath = settingsFilePath();
      if (!filePath || !fs.existsSync(filePath)) return {};
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      app.error(`[${PLUGIN_ID}] could not load settings: ${error.message}`);
      return {};
    }
  }

  function saveRuntimeSettings() {
    const filePath = settingsFilePath();
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(options, null, 2)}\n`);
  }

  function settingsFilePath() {
    if (typeof app.getDataDirPath !== "function") return null;
    return path.join(app.getDataDirPath(), SETTINGS_FILE);
  }
};

function standardNotificationPath(monitor) {
  const sourcePath = String(monitor?.path || "").trim();
  if (/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(sourcePath)) {
    return `notifications.${sourcePath}`;
  }
  return `${NOTIFICATION_ROOT}.${monitor?.id || "instrument"}`;
}

function createDepthCalloutState() {
  return {
    lastDepthMeters: null,
    lastUpdatedAt: null,
    currentBucket: null,
    lastAnnouncedBucket: null,
    lastAnnouncedAt: null,
    lastAnnouncement: null,
    lastAnchorDrop: null,
    anchorDropActive: false,
    activeNotificationId: null,
    notificationClearsAt: null,
    lastClearedAt: null,
    lastClearReason: null,
  };
}

function depthCalloutStep(depthMeters, options) {
  return depthMeters <= options.fineBelowMeters ? options.fineStepMeters : options.coarseStepMeters;
}

function depthWithinCalloutWindow(depthMeters, options) {
  const maximum = Math.max(options.targetMinimumMeters, options.targetMaximumMeters);
  return depthMeters <= maximum + options.hysteresisMeters;
}

function depthCalloutBucket(depthMeters, options) {
  const step = depthCalloutStep(depthMeters, options);
  return round(Math.round(depthMeters / step) * step, step < 1 ? 1 : 0);
}

function formatDepth(depthMeters, sayUnits) {
  const decimals = depthMeters < 3 ? 1 : 0;
  const value = round(depthMeters, decimals).toFixed(decimals);
  return sayUnits ? `${value} meters` : value;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalPositiveNumber(value) {
  const number = optionalNumber(value);
  return number == null ? null : Math.max(0, number);
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value, fallback, min, max) {
  return Math.min(max, Math.max(min, finiteOr(value, fallback)));
}

function clampInteger(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max));
}
