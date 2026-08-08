# Changelog

## 0.8.1

- Add concise purpose headers to every maintained runtime module so its role is
  clear before reading implementation details.
- Add a regression check that prevents new source modules from being introduced
  without a module-purpose header.
- Align OpenAPI metadata with the package release and test that the versions do
  not drift apart again.
- Preserve existing runtime contracts and behaviour following a suite-wide
  maintainability and Signal K integration review.
- Refresh Instruments browser asset cache keys to the package release.

## 0.6.9

- Expose an in-process status API and versioned contract for the derived
  pilot-helm and XTE paths.
- Declare radians, metre units, nullable behavior, autopilot engagement gating,
  and XTE port/starboard sign semantics explicitly for suite BITE consumers.

## 0.6.8

- Make test discovery portable to Node 20 on ARMv7 runners.

## 0.6.7

- Add Signal K configuration switches for showing or hiding each instrument
  card independently, retaining the current all-visible display by default.

## 0.6.6

- Make the Depth card the same one-column size as the other standard gauges
  while retaining Wind's larger three-column layout.

## 0.6.5

- Add true-heading and cross-track-error instruments, displaying XTE as a
  magnitude with Port/Stbd direction and preserving null whenever the
  corresponding navigation information is unavailable.
- Publish a normalized nullable XTE value at
  `plugins.ajrmMarineInstruments.crossTrackError`, preferring the modern course
  API and preventing an explicit route-end null from falling through to a
  retained legacy course value.

## 0.6.4

- Publish `plugins.ajrmMarineInstruments.pilotHelmAngle` in radians while the
  autopilot is explicitly engaged, and clear it outside engaged modes so alarm
  consumers do not see TP32 standby placeholders or stale helm values.

## 0.6.3

- Present TP32 steering position as a pilot-helm proxy only while Signal K
  explicitly reports an engaged autopilot mode; suppress standby and unknown
  values so the unit's alternating placeholder positions are not mistaken for
  physical rudder movement.

## 0.6.2

- Add signed port/amidships/starboard rudder-angle and sea-water temperature
  instruments using the standard Signal K paths.

## 0.6.1

- Use AJRM Marine Navigation Reference as the authoritative source for coherent
  GNSS quality, track, heading, current, leeway, and provenance.
- Keep GNSS quality fields on the selected GNSS source and expose
  heading-dependent values only when the provider says a real heading exists.
- Distinguish independent current from GPS-dependent ground-minus-water
  residuals rather than presenting both as measured tide/current.
- Withhold provider-owned navigation and GNSS fields for stale states or
  malformed and unsupported provider contracts; accept `updatedAt` only within
  15 seconds and use raw fallback only when the provider path is absent.

## 0.5.7

- Treat Signal K angular values as radians consistently instead of guessing
  radians versus degrees from numeric magnitude.

## 0.5.5

- Add Signal K AppStore relationship metadata recommending Instrument Alerts
  for users who want audible thresholds and trend monitoring.
- Add the reusable Signal K plugin CI workflow.

## 0.5.4

- Align web asset cache keys and install documentation with the package version.

## 0.5.3

- Update public README launch URL guidance.

## 0.5.0

- Initial public beta release as AJRM Marine Instruments.
