/**
 * Implements the alerts responsibilities of the AJRM Marine Instruments browser application.
 */

const API = "../plugins/signalk-ajrm-marine-instruments/alerts";
const LEVELS = ["information", "warning", "danger"];
const DEFAULT_REPEATS = { information: 300, warning: 60, danger: 15 };
const DEFAULT_DEPTH_CALLOUT = {
  enabled: false,
  path: "environment.depth.belowKeel",
  sayUnits: false,
  fineBelowMeters: 3,
  minimumIntervalSeconds: 5,
  repeatSameBucketSeconds: 30,
  targetMinimumMeters: 2,
  targetMaximumMeters: 3,
};

const elements = {
  enabled: document.getElementById("enabled"),
  depthCalloutEnabled: document.getElementById("depthCalloutEnabled"),
  depthCalloutPath: document.getElementById("depthCalloutPath"),
  depthTargetMinimum: document.getElementById("depthTargetMinimum"),
  depthTargetMaximum: document.getElementById("depthTargetMaximum"),
  depthFineBelow: document.getElementById("depthFineBelow"),
  depthMinimumInterval: document.getElementById("depthMinimumInterval"),
  depthRepeatSame: document.getElementById("depthRepeatSame"),
  depthSayUnits: document.getElementById("depthSayUnits"),
  depthCalloutState: document.getElementById("depthCalloutState"),
  depthLiveValue: document.getElementById("depthLiveValue"),
  depthLastCallout: document.getElementById("depthLastCallout"),
  depthUpdated: document.getElementById("depthUpdated"),
  monitors: document.getElementById("monitors"),
  monitorTemplate: document.getElementById("monitorTemplate"),
  addMonitor: document.getElementById("addMonitor"),
  saveSettings: document.getElementById("saveSettings"),
  settingsMessage: document.getElementById("settingsMessage"),
  recentEvents: document.getElementById("recentEvents"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
};

let settings = { enabled: true, monitors: [], depthCallout: { ...DEFAULT_DEPTH_CALLOUT } };
let refreshTimer = null;
let dirty = false;
let saving = false;

elements.enabled.addEventListener("change", markDirty);
[
  elements.depthCalloutEnabled,
  elements.depthCalloutPath,
  elements.depthTargetMinimum,
  elements.depthTargetMaximum,
  elements.depthFineBelow,
  elements.depthMinimumInterval,
  elements.depthRepeatSame,
  elements.depthSayUnits,
].forEach((element) => element.addEventListener("change", markDirty));
elements.depthCalloutPath.addEventListener("input", markDirty);
elements.addMonitor.addEventListener("click", () => {
  settings.monitors.push(blankMonitor(settings.monitors.length + 1));
  dirty = true;
  renderSettings();
});
elements.saveSettings.addEventListener("click", saveSettings);
elements.monitors.addEventListener("input", markDirty);
elements.monitors.addEventListener("change", markDirty);

start();

async function start() {
  try {
    settings = await getJson(`${API}/settings`);
    dirty = false;
    renderSettings();
    await refreshStatus();
  } catch (error) {
    setConnection("error", error.message);
    scheduleRefresh(5);
  }
}

async function refreshStatus() {
  try {
    const status = await getJson(`${API}/status`);
    setConnection("ok", `Live v${status.version}`);
    renderLiveStatus(status);
    renderRecentEvents(status.recentEvents || []);
    scheduleRefresh(1);
  } catch (error) {
    setConnection("error", error.message);
    scheduleRefresh(5);
  }
}

function renderSettings() {
  elements.enabled.checked = settings.enabled !== false;
  renderDepthCalloutSettings(settings.depthCallout || DEFAULT_DEPTH_CALLOUT);
  elements.monitors.replaceChildren();
  settings.monitors.forEach((monitor, index) => {
    const card = elements.monitorTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.index = String(index);
    setField(card, "enabled", monitor.enabled !== false);
    setField(card, "label", monitor.label);
    setField(card, "path", monitor.path);
    setField(card, "unit", monitor.unit);
    setField(card, "conversion", monitor.conversion || "none");
    setField(card, "directionMode", monitor.directionMode || "none");
    setField(card, "absoluteValue", monitor.absoluteValue === true);
    setField(card, "rateWindowSeconds", monitor.rateWindowSeconds ?? 60);
    setField(card, "minimumRateSampleSeconds", monitor.minimumRateSampleSeconds ?? 10);
    setField(card, "hysteresis", monitor.hysteresis ?? 0);
    setField(card, "rateHysteresisPerMinute", monitor.rateHysteresisPerMinute ?? 0);
    for (const level of LEVELS) {
      const row = card.querySelector(`[data-level="${level}"]`);
      const rule = monitor.levels?.[level] || {};
      setRule(row, "enabled", rule.enabled !== false);
      setRule(row, "minimum", rule.minimum);
      setRule(row, "maximum", rule.maximum);
      setRule(row, "risePerMinute", rule.risePerMinute);
      setRule(row, "fallPerMinute", rule.fallPerMinute);
      setRule(row, "repeatSeconds", rule.repeatSeconds ?? DEFAULT_REPEATS[level]);
    }
    card.querySelector('[data-action="remove"]').addEventListener("click", () => {
      settings.monitors.splice(index, 1);
      dirty = true;
      renderSettings();
    });
    elements.monitors.append(card);
  });
  updateSaveButton();
}

function renderLiveStatus(status) {
  renderDepthCalloutStatus(status.depthCallout || {});
  const byId = new Map((status.monitors || []).map((monitor) => [monitor.id, monitor]));
  for (const card of elements.monitors.querySelectorAll(".monitor-card")) {
    const index = Number(card.dataset.index);
    const configured = settings.monitors[index];
    const live = byId.get(configured?.id);
    if (!live) continue;
    const state = live.state || {};
    card.dataset.activeLevel = state.activeLevel || "normal";
    card.querySelector(".active-state").textContent = labelLevel(state.activeLevel);
    card.querySelector(".live-value").textContent =
      state.lastValue == null
        ? "--"
        : `${Number(state.lastValue).toFixed(live.decimals ?? 1)} ${live.unit || ""}`.trim();
    card.querySelector(".live-rate").textContent =
      state.ratePerMinute == null
        ? "Rate --"
        : `Rate ${signed(Number(state.ratePerMinute).toFixed(live.decimals ?? 1))} ${live.unit || ""}/min`;
    card.querySelector(".live-updated").textContent = state.updatedAt
      ? `Updated ${new Date(state.updatedAt).toLocaleTimeString()}`
      : "";
  }
}

function renderRecentEvents(events) {
  if (events.length === 0) {
    elements.recentEvents.innerHTML = "<p>None yet.</p>";
    return;
  }
  elements.recentEvents.replaceChildren(
    ...events.slice(0, 20).map((event) => {
      const row = document.createElement("div");
      row.className = `event ${event.level}`;
      row.innerHTML = `<time>${escapeHtml(new Date(event.ts).toLocaleTimeString())}</time><span>${escapeHtml(event.message)}</span>`;
      return row;
    }),
  );
}

async function saveSettings() {
  if (!dirty || saving) return;
  const payload = readSettingsFromPage();
  const validationError = validateSettings(payload);
  if (validationError) {
    setMessage(validationError, true);
    return;
  }

  saving = true;
  updateSaveButton();
  try {
    const saved = await putJson(`${API}/settings`, payload);
    const verified = await getJson(`${API}/settings`);
    if (
      JSON.stringify(saved.monitors) !== JSON.stringify(verified.monitors) ||
      JSON.stringify(saved.depthCallout) !== JSON.stringify(verified.depthCallout) ||
      saved.enabled !== verified.enabled
    ) {
      throw new Error("Saved settings could not be verified");
    }
    settings = verified;
    dirty = false;
    renderSettings();
    setMessage("Saved and applied");
    await refreshStatus();
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    saving = false;
    updateSaveButton();
  }
}

function readSettingsFromPage() {
  return {
    enabled: elements.enabled.checked,
    depthCallout: readDepthCalloutFromPage(),
    monitors: [...elements.monitors.querySelectorAll(".monitor-card")].map((card, index) => {
      const existing = settings.monitors[index] || {};
      const label = readField(card, "label").trim();
      const path = readField(card, "path").trim();
      return {
        ...existing,
        id: existing.id || slug(label || path || `monitor-${index + 1}`),
        enabled: readChecked(card, "enabled"),
        label,
        path,
        unit: readField(card, "unit").trim(),
        conversion: readField(card, "conversion"),
        directionMode: readField(card, "directionMode"),
        absoluteValue: readChecked(card, "absoluteValue"),
        rateWindowSeconds: readNumber(card, "rateWindowSeconds"),
        minimumRateSampleSeconds: readNumber(card, "minimumRateSampleSeconds"),
        hysteresis: readNumber(card, "hysteresis"),
        rateHysteresisPerMinute: readNumber(card, "rateHysteresisPerMinute"),
        levels: Object.fromEntries(
          LEVELS.map((level) => {
            const row = card.querySelector(`[data-level="${level}"]`);
            return [
              level,
              {
                enabled: row.querySelector('[data-rule="enabled"]').checked,
                minimum: optionalInput(row, "minimum"),
                maximum: optionalInput(row, "maximum"),
                risePerMinute: optionalInput(row, "risePerMinute"),
                fallPerMinute: optionalInput(row, "fallPerMinute"),
                repeatSeconds: Number(row.querySelector('[data-rule="repeatSeconds"]').value),
              },
            ];
          }),
        ),
      };
    }),
  };
}

function validateSettings(value) {
  if (value.depthCallout.enabled && !value.depthCallout.path) return "Depth callout needs a Signal K path";
  if (value.depthCallout.targetMinimumMeters > value.depthCallout.targetMaximumMeters) {
    return "Depth callout target minimum must be no more than the maximum";
  }
  if (!(value.depthCallout.minimumIntervalSeconds >= 1)) return "Depth callout interval must be at least 1 second";
  if (!(value.depthCallout.repeatSameBucketSeconds >= 5)) {
    return "Depth callout repeat must be at least 5 seconds";
  }
  for (const [index, monitor] of value.monitors.entries()) {
    if (!monitor.label) return `Instrument ${index + 1} needs a label`;
    if (!monitor.path) return `${monitor.label} needs a Signal K path`;
    for (const level of LEVELS) {
      const rule = monitor.levels[level];
      if (!(rule.repeatSeconds >= 1)) return `${monitor.label} ${level} repeat must be at least 1 second`;
    }
  }
  return "";
}

function renderDepthCalloutSettings(value) {
  const depthCallout = { ...DEFAULT_DEPTH_CALLOUT, ...value };
  elements.depthCalloutEnabled.checked = depthCallout.enabled === true;
  elements.depthCalloutPath.value = depthCallout.path || DEFAULT_DEPTH_CALLOUT.path;
  elements.depthTargetMinimum.value = numberField(depthCallout.targetMinimumMeters, DEFAULT_DEPTH_CALLOUT.targetMinimumMeters);
  elements.depthTargetMaximum.value = numberField(depthCallout.targetMaximumMeters, DEFAULT_DEPTH_CALLOUT.targetMaximumMeters);
  elements.depthFineBelow.value = numberField(depthCallout.fineBelowMeters, DEFAULT_DEPTH_CALLOUT.fineBelowMeters);
  elements.depthMinimumInterval.value = numberField(
    depthCallout.minimumIntervalSeconds,
    DEFAULT_DEPTH_CALLOUT.minimumIntervalSeconds,
  );
  elements.depthRepeatSame.value = numberField(depthCallout.repeatSameBucketSeconds, DEFAULT_DEPTH_CALLOUT.repeatSameBucketSeconds);
  elements.depthSayUnits.checked = depthCallout.sayUnits === true;
}

function renderDepthCalloutStatus(value) {
  const lastAnnouncement = lastAnnouncementMessage(value.lastAnnouncement);
  elements.depthCalloutState.textContent = value.active ? "Armed" : "Off";
  elements.depthCalloutState.classList.toggle("armed", value.active === true);
  elements.depthLiveValue.textContent =
    value.lastDepthMeters == null ? "--" : `${Number(value.lastDepthMeters).toFixed(1)} m`;
  elements.depthLastCallout.textContent = lastAnnouncement || "No callout yet";
  elements.depthUpdated.textContent = value.lastUpdatedAt
    ? `Updated ${new Date(value.lastUpdatedAt).toLocaleTimeString()}`
    : "";
}

function lastAnnouncementMessage(value) {
  if (typeof value === "string") return value;
  return value?.message || "";
}

function readDepthCalloutFromPage() {
  return {
    ...(settings.depthCallout || DEFAULT_DEPTH_CALLOUT),
    enabled: elements.depthCalloutEnabled.checked,
    path: elements.depthCalloutPath.value.trim(),
    sourcePath: elements.depthCalloutPath.value.trim(),
    sayUnits: elements.depthSayUnits.checked,
    targetMinimumMeters: Number(elements.depthTargetMinimum.value),
    targetMaximumMeters: Number(elements.depthTargetMaximum.value),
    fineBelowMeters: Number(elements.depthFineBelow.value),
    minimumIntervalSeconds: Number(elements.depthMinimumInterval.value),
    repeatSameBucketSeconds: Number(elements.depthRepeatSame.value),
  };
}

function blankMonitor(number) {
  return {
    id: `instrument-${Date.now()}-${number}`,
    label: `Instrument ${number}`,
    path: "",
    unit: "",
    conversion: "none",
    directionMode: "none",
    absoluteValue: false,
    enabled: true,
    rateWindowSeconds: 60,
    minimumRateSampleSeconds: 10,
    hysteresis: 0,
    rateHysteresisPerMinute: 0,
    levels: {
      information: { enabled: true, repeatSeconds: 300 },
      warning: { enabled: true, repeatSeconds: 60 },
      danger: { enabled: true, repeatSeconds: 15 },
    },
  };
}

function setField(card, name, value) {
  const input = card.querySelector(`[data-field="${name}"]`);
  if (input.type === "checkbox") input.checked = Boolean(value);
  else input.value = value == null ? "" : String(value);
}

function setRule(row, name, value) {
  const input = row.querySelector(`[data-rule="${name}"]`);
  if (input.type === "checkbox") input.checked = Boolean(value);
  else input.value = value == null ? "" : String(value);
}

function readField(card, name) {
  return card.querySelector(`[data-field="${name}"]`).value;
}

function readChecked(card, name) {
  return card.querySelector(`[data-field="${name}"]`).checked;
}

function readNumber(card, name) {
  return Number(readField(card, name));
}

function numberField(value, fallback) {
  return Number.isFinite(Number(value)) ? String(value) : String(fallback);
}

function optionalInput(row, name) {
  const value = row.querySelector(`[data-rule="${name}"]`).value.trim();
  return value === "" ? null : Number(value);
}

function markDirty() {
  dirty = true;
  updateSaveButton();
  setMessage("Unsaved changes");
}

function updateSaveButton() {
  elements.saveSettings.disabled = saving || !dirty;
  elements.saveSettings.classList.toggle("dirty", dirty && !saving);
  elements.saveSettings.classList.toggle("saving", saving);
  if (saving) {
    elements.saveSettings.textContent = "Saving...";
  } else if (dirty) {
    elements.saveSettings.textContent = "Save and apply";
  } else {
    elements.saveSettings.textContent = "Saved";
  }
}

function labelLevel(level) {
  if (level === "danger") return "Danger";
  if (level === "warning") return "Warning";
  if (level === "information") return "Information";
  return "Normal";
}

function signed(value) {
  return Number(value) > 0 ? `+${value}` : value;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setMessage(message, error = false) {
  elements.settingsMessage.textContent = message;
  elements.settingsMessage.classList.toggle("error", error);
}

function setConnection(state, text) {
  elements.statusDot.className = state;
  elements.statusText.textContent = text;
}

function scheduleRefresh(seconds) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshStatus, seconds * 1000);
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function putJson(url, body) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(responseBody.error || `HTTP ${response.status}`);
  return responseBody;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(responseBody.error || `HTTP ${response.status}`);
  return responseBody;
}
