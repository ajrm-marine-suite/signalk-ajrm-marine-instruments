# AJRM Marine Instruments

## Version 0.8.0

Version 0.8.0 combines AJRM Marine Instruments and AJRM Marine Instrument
Alerts into one Signal K package. The gauge renderer and alert evaluator remain
separate internal modules, but now share one lifecycle, configuration surface,
test suite, and web application. Existing live alert settings continue to use
`ajrm-marine-instrument-alerts-settings.json`.

Signal K plugin configuration includes a **Displayed instruments** group. Each
card can be shown or hidden independently: Depth, Wind, SOG, COG, Heading, XTE,
Pilot helm, GPS, Exhaust temperature, and Water temperature. All cards remain
visible by default for compatibility with existing installations.

> **Alpha Release disclaimer:** This software is Alpha Release and has not been tested in live environments and must not be relied upon for navigation or safety. The Authors do not accept any responsibility for loss or damage as a result of using this software.

AJRM Marine Instruments is a Signal K webapp and plugin for compact, readable
boat instruments and configurable instrument monitoring. Its alert provider
publishes standards-compatible Signal K notifications; AJRM Marine
Notifications and Audio remain separate authorities for brokering and delivery.

It displays:

- Depth
- Apparent wind speed and angle
- True wind speed, Beaufort force, true direction in degrees, and cardinal direction
- Qualified independent current drift and set from AJRM Marine Navigation
  Reference; arbitrary or GPS-derived `environment.current.*` values are not
  presented as trusted tide/current
- COG and SOG
- True heading, when an AJRM Navigation Reference heading or raw
  `navigation.headingTrue` is available
- Cross-track-error magnitude in metres with **Port** or **Stbd** direction,
  using the current Signal K course API value with Great Circle and Rhumbline
  compatibility fallbacks
- TP32 pilot helm-position proxy on a signed port/amidships/starboard dial,
  shown only when Signal K explicitly reports an engaged autopilot mode. It is
  not presented as a calibrated physical rudder measurement, and standby or
  unknown-state values are withheld.
- GPS latitude, longitude, accuracy, satellites, and dilution of precision
- Exhaust water temperature
- Sea-water temperature

For downstream alarms, the plugin publishes the gated pilot helm position at:

```text
plugins.ajrmMarineInstruments.pilotHelmAngle
```

The value uses Signal K radians. It is present only while
`steering.autopilot.state` explicitly reports `auto`, `heading`, `wind`, or
`route`; the path is cleared to `null` in standby or when the mode is unknown.
In the **Alert settings** view, select **Radians to degrees** if thresholds
are to be entered and spoken in degrees.

The plugin also publishes the currently selected cross-track error at:

```text
plugins.ajrmMarineInstruments.crossTrackError
```

This normalized value retains the signed Signal K metres contract for downstream
consumers, while the instrument presents magnitude plus Port/Stbd direction. It
is explicitly cleared to `null` when
the active course source reports no XTE. An explicit null from the modern
course API is authoritative, so an older retained compatibility value cannot
keep an XTE alarm active after route termination.

## Install On The Pi

```bash
cd ~/.signalk
npm install git+https://github.com/ajrm-marine-suite/signalk-ajrm-marine-instruments.git#v0.8.0 --omit=dev --no-package-lock
sudo systemctl restart signalk
```

Then open the webapp on your Signal K server:

`https://<signal-k-host>:3443/signalk-ajrm-marine-instruments/`

Use **Alert settings** in the header, or open:

`https://<signal-k-host>:3443/signalk-ajrm-marine-instruments/alerts.html`

## Configuration

The plugin settings allow you to choose the depth source, exhaust water temperature path, and refresh interval.

Configure spoken Information, Warning, and Danger rules in the integrated
**Alert settings** view. It can monitor any numeric Signal K path, including
these same depth and temperature paths. State-changing controls require Signal K
read/write or administrator access when security is enabled.

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
