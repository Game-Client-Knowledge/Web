const assert = require("node:assert/strict");
const {
  validateMarkdownStructure
} = require("../lib/markdown-structure");

assert.deepEqual(
  validateMarkdownStructure(
    [
      "# Title",
      "",
      "### Notes",
      "",
      "##### Client",
      "",
      "###### Server"
    ].join("\n")
  ),
  [],
  "skipped heading levels must not block content builds"
);

assert.deepEqual(
  validateMarkdownStructure("# Title\n\n```text\n# code"),
  ["代码围栏未闭合"],
  "unclosed code fences must remain invalid"
);

assert.deepEqual(
  validateMarkdownStructure("## Missing title"),
  ["需要且只能有一个一级标题，当前为 0 个"],
  "documents must still contain one H1"
);

assert.deepEqual(
  validateMarkdownStructure("# First\n\n# Second"),
  ["需要且只能有一个一级标题，当前为 2 个"],
  "documents must not contain multiple H1 headings"
);

process.stdout.write("Markdown structure checks passed\n");
