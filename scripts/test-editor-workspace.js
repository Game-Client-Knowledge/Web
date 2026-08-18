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
const javascript = fs.readFileSync(
  path.join(root, "editor/app/static/editor.js"),
  "utf8"
);

assert.match(html, /id="diffModeLabel"[^>]*>完整文件差异</);
assert.match(html, /id="diffSnapshotSummary"/);
assert.match(css, /\.diff-snapshot-summary\s*\{/);
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

process.stdout.write("Editor workspace snapshot checks passed\n");
