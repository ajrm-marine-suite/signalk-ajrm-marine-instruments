import test from "node:test";
import assert from "node:assert/strict";

import {
  beaufortFromMetersPerSecond,
  buildInstrumentState,
  cardinalDirection,
  celsiusFromKelvin,
  depthSignalKPath,
  signalKAngleToDegrees,
} from "../plugin/lib/instruments.js";

test("cardinalDirection maps degrees to compass labels", () => {
  assert.equal(cardinalDirection(0), "N");
  assert.equal(cardinalDirection(44), "NE");
  assert.equal(cardinalDirection(181), "S");
  assert.equal(cardinalDirection(281), "W");
});

test("signalKAngleToDegrees accepts radians and degree-like values", () => {
  assert.equal(signalKAngleToDegrees(Math.PI), 180);
  assert.equal(signalKAngleToDegrees(270), 270);
  assert.equal(signalKAngleToDegrees(-Math.PI / 2), 270);
});

test("beaufortFromMetersPerSecond returns force and label", () => {
  assert.equal(beaufortFromMetersPerSecond(0).force, 0);
  assert.equal(beaufortFromMetersPerSecond(5).force, 3);
  assert.equal(beaufortFromMetersPerSecond(40).force, 12);
});

test("celsiusFromKelvin converts Signal K temperature values", () => {
  assert.equal(Math.round(celsiusFromKelvin(289.75) * 10) / 10, 16.6);
});

test("depthSignalKPath chooses the configured source", () => {
  assert.equal(depthSignalKPath("belowKeel"), "environment.depth.belowKeel");
  assert.equal(depthSignalKPath("belowSurface"), "environment.depth.belowSurface");
  assert.equal(depthSignalKPath("belowTransducer"), "environment.depth.belowTransducer");
  assert.equal(depthSignalKPath("unknown"), "environment.depth.belowKeel");
});

test("buildInstrumentState converts common Signal K self values", () => {
  const values = {
    "environment.depth.belowKeel": { value: 3.53 },
    "environment.wind.speedApparent": { value: 2.57 },
    "environment.wind.angleApparent": { value: -Math.PI / 2 },
    "environment.wind.speedTrue": { value: 5 },
    "environment.wind.angleTrue": { value: Math.PI / 2 },
    "navigation.headingTrue": { value: Math.PI },
    "navigation.courseOverGroundTrue": { value: Math.PI / 2 },
    "navigation.speedOverGround": { value: 1.5 },
    "environment.current.drift": { value: 0.35 },
    "environment.current.setTrue": { value: Math.PI * 1.25 },
    "navigation.position": { value: { latitude: 56.1234567, longitude: -5.9876543, altitude: 7.2 } },
    "navigation.gnss.horizontalAccuracy": { value: 4.6 },
    "navigation.gnss.horizontalDilution": { value: 0.9 },
    "navigation.gnss.positionDilution": { value: 1.4 },
    "navigation.gnss.satellites": { value: 11 },
    "navigation.gnss.type": { value: "GPS" },
    "navigation.gnss.methodQuality": { value: "GNSS fix" },
    "environment.inside.engineRoom.temperature": { value: 289.75 },
  };
  const app = {
    getSelfPath(path) {
      return values[path];
    },
  };

  const state = buildInstrumentState(app, {
    version: "0.1.0",
    depthSource: "belowKeel",
  });
  assert.equal(state.depth.meters, 3.53);
  assert.equal(state.wind.apparent.speedKnots, 5);
  assert.equal(state.wind.apparent.angleDegrees, -90);
  assert.equal(state.wind.true.directionDegrees, 270);
  assert.equal(state.wind.true.cardinal, "W");
  assert.equal(state.current.driftKnots, 0.7);
  assert.equal(state.current.setTrueDegrees, 225);
  assert.equal(state.current.setRelativeDegrees, 45);
  assert.equal(state.current.setCardinal, "SW");
  assert.equal(state.gps.latitude, 56.123457);
  assert.equal(state.gps.longitude, -5.987654);
  assert.equal(state.gps.altitudeMeters, 7.2);
  assert.equal(state.gps.horizontalAccuracyMeters, 4.6);
  assert.equal(state.gps.horizontalDilution, 0.9);
  assert.equal(state.gps.positionDilution, 1.4);
  assert.equal(state.gps.satellites, 11);
  assert.equal(state.gps.type, "GPS");
  assert.equal(state.gps.methodQuality, "GNSS fix");
  assert.equal(state.navigation.sogKnots, 2.9);
  assert.equal(state.navigation.cogCardinal, "E");
  assert.equal(state.exhaustWater.temperatureCelsius, 16.6);
  assert.equal(state.engineRoom.temperatureCelsius, 16.6);
});
