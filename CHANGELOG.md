# Changelog

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
