const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const siteTemplate = fs.readFileSync(
  path.join(root, "src/_includes/layouts/base.njk"),
  "utf8"
);
const siteScript = fs.readFileSync(
  path.join(root, "src/assets/js/editor-integration.js"),
  "utf8"
);
const siteCss = fs.readFileSync(
  path.join(root, "src/assets/css/site.css"),
  "utf8"
);
const editorTemplate = fs.readFileSync(
  path.join(root, "editor/app/static/index.html"),
  "utf8"
);
const editorScript = fs.readFileSync(
  path.join(root, "editor/app/static/editor.js"),
  "utf8"
);
const editorCss = fs.readFileSync(
  path.join(root, "editor/app/static/editor.css"),
  "utf8"
);

for (const [name, source] of [
  ["knowledge site", siteTemplate],
  ["editor workspace", editorTemplate]
]) {
  assert.equal(
    (source.match(/data-onboarding-step(?:\s|>)/g) || []).length,
    7,
    `${name} must expose seven guide steps`
  );
  assert.equal(
    (source.match(/data-onboarding-progress/g) || []).length,
    7,
    `${name} must expose seven progress segments`
  );
  for (const phrase of [
    "编辑文档",
    "新建结构",
    "评论协作",
    "检查更改",
    "发布更改",
    "查看贡献",
    "Base Tree",
    "Current Tree",
    "Draft PR"
  ]) {
    assert.match(source, new RegExp(phrase), `${name}: missing ${phrase}`);
  }
  assert.match(source, /onboarding-checklist/);
}

assert.match(siteTemplate, /data-onboarding-open/);
assert.match(editorTemplate, /id="onboardingOpenButton"/);

for (const source of [siteScript, editorScript]) {
  assert.match(source, /onboardingManual/);
  assert.match(source, /openOnboarding\(true\)/);
  assert.match(source, /state\.onboardingManual \|\|/);
  assert.match(source, /"关闭引导"/);
}

for (const source of [siteCss, editorCss]) {
  assert.match(
    source,
    /grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.match(source, /\.onboarding-checklist/);
  assert.match(source, /\.onboarding-note/);
}

console.log("Comprehensive onboarding guide checks passed");
