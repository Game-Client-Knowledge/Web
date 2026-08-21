const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  buildContributorIdentities,
  getContentStatistics,
  lineStatsFromNumstat,
  trackForHistoryPath
} = require("../lib/content-statistics");
const {
  mergeContributors,
  paginateContributors,
  recentContributors,
  sortContributors
} = require("../src/assets/js/home-statistics");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gck-statistics-"));
const cachePath = path.join(root, "cache", "statistics.json");
const previousGitDirectory = process.env.CONTENT_GIT_DIR;
const previousGitRevision = process.env.CONTENT_GIT_REVISION;
const previousCommit = process.env.CONTENT_COMMIT;

const aliasIdentities = buildContributorIdentities([
  {
    authorName: "Original Name",
    authorEmail: "shared@example.com",
    timestamp: "2026-08-10T00:00:00Z"
  },
  {
    authorName: "Renamed Author",
    authorEmail: "shared@example.com",
    timestamp: "2026-08-11T00:00:00Z"
  },
  {
    authorName: "Renamed Author",
    authorEmail: "other@example.com",
    timestamp: "2026-08-12T00:00:00Z"
  }
]);
assert.equal(aliasIdentities[0].contributorId, aliasIdentities[1].contributorId);
assert.equal(aliasIdentities[1].contributorName, "Renamed Author");
assert.notEqual(
  aliasIdentities[1].contributorId,
  aliasIdentities[2].contributorId,
  "equal display names with different emails must stay independent"
);

const identityGraph = {
  version: 2,
  revision: "test-revision",
  identity_aliases: {
    "user:1": ["identity:a", "identity:b"],
    "user:2": ["identity:c"]
  },
  links: [
    {
      contributor_id: "user:1",
      contributor_name: "Canonical User",
      last_contributed_at: "2026-08-20T00:00:00Z"
    },
    {
      contributor_id: "user:2",
      contributor_name: "Other User",
      last_contributed_at: "2026-08-20T00:00:00Z"
    }
  ]
};
const mergedAccounts = mergeContributors(
  [
    {
      id: "identity:a",
      name: "Old Git Name",
      added: 12,
      modified: 3,
      deleted: 1,
      commitCount: 2,
      lastContributedAt: "2026-08-18T00:00:00Z"
    },
    {
      id: "identity:b",
      name: "New Git Name",
      added: 7,
      modified: 2,
      deleted: 0,
      commitCount: 1,
      lastContributedAt: "2026-08-19T00:00:00Z"
    },
    {
      id: "identity:c",
      name: "Old Git Name",
      added: 4,
      modified: 0,
      deleted: 0,
      commitCount: 1,
      lastContributedAt: "2026-08-17T00:00:00Z"
    }
  ],
  identityGraph
);
assert.deepEqual(
  mergedAccounts.map((item) => item.id).sort(),
  ["user:1", "user:2"],
  "verified aliases must collapse to their website accounts"
);
const canonicalUser = mergedAccounts.find((item) => item.id === "user:1");
assert.equal(canonicalUser.name, "Canonical User");
assert.equal(canonicalUser.added, 19);
assert.equal(canonicalUser.modified, 5);
assert.equal(canonicalUser.deleted, 1);
assert.equal(canonicalUser.commitCount, 3);
assert.equal(
  mergeContributors(
    [
      { id: "separate:a", name: "Same Name", added: 1 },
      { id: "separate:b", name: "Same Name", added: 2 }
    ],
    null
  ).length,
  2,
  "equal names without a stable alias must remain separate"
);
assert.equal(
  sortContributors(mergedAccounts, "total", "desc")[0].id,
  "user:1"
);
assert.equal(
  sortContributors(mergedAccounts, "name", "asc")[0].name,
  "Canonical User"
);
assert.deepEqual(
  paginateContributors(
    [
      { id: "1" },
      { id: "2" },
      { id: "3" },
      { id: "4" },
      { id: "5" }
    ],
    2,
    4,
    2
  ),
  {
    items: [{ id: "3" }, { id: "4" }],
    page: 2,
    pageCount: 2,
    start: 2,
    total: 5,
    limitedTotal: 4
  }
);
const recentMerged = recentContributors(
  {
    recentEvents: [
      {
        timestamp: "2026-08-20T00:00:00Z",
        trackKey: "program",
        contributorId: "identity:a",
        contributorName: "Old Git Name",
        added: 2,
        modified: 0,
        deleted: 0
      },
      {
        timestamp: "2026-08-20T01:00:00Z",
        trackKey: "program",
        contributorId: "identity:b",
        contributorName: "New Git Name",
        added: 3,
        modified: 1,
        deleted: 0
      }
    ]
  },
  "program",
  identityGraph,
  new Date("2026-08-21T00:00:00Z").getTime()
);
assert.equal(recentMerged.length, 1);
assert.equal(recentMerged[0].name, "Canonical User");
assert.equal(recentMerged[0].added, 5);

function git(args, environment = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment }
  }).trim();
}

function write(relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function commit(message, name, email, date) {
  git(["add", "."]);
  git(
    ["commit", "-m", message],
    {
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
      GIT_COMMITTER_DATE: date
    }
  );
}

try {
  delete process.env.CONTENT_GIT_DIR;
  delete process.env.CONTENT_GIT_REVISION;
  delete process.env.CONTENT_COMMIT;
  git(["init", "-b", "main"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@example.com"]);

  write("program/README.md", "# Program\n");
  write(
    "program/knowledge/topic.md",
    "# Topic\n\nalpha\nbeta\n"
  );
  commit(
    "docs: add program topic",
    "Alice",
    "alice@example.com",
    "2026-08-12T10:00:00+08:00"
  );

  write(
    "program/knowledge/topic.md",
    "# Topic\n\nalpha changed\nbeta\n"
  );
  commit(
    "docs: update program topic",
    "Bob",
    "bob@example.com",
    "2026-08-13T10:00:00+08:00"
  );

  write("planning/README.md", "# Planning\n");
  write("planning/cases/case.md", "# Case\n\nplan\n");
  commit(
    "docs: add planning case",
    "Alice Renamed",
    "alice@example.com",
    "2026-08-14T10:00:00+08:00"
  );

  let statistics = getContentStatistics(root, {
    cachePath,
    fallbackUpdatedAt: "2026-08-14T10:00:00+08:00",
    referenceDate: "2026-08-19T10:00:00+08:00"
  });
  assert.equal(statistics.cacheMode, "rebuild");
  assert.equal(statistics.scopes.length, 3);
  const overall = statistics.scopes.find((scope) => scope.key === "all");
  const program = statistics.scopes.find((scope) => scope.key === "program");
  const planning = statistics.scopes.find((scope) => scope.key === "planning");
  assert.equal(overall.contributorCount, 2);
  assert.equal(program.contributorCount, 2);
  assert.equal(planning.contributorCount, 1);
  assert(
    overall.characterCount > planning.characterCount,
    "current character totals must be split by track"
  );
  assert(
    overall.lineCount === program.lineCount + planning.lineCount,
    "overall line count must equal both tracks"
  );
  const alice = overall.contributors.find(
    (item) => item.name === "Alice Renamed"
  );
  assert(alice, "the latest name for one email must be used");
  assert(alice.added > 0);
  assert.equal(alice.activity7Count, 2);
  assert.equal(alice.activity30Count, 2);
  assert(alice.modification7Count > 0);
  const renamedIdentities = getContentStatistics(root, {
    cachePath,
    referenceDate: "2026-08-19T10:00:00+08:00"
  }).scopes.find((scope) => scope.key === "all").contributors;
  assert.equal(
    renamedIdentities.filter((item) => {
      return item.name === "Alice" || item.name === "Alice Renamed";
    }).length,
    1,
    "different names with one email must remain one contributor"
  );
  const bob = program.contributors.find((item) => item.name === "Bob");
  assert.equal(bob.modified, 1);
  assert.equal(bob.activity7Count, 1);
  const topicMetrics = statistics.documentMetrics.find(
    (item) => item.path === "program/knowledge/topic.md"
  );
  assert.equal(topicMetrics.activity7Count, 2);
  assert.equal(topicMetrics.activity30Count, 2);
  assert(topicMetrics.modification7Count > 0);
  assert.equal(
    topicMetrics._commitWindows.seven.size,
    2,
    "internal commit windows must preserve exact code-system deduplication"
  );
  assert(
    statistics.documentContributions.some(
      (item) =>
        item.path === "program/knowledge/topic.md" &&
        item.contributorName === "Alice Renamed" &&
        item.commitCount === 1
    ),
    "document contribution links must share normalized identities"
  );

  statistics = getContentStatistics(root, { cachePath });
  assert.equal(statistics.cacheMode, "hit");

  write(
    "planning/cases/case.md",
    "# Case\n\nplan revised\n"
  );
  commit(
    "docs: revise planning case",
    "Bob",
    "bob@example.com",
    "2026-08-15T10:00:00+08:00"
  );
  statistics = getContentStatistics(root, { cachePath });
  assert.equal(statistics.cacheMode, "incremental");
  assert.equal(
    statistics.scopes.find((scope) => scope.key === "planning")
      .contributorCount,
    2
  );
  assert(
    statistics.recentEvents.some(
      (event) =>
        event.trackKey === "planning" &&
        event.contributorName === "Bob" &&
        event.modified === 1
    )
  );

  const bareRepository = path.join(root, "content.git");
  git(["clone", "--bare", root, bareRepository]);
  process.env.CONTENT_GIT_DIR = bareRepository;
  process.env.CONTENT_GIT_REVISION = git(["rev-parse", "HEAD"]);
  const bareStatistics = getContentStatistics(root, {
    cachePath: path.join(root, "cache", "bare-statistics.json")
  });
  assert.equal(bareStatistics.revision, process.env.CONTENT_GIT_REVISION);
  assert.equal(
    bareStatistics.scopes.find((scope) => scope.key === "all")
      .contributorCount,
    2,
    "production bare Git mirrors must produce the same identities"
  );

  assert.deepEqual(
    lineStatsFromNumstat("8", "3"),
    { added: 5, modified: 3, deleted: 0 }
  );
  assert.equal(
    trackForHistoryPath("knowledge/cpp/README.md"),
    "program"
  );
  assert.equal(
    trackForHistoryPath("planning/cases/README.md"),
    "planning"
  );

  process.stdout.write("Content contribution statistics checks passed\n");
} finally {
  if (previousGitDirectory === undefined) {
    delete process.env.CONTENT_GIT_DIR;
  } else {
    process.env.CONTENT_GIT_DIR = previousGitDirectory;
  }
  if (previousGitRevision === undefined) {
    delete process.env.CONTENT_GIT_REVISION;
  } else {
    process.env.CONTENT_GIT_REVISION = previousGitRevision;
  }
  if (previousCommit === undefined) delete process.env.CONTENT_COMMIT;
  else process.env.CONTENT_COMMIT = previousCommit;
  fs.rmSync(root, { recursive: true, force: true });
}
