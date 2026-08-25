const assert = require("node:assert/strict");
const {
  buildModuleTree,
  mergeEntries,
  parseMarkdownMetadata
} = require("../src/assets/js/workspace-tree.js");

const base = [
  {
    path: "interviews/README.md",
    title: "真实面经",
    description: "面经",
    kind: "markdown",
    route: "/interviews/",
    isReadme: true,
    baseSha: "root-sha"
  },
  {
    path: "interviews/mihoyo/README.md",
    title: "米哈游",
    description: "米哈游面经",
    kind: "markdown",
    route: "/interviews/mihoyo/",
    isReadme: true,
    baseSha: "mihoyo-readme-sha"
  },
  {
    path: "interviews/mihoyo/01-round.md",
    title: "一面",
    kind: "markdown",
    route: "/interviews/mihoyo/01-round/",
    baseSha: "mihoyo-round-sha"
  }
];
const serverDrafts = [
  {
    path: "interviews/mihoyo/01-round.md",
    content: "# 一面更新\n\n新增的问题说明。\n",
    operation: "upsert",
    base_sha: "base-file",
    revision: 2
  }
];
const localChanges = [
  {
    path: "interviews/tencent/2026-autumn/README.md",
    content: "# 腾讯 2026 秋招游戏客户端\n\n腾讯秋招面经。\n",
    operation: "upsert",
    baseSha: null,
    serverRevision: 0
  },
  {
    path: "interviews/tencent/2026-autumn/01-round.md",
    content: "# 腾讯一面\n\n第一轮面试内容。\n",
    operation: "upsert",
    baseSha: null,
    lineDiff: [
      {
        type: "added",
        marker: "+",
        oldNumber: null,
        newNumber: 1,
        text: "# 腾讯一面"
      }
    ],
    diffSummary: { added: 1, modified: 0, deleted: 0 },
    serverRevision: 0
  }
];

const entries = mergeEntries(base, serverDrafts, localChanges);
const tree = buildModuleTree("interviews", entries);
const mihoyo = tree.rootUnits.find((unit) => unit.id === "interviews/mihoyo");
const tencent = tree.rootUnits.find(
  (unit) => unit.id === "interviews/tencent/2026-autumn"
);

assert(mihoyo);
assert.equal(mihoyo.status, "M");
assert.equal(mihoyo.documents[1].title, "一面更新");
assert(tencent, "a local README must become a normal topic unit");
assert.equal(tencent.status, "A");
assert.deepEqual(
  tree.rootUnits.map((unit) => unit.id),
  ["interviews/mihoyo", "interviews/tencent/2026-autumn"],
  "draft status must not reorder the reader navigation"
);
assert.equal(tencent.documents.length, 2);
assert.deepEqual(
  tencent.documents.map((item) => item.status),
  ["A", "A"]
);
assert.equal(tree.changedCount, 3);
assert.equal(mihoyo.readme.baseSha, "mihoyo-readme-sha");
const tencentRound = tencent.documents.find((item) => {
  return item.path.endsWith("/01-round.md");
});
assert.equal(tencentRound.lineDiff[0].type, "added");
assert.equal(tencentRound.diffSummary.added, 1);

const deletedEntries = mergeEntries(base, [], [
  {
    path: "interviews/mihoyo/README.md",
    content: "",
    operation: "delete",
    baseSha: "mihoyo-readme-sha"
  },
  {
    path: "interviews/mihoyo/01-round.md",
    content: "",
    operation: "delete",
    baseSha: "mihoyo-round-sha"
  }
]);
const deletedTree = buildModuleTree("interviews", deletedEntries);
const deletedUnit = deletedTree.rootUnits.find(
  (unit) => unit.id === "interviews/mihoyo"
);
assert.equal(deletedUnit.status, "D");
assert.equal(deletedUnit.changeCount, 2);
assert(
  deletedUnit.documents.every((entry) => entry.operation === "delete")
);
assert.deepEqual(
  parseMarkdownMetadata(
    "---\norder: 1\n---\n# 标题\n\n正文简介。\n",
    "",
    ""
  ),
  {
    title: "标题",
    description: "正文简介。"
  }
);

process.stdout.write("Client workspace tree checks passed\n");
