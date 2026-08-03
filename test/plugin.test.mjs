import test from "node:test";
import assert from "node:assert/strict";

import createPlugin, {
  CROSS_TRACK_ERROR_PATH,
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

function projectedValue(messages, expectedPath) {
  const message = messages.findLast((entry) =>
    entry.delta.updates[0].values[0].path === expectedPath
  );
  assert.equal(message.id, "signalk-ajrm-marine-instruments");
  const value = message.delta.updates[0].values[0];
  assert.equal(value.path, expectedPath);
  return value.value;
}
