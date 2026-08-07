import test from "node:test";
import assert from "node:assert/strict";
import ajrmMarineInstrumentAlerts from "../plugin/alerts/index.js";

test("subscribed values publish AJRM Marine Instrument Alerts notifications", () => {
  let deltaHandler;
  const messages = [];
  const app = {
    subscriptionmanager: {
      subscribe(_subscription, unsubscribes, _onError, onDelta) {
        deltaHandler = onDelta;
        unsubscribes.push(() => {});
      },
    },
    getSelfPath() {
      return null;
    },
    getDataDirPath() {
      return null;
    },
    handleMessage(_pluginId, message) {
      messages.push(message);
    },
    setPluginStatus() {},
    error() {},
  };
  const plugin = ajrmMarineInstrumentAlerts(app);
  plugin.start({
    enabled: true,
    monitors: [
      {
        id: "depth",
        label: "Depth below keel",
        path: "environment.depth.belowKeel",
        unit: "metres",
        levels: {
          information: { enabled: false },
          warning: { minimum: 3, repeatSeconds: 60 },
          danger: { minimum: 2, repeatSeconds: 15 },
        },
      },
    ],
  });

  deltaHandler({
    updates: [
      {
        timestamp: "2026-06-18T12:00:00.000Z",
        values: [{ path: "environment.depth.belowKeel", value: 1.8 }],
      },
    ],
  });

  const published = messages.at(-1).updates[0].values[0];
  assert.equal(published.path, "notifications.environment.depth.belowKeel");
  assert.equal(published.value.state, "alarm");
  assert.deepEqual(published.value.method, ["visual", "sound"]);
  assert.equal(published.value.data.level, "danger");
  assert.match(published.value.message, /Depth below keel 1.8 metres/);
  const ajrmMarineNotifications = published.value.data.ajrmMarineNotifications;
  assert.ok(ajrmMarineNotifications.providerSessionId);
  assert.equal(ajrmMarineNotifications.sourceSequence, 1);
  assert.ok(ajrmMarineNotifications.correlationId);
  assert.deepEqual(
    {
      lifecycle: ajrmMarineNotifications.lifecycle,
      subjectKey: ajrmMarineNotifications.subjectKey,
      historyPolicy: ajrmMarineNotifications.history.policy,
      priority: ajrmMarineNotifications.priority.score,
      title: ajrmMarineNotifications.presentation.title,
    },
    {
      lifecycle: "active",
      subjectKey: "ajrm-marine-instrument-alerts:depth",
      historyPolicy: "on-resolve",
      priority: 850,
      title: "Depth below keel",
    },
  );
});

test("status advertises anchoring depth callout capability", () => {
  let status = null;
  const messages = [];
  const app = {
    subscriptionmanager: {
      subscribe(_subscription, unsubscribes) {
        unsubscribes.push(() => {});
      },
    },
    getSelfPath() {
      return null;
    },
    getDataDirPath() {
      return null;
    },
    handleMessage(_pluginId, message) {
      messages.push(message);
    },
    setPluginStatus() {},
    error() {},
  };
  const plugin = ajrmMarineInstrumentAlerts(app);
  plugin.start({});
  plugin.registerWithRouter({
    get(path, handler) {
      if (path === "/status") handler({}, { json(value) { status = value; } });
    },
    put() {},
    post() {},
  });
  assert.equal(status.depthCallout.supported, true);
  assert.equal(status.depthCallout.available, true);
  assert.equal(status.depthCallout.path, "environment.depth.belowKeel");
  assert.equal(status.depthCallout.audio, true);
  assert.equal(status.depthCallout.active, false);
  assert.equal(status.enabled, false);
  const xte = status.monitors.find((monitor) => monitor.id === "cross-track-error");
  assert.equal(xte.path, "plugins.ajrmMarineInstruments.crossTrackError");
  assert.equal(xte.absoluteValue, true);
  assert.equal(xte.directionMode, "portStarboard");
  assert.equal(xte.enabled, false);
  const projection = messages.find((message) =>
    message.updates?.[0]?.values?.[0]?.path === "plugins.ajrmMarineInstrumentAlerts"
  ).updates[0].values[0];
  assert.equal(projection.value.enabled, false);
  assert.equal(projection.value.depthCallout.supported, true);
  assert.equal(projection.value.depthCallout.audio, true);
});

test("adds the built-in nullable XTE monitor to existing monitor settings", () => {
  let settings = null;
  const app = {
    subscriptionmanager: { subscribe(_request, unsubscribes) { unsubscribes.push(() => {}); } },
    getSelfPath() { return null; },
    getDataDirPath() { return null; },
    handleMessage() {},
    setPluginStatus() {},
    error() {},
  };
  const plugin = ajrmMarineInstrumentAlerts(app);
  plugin.start({
    monitors: [{ id: "custom", label: "Custom", path: "environment.custom" }],
  });
  plugin.registerWithRouter({
    get(route, handler) {
      if (route === "/settings") handler({}, { json(value) { settings = value; } });
    },
    put() {},
    post() {},
  });

  assert.deepEqual(settings.monitors.map((monitor) => monitor.id), [
    "custom",
    "cross-track-error",
  ]);
});

test("plugin startup clears a callout retained by an older release", () => {
  const messages = [];
  const app = {
    subscriptionmanager: {
      subscribe(_subscription, unsubscribes) {
        unsubscribes.push(() => {});
      },
    },
    getSelfPath() {
      return null;
    },
    getDataDirPath() {
      return null;
    },
    handleMessage(_pluginId, message) {
      messages.push(message);
    },
    setPluginStatus() {},
    error() {},
  };
  const plugin = ajrmMarineInstrumentAlerts(app);
  plugin.start({});
  const startupClear = messages
    .flatMap((message) => message.updates?.[0]?.values || [])
    .find(
      (value) =>
        value.path === "notifications.environment.depth.callout",
    );
  assert.ok(startupClear);
  assert.equal(startupClear.value, null);
});

test("depth callout announces only inside the configured anchoring depth window", () => {
  let deltaHandler;
  const messages = [];
  const app = {
    subscriptionmanager: {
      subscribe(subscription, unsubscribes, _onError, onDelta) {
        assert.ok(subscription.subscribe.some((item) => item.path === "environment.depth.belowKeel"));
        deltaHandler = onDelta;
        unsubscribes.push(() => {});
      },
    },
    getSelfPath() {
      return null;
    },
    getDataDirPath() {
      return null;
    },
    handleMessage(_pluginId, message) {
      messages.push(message);
    },
    setPluginStatus() {},
    error() {},
  };
  const plugin = ajrmMarineInstrumentAlerts(app);
  plugin.start({
    enabled: true,
    monitors: [],
    depthCallout: {
      enabled: true,
      path: "environment.depth.belowKeel",
      sayUnits: true,
      minimumIntervalSeconds: 1,
      targetMinimumMeters: 2,
      targetMaximumMeters: 3,
    },
  });

  deltaHandler({
    updates: [
      {
        timestamp: "2026-07-03T12:00:00.000Z",
        values: [{ path: "environment.depth.belowKeel", value: 8.2 }],
      },
      {
        timestamp: "2026-07-03T12:00:01.500Z",
        values: [{ path: "environment.depth.belowKeel", value: 3.0 }],
      },
      {
        timestamp: "2026-07-03T12:00:03.000Z",
        values: [{ path: "environment.depth.belowKeel", value: 2.4 }],
      },
    ],
  });

  const callouts = messages
    .map((message) => message.updates[0].values[0])
    .filter(
      (value) =>
        value.path === "notifications.environment.depth.callout" &&
        value.value,
    );
  assert.equal(callouts.length, 2);
  assert.equal(callouts[0].value.message, "Depth 3 meters.");
  assert.equal(callouts[1].value.message, "Depth 2.4 meters.");
  assert.equal(callouts[1].value.data.category, "instrument-depth-callout");
  assert.equal(callouts[1].value.data.announcement.shouldAnnounce, true);
  assert.equal(
    callouts[1].value.data.ajrmMarineNotifications.lifecycle,
    "event",
  );
  assert.equal(
    callouts[1].value.data.ajrmMarineNotifications.delivery.expiresSeconds,
    30,
  );

  deltaHandler({
    updates: [
      {
        timestamp: "2026-07-03T12:00:04.000Z",
        values: [{ path: "environment.depth.belowKeel", value: 3.2 }],
      },
    ],
  });
  const cleared = messages
    .map((message) => message.updates[0].values[0])
    .filter((value) => value.path === "notifications.environment.depth.callout")
    .at(-1);
  assert.equal(cleared.value, null);
  assert.equal(
    messages.some(
      (message) =>
        message.updates[0].values[0].path ===
          "notifications.environment.depth.belowKeel" &&
        message.updates[0].values[0].value === null,
    ),
    false,
    "leaving the callout band must not clear the separate shallow-depth monitor",
  );
});

test("latest depth callout resets the explicit 30-second clear timer", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];
  let plugin;
  globalThis.setTimeout = (callback, milliseconds) => {
    const timer = {
      callback,
      milliseconds,
      cleared: false,
      unref() {},
    };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    timer.cleared = true;
  };
  try {
    let deltaHandler;
    const messages = [];
    const app = {
      subscriptionmanager: {
        subscribe(_subscription, unsubscribes, _onError, onDelta) {
          deltaHandler = onDelta;
          unsubscribes.push(() => {});
        },
      },
      getSelfPath() {
        return null;
      },
      getDataDirPath() {
        return null;
      },
      handleMessage(_pluginId, message) {
        messages.push(message);
      },
      setPluginStatus() {},
      error() {},
    };
    plugin = ajrmMarineInstrumentAlerts(app);
    plugin.start({
      enabled: true,
      monitors: [],
      depthCallout: {
        enabled: true,
        path: "environment.depth.belowKeel",
        minimumIntervalSeconds: 1,
        targetMinimumMeters: 2,
        targetMaximumMeters: 3,
      },
    });

    deltaHandler({
      updates: [
        {
          timestamp: "2026-07-03T12:00:00.000Z",
          values: [{ path: "environment.depth.belowKeel", value: 3 }],
        },
        {
          timestamp: "2026-07-03T12:00:01.500Z",
          values: [{ path: "environment.depth.belowKeel", value: 2 }],
        },
      ],
    });

    assert.equal(timers.length, 2);
    assert.equal(timers[0].milliseconds, 30_000);
    assert.equal(timers[0].cleared, true);
    assert.equal(timers[1].cleared, false);
    timers[1].callback();
    const calloutValues = messages
      .flatMap((message) => message.updates?.[0]?.values || [])
      .filter(
        (value) =>
          value.path === "notifications.environment.depth.callout",
      );
    assert.equal(calloutValues.at(-1).value, null);
  } finally {
    plugin?.stop();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("Anchor dropped announces depth and selects Traffic Anchor profile when available", () => {
  let deltaHandler;
  const messages = [];
  const selectedProfiles = [];
  let currentTrafficProfile = "coastal";
  const routes = new Map();
  const app = {
    ajrmMarineTrafficApi: {
      status() {
        return { profiles: { current: currentTrafficProfile } };
      },
      setProfile(profile) {
        selectedProfiles.push(profile);
        currentTrafficProfile = profile;
        return { current: profile };
      },
    },
    subscriptionmanager: {
      subscribe(_subscription, unsubscribes, _onError, onDelta) {
        deltaHandler = onDelta;
        unsubscribes.push(() => {});
      },
    },
    getSelfPath() {
      return null;
    },
    getDataDirPath() {
      return null;
    },
    handleMessage(_pluginId, message) {
      messages.push(message);
    },
    setPluginStatus() {},
    error() {},
  };
  const plugin = ajrmMarineInstrumentAlerts(app);
  plugin.registerWithRouter({
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    },
    put() {},
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
  });
  plugin.start({
    enabled: true,
    monitors: [],
    depthCallout: {
      enabled: true,
      path: "environment.depth.belowKeel",
    },
  });

  deltaHandler({
    updates: [
      {
        timestamp: "2026-07-08T12:00:00.000Z",
        values: [{ path: "environment.depth.belowKeel", value: 4.4 }],
      },
    ],
  });

  const postAnchorDropped = () => {
    let response = null;
    routes.get("POST /depth-callout/drop")({}, {
      json(value) {
        response = value;
      },
      status() {
        throw new Error("Anchor dropped should succeed with recent depth");
      },
    });
    return response;
  };

  const response = postAnchorDropped();
  const secondResponse = postAnchorDropped();

  assert.deepEqual(selectedProfiles, ["anchor", "anchor"]);
  assert.equal(response.ok, true);
  assert.equal(response.depthMeters, 4.4);
  assert.deepEqual(response.trafficProfile, {
    requested: "anchor",
    available: true,
    ok: true,
    profile: "anchor",
  });
  assert.deepEqual(secondResponse.trafficProfile, response.trafficProfile);
  const anchorAnnouncement = messages
    .map((message) => message.updates[0].values[0])
    .filter((value) => value.value?.data?.announcement?.id?.startsWith("anchor-dropped-"));
  assert.equal(anchorAnnouncement.length, 2);
  assert.equal(anchorAnnouncement.at(-1).value.message, "Anchor dropped in 4 meters.");
  assert.equal(
    anchorAnnouncement.at(-1).value.data.ajrmMarineNotifications.lifecycle,
    "event",
  );

  const readStatus = () => {
    let response = null;
    routes.get("GET /status")({}, {
      json(value) {
        response = value;
      },
    });
    return response;
  };
  assert.equal(readStatus().depthCallout.anchorDropActive, true);
  assert.deepEqual(readStatus().trafficProfile, { available: true, current: "anchor" });

  currentTrafficProfile = "coastal";
  assert.equal(readStatus().depthCallout.anchorDropActive, false);

  currentTrafficProfile = "anchor";
  assert.equal(readStatus().depthCallout.anchorDropActive, false);
});

test("Anchor dropped can find Traffic API from the shared registry", () => {
  let deltaHandler;
  const selectedProfiles = [];
  const routes = new Map();
  const registry = Symbol.for("ajrmMarineTrafficApi");
  const previousRegistry = globalThis[registry];
  globalThis[registry] = {
    setProfile(profile) {
      selectedProfiles.push(profile);
      return { current: profile };
    },
  };
  const app = {
    subscriptionmanager: {
      subscribe(_subscription, unsubscribes, _onError, onDelta) {
        deltaHandler = onDelta;
        unsubscribes.push(() => {});
      },
    },
    getSelfPath() {
      return null;
    },
    getDataDirPath() {
      return null;
    },
    handleMessage() {},
    setPluginStatus() {},
    error() {},
  };
  try {
    const plugin = ajrmMarineInstrumentAlerts(app);
    plugin.registerWithRouter({
      get() {},
      put() {},
      post(path, handler) {
        routes.set(`POST ${path}`, handler);
      },
    });
    plugin.start({
      enabled: true,
      monitors: [],
      depthCallout: {
        enabled: true,
        path: "environment.depth.belowKeel",
      },
    });
    deltaHandler({
      updates: [
        {
          timestamp: "2026-07-08T12:00:00.000Z",
          values: [{ path: "environment.depth.belowKeel", value: 3.7 }],
        },
      ],
    });
    let response = null;
    routes.get("POST /depth-callout/drop")(
      {},
      {
        json(value) {
          response = value;
        },
        status() {
          throw new Error("Anchor dropped should succeed with recent depth");
        },
      },
    );

    assert.deepEqual(selectedProfiles, ["anchor"]);
    assert.deepEqual(response.trafficProfile, {
      requested: "anchor",
      available: true,
      ok: true,
      profile: "anchor",
    });
  } finally {
    if (previousRegistry === undefined) delete globalThis[registry];
    else globalThis[registry] = previousRegistry;
  }
});

test("protects integrated settings mutations with Signal K access", () => {
  const routes = new Map();
  const app = {
    getSelfPath() { return null; },
    getDataDirPath() { return null; },
    handleMessage() {},
    setPluginStatus() {},
    error() {},
  };
  const plugin = ajrmMarineInstrumentAlerts(app);
  plugin.registerWithRouter({
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    put(path, handler) { routes.set(`PUT ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
  });

  let statusCode = null;
  let body = null;
  routes.get("PUT /settings")(
    { body: {}, skIsAuthenticated: false },
    {
      status(code) { statusCode = code; return this; },
      json(value) { body = value; },
    },
  );
  assert.equal(statusCode, 403);
  assert.equal(body.ok, false);
});
