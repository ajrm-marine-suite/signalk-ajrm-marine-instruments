import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("web app exposes and persists absolute-value monitoring", async () => {
  const [html, app] = await Promise.all([
    fs.readFile(new URL("../public/alerts.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/alerts.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /data-field="absoluteValue" type="checkbox"/);
  assert.match(app, /setField\(card, "absoluteValue", monitor\.absoluteValue === true\)/);
  assert.match(app, /absoluteValue: readChecked\(card, "absoluteValue"\)/);
  assert.match(html, /data-field="directionMode"/);
  assert.match(html, /value="portStarboard">Port \/ Starboard/);
  assert.match(app, /setField\(card, "directionMode", monitor\.directionMode \|\| "none"\)/);
  assert.match(app, /directionMode: readField\(card, "directionMode"\)/);
});

test("rate tuning fields provide hover help and suggested starting values", async () => {
  const [html, css] = await Promise.all([
    fs.readFile(new URL("../public/alerts.html", import.meta.url), "utf8"),
    fs.readFile(new URL("../public/alerts.css", import.meta.url), "utf8"),
  ]);

  for (const field of [
    "rateWindowSeconds",
    "minimumRateSampleSeconds",
    "hysteresis",
    "rateHysteresisPerMinute",
  ]) {
    assert.match(html, new RegExp(`data-field="${field}"`));
  }
  assert.equal((html.match(/class="help-tip"/g) || []).length, 4);
  assert.match(html, /class="live-rate" tabindex="0"/);
  assert.match(html, /Rate -- means there is no usable value yet/);
  assert.match(html, /Suggested: 60 s/);
  assert.match(html, /Suggested: 10 s/);
  assert.match(html, /Depth 0\.2 m; Temperature 1 °C; XTE 5 m/);
  assert.match(html, /Suggested: about 10% of the configured rate threshold/);
  assert.match(html, /Only used when a Rise\/min or Fall\/min rule is configured/);
  assert.match(css, /\.help-tip:hover, \.help-tip:focus-visible/);
  assert.match(css, /\.live-rate\[title\]/);
});

