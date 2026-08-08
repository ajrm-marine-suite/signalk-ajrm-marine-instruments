/**
 * Implements the notifications plus envelope responsibilities of the AJRM Marine Instruments Signal K server.
 */

"use strict";

const { randomUUID } = require("node:crypto");

const PROVIDER = "ajrm-marine-instrument-alerts";
let providerSessionId = randomUUID();
let sourceSequence = 0;
let monitorCorrelations = new Map();

function activeEnvelope(monitor, event) {
  const level =
    event.level === "danger"
      ? "danger"
      : event.level === "warning"
        ? "warning"
        : "information";
  const subjectKey = `${PROVIDER}:${monitor.id}`;
  return {
    schemaVersion: 1,
    provider: PROVIDER,
    providerSessionId,
    sourceSequence: ++sourceSequence,
    correlationId: correlationFor(subjectKey),
    subjectKey,
    eventId: event.id,
    revision: Date.parse(event.ts) || Date.now(),
    lifecycle: "active",
    timestamp: event.ts,
    priority: {
      level,
      score: level === "danger" ? 850 : level === "warning" ? 550 : 250,
    },
    supersedes: [],
    history: { policy: "on-resolve" },
    delivery: {
      visual: true,
      audio: true,
      localPlayback: true,
      streamOutput: true,
      repeatSeconds: Number(monitor.levels?.[event.level]?.repeatSeconds) || 0,
      expiresSeconds: 90,
    },
    presentation: {
      title: monitor.label,
      label:
        level === "danger"
          ? "Danger"
          : level === "warning"
            ? "Warning"
            : "Information",
      message: event.message,
      category: "instrument-alert",
      facts: [],
    },
    actions: [],
    context: {
      monitorId: monitor.id,
      path: monitor.path,
      value: event.value,
      unit: event.unit,
      ratePerMinute: event.ratePerMinute,
    },
  };
}

function resolvedEnvelope(monitorId, now = Date.now()) {
  const subjectKey = `${PROVIDER}:${monitorId}`;
  const result = {
    schemaVersion: 1,
    provider: PROVIDER,
    providerSessionId,
    sourceSequence: ++sourceSequence,
    correlationId: correlationFor(subjectKey),
    subjectKey,
    eventId: `${PROVIDER}:${monitorId}:resolved:${now}`,
    revision: now,
    lifecycle: "resolved",
    timestamp: new Date(now).toISOString(),
    priority: { level: "information", score: 0 },
    supersedes: [],
    history: { policy: "on-resolve" },
    delivery: {
      visual: false,
      audio: false,
      localPlayback: false,
      streamOutput: false,
      repeatSeconds: 0,
      expiresSeconds: 30,
    },
    presentation: {
      title: "",
      label: "",
      message: "",
      category: "",
      facts: [],
    },
    actions: [],
    context: { monitorId },
  };
  monitorCorrelations.delete(subjectKey);
  return result;
}

function eventEnvelope(
  monitor,
  event,
  {
    category = "instrument-event",
    expiresSeconds = 30,
    context = {},
  } = {},
) {
  const eventId = String(
    event?.id || `${PROVIDER}:event:${Date.now()}`,
  );
  return {
    schemaVersion: 1,
    provider: PROVIDER,
    providerSessionId,
    sourceSequence: ++sourceSequence,
    correlationId: randomUUID(),
    subjectKey: `${PROVIDER}:${monitor?.id || "instrument-event"}`,
    eventId,
    revision: Date.parse(event?.ts) || Date.now(),
    lifecycle: "event",
    timestamp: event?.ts || new Date().toISOString(),
    priority: {
      level: "information",
      score: 250,
    },
    supersedes: [],
    history: { policy: "always" },
    delivery: {
      visual: true,
      audio: true,
      preempt: false,
      localPlayback: true,
      streamOutput: true,
      repeatSeconds: 0,
      expiresSeconds: Math.max(1, Number(expiresSeconds) || 30),
    },
    presentation: {
      title: monitor?.label || "Instrument",
      label: "Information",
      message: event?.message || "",
      category,
      facts: [],
    },
    actions: [],
    context: {
      monitorId: monitor?.id || null,
      path: monitor?.path || null,
      value: event?.value ?? null,
      unit: event?.unit || null,
      ratePerMinute: event?.ratePerMinute ?? null,
      ...context,
    },
  };
}

function correlationFor(subjectKey) {
  const existing = monitorCorrelations.get(subjectKey);
  if (existing) return existing;
  const correlationId = randomUUID();
  monitorCorrelations.set(subjectKey, correlationId);
  return correlationId;
}

function resetProviderSession() {
  providerSessionId = randomUUID();
  sourceSequence = 0;
  monitorCorrelations = new Map();
}

module.exports = {
  activeEnvelope,
  eventEnvelope,
  resetProviderSession,
  resolvedEnvelope,
};

