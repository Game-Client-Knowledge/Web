const assert = require("node:assert/strict");

global.JsDiff = require("diff");
const {
  normalizeEditorHeadingEscapes,
  normalizeEditorNumericEscapes,
  preserveSourceFormatting
} = require(
  "../src/assets/js/markdown-preserve.js"
);

const original = `# 引擎基础

## 1. 文档范围

- 内存分配器
- 作用域守卫

| 顺序 | 文件 |
|---|---|
| 1 | allocators |
`;

const canonical = `# 引擎基础

## 1\\. 文档范围

* 内存分配器
* 作用域守卫

| 顺序 | 文件 |
| --- | --- |
| 1 | allocators |
`;

assert.equal(
  preserveSourceFormatting(original, canonical, canonical),
  original,
  "an untouched visual document must retain its exact source"
);

assert.equal(
  preserveSourceFormatting(
    original,
    canonical,
    canonical.replace("# 引擎基础", "# 引擎基础与资源")
  ),
  original.replace("# 引擎基础", "# 引擎基础与资源"),
  "editing one heading must not normalize unrelated lines"
);

assert.equal(
  preserveSourceFormatting(
    original,
    canonical,
    canonical.replace("* 作用域守卫", "* 作用域守卫\n* GPU 状态")
  ),
  original.replace("- 作用域守卫", "- 作用域守卫\n* GPU 状态"),
  "inserted visual lines may use canonical syntax without rewriting old lines"
);

assert.equal(
  preserveSourceFormatting(
    original,
    canonical,
    canonical.replace("* 内存分配器\n", "")
  ),
  original.replace("- 内存分配器\n", ""),
  "deleting one visual line must preserve untouched formatting"
);

assert.equal(
  normalizeEditorHeadingEscapes(
    "## 1\\. 原理\n\n1\\. 正文保持原样\n\n```md\n## 2\\. code\n```\n"
  ),
  "## 1. 原理\n\n1\\. 正文保持原样\n\n```md\n## 2\\. code\n```\n",
  "numeric escapes must only be normalized at heading starts"
);

assert.equal(
  preserveSourceFormatting(
    "## 1.xxx\n\n正文\n",
    "## 1\\.xxx\n\n正文\n",
    "## 1\\.yyy\n\n正文\n"
  ),
  "## 1.yyy\n\n正文\n",
  "editing a numbered heading must not persist the editor escape"
);

assert.equal(
  normalizeEditorNumericEscapes(
    "1\\.compact\n\n1\\. ordered literal\n\n> ## 2\\.quoted\n\n```md\n1\\.code\n```\n"
  ),
  "1.compact\n\n1\\. ordered literal\n\n> ## 2.quoted\n\n```md\n1\\.code\n```\n",
  "compact numeric text and quoted headings must drop editor-only escapes"
);

assert.equal(
  preserveSourceFormatting(
    "状态：1.alpha\n",
    "状态：1.alpha\n",
    "1\\.beta\n"
  ),
  "1.beta\n",
  "new compact numeric lines must not persist editor-only escapes"
);

process.stdout.write("Markdown preservation checks passed\n");
