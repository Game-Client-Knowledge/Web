const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gck-content-loader-"));
const previousRoot = process.env.CONTENT_REPO_PATH;
const previousCommit = process.env.CONTENT_COMMIT;
const previousUpdated = process.env.CONTENT_UPDATED_AT;
const previousGitDirectory = process.env.CONTENT_GIT_DIR;
const previousGitRevision = process.env.CONTENT_GIT_REVISION;

function write(relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

try {
  for (const [key, title] of [
    ["program", "程序赛道"],
    ["planning", "策划赛道"]
  ]) {
    write(`${key}/README.md`, `# ${title}\n\n${title}说明。\n`);
  }
  for (const [key, title] of [
    ["program/knowledge", "八股与专题"],
    ["program/interviews", "真实面经"],
    ["program/examples", "代码示例"],
    ["program/code", "代码阅读"],
    ["planning/knowledge", "策划八股"],
    ["planning/interviews", "策划面经"]
  ]) {
    write(`${key}/README.md`, `# ${title}\n\n${title}说明。\n`);
  }
  write(
    "program/graphics/README.md",
    `---
shortTitle: 图形
icon: shapes
accent: gold
allowCode: true
order: 40
---
# 图形与渲染

实时渲染知识与示例。
`
  );
  write(
    "program/graphics/rendering/README.md",
    "# 渲染基础\n\n渲染管线与图形 API。\n"
  );
  write("program/graphics/rendering/demo.cpp", "int main() { return 0; }\n");
  write(
    "program/graphics/rendering/materials/README.md",
    "# 材质系统\n\n材质、着色器与参数绑定。\n"
  );
  write(
    "program/graphics/rendering/materials/01-overview.md",
    "# 材质概览\n\n材质系统概览。\n"
  );
  write(
    "program/knowledge/interview-roadmap/multiplayer-game/" +
      "game-synchronization/README.md",
    "# 游戏同步\n\n状态与输入同步。\n"
  );
  write(
    "program/knowledge/interview-roadmap/multiplayer-game/" +
      "game-synchronization/01-state.md",
    "# 状态同步\n\n权威状态同步。\n"
  );

  process.env.CONTENT_REPO_PATH = root;
  process.env.CONTENT_COMMIT = "0123456789abcdef";
  process.env.CONTENT_UPDATED_AT = "2026-08-17T00:00:00Z";
  delete process.env.CONTENT_GIT_DIR;
  delete process.env.CONTENT_GIT_REVISION;
  const { loadCatalog } = require("../lib/content-loader");
  const catalog = loadCatalog();
  const graphics = catalog.modules.find(
    (module) => module.key === "program/graphics"
  );

  assert.deepEqual(
    catalog.tracks.map((track) => track.key),
    ["program", "planning"]
  );
  assert(graphics, "a track module README must create a website module");
  assert.equal(graphics.title, "图形与渲染");
  assert.equal(graphics.shortTitle, "图形");
  assert.equal(graphics.icon, "shapes");
  assert.equal(graphics.accent, "gold");
  assert.equal(graphics.allowCode, true);
  assert(
    catalog.documents.some(
      (document) =>
        document.sourceRelative === "program/graphics/rendering/demo.cpp" &&
        document.moduleKey === "program/graphics" &&
        document.trackKey === "program" &&
        document.moduleSlug === "graphics"
    ),
    "allowCode modules must include source files"
  );
  assert.deepEqual(
    catalog.modules.slice(0, 5).map((module) => module.key),
    [
      "program/knowledge",
      "program/interviews",
      "program/examples",
      "program/code",
      "program/graphics"
    ]
  );
  assert.equal(graphics.rootUnits.length, 1);
  assert.equal(graphics.rootUnits[0].id, "program/graphics/rendering");
  assert.equal(graphics.rootUnits[0].children.length, 1);
  assert.equal(
    graphics.rootUnits[0].children[0].id,
    "program/graphics/rendering/materials"
  );
  assert.equal(
    graphics.rootUnits[0].children[0].parentId,
    "program/graphics/rendering"
  );
  assert.deepEqual(
    graphics.rootUnits[0].children[0].ancestorIds,
    ["program/graphics/rendering"]
  );
  assert(
    catalog.workspaceEntries.some(
      (entry) =>
        entry.path === "program/graphics/rendering/materials/README.md" &&
        entry.moduleKey === "program/graphics" &&
        entry.isReadme &&
        entry.title === "材质系统"
    ),
    "the client workspace tree must receive generated content metadata"
  );
  assert(
    catalog.legacyRedirects.some(
      (redirect) =>
        redirect.from === "/graphics/rendering/" &&
        redirect.to === "/program/graphics/rendering/"
    ),
    "program track routes must publish legacy redirects"
  );
  assert(
    catalog.legacyRedirects.some(
      (redirect) =>
        redirect.from ===
          "/program/knowledge/interview-roadmap/game-synchronization/" &&
        redirect.to ===
          "/program/knowledge/interview-roadmap/multiplayer-game/" +
            "game-synchronization/"
    ),
    "moved multiplayer topics must preserve their previous program routes"
  );
  assert(
    catalog.legacyRedirects.some(
      (redirect) =>
        redirect.from ===
          "/knowledge/interview-roadmap/game-synchronization/01-state/" &&
        redirect.to ===
          "/program/knowledge/interview-roadmap/multiplayer-game/" +
            "game-synchronization/01-state/"
    ),
    "moved multiplayer documents must preserve pre-track legacy routes"
  );
  assert.deepEqual(
    catalog.contributors,
    ["sourcecode", "Game Client Knowledge"],
    "snapshot-only builds must expose safe contributor labels"
  );
  process.stdout.write("Dynamic content module checks passed\n");
} finally {
  if (previousRoot === undefined) delete process.env.CONTENT_REPO_PATH;
  else process.env.CONTENT_REPO_PATH = previousRoot;
  if (previousCommit === undefined) delete process.env.CONTENT_COMMIT;
  else process.env.CONTENT_COMMIT = previousCommit;
  if (previousUpdated === undefined) delete process.env.CONTENT_UPDATED_AT;
  else process.env.CONTENT_UPDATED_AT = previousUpdated;
  if (previousGitDirectory === undefined) delete process.env.CONTENT_GIT_DIR;
  else process.env.CONTENT_GIT_DIR = previousGitDirectory;
  if (previousGitRevision === undefined) delete process.env.CONTENT_GIT_REVISION;
  else process.env.CONTENT_GIT_REVISION = previousGitRevision;
  fs.rmSync(root, { recursive: true, force: true });
}
