import test from "node:test";
import assert from "node:assert/strict";

import createPlugin, { PILOT_HELM_ANGLE_PATH } from "../plugin/index.js";

test("publishes a gated pilot helm angle and clears it outside engaged modes", () => {
  const values = {
    "steering.rudderAngle": { value: Math.PI / 12 },
    "steering.autopilot.state": { value: "standby" },
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
  ]);
  assert.equal(projectedValue(messages.at(-1)), null);

  values["steering.autopilot.state"] = { value: "heading" };
  handleDelta({ updates: [] });
  assert.equal(projectedValue(messages.at(-1)), Math.PI / 12);

  values["steering.rudderAngle"] = { value: -Math.PI / 18 };
  handleDelta({ updates: [] });
  assert.equal(projectedValue(messages.at(-1)), -Math.PI / 18);

  values["steering.autopilot.state"] = { value: "standby" };
  handleDelta({ updates: [] });
  assert.equal(projectedValue(messages.at(-1)), null);

  const messageCount = messages.length;
  handleDelta({ updates: [] });
  assert.equal(messages.length, messageCount, "unchanged values are not republished");

  plugin.stop();
  assert.equal(unsubscribed, true);
});

function projectedValue(message) {
  assert.equal(message.id, "signalk-ajrm-marine-instruments");
  const value = message.delta.updates[0].values[0];
  assert.equal(value.path, PILOT_HELM_ANGLE_PATH);
  return value.value;
}
