const assert = require("node:assert/strict");
const documentApi = require("../src/assets/js/editor-document.js");

const complete = `# 内存分配器与分配器上下文

## 1. 为什么引擎要自定义分配器

系统 malloc/free 通用。

| 缺陷 | 说明 |
|---|---|
| 性能 | 单次分配较慢 |

## 2. 各策略要点

正文。
`;

const parts = documentApi.splitMarkdownDocument(complete);
assert.equal(parts.title, "内存分配器与分配器上下文");
assert(parts.body.startsWith("## 1. 为什么引擎要自定义分配器"));
assert.equal(
  documentApi.assembleMarkdownDocument(
    parts,
    parts.title,
    parts.body
  ),
  complete
);

assert.equal(documentApi.topLevelHeadingCount(complete), 1);
assert.equal(
  documentApi.topLevelHeadingCount(
    "# 文档\n\n```md\n# 代码中的标题\n```\n"
  ),
  1
);
assert.equal(
  documentApi.validateCompleteSnapshot(
    "program/knowledge/engine/01-memory-allocators.md",
    "## 1. 为什么引擎要自定义分配器17717"
  ).valid,
  false
);
assert.equal(
  documentApi.validateCompleteSnapshot(
    "program/code/demo/main.cpp",
    "int main() {}"
  ).valid,
  true
);

const repaired = documentApi.repairLegacyPartialSnapshot(
  "program/knowledge/engine/01-memory-allocators.md",
  complete,
  "## 1. 为什么引擎要自定义分配器",
  "## 1. 为什么引擎要自定义分配器17717"
);
assert.equal(repaired.repaired, true);
assert.equal(
  repaired.content,
  complete.replace(
    "## 1. 为什么引擎要自定义分配器",
    "## 1. 为什么引擎要自定义分配器17717"
  )
);
assert.equal(documentApi.topLevelHeadingCount(repaired.content), 1);
assert(repaired.content.includes("## 2. 各策略要点"));
assert(repaired.content.includes("| 性能 | 单次分配较慢 |"));

const ambiguous = documentApi.repairLegacyPartialSnapshot(
  "program/knowledge/repeated.md",
  "# 文档\n\n相同\n\n相同\n",
  "相同",
  "修改"
);
assert.equal(ambiguous.repaired, false);

const intentionalCompleteEdit =
  complete.replace("正文。", "完整修改后的正文。");
assert.deepEqual(
  documentApi.repairLegacyPartialSnapshot(
    "program/knowledge/engine/01-memory-allocators.md",
    complete,
    complete,
    intentionalCompleteEdit
  ),
  {
    content: intentionalCompleteEdit,
    repaired: false
  }
);

process.stdout.write("Complete editor document snapshot checks passed\n");
