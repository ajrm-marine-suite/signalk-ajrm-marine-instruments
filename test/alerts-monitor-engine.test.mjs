import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateRatePerMinute,
  convertValue,
  createMonitorState,
  evaluateMonitor,
} from "../plugin/lib/monitor-engine.js";

const depthMonitor = {
  id: "depth",
  label: "Depth below keel",
  path: "environment.depth.belowKeel",
  unit: "metres",
  decimals: 1,
  hysteresis: 0.2,
  levels: {
    information: { minimum: 5, repeatSeconds: 300 },
    warning: { minimum: 3, repeatSeconds: 60 },
    danger: { minimum: 2, repeatSeconds: 15 },
  },
};

test("converts common Signal K units", () => {
  assert.equal(Math.round(convertValue(289.75, { conversion: "kelvinToCelsius" }) * 10) / 10, 16.6);
  assert.equal(Math.round(convertValue(5, { conversion: "metersPerSecondToKnots" }) * 10) / 10, 9.7);
  assert.equal(convertValue(Math.PI, { conversion: "radiansToDegrees" }), 180);
  assert.ok(
    Math.abs(convertValue(-Math.PI / 12, {
      conversion: "radiansToDegrees",
      absoluteValue: true,
    }) - 15) < 1e-9,
  );
});

test("absolute-value monitoring applies the same maximum threshold to both signs", () => {
  const monitor = {
    id: "pilot-helm",
    label: "Pilot helm",
    path: "plugins.ajrmMarineInstruments.pilotHelmAngle",
    unit: "degrees",
    conversion: "radiansToDegrees",
    absoluteValue: true,
    directionMode: "portStarboard",
    enabled: true,
    levels: {
      danger: { enabled: true, maximum: 12, repeatSeconds: 15 },
      warning: { enabled: false, repeatSeconds: 60 },
      information: { enabled: false, repeatSeconds: 300 },
    },
  };

  const port = evaluateMonitor({
    monitor,
    rawValue: -15 * Math.PI / 180,
    timestamp: Date.parse("2026-08-02T12:00:00Z"),
    state: createMonitorState(),
  });
  const starboard = evaluateMonitor({
    monitor,
    rawValue: 15 * Math.PI / 180,
    timestamp: Date.parse("2026-08-02T12:01:00Z"),
    state: createMonitorState(),
  });

  assert.equal(port.event?.level, "danger");
  assert.ok(Math.abs(port.event?.value - 15) < 1e-9);
  assert.ok(Math.abs(port.event?.signedValue + 15) < 1e-9);
  assert.equal(port.event?.direction, "to Port");
  assert.match(port.event?.message, /15\.0 degrees to Port/);
  assert.equal(starboard.event?.level, "danger");
  assert.ok(Math.abs(starboard.event?.value - 15) < 1e-9);
  assert.equal(starboard.event?.direction, "to Starboard");
  assert.match(starboard.event?.message, /15\.0 degrees to Starboard/);
});

test("an active Port-to-Starboard XTE change announces immediately", () => {
  const monitor = {
    id: "cross-track-error",
    label: "Cross track error",
    unit: "metres",
    absoluteValue: true,
    directionMode: "portStarboard",
    levels: {
      danger: { enabled: false },
      warning: { enabled: true, maximum: 50, repeatSeconds: 300 },
      information: { enabled: false },
    },
  };

  let result = evaluateMonitor({
    monitor,
    rawValue: -55,
    timestamp: 1000,
    state: createMonitorState(),
  });
  assert.match(result.event?.message, /55\.0 metres to Port/);

  result = evaluateMonitor({
    monitor,
    rawValue: 55,
    timestamp: 2000,
    state: result.state,
  });
  assert.match(result.event?.message, /55\.0 metres to Starboard/);
  assert.equal(result.state.activeDirection, "to Starboard");
});

test("a missing XTE value cannot activate an alert and clears an active alert", () => {
  const monitor = {
    id: "cross-track-error",
    label: "Cross track error",
    path: "plugins.ajrmMarineInstruments.crossTrackError",
    unit: "metres",
    absoluteValue: true,
    enabled: true,
    levels: {
      danger: { enabled: true, maximum: 100, repeatSeconds: 15 },
      warning: { enabled: true, maximum: 50, repeatSeconds: 60 },
      information: { enabled: true, maximum: 25, repeatSeconds: 300 },
    },
  };

  let result = evaluateMonitor({
    monitor,
    rawValue: null,
    timestamp: 1000,
    state: createMonitorState(),
  });
  assert.equal(result.state.activeLevel, null);
  assert.equal(result.event, null);

  result = evaluateMonitor({
    monitor,
    rawValue: -55,
    timestamp: 2000,
    state: result.state,
  });
  assert.equal(result.state.activeLevel, "warning");

  result = evaluateMonitor({
    monitor,
    rawValue: null,
    timestamp: 3000,
    state: result.state,
  });
  assert.equal(result.state.activeLevel, null);
  assert.equal(result.event, null);
  assert.equal(result.cleared, true);
});

test("selects the highest matching depth severity", () => {
  let result = evaluateMonitor({
    monitor: depthMonitor,
    rawValue: 4.5,
    timestamp: 1000,
    state: createMonitorState(),
  });
  assert.equal(result.state.activeLevel, "information");
  assert.match(result.event.message, /Information/);

  result = evaluateMonitor({
    monitor: depthMonitor,
    rawValue: 2.8,
    timestamp: 2000,
    state: result.state,
  });
  assert.equal(result.state.activeLevel, "warning");
  assert.match(result.event.message, /Warning/);

  result = evaluateMonitor({
    monitor: depthMonitor,
    rawValue: 1.9,
    timestamp: 3000,
    state: result.state,
  });
  assert.equal(result.state.activeLevel, "danger");
  assert.match(result.event.message, /Danger/);
});

test("holds an active low trigger until hysteresis is cleared", () => {
  let result = evaluateMonitor({
    monitor: depthMonitor,
    rawValue: 2.9,
    timestamp: 1000,
    state: createMonitorState(),
  });
  assert.equal(result.state.activeLevel, "warning");

  result = evaluateMonitor({
    monitor: depthMonitor,
    rawValue: 3.1,
    timestamp: 2000,
    state: result.state,
  });
  assert.equal(result.state.activeLevel, "warning");

  result = evaluateMonitor({
    monitor: depthMonitor,
    rawValue: 3.3,
    timestamp: 3000,
    state: result.state,
  });
  assert.equal(result.state.activeLevel, "information");
});

test("repeats each level on its own interval", () => {
  let result = evaluateMonitor({
    monitor: depthMonitor,
    rawValue: 1.8,
    timestamp: 0,
    state: createMonitorState(),
  });
  assert.ok(result.event);

  result = evaluateMonitor({
    monitor: depthMonitor,
    rawValue: 1.8,
    timestamp: 14000,
    state: result.state,
  });
  assert.equal(result.event, null);

  result = evaluateMonitor({
    monitor: depthMonitor,
    rawValue: 1.8,
    timestamp: 15000,
    state: result.state,
  });
  assert.ok(result.event);
});

test("calculates and triggers a rise rate per minute", () => {
  const temperatureMonitor = {
    id: "engine-temperature",
    label: "Engine room temperature",
    unit: "degrees Celsius",
    conversion: "kelvinToCelsius",
    decimals: 1,
    rateWindowSeconds: 60,
    minimumRateSampleSeconds: 10,
    levels: {
      information: { risePerMinute: 1, repeatSeconds: 300 },
      warning: { risePerMinute: 2, repeatSeconds: 60 },
      danger: { risePerMinute: 4, repeatSeconds: 15 },
    },
  };
  let result = evaluateMonitor({
    monitor: temperatureMonitor,
    rawValue: 293.15,
    timestamp: 0,
    state: createMonitorState(),
  });
  result = evaluateMonitor({
    monitor: temperatureMonitor,
    rawValue: 293.65,
    timestamp: 15000,
    state: result.state,
  });
  assert.equal(result.state.ratePerMinute, 2);
  assert.equal(result.state.activeLevel, "warning");
  assert.match(result.event.message, /rising at 2.0 degrees Celsius per minute/);
});

test("rate calculation waits for the minimum sample duration", () => {
  assert.equal(
    calculateRatePerMinute(
      [
        { value: 10, timestamp: 0 },
        { value: 11, timestamp: 5000 },
      ],
      10,
    ),
    null,
  );
  assert.equal(
    calculateRatePerMinute(
      [
        { value: 10, timestamp: 0 },
        { value: 11, timestamp: 30000 },
      ],
      10,
    ),
    2,
  );
});

