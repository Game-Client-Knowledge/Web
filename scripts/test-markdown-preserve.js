const assert = require("node:assert/strict");

global.JsDiff = require("diff");
const { preserveSourceFormatting } = require(
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

process.stdout.write("Markdown preservation checks passed\n");
