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

const NAVIGATION_REFERENCE_NOW = "2026-07-27T12:00:00.000Z";
const NAVIGATION_REFERENCE_NOW_MS = Date.parse(NAVIGATION_REFERENCE_NOW);

test("cardinalDirection maps degrees to compass labels", () => {
  assert.equal(cardinalDirection(0), "N");
  assert.equal(cardinalDirection(44), "NE");
  assert.equal(cardinalDirection(181), "S");
  assert.equal(cardinalDirection(281), "W");
});

test("signalKAngleToDegrees treats Signal K angle values as radians", () => {
  assert.equal(signalKAngleToDegrees(Math.PI), 180);
  assert.equal(Math.round(signalKAngleToDegrees(270)), 350);
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
    "environment.current.drift": { value: 9.9 },
    "environment.current.setTrue": { value: 0 },
    "navigation.position": { value: { latitude: 56.1234567, longitude: -5.9876543, altitude: 7.2 } },
    "navigation.gnss.horizontalAccuracy": { value: 4.6 },
    "navigation.gnss.horizontalDilution": { value: 0.9 },
    "navigation.gnss.positionDilution": { value: 1.4 },
    "navigation.gnss.satellites": { value: 11 },
    "navigation.gnss.type": { value: "GPS" },
    "navigation.gnss.methodQuality": { value: "GNSS fix" },
    "environment.inside.engineRoom.temperature": { value: 289.75 },
    "environment.water.temperature": { value: 285.15 },
    "steering.rudderAngle": { value: -Math.PI / 12 },
    "plugins.ajrmMarineNavigationReference.state": {
      value: {
        contract: "ajrm-marine-navigation-reference",
        schemaVersion: 1,
        updatedAt: NAVIGATION_REFERENCE_NOW,
        position: {
          value: { latitude: 56.1234567, longitude: -5.9876543, altitude: 7.2 },
        },
        groundTrack: {
          courseTrue: { value: Math.PI / 2 },
          speedOverGround: { value: 1.5 },
          quality: {
            horizontalDilution: 0.9,
            satellites: 11,
            type: "GPS",
            methodQuality: "GNSS fix",
            integrity: "safe",
            source: "YDEN.43",
            evidence: "same-source-gnss-quality",
          },
        },
        bowHeadingTrue: {
          value: Math.PI,
          source: "YDEN.4",
          method: "magnetic-heading-plus-wmm",
        },
        clockReference: {
          value: Math.PI,
          kind: "heading",
          source: "YDEN.4",
          method: "magnetic-heading-plus-wmm",
          gpsDependent: false,
        },
        current: {
          setTrue: Math.PI * 1.25,
          drift: 0.35,
          source: "independent-current-sensor",
          origin: "independent-sensor",
          gpsDependent: false,
        },
      },
    },
  };
  const app = {
    getSelfPath(path) {
      return values[path];
    },
  };

  const state = buildInstrumentState(app, {
    version: "0.1.0",
    depthSource: "belowKeel",
    nowMs: NAVIGATION_REFERENCE_NOW_MS,
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
  assert.equal(state.gps.integrity, "safe");
  assert.equal(state.gps.qualitySource, "YDEN.43");
  assert.equal(state.navigation.sogKnots, 2.9);
  assert.equal(state.navigation.cogCardinal, "E");
  assert.equal(state.navigation.headingTrueDegrees, 180);
  assert.equal(state.navigation.referenceKind, "heading");
  assert.equal(state.navigation.referenceSource, "YDEN.4");
  assert.equal(state.current.source, "independent-current-sensor");
  assert.equal(state.current.gpsDependent, false);
  assert.equal(state.exhaustWater.temperatureCelsius, 16.6);
  assert.equal(state.engineRoom.temperatureCelsius, 16.6);
  assert.equal(state.water.temperatureCelsius, 12);
  assert.equal(state.rudder.angleDegrees, -15);
  assert.equal(state.paths.waterTemperature, "environment.water.temperature");
  assert.equal(state.paths.rudderAngle, "steering.rudderAngle");
});

test("does not present unqualified Signal K set and drift as current", () => {
  const values = {
    "environment.current.drift": { value: 1.2 },
    "environment.current.setTrue": { value: Math.PI / 2 },
    "navigation.courseOverGroundTrue": { value: Math.PI / 2 },
    "environment.wind.angleTrue": { value: Math.PI / 4 },
  };
  const app = {
    getSelfPath(path) {
      return values[path];
    },
  };

  const state = buildInstrumentState(app);

  assert.equal(state.current.driftKnots, null);
  assert.equal(state.current.setTrueDegrees, null);
  assert.equal(state.current.setRelativeDegrees, null);
  assert.equal(state.wind.true.directionDegrees, null);
});

test("does not fall back to raw navigation when the provider is present but unavailable", () => {
  const values = {
    "environment.wind.angleTrue": { value: Math.PI / 4 },
    "navigation.headingTrue": { value: Math.PI },
    "navigation.courseOverGroundTrue": { value: Math.PI / 2 },
    "navigation.speedOverGround": { value: 1.5 },
    "navigation.position": {
      value: { latitude: 56.1234567, longitude: -5.9876543 },
    },
    "plugins.ajrmMarineNavigationReference.state": {
      value: {
        contract: "ajrm-marine-navigation-reference",
        schemaVersion: 1,
        updatedAt: NAVIGATION_REFERENCE_NOW,
        status: "unavailable",
        position: null,
        groundTrack: null,
        bowHeadingTrue: null,
        clockReference: null,
      },
    },
  };
  const app = {
    getSelfPath(path) {
      return values[path];
    },
  };

  const state = buildInstrumentState(app, {
    nowMs: NAVIGATION_REFERENCE_NOW_MS,
  });

  assert.equal(state.gps.latitude, null);
  assert.equal(state.navigation.cogDegrees, null);
  assert.equal(state.navigation.sogKnots, null);
  assert.equal(state.navigation.headingTrueDegrees, null);
  assert.equal(state.wind.true.directionDegrees, null);
});

test("does not fall back to raw navigation for a wrong or unsupported provider contract", () => {
  for (const invalidReference of [
    {
      contract: "unexpected-provider",
      schemaVersion: 1,
    },
    {
      contract: "ajrm-marine-navigation-reference",
      schemaVersion: 2,
    },
  ]) {
    const values = {
      "environment.wind.angleTrue": { value: Math.PI / 4 },
      "navigation.headingTrue": { value: Math.PI },
      "navigation.courseOverGroundTrue": { value: Math.PI / 2 },
      "navigation.speedOverGround": { value: 1.5 },
      "navigation.position": {
        value: { latitude: 56.1234567, longitude: -5.9876543 },
      },
      "navigation.gnss.horizontalDilution": { value: 0.9 },
      "navigation.gnss.satellites": { value: 11 },
      "navigation.gnss.type": { value: "GPS" },
      "navigation.gnss.methodQuality": { value: "GNSS fix" },
      "navigation.gnss.integrity": { value: "safe" },
      "plugins.ajrmMarineNavigationReference.state": {
        value: invalidReference,
      },
    };
    const app = {
      getSelfPath(path) {
        return values[path];
      },
    };

    const state = buildInstrumentState(app);

    assert.equal(state.gps.latitude, null);
    assert.equal(state.gps.longitude, null);
    assert.equal(state.gps.horizontalDilution, null);
    assert.equal(state.gps.satellites, null);
    assert.equal(state.gps.type, "");
    assert.equal(state.gps.methodQuality, "");
    assert.equal(state.gps.integrity, "");
    assert.equal(state.navigation.cogDegrees, null);
    assert.equal(state.navigation.sogKnots, null);
    assert.equal(state.navigation.headingTrueDegrees, null);
    assert.equal(state.navigation.referenceKind, null);
    assert.equal(state.wind.true.directionDegrees, null);
  }
});

test("uses raw true navigation only while the provider path is absent", () => {
  const values = {
    "navigation.headingTrue": { value: 0 },
    "navigation.courseOverGroundTrue": { value: Math.PI / 2 },
    "navigation.speedOverGround": { value: 1.5 },
    "navigation.position": {
      value: { latitude: 56.1234567, longitude: -5.9876543 },
    },
  };
  const app = {
    getSelfPath(path) {
      return values[path];
    },
  };

  const state = buildInstrumentState(app);

  assert.equal(state.gps.latitude, 56.123457);
  assert.equal(state.navigation.cogDegrees, 90);
  assert.equal(state.navigation.sogKnots, 2.9);
  assert.equal(state.navigation.headingTrueDegrees, 0);
});

test("withholds provider-owned navigation when updatedAt is missing, invalid, or stale", () => {
  for (const updatedAt of [
    undefined,
    "not-a-timestamp",
    "2026-07-27T11:59:44.999Z",
  ]) {
    const values = {
      "navigation.headingTrue": { value: Math.PI },
      "navigation.courseOverGroundTrue": { value: Math.PI / 2 },
      "navigation.speedOverGround": { value: 1.5 },
      "navigation.position": {
        value: { latitude: 56.1234567, longitude: -5.9876543 },
      },
      "plugins.ajrmMarineNavigationReference.state": {
        value: {
          contract: "ajrm-marine-navigation-reference",
          schemaVersion: 1,
          updatedAt,
          position: {
            value: { latitude: 55.9, longitude: -5.7 },
          },
          groundTrack: {
            courseTrue: { value: 0 },
            speedOverGround: { value: 2 },
          },
          bowHeadingTrue: { value: 0 },
          clockReference: { value: 0, kind: "heading" },
        },
      },
    };
    const app = {
      getSelfPath(path) {
        return values[path];
      },
    };

    const state = buildInstrumentState(app, {
      nowMs: NAVIGATION_REFERENCE_NOW_MS,
    });

    assert.equal(state.gps.latitude, null);
    assert.equal(state.navigation.cogDegrees, null);
    assert.equal(state.navigation.sogKnots, null);
    assert.equal(state.navigation.headingTrueDegrees, null);
    assert.equal(state.navigation.referenceKind, null);
  }
});
