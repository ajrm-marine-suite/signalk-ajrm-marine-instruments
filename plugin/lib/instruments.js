"use strict";

const MS_TO_KNOTS = 1.9438444924406048;
const NAVIGATION_REFERENCE_MAX_AGE_MS = 15_000;

const CARDINALS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

const BEAUFORT = [
  { force: 0, max: 0.2, label: "Calm" },
  { force: 1, max: 1.5, label: "Light air" },
  { force: 2, max: 3.3, label: "Light breeze" },
  { force: 3, max: 5.4, label: "Gentle breeze" },
  { force: 4, max: 7.9, label: "Moderate breeze" },
  { force: 5, max: 10.7, label: "Fresh breeze" },
  { force: 6, max: 13.8, label: "Strong breeze" },
  { force: 7, max: 17.1, label: "Near gale" },
  { force: 8, max: 20.7, label: "Gale" },
  { force: 9, max: 24.4, label: "Strong gale" },
  { force: 10, max: 28.4, label: "Storm" },
  { force: 11, max: 32.6, label: "Violent storm" },
  { force: 12, max: Infinity, label: "Hurricane" },
];

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, decimals = 1) {
  const number = finiteNumber(value);
  if (number == null) return null;
  const scale = 10 ** decimals;
  return Math.round(number * scale) / scale;
}

function signalKAngleToDegrees(value) {
  const number = finiteNumber(value);
  if (number == null) return null;
  return normalizeDegrees((number * 180) / Math.PI);
}

function normalizeDegrees(value) {
  const number = finiteNumber(value);
  if (number == null) return null;
  return ((number % 360) + 360) % 360;
}

function relativeDegrees(value) {
  const number = finiteNumber(value);
  if (number == null) return null;
  const degrees = (number * 180) / Math.PI;
  let normalized = ((degrees % 360) + 360) % 360;
  if (normalized > 180) normalized -= 360;
  return normalized;
}

function cardinalDirection(degrees) {
  const number = normalizeDegrees(degrees);
  if (number == null) return "";
  return CARDINALS[Math.round(number / 22.5) % CARDINALS.length];
}

function beaufortFromMetersPerSecond(speed) {
  const number = finiteNumber(speed);
  if (number == null) return null;
  return BEAUFORT.find((entry) => number <= entry.max) || BEAUFORT[BEAUFORT.length - 1];
}

function knotsFromMetersPerSecond(speed) {
  const number = finiteNumber(speed);
  return number == null ? null : number * MS_TO_KNOTS;
}

function celsiusFromKelvin(temperature) {
  const number = finiteNumber(temperature);
  return number == null ? null : number - 273.15;
}

function unwrapSignalKValue(entry) {
  if (entry && typeof entry === "object" && Object.hasOwn(entry, "value")) return entry.value;
  return entry;
}

function readSelfRaw(app, path) {
  if (!path || typeof app?.getSelfPath !== "function") return null;
  return unwrapSignalKValue(app.getSelfPath(path));
}

function readSelfValue(app, path) {
  return finiteNumber(readSelfRaw(app, path));
}

function buildInstrumentState(app, options = {}) {
  const requestedNowMs = Number(options.nowMs);
  const nowMs = Number.isFinite(requestedNowMs) ? requestedNowMs : Date.now();
  const navigationReferenceSelection = readNavigationReference(app, nowMs);
  const navigationReference = navigationReferenceSelection.value;
  const navigationReferencePresent = navigationReferenceSelection.present;
  const depthPath = depthSignalKPath(options.depthSource);
  const depthMeters = readSelfValue(app, depthPath);
  const apparentWindSpeed = readSelfValue(app, "environment.wind.speedApparent");
  const trueWindSpeed = readSelfValue(app, "environment.wind.speedTrue");
  const apparentWindAngle = readSelfValue(app, "environment.wind.angleApparent");
  const trueWindAngle = readSelfValue(app, "environment.wind.angleTrue");
  const trueWindDirection =
    signalKAngleToDegrees(readSelfValue(app, "environment.wind.directionTrue")) ??
    deriveTrueWindDirection(
      app,
      trueWindAngle,
      navigationReference,
      navigationReferencePresent,
    );
  const qualifiedCurrent = independentCurrent(navigationReference?.current);
  const currentDrift = qualifiedCurrent?.drift ?? null;
  const currentSetTrue = signalKAngleToDegrees(qualifiedCurrent?.setTrue);
  const position = navigationReferencePresent
    ? navigationReference?.position?.value
    : readSelfRaw(app, "navigation.position");
  const cog = signalKAngleToDegrees(
    navigationReferencePresent
      ? navigationReference?.groundTrack?.courseTrue?.value
      : readSelfValue(app, "navigation.courseOverGroundTrue"),
  );
  const sog = navigationReferencePresent
    ? finiteNumber(navigationReference?.groundTrack?.speedOverGround?.value)
    : readSelfValue(app, "navigation.speedOverGround");
  const bowHeadingTrue = finiteNumber(
    navigationReferencePresent
      ? navigationReference?.bowHeadingTrue?.value
      : readSelfValue(app, "navigation.headingTrue"),
  );
  const clockReference = navigationReference?.clockReference;
  const gnssQuality = navigationReference?.groundTrack?.quality;
  const exhaustWaterTemperature = readSelfValue(
    app,
    options.exhaustWaterTemperaturePath ||
      options.engineRoomTemperaturePath ||
      "environment.inside.engineRoom.temperature",
  );
  const rudderAngle = readSelfValue(app, "steering.rudderAngle");
  const waterTemperature = readSelfValue(app, "environment.water.temperature");
  const beaufort = beaufortFromMetersPerSecond(trueWindSpeed);

  return {
    ok: true,
    plugin: "signalk-ajrm-marine-instruments",
    version: options.version || "0.0.0",
    timestamp: new Date(nowMs).toISOString(),
    paths: {
      depth: depthPath,
      exhaustWaterTemperature:
        options.exhaustWaterTemperaturePath ||
        options.engineRoomTemperaturePath ||
        "environment.inside.engineRoom.temperature",
      rudderAngle: "steering.rudderAngle",
      waterTemperature: "environment.water.temperature",
    },
    depth: {
      meters: round(depthMeters, 2),
      source: options.depthSource || "belowKeel",
    },
    wind: {
      apparent: {
        speedKnots: round(knotsFromMetersPerSecond(apparentWindSpeed), 1),
        speedMetersPerSecond: round(apparentWindSpeed, 1),
        angleDegrees: round(relativeDegrees(apparentWindAngle), 0),
      },
      true: {
        speedKnots: round(knotsFromMetersPerSecond(trueWindSpeed), 1),
        speedMetersPerSecond: round(trueWindSpeed, 1),
        angleDegrees: round(relativeDegrees(trueWindAngle), 0),
        directionDegrees: round(trueWindDirection, 0),
        cardinal: cardinalDirection(trueWindDirection),
        beaufortForce: beaufort?.force ?? null,
        beaufortLabel: beaufort?.label || "",
      },
    },
    current: {
      driftKnots: round(knotsFromMetersPerSecond(currentDrift), 1),
      driftMetersPerSecond: round(currentDrift, 2),
      setTrueDegrees: round(currentSetTrue, 0),
      setRelativeDegrees: round(
        relativeDirectionFromVessel(
          app,
          currentSetTrue,
          navigationReference,
          navigationReferencePresent,
        ),
        0,
      ),
      setCardinal: cardinalDirection(currentSetTrue),
      origin: qualifiedCurrent?.origin || null,
      source: qualifiedCurrent?.source || null,
      gpsDependent: qualifiedCurrent?.gpsDependent ?? null,
    },
    gps: {
      latitude: round(position?.latitude, 6),
      longitude: round(position?.longitude, 6),
      altitudeMeters: round(position?.altitude, 1),
      horizontalAccuracyMeters: round(
        readFirstValue(app, [
          "navigation.gnss.horizontalAccuracy",
          "navigation.gnss.estimatedHorizontalPositionError",
        ]),
        1,
      ),
      horizontalDilution: round(
        navigationReferencePresent
          ? finiteNumber(gnssQuality?.horizontalDilution)
          : readSelfValue(app, "navigation.gnss.horizontalDilution"),
        1,
      ),
      positionDilution: round(readSelfValue(app, "navigation.gnss.positionDilution"), 1),
      satellites: round(
        navigationReferencePresent
          ? finiteNumber(gnssQuality?.satellites)
          : readSelfValue(app, "navigation.gnss.satellites"),
        0,
      ),
      type: navigationReferencePresent
        ? stringValue(gnssQuality?.type)
        : stringValue(readSelfRaw(app, "navigation.gnss.type")),
      methodQuality: navigationReferencePresent
        ? stringValue(gnssQuality?.methodQuality)
        : stringValue(readSelfRaw(app, "navigation.gnss.methodQuality")),
      integrity: navigationReferencePresent
        ? stringValue(gnssQuality?.integrity)
        : stringValue(readSelfRaw(app, "navigation.gnss.integrity")),
      qualitySource: navigationReferencePresent
        ? stringValue(gnssQuality?.source)
        : "",
      qualityEvidence: navigationReferencePresent
        ? stringValue(gnssQuality?.evidence)
        : "",
    },
    navigation: {
      cogDegrees: round(cog, 0),
      cogCardinal: cardinalDirection(cog),
      sogKnots: round(knotsFromMetersPerSecond(sog), 1),
      headingTrueDegrees: round(signalKAngleToDegrees(bowHeadingTrue), 0),
      referenceKind: clockReference?.kind || null,
      referenceDegreesTrue: round(
        signalKAngleToDegrees(clockReference?.value),
        0,
      ),
      referenceSource: clockReference?.source || null,
      referenceMethod: clockReference?.method || null,
      referenceGpsDependent: clockReference?.gpsDependent ?? null,
    },
    rudder: {
      angleDegrees: round(relativeDegrees(rudderAngle), 1),
    },
    water: {
      temperatureCelsius: round(celsiusFromKelvin(waterTemperature), 1),
    },
    exhaustWater: {
      temperatureCelsius: round(celsiusFromKelvin(exhaustWaterTemperature), 1),
    },
    engineRoom: {
      temperatureCelsius: round(celsiusFromKelvin(exhaustWaterTemperature), 1),
    },
  };
}

function readFirstValue(app, paths) {
  for (const path of paths) {
    const value = readSelfValue(app, path);
    if (value != null) return value;
  }
  return null;
}

function stringValue(value) {
  if (value == null) return "";
  return String(value);
}

function depthSignalKPath(source) {
  const normalized = String(source || "belowKeel");
  if (normalized === "belowSurface") return "environment.depth.belowSurface";
  if (normalized === "belowTransducer") return "environment.depth.belowTransducer";
  return "environment.depth.belowKeel";
}

function deriveTrueWindDirection(
  app,
  trueWindAngle,
  navigationReference,
  navigationReferencePresent,
) {
  const angle = relativeDegrees(trueWindAngle);
  if (angle == null) return null;
  const heading = signalKAngleToDegrees(
    navigationReferencePresent
      ? navigationReference?.bowHeadingTrue?.value
      : readSelfValue(app, "navigation.headingTrue"),
  );
  return heading == null ? null : normalizeDegrees(heading + angle);
}

function relativeDirectionFromVessel(
  app,
  trueDirectionDegrees,
  navigationReference,
  navigationReferencePresent,
) {
  const directionDegrees = finiteNumber(trueDirectionDegrees);
  if (directionDegrees == null) return null;
  const heading = signalKAngleToDegrees(
    navigationReferencePresent
      ? navigationReference?.bowHeadingTrue?.value
      : readSelfValue(app, "navigation.headingTrue"),
  );
  if (heading == null) return null;
  let relative = ((directionDegrees - heading) % 360 + 360) % 360;
  if (relative > 180) relative -= 360;
  return relative;
}

function readNavigationReference(app, nowMs) {
  if (typeof app?.getSelfPath !== "function") {
    return { present: false, value: null };
  }
  const entry = app.getSelfPath("plugins.ajrmMarineNavigationReference.state");
  if (entry === null || entry === undefined) {
    return { present: false, value: null };
  }
  const value = unwrapSignalKValue(entry);
  if (
    !value ||
    typeof value !== "object" ||
    value.contract !== "ajrm-marine-navigation-reference" ||
    value.schemaVersion !== 1
  ) {
    return { present: true, value: null };
  }
  const updatedAtMs = Date.parse(value.updatedAt);
  if (
    !Number.isFinite(updatedAtMs) ||
    Math.abs(nowMs - updatedAtMs) > NAVIGATION_REFERENCE_MAX_AGE_MS
  ) {
    return { present: true, value: null };
  }
  return { present: true, value };
}

function independentCurrent(value) {
  if (
    !value ||
    typeof value !== "object" ||
    finiteNumber(value.setTrue) == null ||
    finiteNumber(value.drift) == null ||
    value.gpsDependent !== false ||
    !String(value.source || "").trim() ||
    !String(value.origin || "").trim()
  ) {
    return null;
  }
  return value;
}

module.exports = {
  BEAUFORT,
  beaufortFromMetersPerSecond,
  buildInstrumentState,
  cardinalDirection,
  celsiusFromKelvin,
  depthSignalKPath,
  knotsFromMetersPerSecond,
  relativeDegrees,
  signalKAngleToDegrees,
};
