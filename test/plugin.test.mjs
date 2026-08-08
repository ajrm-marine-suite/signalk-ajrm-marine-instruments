import test from "node:test";
import assert from "node:assert/strict";

import createPlugin, {
  CROSS_TRACK_ERROR_PATH,
  DEFAULT_VISIBLE_INSTRUMENTS,
  PILOT_HELM_ANGLE_PATH,
} from "../plugin/index.js";

test("publishes a gated pilot helm angle and clears it outside engaged modes", () => {
  const values = {
    "steering.rudderAngle": { value: Math.PI / 12 },
    "steering.autopilot.state": { value: "standby" },
    "navigation.course.calcValues.crossTrackError": { value: -12.4 },
  };
  const messages = [];
  const subscriptions = [];
  let handleDelta = null;
  let unsubscribed = false;
  const app = {
    getSelfPath(path) {
      return values[path];
    },
    setPluginStatus() {},
    handleMessage(id, delta) {
      messages.push({ id, delta });
    },
    subscriptionmanager: {
      subscribe(request, unsubscribes, _onError, callback) {
        subscriptions.push(request);
        handleDelta = callback;
        unsubscribes.push(() => { unsubscribed = true; });
      },
    },
  };
  const plugin = createPlugin(app);

  plugin.start();
  assert.deepEqual(subscriptions[0].subscribe.map((entry) => entry.path), [
    "steering.rudderAngle",
    "steering.autopilot.state",
    "navigation.course.calcValues.crossTrackError",
    "navigation.courseGreatCircle.crossTrackError",
    "navigation.courseRhumbline.crossTrackError",
  ]);
  assert.equal(projectedValue(messages, PILOT_HELM_ANGLE_PATH), null);
  assert.equal(projectedValue(messages, CROSS_TRACK_ERROR_PATH), -12.4);

  values["steering.autopilot.state"] = { value: "heading" };
  handleDelta({ updates: [] });
  assert.equal(projectedValue(messages, PILOT_HELM_ANGLE_PATH), Math.PI / 12);

  values["steering.rudderAngle"] = { value: -Math.PI / 18 };
  handleDelta({ updates: [] });
  assert.equal(projectedValue(messages, PILOT_HELM_ANGLE_PATH), -Math.PI / 18);

  values["navigation.course.calcValues.crossTrackError"] = { value: null };
  handleDelta({ updates: [] });
  assert.equal(projectedValue(messages, CROSS_TRACK_ERROR_PATH), null);

  values["steering.autopilot.state"] = { value: "standby" };
  handleDelta({ updates: [] });
  assert.equal(projectedValue(messages, PILOT_HELM_ANGLE_PATH), null);

  const messageCount = messages.length;
  handleDelta({ updates: [] });
  assert.equal(messages.length, messageCount, "unchanged values are not republished");

  plugin.stop();
  assert.equal(unsubscribed, true);
});

test("exposes configurable instrument visibility and defaults every card to visible", () => {
  let statusHandler = null;
  const app = {
    getSelfPath() { return null; },
    setPluginStatus() {},
    handleMessage() {},
  };
  const plugin = createPlugin(app);
  plugin.registerWithRouter({
    get(path, handler) {
      if (path === "/status") statusHandler = handler;
    },
    put() {},
    post() {},
  });
  plugin.start({
    visibleInstruments: {
      crossTrackError: false,
      exhaustTemperature: false,
    },
  });

  let body = null;
  statusHandler({}, {
    json(value) { body = value; },
    status() { return this; },
  });

  assert.deepEqual(Object.keys(plugin.schema.properties.visibleInstruments.properties), Object.keys(DEFAULT_VISIBLE_INSTRUMENTS));
  assert.equal(body.controls.visibleInstruments.depth, true);
  assert.equal(body.controls.visibleInstruments.wind, true);
  assert.equal(body.controls.visibleInstruments.crossTrackError, false);
  assert.equal(body.controls.visibleInstruments.exhaustTemperature, false);
  assert.equal(app.ajrmMarineInstrumentsApi.pluginId, "signalk-ajrm-marine-instruments");
  assert.deepEqual(app.ajrmMarineInstrumentsApi.status().derivedPaths, body.derivedPaths);
  assert.equal(body.derivedPaths.contract, "ajrm-marine-instruments-derived-paths-v1");
  assert.equal(body.derivedPaths.pilotHelmAngle.unit, "rad");
  assert.equal(body.derivedPaths.pilotHelmAngle.nullUnlessAutopilotEngaged, true);
  assert.deepEqual(body.derivedPaths.pilotHelmAngle.autopilotEngagedStates, ["auto", "heading", "wind", "route"]);
  assert.equal(body.derivedPaths.crossTrackError.unit, "m");
  assert.equal(body.derivedPaths.crossTrackError.negativeDirection, "port");
  assert.equal(body.derivedPaths.crossTrackError.positiveDirection, "starboard");

  plugin.stop();
  assert.equal(app.ajrmMarineInstrumentsApi, undefined);
});

test("publishes OpenAPI and safely replaces subscriptions when restarted", () => {
  let subscriptions = 0;
  let unsubscriptions = 0;
  const app = {
    getSelfPath() { return null; },
    setPluginStatus() {},
    handleMessage() {},
    subscriptionmanager: {
      subscribe(_request, unsubscribes) {
        subscriptions += 1;
        unsubscribes.push(() => { unsubscriptions += 1; });
      },
    },
  };
  const plugin = createPlugin(app);
  assert.equal(plugin.getOpenApi().openapi, "3.0.3");
  assert.ok(plugin.getOpenApi().paths["/status"].get);

  plugin.start();
  plugin.start();
  assert.equal(subscriptions, 2);
  assert.equal(unsubscriptions, 1);
  plugin.stop();
  assert.equal(unsubscriptions, 2);
});

test("integrates the alert provider routes and status", () => {
  const routes = new Set();
  const app = {
    getSelfPath() { return null; },
    getDataDirPath() { return null; },
    setPluginStatus() {},
    handleMessage() {},
    error() {},
  };
  const plugin = createPlugin(app);
  plugin.registerWithRouter({
    get(path) { routes.add(`GET ${path}`); },
    put(path) { routes.add(`PUT ${path}`); },
    post(path) { routes.add(`POST ${path}`); },
  });
  plugin.start();

  assert.ok(routes.has("GET /alerts/status"));
  assert.ok(routes.has("GET /alerts/settings"));
  assert.ok(routes.has("PUT /alerts/settings"));
  assert.equal(app.ajrmMarineInstrumentsApi.status().alerts.enabled, false);
  assert.equal(app.ajrmMarineInstrumentsApi.status().alerts.capabilities.anchoringDepthCallout, true);
  plugin.stop();
});

function projectedValue(messages, expectedPath) {
  const message = messages.findLast((entry) =>
    entry.delta.updates[0].values[0].path === expectedPath
  );
  assert.equal(message.id, "signalk-ajrm-marine-instruments");
  const value = message.delta.updates[0].values[0];
  assert.equal(value.path, expectedPath);
  return value.value;
}
