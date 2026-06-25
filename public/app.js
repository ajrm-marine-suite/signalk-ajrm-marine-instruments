const API = "../plugins/signalk-ajrm-marine-instruments";
const DEFAULT_REFRESH_SECONDS = 3;
const HIDDEN_REFRESH_SECONDS = 15;
const GAUGE_MIN_ANGLE = -120;
const GAUGE_MAX_ANGLE = 120;
const DEPTH_SCALE_STEPS = [10, 50, 100, 200];
const DEPTH_SCALE_HYSTERESIS = {
  stepUpFactor: 1.1,
  stepDownFactor: 0.85,
};
const SOG_SCALE_STEPS = [6, 12, 24, 40];
const TEMPERATURE_SCALE_STEPS = [80, 100, 120];

const elements = {
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  depthInstrument: document.getElementById("depthInstrument"),
  depthValue: document.getElementById("depthValue"),
  depthSource: document.getElementById("depthSource"),
  depthNeedle: document.getElementById("depthNeedle"),
  depthScale: scaleElements("depth"),
  windInstrument: document.getElementById("windInstrument"),
  trueWindNeedle: document.getElementById("trueWindNeedle"),
  apparentWindNeedle: document.getElementById("apparentWindNeedle"),
  currentSetNeedle: document.getElementById("currentSetNeedle"),
  trueWindDirection: document.getElementById("trueWindDirection"),
  apparentWindAngle: document.getElementById("apparentWindAngle"),
  trueWindSpeed: document.getElementById("trueWindSpeed"),
  trueWindAngle: document.getElementById("trueWindAngle"),
  apparentWindSpeed: document.getElementById("apparentWindSpeed"),
  tideDrift: document.getElementById("tideDrift"),
  tideSetAngle: document.getElementById("tideSetAngle"),
  windDetail: document.getElementById("windDetail"),
  sogInstrument: document.getElementById("sogInstrument"),
  sogNeedle: document.getElementById("sogNeedle"),
  sogValue: document.getElementById("sogValue"),
  sogScale: scaleElements("sog"),
  cogInstrument: document.getElementById("cogInstrument"),
  cogNeedle: document.getElementById("cogNeedle"),
  cogValue: document.getElementById("cogValue"),
  gpsInstrument: document.getElementById("gpsInstrument"),
  gpsFixLabel: document.getElementById("gpsFixLabel"),
  gpsAccuracy: document.getElementById("gpsAccuracy"),
  gpsLatitude: document.getElementById("gpsLatitude"),
  gpsLongitude: document.getElementById("gpsLongitude"),
  gpsSatellites: document.getElementById("gpsSatellites"),
  gpsDilution: document.getElementById("gpsDilution"),
  temperatureInstrument: document.getElementById("temperatureInstrument"),
  temperatureNeedle: document.getElementById("temperatureNeedle"),
  engineTemp: document.getElementById("engineTemp"),
  tempScale: scaleElements("temp"),
};

let refreshTimer = null;
let activeDepthScale = null;

refresh();

document.addEventListener("visibilitychange", () => {
  window.clearTimeout(refreshTimer);
  if (document.hidden) {
    schedule(HIDDEN_REFRESH_SECONDS);
  } else {
    refresh();
  }
});

async function refresh() {
  try {
    const status = await getJson(`${API}/status`);
    render(status);
    setConnection("ok", `Live v${status.version}`);
    schedule(status.controls?.refreshIntervalSeconds || DEFAULT_REFRESH_SECONDS);
  } catch (error) {
    setConnection("error", error.message);
    schedule(5);
  }
}

function render(status) {
  const depth = status.depth?.meters;
  activeDepthScale = chooseDepthScale(depth, activeDepthScale);
  const depthScale = scaleFromMax(activeDepthScale || 10);
  setText(elements.depthValue, formatNumber(depth, 1));
  setText(elements.depthSource, `${labelDepthSource(status.depth?.source)} - 0-${depthScale.max} m scale`);
  setGaugeScale(elements.depthScale, depthScale);
  rotateGauge(elements.depthNeedle, depth, 0, depthScale.max, GAUGE_MIN_ANGLE, GAUGE_MAX_ANGLE);
  setBand(elements.depthInstrument, depthBand(depth));

  const trueWind = status.wind?.true || {};
  const apparentWind = status.wind?.apparent || {};
  const current = status.current || {};
  setText(elements.trueWindDirection, formatHeading(trueWind.directionDegrees, trueWind.cardinal, "T"));
  setText(elements.apparentWindAngle, formatRelativeAngle(apparentWind.angleDegrees));
  setText(elements.trueWindSpeed, formatNumber(trueWind.speedKnots, 1));
  setText(elements.trueWindAngle, formatRelativeAngle(trueWind.angleDegrees));
  setText(elements.apparentWindSpeed, formatNumber(apparentWind.speedKnots, 1));
  setText(elements.tideDrift, formatNumber(current.driftKnots, 1));
  setText(elements.tideSetAngle, formatHeading(current.setTrueDegrees, current.setCardinal, "T"));
  setText(
    elements.windDetail,
    [
      trueWind.beaufortForce == null ? "" : `F${trueWind.beaufortForce} ${trueWind.beaufortLabel}`,
      trueWind.directionDegrees == null ? "" : `${trueWind.cardinal} ${trueWind.directionDegrees} deg true`,
      trueWind.angleDegrees == null ? "" : `${trueWind.angleDegrees} deg true angle`,
      current.driftKnots == null ? "" : `Tide ${current.driftKnots} kn ${current.setCardinal || ""}`,
    ].filter(Boolean).join(" - ") || "--",
  );
  rotateCompass(elements.trueWindNeedle, trueWind.angleDegrees);
  rotateCompass(elements.apparentWindNeedle, apparentWind.angleDegrees);
  rotateCompass(elements.currentSetNeedle, current.setRelativeDegrees);
  setBand(elements.windInstrument, windBand(trueWind.speedKnots ?? apparentWind.speedKnots));

  const nav = status.navigation || {};
  const sogScale = chooseScale(nav.sogKnots, SOG_SCALE_STEPS, 6);
  setText(elements.sogValue, formatNumber(nav.sogKnots, 1));
  setGaugeScale(elements.sogScale, sogScale);
  rotateGauge(elements.sogNeedle, nav.sogKnots, 0, sogScale.max, GAUGE_MIN_ANGLE, GAUGE_MAX_ANGLE);
  setBand(elements.sogInstrument, speedBand(nav.sogKnots));
  rotateCompass(elements.cogNeedle, nav.cogDegrees);
  setText(
    elements.cogValue,
    nav.cogDegrees == null ? "--" : `${String(Math.round(nav.cogDegrees)).padStart(3, "0")}° ${nav.cogCardinal}`,
  );
  setBand(elements.cogInstrument, nav.cogDegrees == null ? "offline" : "safe");

  const gps = status.gps || {};
  const hasPosition = Number.isFinite(Number(gps.latitude)) && Number.isFinite(Number(gps.longitude));
  setText(elements.gpsFixLabel, gps.methodQuality || gps.type || (hasPosition ? "GPS fix" : "No fix"));
  setText(elements.gpsAccuracy, formatGpsAccuracy(gps));
  setText(elements.gpsLatitude, formatCoordinate(gps.latitude, "N", "S"));
  setText(elements.gpsLongitude, formatCoordinate(gps.longitude, "E", "W"));
  setText(elements.gpsSatellites, gps.satellites == null ? "--" : String(Math.round(gps.satellites)));
  setText(elements.gpsDilution, formatDilution(gps));
  setBand(elements.gpsInstrument, gpsBand(gps));

  const temp = status.exhaustWater?.temperatureCelsius ?? status.engineRoom?.temperatureCelsius;
  const tempScale = chooseScale(temp, TEMPERATURE_SCALE_STEPS, 100);
  setText(elements.engineTemp, formatNumber(temp, 1));
  setGaugeScale(elements.tempScale, tempScale);
  rotateGauge(elements.temperatureNeedle, temp, 0, tempScale.max, GAUGE_MIN_ANGLE, GAUGE_MAX_ANGLE);
  setBand(elements.temperatureInstrument, temperatureBand(temp));
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function setConnection(state, text) {
  elements.statusDot.className = state;
  elements.statusText.textContent = text;
}

function schedule(seconds) {
  window.clearTimeout(refreshTimer);
  const interval = document.hidden
    ? Math.max(HIDDEN_REFRESH_SECONDS, seconds)
    : Math.max(1, seconds);
  refreshTimer = window.setTimeout(refresh, interval * 1000);
}

function setText(element, value) {
  if (!element) return;
  element.textContent = value == null || value === "" ? "--" : value;
}

function formatNumber(value, decimals) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(decimals) : "--";
}

function formatHeading(degrees, cardinal = "", suffix = "") {
  const number = Number(degrees);
  if (!Number.isFinite(number)) return "--";
  const heading = String(Math.round(number)).padStart(3, "0");
  return `${heading}°${suffix}${cardinal ? ` ${cardinal}` : ""}`;
}

function formatRelativeAngle(degrees) {
  const number = Number(degrees);
  if (!Number.isFinite(number)) return "--";
  const side = number < 0 ? "P" : "S";
  return `${String(Math.round(Math.abs(number))).padStart(3, "0")}°${side}`;
}

function formatCoordinate(value, positiveSuffix, negativeSuffix) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${Math.abs(number).toFixed(6)}°${number < 0 ? negativeSuffix : positiveSuffix}`;
}

function formatGpsAccuracy(gps) {
  if (Number.isFinite(Number(gps.horizontalAccuracyMeters))) {
    return `${Number(gps.horizontalAccuracyMeters).toFixed(1)} m`;
  }
  if (Number.isFinite(Number(gps.horizontalDilution))) {
    return `HDOP ${Number(gps.horizontalDilution).toFixed(1)}`;
  }
  if (Number.isFinite(Number(gps.positionDilution))) {
    return `PDOP ${Number(gps.positionDilution).toFixed(1)}`;
  }
  return "--";
}

function formatDilution(gps) {
  const hdop = Number.isFinite(Number(gps.horizontalDilution))
    ? Number(gps.horizontalDilution).toFixed(1)
    : "--";
  const pdop = Number.isFinite(Number(gps.positionDilution))
    ? Number(gps.positionDilution).toFixed(1)
    : "--";
  return `${hdop} / ${pdop}`;
}

function labelDepthSource(source) {
  if (source === "belowSurface") return "below surface";
  if (source === "belowTransducer") return "below transducer";
  return "below keel";
}

function scaleElements(prefix) {
  return [
    document.getElementById(`${prefix}Scale0`),
    document.getElementById(`${prefix}Scale25`),
    document.getElementById(`${prefix}Scale50`),
    document.getElementById(`${prefix}Scale75`),
    document.getElementById(`${prefix}Scale100`),
  ];
}

function chooseScale(value, steps, fallbackMax) {
  const number = Number(value);
  const target = Number.isFinite(number) ? Math.max(0, number) * 1.12 : fallbackMax;
  const max = steps.find((candidate) => target <= candidate) || steps[steps.length - 1] || fallbackMax;
  return scaleFromMax(max);
}

function scaleFromMax(max) {
  return {
    max,
    labels: [0, max * 0.25, max * 0.5, max * 0.75, max],
  };
}

function smallestDepthScaleFor(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 10;
  const depth = Math.max(0, number);
  return DEPTH_SCALE_STEPS.find((candidate) => depth <= candidate) || DEPTH_SCALE_STEPS[DEPTH_SCALE_STEPS.length - 1];
}

function chooseDepthScale(value, currentScale = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return currentScale || 10;
  const depth = Math.max(0, number);
  if (!currentScale) return smallestDepthScaleFor(depth);
  const currentIndex = DEPTH_SCALE_STEPS.indexOf(currentScale);
  const current = currentIndex >= 0 ? currentScale : smallestDepthScaleFor(depth);
  const lower = currentIndex > 0 ? DEPTH_SCALE_STEPS[currentIndex - 1] : null;
  if (depth > current * DEPTH_SCALE_HYSTERESIS.stepUpFactor) {
    return smallestDepthScaleFor(depth);
  }
  if (lower && depth < lower * DEPTH_SCALE_HYSTERESIS.stepDownFactor) {
    return smallestDepthScaleFor(depth);
  }
  return current;
}

function setGaugeScale(elementsForScale, scale) {
  elementsForScale.forEach((element, index) => {
    setText(element, formatScaleLabel(scale.labels[index]));
  });
}

function formatScaleLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (number >= 100) return String(Math.round(number));
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(1).replace(/\.0$/, "");
}

function rotateGauge(element, value, min, max, minAngle, maxAngle, invert = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  const fraction = clamp((number - min) / (max - min), 0, 1);
  const mapped = invert ? 1 - fraction : fraction;
  const angle = minAngle + mapped * (maxAngle - minAngle);
  element.style.transform = `translateX(-50%) rotate(${angle}deg)`;
}

function rotateCompass(element, degrees) {
  const number = Number(degrees);
  if (!Number.isFinite(number)) return;
  element.style.transform = `translateX(-50%) rotate(${number}deg)`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setBand(element, band) {
  if (!element) return;
  element.dataset.band = band || "offline";
}

function depthBand(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "offline";
  if (number < 2) return "danger";
  if (number < 4) return "caution";
  return "safe";
}

function windBand(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "offline";
  if (number >= 28) return "danger";
  if (number >= 18) return "caution";
  return "safe";
}

function speedBand(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "offline";
  return number > 0.2 ? "safe" : "caution";
}

function temperatureBand(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "offline";
  if (number >= 70) return "danger";
  if (number >= 55) return "caution";
  return "safe";
}

function gpsBand(gps) {
  const hasPosition = Number.isFinite(Number(gps.latitude)) && Number.isFinite(Number(gps.longitude));
  if (!hasPosition) return "offline";
  const hdop = Number(gps.horizontalDilution);
  const accuracy = Number(gps.horizontalAccuracyMeters);
  if (Number.isFinite(accuracy)) {
    if (accuracy > 25) return "danger";
    if (accuracy > 10) return "caution";
    return "safe";
  }
  if (Number.isFinite(hdop)) {
    if (hdop > 5) return "danger";
    if (hdop > 2) return "caution";
  }
  return "safe";
}
