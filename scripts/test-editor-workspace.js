const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(
  path.join(root, "editor/app/static/index.html"),
  "utf8"
);
const css = fs.readFileSync(
  path.join(root, "editor/app/static/editor.css"),
  "utf8"
);
const siteCss = fs.readFileSync(
  path.join(root, "src/assets/css/site.css"),
  "utf8"
);
const javascript = fs.readFileSync(
  path.join(root, "editor/app/static/editor.js"),
  "utf8"
);
const siteIntegration = fs.readFileSync(
  path.join(root, "src/assets/js/editor-integration.js"),
  "utf8"
);

assert.match(html, /id="bootView" class="workspace-boot"/);
assert.match(html, /id="authView" class="auth-shell" hidden/);
assert.match(css, /\.workspace-boot\s*\{/);
assert.match(javascript, /function readIdentityCache\(\)/);
assert.match(javascript, /function applyCachedSession\(\)/);
assert.match(
  javascript,
  /applyCachedSession\(\);\s*loadSession\(\)\.catch/
);
assert.match(
  javascript,
  /function showView\(name\) \{\s*byId\("bootView"\)\.hidden = true/
);
assert.match(html, /id="diffModeLabel"[^>]*>完整文件差异</);
assert.match(html, /id="diffSnapshotSummary"/);
assert.match(css, /\.diff-snapshot-summary\s*\{/);
assert.match(css, /#activeEditor:not\(\[hidden\]\)\s*\{[^}]*flex:\s*1/s);
assert.match(css, /#contentEditor\s*\{[^}]*flex:\s*1/s);
assert.match(siteCss, /\.inline-editor-modebar\s*\{/);
assert.match(
  siteIntegration,
  /previewMode\.innerHTML\s*=\s*[\s\S]*?<span>预览<\/span>/
);
assert.match(
  siteIntegration,
  /textarea\.dataset\.markdownSource\s*=\s*""/
);
assert.doesNotMatch(siteIntegration, /initialEditType:\s*"wysiwyg"/);
assert.doesNotMatch(javascript, /initialEditType:\s*"wysiwyg"/);
assert.match(
  javascript,
  /byId\("editChangeButton"\)\.dataset\.changeMode = "source"/
);
assert.match(
  javascript,
  /byId\("editChangeButton"\)\.dataset\.changeMode = "diff"/
);
assert.match(
  javascript,
  /function renderDiffSnapshotSummary\(draft, contextAvailable = true\)/
);
assert.match(
  javascript,
  /renderSourceDiff\(await baseContentForDraft\(draft\), draft\)/
);
assert.match(
  javascript,
  /提交内容：完整文件 · \$\{fileLines\} 行 · \$\{changedLines\} 行变化/
);

const submitBlock = javascript.slice(
  javascript.indexOf('byId("submitForm").addEventListener'),
  javascript.indexOf(
    'byId("adminApplicationForm").addEventListener'
  )
);
assert.match(submitBlock, /content:\s*draft\.operation === "delete" \? "" : draft\.content/);
assert.doesNotMatch(submitBlock, /content:\s*draft\.line_diff/);
const requestPayloadBlock = submitBlock.slice(
  submitBlock.indexOf("const submitChanges"),
  submitBlock.indexOf("let result;")
);
assert.doesNotMatch(requestPayloadBlock, /base_(sha|content)/);
for (const field of [
  "base_commit",
  "commit_message",
  "pr_title",
  "pr_body",
  "pr_base",
  "draft",
  "force_update",
  "changes"
]) {
  assert.match(submitBlock, new RegExp(`${field}:`));
}
assert.match(submitBlock, /branch,/);
assert.match(
  submitBlock,
  /state\.active\?\.operation !== "delete" &&\s*byId\("diffViewer"\)\.hidden/
);
assert.doesNotMatch(submitBlock, /repository_merge_conflict/);

const normalizeParentStart = siteIntegration.indexOf(
  "  function normalizeParent(root, value) {"
);
const normalizeParentEnd = siteIntegration.indexOf(
  "\n\n  function currentSourceParent",
  normalizeParentStart
);
assert(normalizeParentStart >= 0 && normalizeParentEnd > normalizeParentStart);
const normalizeParent = Function(
  siteIntegration.slice(normalizeParentStart, normalizeParentEnd) +
    "\nreturn normalizeParent;"
)();

assert.equal(
  normalizeParent("program/knowledge", "program/knowledge/ecs"),
  "ecs"
);
assert.equal(
  normalizeParent("program/knowledge", "program/knowledge"),
  ""
);
assert.equal(
  normalizeParent("program/knowledge", "ecs/rendering"),
  "ecs/rendering"
);
assert.equal(
  normalizeParent("program/knowledge", "program/knowledge-base/ecs"),
  "program/knowledge-base/ecs"
);
assert.equal(
  [
    "program/knowledge",
    normalizeParent("program/knowledge", "program/knowledge/ecs"),
    "rendering",
    "README.md"
  ].join("/"),
  "program/knowledge/ecs/rendering/README.md"
);

process.stdout.write("Editor workspace checks passed\n");
