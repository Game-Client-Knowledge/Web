const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gck-content-loader-"));
const previousRoot = process.env.CONTENT_REPO_PATH;
const previousCommit = process.env.CONTENT_COMMIT;
const previousUpdated = process.env.CONTENT_UPDATED_AT;

function write(relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

try {
  for (const [key, title] of [
    ["knowledge", "八股与专题"],
    ["interviews", "真实面经"],
    ["examples", "代码示例"]
  ]) {
    write(`${key}/README.md`, `# ${title}\n\n${title}说明。\n`);
  }
  write(
    "graphics/README.md",
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
    "graphics/rendering/README.md",
    "# 渲染基础\n\n渲染管线与图形 API。\n"
  );
  write("graphics/rendering/demo.cpp", "int main() { return 0; }\n");
  write(
    "graphics/rendering/materials/README.md",
    "# 材质系统\n\n材质、着色器与参数绑定。\n"
  );
  write(
    "graphics/rendering/materials/01-overview.md",
    "# 材质概览\n\n材质系统概览。\n"
  );

  process.env.CONTENT_REPO_PATH = root;
  process.env.CONTENT_COMMIT = "0123456789abcdef";
  process.env.CONTENT_UPDATED_AT = "2026-08-17T00:00:00Z";
  const { loadCatalog } = require("../lib/content-loader");
  const catalog = loadCatalog();
  const graphics = catalog.modules.find(
    (module) => module.key === "graphics"
  );

  assert(graphics, "a top-level README must create a website module");
  assert.equal(graphics.title, "图形与渲染");
  assert.equal(graphics.shortTitle, "图形");
  assert.equal(graphics.icon, "shapes");
  assert.equal(graphics.accent, "gold");
  assert.equal(graphics.allowCode, true);
  assert(
    catalog.documents.some(
      (document) =>
        document.sourceRelative === "graphics/rendering/demo.cpp"
    ),
    "allowCode modules must include source files"
  );
  assert.deepEqual(
    catalog.modules.slice(0, 4).map((module) => module.key),
    ["knowledge", "interviews", "examples", "graphics"]
  );
  assert.equal(graphics.rootUnits.length, 1);
  assert.equal(graphics.rootUnits[0].id, "graphics/rendering");
  assert.equal(graphics.rootUnits[0].children.length, 1);
  assert.equal(
    graphics.rootUnits[0].children[0].id,
    "graphics/rendering/materials"
  );
  assert.equal(
    graphics.rootUnits[0].children[0].parentId,
    "graphics/rendering"
  );
  assert.deepEqual(
    graphics.rootUnits[0].children[0].ancestorIds,
    ["graphics/rendering"]
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
  fs.rmSync(root, { recursive: true, force: true });
}
