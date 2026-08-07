import assert from "node:assert/strict";
import test from "node:test";
import envelopeModule from "../plugin/lib/notifications-plus-envelope.js";

const {
  eventEnvelope,
  resetProviderSession,
} = envelopeModule;

test("successive one-shot depth callouts keep a stable supersession subject", () => {
  resetProviderSession();
  const monitor = {
    id: "anchoring-depth-callout",
    label: "Depth",
    path: "environment.depth.belowKeel",
  };
  const first = eventEnvelope(monitor, {
    id: "depth-callout-2026-07-28T10:00:00.000Z",
    ts: "2026-07-28T10:00:00.000Z",
    message: "Depth 3 meters.",
    value: 3,
    unit: "meters",
  });
  const second = eventEnvelope(monitor, {
    id: "depth-callout-2026-07-28T10:00:05.000Z",
    ts: "2026-07-28T10:00:05.000Z",
    message: "Depth 2.5 meters.",
    value: 2.5,
    unit: "meters",
  });

  assert.equal(first.lifecycle, "event");
  assert.equal(second.lifecycle, "event");
  assert.equal(
    first.subjectKey,
    "ajrm-marine-instrument-alerts:anchoring-depth-callout",
  );
  assert.equal(second.subjectKey, first.subjectKey);
  assert.notEqual(second.eventId, first.eventId);
});

