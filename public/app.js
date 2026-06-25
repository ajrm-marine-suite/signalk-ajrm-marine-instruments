const API = "../plugins/signalk-ajrm-marine-instruments";
const DEFAULT_REFRESH_SECONDS = 3;
const HIDDEN_REFRESH_SECONDS = 15;
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
  depthGauge: document.getElementById("depthGauge"),
  depthSource: document.getElementById("depthSource"),
  windInstrument: document.getElementById("windInstrument"),
  windGauge: document.getElementById("windGauge"),
  trueWindDirection: document.getElementById("trueWindDirection"),
  apparentWindAngle: document.getElementById("apparentWindAngle"),
  trueWindSpeed: document.getElementById("trueWindSpeed"),
  trueWindAngle: document.getElementById("trueWindAngle"),
  tideDrift: document.getElementById("tideDrift"),
  tideSetAngle: document.getElementById("tideSetAngle"),
  windDetail: document.getElementById("windDetail"),
  sogInstrument: document.getElementById("sogInstrument"),
  sogGauge: document.getElementById("sogGauge"),
  cogInstrument: document.getElementById("cogInstrument"),
  cogGauge: document.getElementById("cogGauge"),
  gpsInstrument: document.getElementById("gpsInstrument"),
  gpsFixLabel: document.getElementById("gpsFixLabel"),
  gpsAccuracy: document.getElementById("gpsAccuracy"),
  gpsLatitude: document.getElementById("gpsLatitude"),
  gpsLongitude: document.getElementById("gpsLongitude"),
  gpsSatellites: document.getElementById("gpsSatellites"),
  gpsDilution: document.getElementById("gpsDilution"),
  temperatureInstrument: document.getElementById("temperatureInstrument"),
  temperatureGauge: document.getElementById("temperatureGauge"),
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
  renderClassicGauge(elements.depthGauge, {
    label: "Depth",
    units: "m",
    measurement: `0-${depthScale.max} m scale`,
    min: 0,
    max: depthScale.max,
    value: depth,
    major: depthMajorStep(depthScale.max),
    minor: depthMinorStep(depthScale.max),
    sectors: depthSectors(depthScale.max),
  });
  setText(elements.depthSource, `${labelDepthSource(status.depth?.source)} - 0-${depthScale.max} m scale`);
  setBand(elements.depthInstrument, depthBand(depth));

  const trueWind = status.wind?.true || {};
  const apparentWind = status.wind?.apparent || {};
  const current = status.current || {};
  setText(elements.trueWindDirection, formatHeading(trueWind.directionDegrees, trueWind.cardinal, "T"));
  setText(elements.apparentWindAngle, formatRelativeAngle(apparentWind.angleDegrees));
  setText(elements.trueWindSpeed, formatNumber(trueWind.speedKnots, 1));
  setText(elements.trueWindAngle, formatRelativeAngle(trueWind.angleDegrees));
  setText(elements.tideDrift, formatNumber(current.driftKnots, 1));
  setText(elements.tideSetAngle, formatHeading(current.setTrueDegrees, current.setCardinal, ""));
  renderCompassGauge(elements.windGauge, {
    label: "Wind",
    valueText: formatNumber(apparentWind.speedKnots, 1),
    units: "AWS kt",
    windScale: true,
    compactValueBox: true,
    needles: [
      { angleDeg: apparentWind.angleDegrees, color: "#f6a31a", className: "apparent", length: 78 },
      { angleDeg: trueWind.angleDegrees, color: "#22c7f2", className: "true", length: 68 },
      { angleDeg: current.setRelativeDegrees, color: "#9f7bff", className: "current", length: 52 },
    ],
  });
  setText(
    elements.windDetail,
    [
      trueWind.beaufortForce == null ? "" : `F${trueWind.beaufortForce} ${trueWind.beaufortLabel}`,
      trueWind.directionDegrees == null ? "" : `${trueWind.cardinal} ${trueWind.directionDegrees} deg true`,
      trueWind.angleDegrees == null ? "" : `${trueWind.angleDegrees} deg true angle`,
      current.driftKnots == null ? "" : `Tide ${current.driftKnots} kn ${current.setCardinal || ""}`,
    ].filter(Boolean).join(" - ") || "--",
  );
  setBand(elements.windInstrument, windBand(trueWind.speedKnots ?? apparentWind.speedKnots));

  const nav = status.navigation || {};
  const sogScale = chooseScale(nav.sogKnots, SOG_SCALE_STEPS, 6);
  renderClassicGauge(elements.sogGauge, {
    label: "SOG",
    units: "kn",
    min: 0,
    max: sogScale.max,
    value: nav.sogKnots,
    major: sogScale.max / 4,
    minor: sogScale.max / 8,
    sectors: [
      { from: 0, to: Math.min(2, sogScale.max), color: "#34c8f3" },
      { from: Math.min(2, sogScale.max), to: sogScale.max, color: "#27d36b" },
    ].filter((sector) => sector.to > sector.from),
  });
  setBand(elements.sogInstrument, speedBand(nav.sogKnots));
  renderCompassGauge(elements.cogGauge, {
    label: "COG",
    valueText: nav.cogDegrees == null ? "--" : `${String(Math.round(nav.cogDegrees)).padStart(3, "0")}°`,
    units: nav.cogCardinal || "",
    needles: [
      { angleDeg: nav.cogDegrees, color: "#f97316", className: "course", length: 76 },
    ],
  });
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
  renderClassicGauge(elements.temperatureGauge, {
    label: "Exhaust",
    units: "°C",
    min: 0,
    max: tempScale.max,
    value: temp,
    major: tempScale.max / 4,
    minor: tempScale.max / 8,
    sectors: [
      { from: 0, to: Math.min(70, tempScale.max), color: "#27d36b" },
      { from: Math.min(70, tempScale.max), to: tempScale.max, color: "#ef3f3f" },
    ].filter((sector) => sector.to > sector.from),
  });
  setBand(elements.temperatureInstrument, temperatureBand(temp));
}

function polar(cx, cy, radius, angleDeg) {
  const angle = (angleDeg - 90) * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function arcPath(cx, cy, radius, startDeg, endDeg) {
  const start = polar(cx, cy, radius, startDeg);
  const end = polar(cx, cy, radius, endDeg);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg >= startDeg ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

function valueAngle(value, min, max, startDeg, endDeg) {
  const span = max - min || 1;
  const number = Number(value);
  const ratio = Number.isFinite(number) ? clamp((number - min) / span, 0, 1) : 0;
  return startDeg + (endDeg - startDeg) * ratio;
}

function renderClassicGauge(node, options) {
  if (!node) return;
  const {
    min = 0,
    max = 10,
    value = null,
    units = "",
    label = "",
    measurement = "",
    major = 2,
    minor = 1,
    decimals = 1,
    startDeg = 220,
    endDeg = 500,
    sectors = [],
  } = options;
  const cx = 110;
  const cy = 112;
  const radius = 82;
  const scaleRadius = 76;
  const tickParts = [];
  for (let tick = min; tick <= max + 0.0001; tick += minor) {
    const isMajor = Math.abs((tick - min) / major - Math.round((tick - min) / major)) < 0.0001;
    const angle = valueAngle(tick, min, max, startDeg, endDeg);
    const outer = polar(cx, cy, scaleRadius, angle);
    const inner = polar(cx, cy, scaleRadius - (isMajor ? 13 : 8), angle);
    tickParts.push(`<line class="${isMajor ? "svg-tick-major" : "svg-tick-minor"}" x1="${inner.x.toFixed(3)}" y1="${inner.y.toFixed(3)}" x2="${outer.x.toFixed(3)}" y2="${outer.y.toFixed(3)}"></line>`);
    if (isMajor) {
      const text = polar(cx, cy, scaleRadius - 24, angle);
      tickParts.push(`<text class="svg-tick-label" x="${text.x.toFixed(3)}" y="${text.y.toFixed(3)}">${formatScaleLabel(tick)}</text>`);
    }
  }
  const sectorParts = sectors.map((sector, index) => {
    const start = valueAngle(sector.from, min, max, startDeg, endDeg);
    const end = valueAngle(sector.to, min, max, startDeg, endDeg);
    return `<path class="svg-sector svg-sector-${index}" d="${arcPath(cx, cy, radius, start, end)}" style="stroke:${sector.color}"></path>`;
  });
  const needleAngle = valueAngle(value, min, max, startDeg, endDeg);
  const needleEnd = polar(cx, cy, 68, needleAngle);
  const displayValue = Number.isFinite(Number(value)) ? Number(value).toFixed(decimals) : "--";
  node.innerHTML = `
    <svg viewBox="0 0 220 220" role="img" aria-label="${escapeHtml(label)} gauge">
      <circle class="svg-gauge-face" cx="${cx}" cy="${cy}" r="98"></circle>
      <path class="svg-scale-arc" d="${arcPath(cx, cy, radius, startDeg, endDeg)}"></path>
      ${sectorParts.join("")}
      ${tickParts.join("")}
      <line class="svg-needle" x1="${cx}" y1="${cy}" x2="${needleEnd.x.toFixed(3)}" y2="${needleEnd.y.toFixed(3)}"></line>
      <circle class="svg-needle-hub" cx="${cx}" cy="${cy}" r="8"></circle>
      <rect class="svg-value-box" x="72" y="143" width="76" height="42" rx="4"></rect>
      <text class="svg-value-text" x="${cx}" y="160">${escapeHtml(displayValue)}</text>
      <text class="svg-unit-text" x="${cx}" y="177">${escapeHtml(units)}</text>
      <text class="svg-label-text" x="${cx}" y="36">${escapeHtml(label)}</text>
      <text class="svg-measurement-text" x="${cx}" y="133">${escapeHtml(measurement)}</text>
    </svg>
  `;
}

function renderCompassGauge(node, options) {
  if (!node) return;
  const cx = 110;
  const cy = 112;
  const currentArrowId = `${node.id || "compass"}-current-arrowhead`;
  const valueBox = options.compactValueBox
    ? { x: 81.5, y: 132, width: 57, height: 31.5, rx: 3, valueY: 144, unitY: 158, boxClass: "svg-value-box compact", valueClass: "svg-value-text compact", unitClass: "svg-unit-text compact" }
    : { x: 72, y: 143, width: 76, height: 42, rx: 4, valueY: 160, unitY: 177, boxClass: "svg-value-box", valueClass: "svg-value-text", unitClass: "svg-unit-text" };
  const ticks = [];
  for (let deg = 0; deg < 360; deg += 10) {
    const major = deg % 30 === 0;
    const outer = polar(cx, cy, 82, deg);
    const inner = polar(cx, cy, major ? 68 : 74, deg);
    ticks.push(`<line class="${major ? "svg-tick-major" : "svg-tick-minor"}" x1="${inner.x.toFixed(3)}" y1="${inner.y.toFixed(3)}" x2="${outer.x.toFixed(3)}" y2="${outer.y.toFixed(3)}"></line>`);
  }
  const needles = (options.needles || []).map((needle) => {
    const angle = Number(needle.angleDeg);
    if (!Number.isFinite(angle)) return "";
    const end = polar(cx, cy, needle.length || 70, angle);
    const className = `svg-needle ${needle.className || ""}`;
    const marker = needle.className === "current" ? ` marker-end="url(#${currentArrowId})"` : "";
    return `<line class="${className}" x1="${cx}" y1="${cy}" x2="${end.x.toFixed(3)}" y2="${end.y.toFixed(3)}"${marker}></line>` +
      `<style>#${node.id} .${needle.className}{stroke:${needle.color}}#${node.id} .svg-current-arrowhead{fill:${needle.color}}</style>`;
  });
  const windLabels = options.windScale
    ? `
      <text class="svg-tick-label svg-wind-number" x="83" y="66">30</text>
      <text class="svg-tick-label svg-wind-number" x="137" y="66">30</text>
      <text class="svg-tick-label svg-wind-number" x="61" y="95">60</text>
      <text class="svg-tick-label svg-wind-number" x="159" y="95">60</text>
      <text class="svg-tick-label svg-wind-number" x="51" y="126">90</text>
      <text class="svg-tick-label svg-wind-number" x="169" y="126">90</text>
      <text class="svg-tick-label svg-wind-number" x="72" y="164">120</text>
      <text class="svg-tick-label svg-wind-number" x="148" y="164">120</text>
    `
    : `
      <text class="svg-tick-label" x="${cx}" y="34">N</text>
      <text class="svg-tick-label" x="188" y="${cy}">E</text>
      <text class="svg-tick-label" x="${cx}" y="190">S</text>
      <text class="svg-tick-label" x="32" y="${cy}">W</text>
    `;
  node.innerHTML = `
    <svg viewBox="0 0 220 220" role="img" aria-label="${escapeHtml(options.label)} compass">
      <defs>
        <marker id="${currentArrowId}" viewBox="0 0 8 8" markerWidth="3.6" markerHeight="3.6" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
          <path class="svg-current-arrowhead" d="M 0 0 L 8 4 L 0 8 z"></path>
        </marker>
      </defs>
      <circle class="svg-gauge-face" cx="${cx}" cy="${cy}" r="98"></circle>
      ${ticks.join("")}
      ${windLabels}
      ${needles.join("")}
      <circle class="svg-needle-hub" cx="${cx}" cy="${cy}" r="10"></circle>
      <rect class="${valueBox.boxClass}" x="${valueBox.x}" y="${valueBox.y}" width="${valueBox.width}" height="${valueBox.height}" rx="${valueBox.rx}"></rect>
      <text class="${valueBox.valueClass}" x="${cx}" y="${valueBox.valueY}">${escapeHtml(options.valueText || "--")}</text>
      <text class="${valueBox.unitClass}" x="${cx}" y="${valueBox.unitY}">${escapeHtml(options.units || "")}</text>
      <text class="svg-label-text" x="${cx}" y="36">${escapeHtml(options.label)}</text>
    </svg>
  `;
}

function depthMajorStep(maxDepth) {
  if (maxDepth <= 10) return 2;
  if (maxDepth <= 50) return 10;
  if (maxDepth <= 100) return 20;
  return 50;
}

function depthMinorStep(maxDepth) {
  if (maxDepth <= 10) return 1;
  if (maxDepth <= 50) return 5;
  return 10;
}

function depthSectors(maxDepth) {
  return [
    { from: 0, to: Math.min(2, maxDepth), color: "#ef3f3f" },
    { from: Math.min(2, maxDepth), to: Math.min(4, maxDepth), color: "#f5b642" },
    { from: Math.min(4, maxDepth), to: maxDepth, color: "#27d36b" },
  ].filter((sector) => sector.to > sector.from);
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
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
