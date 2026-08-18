const assert = require("node:assert/strict");
const store = require("../src/assets/js/workspace-store.js");

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

const storage = memoryStorage();
const userId = 7;
const repository = "owner/content";
const baseEntries = [
  {
    path: "program/knowledge/README.md",
    sha: "root-sha",
    kind: "markdown",
    title: "Knowledge",
    isReadme: true
  },
  {
    path: "program/knowledge/cpp/README.md",
    sha: "cpp-sha",
    kind: "markdown",
    title: "C++",
    route: "/program/knowledge/cpp/",
    trackKey: "program",
    moduleKey: "program/knowledge",
    isReadme: true
  }
];

let workspace = store.ensure(
  storage,
  userId,
  repository,
  "commit-1",
  baseEntries
);
assert.equal(workspace.base.revision, "commit-1");
assert.equal(workspace.current.entries.length, 2);
assert.deepEqual(workspace.changes, []);
assert.equal(
  workspace.current.entries.find((entry) => entry.path.endsWith("cpp/README.md"))
    .moduleKey,
  "program/knowledge"
);

workspace = store.hydrateBaseFile(
  storage,
  userId,
  repository,
  "program/knowledge/cpp/README.md",
  "cpp-sha",
  "# C++\n"
);
assert.equal(
  workspace.base.entries.find((entry) => entry.path.endsWith("cpp/README.md"))
    .content,
  "# C++\n"
);

workspace = store.applyChange(
  storage,
  userId,
  repository,
  {
    path: "program/knowledge/cpp/README.md",
    content: "# C++ updated\n",
    operation: "upsert",
    lineDiff: [{ type: "modified", text: "# C++ updated" }],
    diffSummary: { added: 0, modified: 1, deleted: 0 }
  }
);
assert.equal(workspace.changes.length, 1);
assert.equal(workspace.changes[0].status, "M");
assert.equal(workspace.changes[0].baseContent, "# C++\n");
assert.equal(workspace.current.entries.length, 2);

workspace = store.applyChange(
  storage,
  userId,
  repository,
  {
    path: "program/knowledge/new/README.md",
    content: "# New\n",
    operation: "upsert"
  }
);
assert.equal(workspace.changes.length, 2);
assert(
  workspace.changes.some((change) => {
    return change.path.endsWith("new/README.md") && change.status === "A";
  })
);

workspace = store.discardChange(
  storage,
  userId,
  repository,
  "program/knowledge/cpp/README.md"
);
assert.equal(workspace.changes.length, 1);

workspace = store.release(storage, userId, repository);
assert.deepEqual(workspace.changes, []);
assert.deepEqual(
  workspace.current.entries.map((entry) => entry.path),
  workspace.base.entries.map((entry) => entry.path)
);

workspace = store.hydrateBaseFile(
  storage,
  userId,
  repository,
  "program/knowledge/cpp/README.md",
  "cpp-sha",
  "# C++\n"
);
workspace = store.applyChange(
  storage,
  userId,
  repository,
  {
    path: "program/knowledge/cpp/README.md",
    content: "# C++ local\n",
    operation: "upsert"
  }
);
workspace = store.syncBase(
  storage,
  userId,
  repository,
  "commit-2",
  [
    {
      path: baseEntries[0].path,
      sha: baseEntries[0].sha,
      size: 120
    },
    {
      path: baseEntries[1].path,
      sha: "cpp-sha-2"
    }
  ]
);
assert.equal(workspace.base.revision, "commit-2");
assert.equal(workspace.changes.length, 1);
assert.equal(workspace.changes[0].content, "# C++ local\n");
assert.equal(
  workspace.base.entries.find((entry) => entry.path.endsWith("cpp/README.md"))
    .title,
  "C++",
  "a path/SHA-only remote tree must preserve catalog titles"
);
assert.equal(
  workspace.base.entries.find((entry) => entry.path.endsWith("cpp/README.md"))
    .route,
  "/program/knowledge/cpp/"
);
assert.equal(
  workspace.changes[0].baseSha,
  "cpp-sha",
  "remote sync must preserve the old merge base until rebase completes"
);

workspace = store.applyChange(
  storage,
  userId,
  repository,
  {
    ...workspace.changes[0],
    baseSha: "cpp-sha-2",
    baseContent: "# C++ remote\n",
    content: "# C++ merged\n",
    operation: "upsert"
  }
);
assert.equal(workspace.changes[0].baseSha, "cpp-sha-2");
assert.equal(workspace.changes[0].baseContent, "# C++ remote\n");

workspace = store.syncBase(
  storage,
  userId,
  repository,
  "commit-3",
  [baseEntries[0]]
);
assert.equal(workspace.changes[0].status, "M");
assert.equal(
  workspace.changes[0].baseSha,
  "cpp-sha-2",
  "a remote deletion must not turn a local edit into an added file"
);

const pollutedStorage = memoryStorage();
workspace = store.syncBase(
  pollutedStorage,
  userId,
  repository,
  "commit-1",
  baseEntries.map((entry) => ({
    path: entry.path,
    sha: entry.sha,
    size: 120
  }))
);
assert.equal(
  workspace.base.entries.find((entry) => entry.path.endsWith("cpp/README.md"))
    .title,
  "README.md"
);
workspace = store.ensure(
  pollutedStorage,
  userId,
  repository,
  "commit-1",
  baseEntries
);
assert.equal(
  workspace.base.entries.find((entry) => entry.path.endsWith("cpp/README.md"))
    .title,
  "C++",
  "the deployed catalog must repair an old path-only Base Tree"
);
assert.equal(
  workspace.current.entries.find((entry) => entry.path.endsWith("cpp/README.md"))
    .title,
  "C++",
  "the repaired metadata must flow into an unchanged Current Tree"
);

process.stdout.write("Local base/current workspace checks passed\n");
