/**
 * Implements the monitor engine responsibilities of the AJRM Marine Instruments Signal K server.
 */

"use strict";

const LEVELS = ["danger", "warning", "information"];
const DEFAULT_REPEATS = {
  information: 300,
  warning: 60,
  danger: 15,
};

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function convertValue(rawValue, monitor = {}) {
  return convertValueDetails(rawValue, monitor).value;
}

function convertValueDetails(rawValue, monitor = {}) {
  const raw = finiteNumber(unwrapSignalKValue(rawValue));
  if (raw == null) return { value: null, signedValue: null };

  let converted = raw;
  switch (monitor.conversion) {
    case "kelvinToCelsius":
      converted = raw - 273.15;
      break;
    case "metersPerSecondToKnots":
      converted = raw * 1.9438444924406048;
      break;
    case "radiansToDegrees":
      converted = (raw * 180) / Math.PI;
      break;
    default:
      break;
  }

  const scale = finiteNumber(monitor.scale) ?? 1;
  const offset = finiteNumber(monitor.offset) ?? 0;
  const adjusted = converted * scale + offset;
  return {
    value: monitor.absoluteValue === true ? Math.abs(adjusted) : adjusted,
    signedValue: adjusted,
  };
}

function unwrapSignalKValue(value) {
  if (value && typeof value === "object" && Object.hasOwn(value, "value")) {
    return value.value;
  }
  return value;
}

function createMonitorState() {
  return {
    samples: [],
    activeLevel: null,
    activeReason: null,
    activeDirection: null,
    activeSince: null,
    lastAnnouncedAt: null,
    lastValue: null,
    ratePerMinute: null,
    updatedAt: null,
  };
}

function evaluateMonitor({ monitor, rawValue, timestamp = Date.now(), state } = {}) {
  const current = state || createMonitorState();
  const converted = convertValueDetails(rawValue, monitor);
  const value = converted.value;
  if (value == null || monitor?.enabled === false) {
    return {
      state: {
        ...current,
        activeLevel: null,
        activeReason: null,
        activeDirection: null,
        activeSince: null,
        lastValue: value,
        updatedAt: new Date(timestamp).toISOString(),
      },
      event: null,
      cleared: current.activeLevel != null,
    };
  }

  const samples = appendSample(current.samples, value, timestamp, monitor?.rateWindowSeconds);
  const ratePerMinute = calculateRatePerMinute(samples, monitor?.minimumRateSampleSeconds);
  const standardMatch = findMatchingLevel(monitor, value, ratePerMinute, false);
  const activeHold = current.activeLevel
    ? matchLevel(monitor, current.activeLevel, value, ratePerMinute, true)
    : null;
  const heldMatch =
    activeHold &&
    (!standardMatch || LEVELS.indexOf(activeHold.level) <= LEVELS.indexOf(standardMatch.level))
      ? activeHold
      : standardMatch;
  const activeLevel = heldMatch?.level || null;
  const activeReason = heldMatch?.reason || null;
  const activeDirection = activeLevel
    ? directionPhrase(monitor, converted.signedValue)
    : null;
  const changed = activeLevel !== current.activeLevel;
  const directionChanged = Boolean(
    activeLevel && activeDirection && activeDirection !== current.activeDirection,
  );
  const repeatSeconds = repeatForLevel(monitor, activeLevel);
  const repeatDue =
    activeLevel &&
    current.lastAnnouncedAt != null &&
    timestamp - current.lastAnnouncedAt >= repeatSeconds * 1000;
  const shouldAnnounce = Boolean(activeLevel && (changed || directionChanged || repeatDue));

  const nextState = {
    samples,
    activeLevel,
    activeReason,
    activeDirection,
    activeSince: activeLevel
      ? changed
        ? new Date(timestamp).toISOString()
        : current.activeSince
      : null,
    lastAnnouncedAt: shouldAnnounce ? timestamp : current.lastAnnouncedAt,
    lastValue: value,
    ratePerMinute,
    updatedAt: new Date(timestamp).toISOString(),
  };

  return {
    state: nextState,
    event: shouldAnnounce
      ? buildAnnouncementEvent(
        monitor,
        activeLevel,
        activeReason,
        value,
        ratePerMinute,
        timestamp,
        converted.signedValue,
      )
      : null,
    cleared: current.activeLevel != null && activeLevel == null,
  };
}

function appendSample(existing, value, timestamp, configuredWindowSeconds) {
  const windowSeconds = clampNumber(configuredWindowSeconds, 60, 10, 3600);
  const cutoff = timestamp - windowSeconds * 1000;
  return [...(Array.isArray(existing) ? existing : []), { value, timestamp }]
    .filter((sample) => sample.timestamp >= cutoff && sample.timestamp <= timestamp)
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-600);
}

function calculateRatePerMinute(samples, configuredMinimumSeconds) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const newest = samples[samples.length - 1];
  const minimumSeconds = clampNumber(configuredMinimumSeconds, 10, 1, 600);
  const oldest =
    samples.find((sample) => newest.timestamp - sample.timestamp >= minimumSeconds * 1000) ||
    samples[0];
  const elapsedMinutes = (newest.timestamp - oldest.timestamp) / 60000;
  if (!(elapsedMinutes > 0) || elapsedMinutes * 60 < minimumSeconds) return null;
  return (newest.value - oldest.value) / elapsedMinutes;
}

function findMatchingLevel(monitor, value, ratePerMinute, holdActive) {
  for (const level of LEVELS) {
    const match = matchLevel(monitor, level, value, ratePerMinute, holdActive);
    if (match) return match;
  }
  return null;
}

function matchLevel(monitor, level, value, ratePerMinute, holdActive = false) {
  const rule = monitor?.levels?.[level] || {};
  if (rule.enabled === false) return null;
  const hysteresis = holdActive ? Math.max(0, finiteNumber(monitor?.hysteresis) ?? 0) : 0;
  const rateHysteresis = holdActive
    ? Math.max(0, finiteNumber(monitor?.rateHysteresisPerMinute) ?? 0)
    : 0;
  const minimum = finiteNumber(rule.minimum);
  const maximum = finiteNumber(rule.maximum);
  const rise = finiteNumber(rule.risePerMinute);
  const fall = finiteNumber(rule.fallPerMinute);

  if (minimum != null && value <= minimum + hysteresis) {
    return { level, reason: "minimum", threshold: minimum };
  }
  if (maximum != null && value >= maximum - hysteresis) {
    return { level, reason: "maximum", threshold: maximum };
  }
  if (rise != null && ratePerMinute != null && ratePerMinute >= rise - rateHysteresis) {
    return { level, reason: "risePerMinute", threshold: rise };
  }
  if (fall != null && ratePerMinute != null && -ratePerMinute >= fall - rateHysteresis) {
    return { level, reason: "fallPerMinute", threshold: fall };
  }
  return null;
}

function repeatForLevel(monitor, level) {
  if (!level) return Infinity;
  return clampNumber(
    monitor?.levels?.[level]?.repeatSeconds,
    DEFAULT_REPEATS[level],
    1,
    86400,
  );
}

function buildAnnouncementEvent(
  monitor,
  level,
  reason,
  value,
  ratePerMinute,
  timestamp,
  signedValue = value,
) {
  const label = String(monitor?.label || monitor?.path || "Instrument").trim();
  const unit = String(monitor?.unit || "").trim();
  const decimals = clampInteger(monitor?.decimals, 1, 0, 4);
  const spokenValue = value.toFixed(decimals);
  const direction = directionPhrase(monitor, signedValue);
  const valueWithUnit = `${spokenValue}${unit ? ` ${unit}` : ""}${direction ? ` ${direction}` : ""}`;
  const levelLabel =
    level === "danger" ? "Danger" : level === "warning" ? "Warning" : "Information";
  let detail = valueWithUnit;
  if (reason === "risePerMinute") {
    detail = `rising at ${Math.abs(ratePerMinute).toFixed(decimals)}${unit ? ` ${unit}` : ""} per minute${direction ? `, currently ${direction}` : ""}`;
  } else if (reason === "fallPerMinute") {
    detail = `falling at ${Math.abs(ratePerMinute).toFixed(decimals)}${unit ? ` ${unit}` : ""} per minute${direction ? `, currently ${direction}` : ""}`;
  }

  return {
    id: `${safeId(monitor?.id || monitor?.path)}-${level}-${timestamp}`,
    ts: new Date(timestamp).toISOString(),
    monitorId: safeId(monitor?.id || monitor?.path),
    path: monitor?.path,
    label,
    level,
    reason,
    value,
    signedValue,
    direction,
    unit,
    ratePerMinute,
    message: `${levelLabel}. ${label} ${detail}.`,
  };
}

function directionPhrase(monitor, signedValue) {
  if (monitor?.directionMode !== "portStarboard") return "";
  const number = finiteNumber(signedValue);
  if (number == null) return "";
  if (number < 0) return "to Port";
  if (number > 0) return "to Starboard";
  return "on track";
}

function safeId(value) {
  return (
    String(value || "instrument")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "instrument"
  );
}

function clampNumber(value, fallback, min, max) {
  const number = finiteNumber(value);
  if (number == null) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampInteger(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max));
}

module.exports = {
  DEFAULT_REPEATS,
  LEVELS,
  buildAnnouncementEvent,
  calculateRatePerMinute,
  convertValue,
  convertValueDetails,
  createMonitorState,
  evaluateMonitor,
  directionPhrase,
  repeatForLevel,
  safeId,
};

