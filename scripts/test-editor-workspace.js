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
const contentPages = fs.readFileSync(
  path.join(root, "src/content-pages.njk"),
  "utf8"
);
const livePreview = require(
  path.join(root, "src/assets/js/markdown-live-preview.js")
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
assert.match(html, /markdown-live-preview\.css/);
assert.match(html, /markdown-live-preview\.js/);
assert.match(html, /toastui-editor\.css/);
assert.match(html, /toastui-editor\.js/);
assert.match(css, /\.diff-snapshot-summary\s*\{/);
assert.match(css, /#activeEditor:not\(\[hidden\]\)\s*\{[^}]*flex:\s*1/s);
assert.match(css, /#contentEditor\s*\{[^}]*flex:\s*1/s);
assert.match(siteCss, /\.inline-editor-modebar\s*\{/);
assert.match(
  siteCss,
  /\.docs-nav-unit-title\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+22px/s
);
assert.match(
  siteCss,
  /\.docs-nav-unit li a\s*\{[^}]*grid-template-columns:\s*14px\s+minmax\(0,\s*1fr\)\s+22px/s
);
assert.match(contentPages, /data-workspace-key="unit:\{\{ unit\.id \}\}"/);
assert.match(
  contentPages,
  /data-workspace-key="file:\{\{ item\.sourceRelative \}\}"/
);
const baseLayout = fs.readFileSync(
  path.join(root, "src/_includes/layouts/base.njk"),
  "utf8"
);
assert.match(baseLayout, /data-update-announcement-dialog/);
assert.match(baseLayout, /data-update-announcement-content/);
assert.match(baseLayout, /data-manual-announcement-dialog/);
assert.match(siteCss, /\.update-announcement-dialog\s*\{/);
assert.match(siteCss, /\.update-announcement-group\[data-status="added"\]/);
assert.match(
  siteIntegration,
  /if \(dataset\.workspaceKey\) return "workspace:" \+ dataset\.workspaceKey/
);
assert.match(
  siteIntegration,
  /function restoreCachedWorkspaceNavigation\(\)[\s\S]*?readIdentityCache\(\{ allowExpired: true \}\)[\s\S]*?store\.deriveChanges\(base, current\)[\s\S]*?addDraftNavigation\(\)/
);
assert.match(
  siteIntegration,
  /bindEvents\(\);\s*restoreCachedWorkspaceNavigation\(\);\s*loadIdentity\(\{ cacheOnly: true \}\)/
);

const readIdentityCacheStart = siteIntegration.indexOf(
  "  function readIdentityCache(options) {"
);
const readIdentityCacheEnd = siteIntegration.indexOf(
  "\n\n  function writeIdentityCache",
  readIdentityCacheStart
);
assert(
  readIdentityCacheStart >= 0 &&
    readIdentityCacheEnd > readIdentityCacheStart
);
const cachedIdentity = {
  config: { repository: "owner/content" },
  session: { authenticated: true, can_edit: true, user: { id: 7 } }
};
const readIdentityCache = Function(
  "window",
  "IDENTITY_CACHE_KEY",
  "IDENTITY_CACHE_TTL",
  siteIntegration.slice(readIdentityCacheStart, readIdentityCacheEnd) +
    "\nreturn readIdentityCache;"
)(
  {
    localStorage: {
      getItem() {
        return JSON.stringify({
          cachedAt: Date.now() - 10 * 60 * 1000,
          payload: cachedIdentity
        });
      }
    }
  },
  "identity",
  5 * 60 * 1000
);
assert.equal(readIdentityCache(), null);
assert.deepEqual(
  readIdentityCache({ allowExpired: true }),
  cachedIdentity
);
assert.match(
  siteIntegration,
  /"\/repository\/update-announcement" \+ queryString/
);
assert.match(siteIntegration, /api\("\/announcements"\)/);
assert.match(
  siteIntegration,
  /openOnboardingIfNeeded\(\);\s*checkForUpdateAnnouncement\(\)/
);
assert.match(
  siteIntegration,
  /previewMode\.innerHTML\s*=\s*[\s\S]*?<span>预览<\/span>/
);
assert.match(
  siteIntegration,
  /textarea\.dataset\.markdownSource\s*=\s*""/
);
assert.match(siteIntegration, /initialEditType:\s*"wysiwyg"/);
assert.match(javascript, /initialEditType:\s*"wysiwyg"/);
assert.match(siteIntegration, /panel\.canonicalContent\s*=\s*modern/);
assert.match(javascript, /state\.active\.canonicalContent\s*=/);
assert.match(siteIntegration, /GCKMarkdownLivePreview\.create/);
assert.match(javascript, /GCKMarkdownLivePreview\.create/);
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

const source = [
  "---",
  "shortTitle: Test",
  "---",
  "# Title",
  "",
  "## Original",
  "",
  "After"
].join("\n");
const range = livePreview.sourceRange(source, 5, 6);
assert.equal(range.editable, "## Original");
assert.equal(
  livePreview.replaceSourceRange(range, "## Updated"),
  source.replace("## Original", "## Updated")
);

const crlfSource = "# Title\r\n\r\n- one\r\n- two\r\n\r\nAfter\r\n";
const crlfRange = livePreview.sourceRange(crlfSource, 2, 5);
assert.equal(crlfRange.editable, "- one\r\n- two");
assert.equal(
  livePreview.replaceSourceRange(crlfRange, "- first\n- second"),
  "# Title\r\n\r\n- first\r\n- second\r\n\r\nAfter\r\n"
);
assert.deepEqual(
  livePreview.wysiwygInputRule("###", " "),
  {
    command: "heading",
    markerLength: 3,
    payload: { level: 3 }
  }
);
assert.deepEqual(
  livePreview.wysiwygInputRule("1.", " "),
  { command: "orderedList", markerLength: 2 }
);
assert.deepEqual(
  livePreview.wysiwygInputRule("``", "`"),
  { command: "codeBlock", markerLength: 2 }
);
assert.equal(livePreview.wysiwygInputRule("text", " "), null);

process.stdout.write("Editor workspace checks passed\n");
