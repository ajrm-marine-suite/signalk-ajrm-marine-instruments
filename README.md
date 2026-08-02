# AJRM Marine Instruments

## Version 1.2

`v0.5.2` replaces the live instrument dial internals with the SVG classic-gauge
renderer from the design study, so Depth, Wind, SOG, COG, and Exhaust use the
new dial faces rather than the older CSS needle layout.

`v0.5.1` folds the classic-gauge design study into the live app. Depth now uses
0-10, 0-50, 0-100, and 0-200m scale steps with hysteresis so it does not chatter
around boundaries; the Wind card has a separate drift readout, purple tide/current
pointer with arrowhead, compact dark AWS readout, and tide set readout below the
dial; the Exhaust card no longer repeats "water temperature" under the gauge.

`v0.5.0` refines the Marine Classic visual design. Wind readouts now sit in
dedicated layout lanes instead of overlaying the dial, small-dial LCDs are less
dominant, and the instrument cards have deeper layered bezels, subtle panel
texture, and glass highlights for a more realistic marine-instrument feel.

`v0.5.0` adds dynamic analogue scales and a compact GPS card. Depth now expands
from an anchoring friendly 0-10m scale up through 20, 50, 100, 200, 300, and
500m; SOG and temperature scales also expand when their values need more
headroom. The GPS card shows latitude, longitude, accuracy, satellites, and
HDOP/PDOP where Signal K provides them.

`v0.5.0` rebuilds the Wind card as a Garmin-style tactical wind instrument with
LCD readouts for TWD, AWA, TWS, TWA, AWS, tide/current drift, and tide set,
plus separate graphical true, apparent, and current pointers.

`v0.5.0` removes the transitional Status card, drops the decorative inactive
soft-key labels below the dials, and gives gauge needles a clearer arrowhead.

`v0.5.0` reduces HTTP access-log noise by using a calmer default web refresh
interval and backing off further when the browser tab is hidden.

`v0.5.0` adds the Marine Classic visual theme: compact Garmin-style hybrid
instrument heads with black bezels, outside scales, LCD readouts, needles, and
simple display-only colour bands.

`v0.5.0` promoted the display-only instrument application as the working
baseline. Audible monitoring remains in AJRM Marine Instrument Alerts.

> **Alpha Release disclaimer:** This software is Alpha Release and has not been tested in live environments and must not be relied upon for navigation or safety. The Authors do not accept any responsibility for loss or damage as a result of using this software.

AJRM Marine Instruments is a Signal K webapp and plugin for compact, readable boat
instruments. It is deliberately display-only: audible monitoring, limits,
rate-of-change rules, severity, and repetition are owned by the separate
**AJRM Marine Instrument Alerts** app.

It displays:

- Depth
- Apparent wind speed and angle
- True wind speed, Beaufort force, true direction in degrees, and cardinal direction
- Qualified independent current drift and set from AJRM Marine Navigation
  Reference; arbitrary or GPS-derived `environment.current.*` values are not
  presented as trusted tide/current
- COG and SOG
- TP32 pilot helm-position proxy on a signed port/amidships/starboard dial,
  shown only when Signal K explicitly reports an engaged autopilot mode. It is
  not presented as a calibrated physical rudder measurement, and standby or
  unknown-state values are withheld.
- GPS latitude, longitude, accuracy, satellites, and dilution of precision
- Exhaust water temperature
- Sea-water temperature

## Install On The Pi

```bash
cd ~/.signalk
npm install git+https://github.com/ajrm-marine-suite/signalk-ajrm-marine-instruments.git#v0.6.3 --omit=dev --no-package-lock
sudo systemctl restart signalk
```

Then open the webapp on your Signal K server:

`https://<signal-k-host>:3443/signalk-ajrm-marine-instruments/`

## Configuration

The plugin settings allow you to choose the depth source, exhaust water temperature path, and refresh interval.

Configure spoken Information, Warning, and Danger rules in **AJRM Marine Instrument Alerts**. That app can monitor any numeric Signal K path, including these same depth and temperature paths.

## Notes

Signal K uses SI units internally. AJRM Marine Instruments converts speed to knots, angles to degrees, and temperature to Celsius for display.

Heading-dependent values use AJRM Marine Navigation Reference when available.
The status projection exposes whether the reference is a bow compass or a
moving-COG proxy, together with its source and method. Raw magnetic heading is
never displayed or used as though it were true heading.
If the provider path exists with a malformed or unsupported contract, or its
`updatedAt` is missing, invalid, or more than 15 seconds old, provider-owned
navigation and GNSS values stay unavailable rather than being silently mixed
with raw paths. Raw fallback is used only when the provider path is absent.

When several GNSS receivers are present, displayed HDOP, satellite count, fix
type, method quality, and integrity come from the same provider-selected
ground-track source rather than Signal K's aggregate current values.

AJRM Marine Instruments is authored and maintained by Anthony McDonald, with assistance from William McAusland. It builds on the Signal K project and the work of Signal K plugin authors.


## Public Beta

Large-format Signal K instrument display for AJRM Marine Suite.

Development assistance: OpenAI Codex helped with code generation, refactoring, and automated testing during the beta development cycle.
## License and commercial use

This software is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). You may use, study, share, and modify it under that licence. If you modify it and make it available to users over a network, the corresponding source code must also be made available under the AGPL.

Commercial licensing is available by arrangement for organisations that want different terms.
