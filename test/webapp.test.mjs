import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

test("webapp uses compact marine classic hybrid instruments", () => {
  const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

  assert.match(html, /marine-classic/);
  assert.match(html, /class="bezel"/);
  assert.match(html, /class="lcd/);
  assert.doesNotMatch(html, /class="softkeys"/);
  assert.doesNotMatch(html, /Status<\/div>/);
  assert.doesNotMatch(html, /id="updatedAt"/);
  assert.match(html, /id="trueWindDirection"/);
  assert.match(html, /id="apparentWindAngle"/);
  assert.match(html, /id="trueWindAngle"/);
  assert.match(html, /id="tideDrift"/);
  assert.match(html, /id="tideSetAngle"/);
  assert.match(html, /drift-readout top-centre/);
  assert.match(html, /id="depthScale100"/);
  assert.match(html, /id="sogScale100"/);
  assert.match(html, /id="tempScale100"/);
  assert.match(html, /id="gpsInstrument"/);
  assert.match(html, /id="gpsLatitude"/);
  assert.match(html, /id="gpsLongitude"/);
  assert.match(html, /id="gpsAccuracy"/);
  assert.match(html, /class="face compass wind-scale tactical-wind-dial"/);
  assert.match(html, /id="temperatureNeedle"/);
  assert.match(css, /grid-template-columns: repeat\(auto-fit, minmax\(176px, 1fr\)\)/);
  assert.match(css, /--lcd:/);
  assert.match(css, /border-bottom: 18px solid #f97316/);
  assert.match(css, /\.wind-readout/);
  assert.match(css, /\.wind-panel\s*\{[^}]*display: grid;/s);
  assert.match(css, /\.tactical-wind-dial\s*\{[^}]*grid-column: 2;/s);
  assert.doesNotMatch(css, /\.wind-readout\s*\{[^}]*position: absolute;/s);
  assert.match(css, /\.tactical-wind-dial/);
  assert.match(css, /\.wind-pointer\.apparent/);
  assert.match(css, /\.wind-pointer\.current::before\s*\{[^}]*border-bottom-color: var\(--tide-current\)/s);
  assert.match(css, /\.aws-lcd\s*\{[^}]*bottom: 24%/s);
  assert.match(css, /\.drift-readout/);
  assert.match(css, /\.scale-quarter/);
  assert.match(css, /\.gps-panel/);
  assert.match(css, /\.gps-card/);
  assert.doesNotMatch(css, /\.scale-20/);
  assert.doesNotMatch(css, /\.softkeys/);
  assert.doesNotMatch(css, /\.status-lcd/);
  assert.match(css, /data-band="offline"/);
  assert.match(app, /setBand\(elements\.depthInstrument, depthBand\(depth\)\)/);
  assert.match(app, /formatRelativeAngle\(apparentWind\.angleDegrees\)/);
  assert.match(app, /current\.driftKnots/);
  assert.match(app, /const DEPTH_SCALE_STEPS = \[10, 50, 100, 200\]/);
  assert.match(app, /const DEPTH_SCALE_HYSTERESIS = \{/);
  assert.match(app, /let activeDepthScale = null/);
  assert.match(app, /chooseDepthScale\(depth, activeDepthScale\)/);
  assert.match(app, /setGaugeScale\(elements\.depthScale, depthScale\)/);
  assert.match(app, /formatCoordinate\(gps\.latitude, "N", "S"\)/);
  assert.match(app, /formatGpsAccuracy\(gps\)/);
  assert.match(app, /gpsBand\(gps\)/);
  assert.doesNotMatch(app, /updatedAt/);
  assert.doesNotMatch(app, /temperatureFill/);
  assert.doesNotMatch(html, /Water temperature/);
});

test("webapp slows status polling when hidden", () => {
  const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

  assert.match(app, /const DEFAULT_REFRESH_SECONDS = 3/);
  assert.match(app, /const HIDDEN_REFRESH_SECONDS = 15/);
  assert.match(app, /document\.addEventListener\("visibilitychange"/);
  assert.match(app, /document\.hidden/);
});
