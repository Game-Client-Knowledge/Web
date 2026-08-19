const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  getContentStatistics,
  lineStatsFromNumstat,
  trackForHistoryPath
} = require("../lib/content-statistics");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gck-statistics-"));
const cachePath = path.join(root, "cache", "statistics.json");
const previousGitDirectory = process.env.CONTENT_GIT_DIR;
const previousGitRevision = process.env.CONTENT_GIT_REVISION;
const previousCommit = process.env.CONTENT_COMMIT;

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
    "Alice",
    "123+alice@users.noreply.github.com",
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
  const alice = overall.contributors.find((item) => item.name === "Alice");
  assert(alice, "normal and GitHub noreply identities must be merged");
  assert(alice.added > 0);
  assert.equal(alice.activity7Count, 2);
  assert.equal(alice.activity30Count, 2);
  assert(alice.modification7Count > 0);
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
        item.contributorName === "Alice" &&
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
