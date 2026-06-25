"use strict";

const packageInfo = require("../package.json");
const { buildInstrumentState } = require("./lib/instruments");

const PLUGIN_ID = "signalk-ajrm-marine-instruments";

module.exports = function ajrmMarineInstruments(app) {
  const plugin = {};
  let options = normalizeOptions({});

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
    app.setPluginStatus(`Started v${packageInfo.version}`);
  };

  plugin.stop = () => {};

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
