const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(
  path.join(root, "editor/app/static/admin.html"),
  "utf8"
);
const css = fs.readFileSync(
  path.join(root, "editor/app/static/editor.css"),
  "utf8"
);
const javascript = fs.readFileSync(
  path.join(root, "editor/app/static/admin.js"),
  "utf8"
);

for (const target of [
  "overview",
  "editing",
  "publishing",
  "visuals",
  "contributions",
  "email",
  "access",
  "users"
]) {
  assert.match(html, new RegExp(`href="#${target}"`));
  assert.match(html, new RegExp(`id="${target}"`));
}
assert.equal(
  (html.match(/class="[^"]*\badmin-panel\b[^"]*"/g) || []).length,
  8
);
assert.equal(
  (html.match(/data-visual-panel-target=/g) || []).length,
  4
);
assert.equal(
  (html.match(/data-visual-panel=/g) || []).length,
  4
);

assert.match(html, /class="admin-layout"/);
assert.match(html, /class="admin-sidebar"/);
assert.match(html, /class="admin-content"/);
assert.match(html, /class="analytics-details"/);
assert.doesNotMatch(
  html,
  /<details class="analytics-details"\s+open/,
  "the long analytics trend must be collapsed by default"
);

for (const legend of [
  "基础外观",
  "关系与点亮",
  "星体亮度",
  "入场动画"
]) {
  assert.match(html, new RegExp(`<legend>${legend}</legend>`));
}
assert.equal(
  (html.match(/class="visual-group"/g) || []).length,
  4
);
assert.match(html, /class="visual-form-actions"/);
assert.match(html, /name="home_star_brightness_min"/);
assert.match(html, /id="starBrightnessRuleList"/);
assert.match(html, /id="starBrightnessTierList"/);
assert.match(html, /id="addStarBrightnessRule"/);
assert.match(html, /id="addStarBrightnessTier"/);
assert.match(html, /id="starFormulaVariableReference"/);
assert.match(html, /id="starFormulaFunctionReference"/);
assert.match(html, /star-formula-engine\.js/);

assert.match(css, /\.admin-layout\s*\{[\s\S]*grid-template-columns:/);
assert.match(css, /\.admin-sidebar\s*\{[\s\S]*position:\s*sticky/);
assert.match(css, /\.admin-section-grid\s*\{/);
assert.match(css, /\.visual-group-grid\s*\{/);
assert.match(css, /\.admin-panel\[hidden\][\s\S]*display:\s*none/);
assert.match(css, /\.visual-settings-tabs\s*\{/);
assert.match(css, /\.star-variable-reference\s*\{/);
assert.match(
  css,
  /@media \(max-width: 900px\)[\s\S]*\.admin-layout\s*\{[\s\S]*display:\s*block/
);
assert.match(
  css,
  /@media \(max-width: 760px\)[\s\S]*\.visual-group-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/
);
assert.match(javascript, /function setupAdminNavigation\(\)/);
assert.match(javascript, /function setupVisualSettingsNavigation\(\)/);
assert.match(javascript, /function renderStarFormulaReference\(\)/);
assert.match(javascript, /starFormulaEngine\.validateFormula/);
assert.match(javascript, /home_star_brightness_tiers/);
assert.match(javascript, /aria-current.*page/);

console.log("Admin layout checks passed");
