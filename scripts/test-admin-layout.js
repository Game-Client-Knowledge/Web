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

assert.match(css, /\.admin-layout\s*\{[\s\S]*grid-template-columns:/);
assert.match(css, /\.admin-sidebar\s*\{[\s\S]*position:\s*sticky/);
assert.match(css, /\.admin-section-grid\s*\{/);
assert.match(css, /\.visual-group-grid\s*\{/);
assert.match(
  css,
  /@media \(max-width: 900px\)[\s\S]*\.admin-layout\s*\{[\s\S]*display:\s*block/
);
assert.match(
  css,
  /@media \(max-width: 760px\)[\s\S]*\.visual-group-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/
);
assert.match(javascript, /function setupAdminNavigation\(\)/);
assert.match(javascript, /aria-current/);

console.log("Admin layout checks passed");
