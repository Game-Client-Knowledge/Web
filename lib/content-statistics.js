const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const CACHE_VERSION = 2;
const TRACKS = {
  program: {
    title: "程序赛道",
    currentRoots: ["program"],
    historicalRoots: [
      "program",
      "knowledge",
      "interviews",
      "examples",
      "code",
      "docs/game-client-interview"
    ]
  },
  planning: {
    title: "策划赛道",
    currentRoots: ["planning"],
    historicalRoots: ["planning"]
  }
};
const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".kt",
  ".lua",
  ".m",
  ".md",
  ".mm",
  ".py",
  ".rs",
  ".sh",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".xml",
  ".yaml",
  ".yml"
]);
const GENERATED_DIRECTORIES = new Set([
  ".git",
  "bin",
  "node_modules",
  "obj"
]);
const HISTORY_PATHS = Array.from(
  new Set(
    Object.values(TRACKS).flatMap((track) => track.historicalRoots)
  )
);

function emptyLineStats() {
  return { added: 0, modified: 0, deleted: 0 };
}

function addLineStats(target, source) {
  target.added += Number(source.added) || 0;
  target.modified += Number(source.modified) || 0;
  target.deleted += Number(source.deleted) || 0;
  return target;
}

function normalizedIdentityPart(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ");
}

function githubLoginFromEmail(email) {
  const match = String(email || "").match(
    /^\d+\+([^@]+)@users\.noreply\.github\.com$/i
  );
  return match ? normalizedIdentityPart(match[1]) : "";
}

function identityTokens(name, email) {
  const normalizedName = normalizedIdentityPart(name);
  const normalizedEmail = normalizedIdentityPart(email);
  const githubLogin = githubLoginFromEmail(normalizedEmail);
  return [
    normalizedName && `name:${normalizedName}`,
    normalizedEmail && `email:${normalizedEmail}`,
    githubLogin && `github:${githubLogin}`
  ].filter(Boolean);
}

function displayNameForIdentity(names, emails) {
  const usableNames = names.filter((name) => {
    const normalized = normalizedIdentityPart(name);
    return (
      normalized &&
      normalized !== "unknown" &&
      normalized !== "github contributor"
    );
  });
  if (usableNames.length) return usableNames[0];
  const githubEmail = emails
    .map(githubLoginFromEmail)
    .find(Boolean);
  if (githubEmail) return githubEmail;
  const localPart = String(emails[0] || "").split("@")[0].trim();
  return localPart || "未命名贡献者";
}

function stableContributorId(tokens) {
  return crypto
    .createHash("sha256")
    .update(tokens.slice().sort().join("\n"))
    .digest("hex")
    .slice(0, 12);
}

function createDisjointSet() {
  const parent = new Map();

  function find(value) {
    if (!parent.has(value)) parent.set(value, value);
    const current = parent.get(value);
    if (current !== value) parent.set(value, find(current));
    return parent.get(value);
  }

  function union(left, right) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  }

  return { find, union };
}

function buildContributorIdentities(events) {
  const disjoint = createDisjointSet();
  for (const event of events) {
    const tokens = identityTokens(event.authorName, event.authorEmail);
    tokens.slice(1).forEach((token) => disjoint.union(tokens[0], token));
  }

  const groups = new Map();
  for (const event of events) {
    const tokens = identityTokens(event.authorName, event.authorEmail);
    if (!tokens.length) continue;
    const root = disjoint.find(tokens[0]);
    if (!groups.has(root)) {
      groups.set(root, {
        tokens: new Set(),
        names: [],
        emails: [],
        latestTimestamp: ""
      });
    }
    const group = groups.get(root);
    tokens.forEach((token) => group.tokens.add(token));
    if (event.authorName && !group.names.includes(event.authorName)) {
      group.names.push(event.authorName);
    }
    if (event.authorEmail && !group.emails.includes(event.authorEmail)) {
      group.emails.push(event.authorEmail);
    }
    if (event.timestamp >= group.latestTimestamp) {
      group.latestTimestamp = event.timestamp;
      if (event.authorName) {
        group.names = [
          event.authorName,
          ...group.names.filter((name) => name !== event.authorName)
        ];
      }
    }
  }

  const identities = new Map();
  for (const [root, group] of groups) {
    const tokens = Array.from(group.tokens);
    identities.set(root, {
      id: stableContributorId(tokens),
      name: displayNameForIdentity(group.names, group.emails)
    });
  }

  return events.map((event) => {
    const tokens = identityTokens(event.authorName, event.authorEmail);
    const identity = tokens.length
      ? identities.get(disjoint.find(tokens[0]))
      : { id: "unknown", name: "未命名贡献者" };
    return {
      ...event,
      contributorId: identity.id,
      contributorName: identity.name
    };
  });
}

function trackForHistoryPath(rawPath) {
  const value = String(rawPath || "").replace(/\\/g, "/");
  if (
    /(^|[/{ ])planning\//.test(value) ||
    /=>\s*planning\//.test(value)
  ) {
    return "planning";
  }
  if (
    /(^|[/{ ])program\//.test(value) ||
    /=>\s*program\//.test(value) ||
    /(^|[/{ ])(?:knowledge|interviews|examples|code)\//.test(value) ||
    value.includes("docs/game-client-interview/")
  ) {
    return "program";
  }
  return "";
}

function lineStatsFromNumstat(additions, deletions) {
  const added = Number(additions);
  const deleted = Number(deletions);
  if (!Number.isFinite(added) || !Number.isFinite(deleted)) {
    return emptyLineStats();
  }
  const modified = Math.min(added, deleted);
  return {
    added: added - modified,
    modified,
    deleted: deleted - modified
  };
}

function currentPathFromNumstat(rawPath) {
  const value = String(rawPath || "").trim();
  if (!value.includes("=>")) return value;
  const braced = value.match(/^(.*)\{([^{}]*) => ([^{}]*)\}(.*)$/);
  if (braced) {
    return `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/+/g, "/");
  }
  return value.split(/\s+=>\s+/).at(-1).trim();
}

function gitArguments() {
  const gitDirectory = process.env.CONTENT_GIT_DIR;
  return gitDirectory ? [`--git-dir=${gitDirectory}`] : [];
}

function runGit(sourceRoot, args, options = {}) {
  return execFileSync(
    "git",
    [...gitArguments(), ...args],
    {
      cwd: sourceRoot,
      encoding: "utf8",
      stdio: options.quiet
        ? ["ignore", "pipe", "ignore"]
        : ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024
    }
  ).trim();
}

function resolveRevision(sourceRoot) {
  const requested =
    process.env.CONTENT_GIT_REVISION ||
    process.env.CONTENT_COMMIT ||
    "HEAD";
  try {
    return runGit(
      sourceRoot,
      ["rev-parse", "--verify", `${requested}^{commit}`],
      { quiet: true }
    );
  } catch {
    return "";
  }
}

function isAncestor(sourceRoot, ancestor, revision) {
  if (!ancestor || !revision) return false;
  const result = spawnSync(
    "git",
    [
      ...gitArguments(),
      "merge-base",
      "--is-ancestor",
      ancestor,
      revision
    ],
    {
      cwd: sourceRoot,
      stdio: "ignore"
    }
  );
  return result.status === 0;
}

function parseHistory(sourceRoot, range) {
  const output = runGit(
    sourceRoot,
    [
      "log",
      "--reverse",
      "--no-merges",
      "--find-renames",
      "--format=%x1e%H%x1f%cI%x1f%aN%x1f%aE",
      "--numstat",
      range,
      "--",
      ...HISTORY_PATHS
    ],
    { quiet: true }
  );
  if (!output) return [];

  const commits = [];
  for (const block of output.split("\x1e")) {
    const lines = block.replace(/^\n+/, "").split("\n");
    if (!lines[0]) continue;
    const [sha, timestamp, authorName, authorEmail] =
      lines.shift().split("\x1f");
    if (!sha || !timestamp) continue;
    const tracks = {
      program: emptyLineStats(),
      planning: emptyLineStats()
    };
    const paths = new Set();
    for (const line of lines) {
      const match = line.match(/^([-\d]+)\t([-\d]+)\t(.+)$/);
      if (!match) continue;
      const track = trackForHistoryPath(match[3]);
      if (!track) continue;
      paths.add(currentPathFromNumstat(match[3]));
      addLineStats(
        tracks[track],
        lineStatsFromNumstat(match[1], match[2])
      );
    }
    if (
      Object.values(tracks).some((stats) => {
        return stats.added || stats.modified || stats.deleted;
      })
    ) {
      commits.push({
        sha,
        timestamp,
        authorName: authorName || "",
        authorEmail: authorEmail || "",
        paths: Array.from(paths),
        tracks
      });
    }
  }
  return commits;
}

function readCache(cachePath) {
  try {
    const value = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (
      value &&
      value.version === CACHE_VERSION &&
      Array.isArray(value.commits)
    ) {
      return value;
    }
  } catch {
    // A missing or incomplete cache is rebuilt from Git history.
  }
  return null;
}

function writeCache(cachePath, payload) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const temporary = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(payload), "utf8");
    fs.renameSync(temporary, cachePath);
  } catch {
    // Statistics remain available for this build when caching is unavailable.
  }
}

function loadContributionEvents(sourceRoot, cachePath) {
  const revision = resolveRevision(sourceRoot);
  if (!revision) {
    return { revision: "", commits: [], cacheMode: "unavailable" };
  }
  const cached = readCache(cachePath);
  if (cached && cached.revision === revision) {
    return {
      revision,
      commits: cached.commits,
      cacheMode: "hit"
    };
  }

  let commits = [];
  let range = revision;
  let cacheMode = "rebuild";
  if (
    cached &&
    cached.revision &&
    isAncestor(sourceRoot, cached.revision, revision)
  ) {
    commits = cached.commits.slice();
    range = `${cached.revision}..${revision}`;
    cacheMode = "incremental";
  }
  const existing = new Set(commits.map((commit) => commit.sha));
  for (const commit of parseHistory(sourceRoot, range)) {
    if (!existing.has(commit.sha)) {
      commits.push(commit);
      existing.add(commit.sha);
    }
  }
  const payload = {
    version: CACHE_VERSION,
    revision,
    commits
  };
  writeCache(cachePath, payload);
  return { ...payload, cacheMode };
}

function stripMarkdownForCount(source) {
  return String(source || "")
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .replace(/```[a-z0-9_-]*\s*/gi, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*(?:[-+*>]|\d+\.)[ \t]+/gm, "")
    .replace(/[`*_~|]/g, "");
}

function countCharacters(source, extension) {
  const value =
    extension === ".md"
      ? stripMarkdownForCount(source)
      : String(source || "");
  return Array.from(value.replace(/\s+/g, "")).length;
}

function countLines(source) {
  if (!source) return 0;
  const lines = String(source).split(/\r\n?|\n/);
  return lines.length - (lines.at(-1) === "" ? 1 : 0);
}

function currentTrackMetrics(sourceRoot, trackKey) {
  const metrics = { characterCount: 0, lineCount: 0, fileCount: 0 };
  const roots = TRACKS[trackKey].currentRoots;

  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || GENERATED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      const extension = path.extname(entry.name).toLocaleLowerCase();
      if (!entry.isFile() || !TEXT_EXTENSIONS.has(extension)) continue;
      const buffer = fs.readFileSync(absolutePath);
      if (buffer.includes(0)) continue;
      const source = buffer.toString("utf8");
      metrics.lineCount += countLines(source);
      metrics.characterCount += countCharacters(source, extension);
      metrics.fileCount += 1;
    }
  }

  roots.forEach((root) => visit(path.join(sourceRoot, root)));
  return metrics;
}

function aggregateStatistics(sourceRoot, rawCommits, fallbackUpdatedAt) {
  const identifiedCommits = buildContributorIdentities(rawCommits);
  const events = [];
  for (const commit of identifiedCommits) {
    for (const trackKey of Object.keys(TRACKS)) {
      const stats = commit.tracks[trackKey] || emptyLineStats();
      if (!stats.added && !stats.modified && !stats.deleted) continue;
      events.push({
        sha: commit.sha,
        timestamp: commit.timestamp,
        authorName: commit.authorName,
        authorEmail: commit.authorEmail,
        contributorId: commit.contributorId,
        contributorName: commit.contributorName,
        trackKey,
        ...stats
      });
    }
  }
  const identifiedEvents = events;
  const contributorNames = new Map(
    identifiedEvents.map((event) => [
      event.contributorId,
      event.contributorName
    ])
  );
  const currentByTrack = new Map(
    Object.keys(TRACKS).map((trackKey) => [
      trackKey,
      currentTrackMetrics(sourceRoot, trackKey)
    ])
  );

  function buildScope(key, title, trackKeys) {
    const scopedEvents = identifiedEvents.filter((event) => {
      return trackKeys.includes(event.trackKey);
    });
    const contributors = new Map();
    const lineTotals = emptyLineStats();
    let latestUpdatedAt = "";
    for (const event of scopedEvents) {
      addLineStats(lineTotals, event);
      latestUpdatedAt = event.timestamp > latestUpdatedAt
        ? event.timestamp
        : latestUpdatedAt;
      if (!contributors.has(event.contributorId)) {
        contributors.set(event.contributorId, {
          id: event.contributorId,
          name: contributorNames.get(event.contributorId),
          commitCount: 0,
          lastContributedAt: "",
          ...emptyLineStats()
        });
      }
      const contributor = contributors.get(event.contributorId);
      addLineStats(contributor, event);
      contributor.commitCount += 1;
      contributor.lastContributedAt =
        event.timestamp > contributor.lastContributedAt
          ? event.timestamp
          : contributor.lastContributedAt;
    }
    const current = trackKeys.reduce(
      (total, trackKey) => {
        const metrics = currentByTrack.get(trackKey);
        total.characterCount += metrics.characterCount;
        total.lineCount += metrics.lineCount;
        total.fileCount += metrics.fileCount;
        return total;
      },
      { characterCount: 0, lineCount: 0, fileCount: 0 }
    );
    return {
      key,
      title,
      ...current,
      contributorCount: contributors.size,
      latestUpdatedAt: latestUpdatedAt || fallbackUpdatedAt,
      lineTotals,
      contributors: Array.from(contributors.values()).sort(
        (left, right) => {
          const leftTotal = left.added + left.modified + left.deleted;
          const rightTotal = right.added + right.modified + right.deleted;
          return rightTotal - leftTotal ||
            left.name.localeCompare(right.name, "zh-CN");
        }
      )
    };
  }

  const scopes = [
    buildScope("all", "全部赛道", Object.keys(TRACKS)),
    ...Object.entries(TRACKS).map(([key, track]) => {
      return buildScope(key, track.title, [key]);
    })
  ];
  const newestTimestamp = scopes[0].latestUpdatedAt;
  const recentBoundary =
    new Date(newestTimestamp || Date.now()).getTime() -
    8 * 24 * 60 * 60 * 1000;
  const recentEvents = identifiedEvents
    .filter((event) => {
      return new Date(event.timestamp).getTime() >= recentBoundary;
    })
    .map((event) => ({
      timestamp: event.timestamp,
      trackKey: event.trackKey,
      contributorId: event.contributorId,
      contributorName: event.contributorName,
      added: event.added,
      modified: event.modified,
      deleted: event.deleted
    }));

  const documentLinks = new Map();
  for (const commit of identifiedCommits) {
    for (const documentPath of commit.paths || []) {
      const key = `${commit.contributorId}\u0000${documentPath}`;
      if (!documentLinks.has(key)) {
        documentLinks.set(key, {
          path: documentPath,
          contributorId: commit.contributorId,
          contributorName: commit.contributorName,
          commitCount: 0,
          lastContributedAt: ""
        });
      }
      const link = documentLinks.get(key);
      link.commitCount += 1;
      link.lastContributedAt =
        commit.timestamp > link.lastContributedAt
          ? commit.timestamp
          : link.lastContributedAt;
    }
  }

  return {
    scopes,
    recentEvents,
    documentContributions: Array.from(documentLinks.values()).sort(
      (left, right) => {
        return (
          left.path.localeCompare(right.path, "zh-CN", { numeric: true }) ||
          left.contributorName.localeCompare(right.contributorName, "zh-CN")
        );
      }
    )
  };
}

function getContentStatistics(sourceRoot, options = {}) {
  const cachePath =
    options.cachePath ||
    process.env.CONTENT_STATS_CACHE_PATH ||
    path.resolve(process.cwd(), ".cache/content-statistics-v2.json");
  const history = loadContributionEvents(sourceRoot, cachePath);
  const aggregated = aggregateStatistics(
    sourceRoot,
    history.commits,
    options.fallbackUpdatedAt || new Date().toISOString()
  );
  return {
    version: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    revision: history.revision,
    cacheMode: history.cacheMode,
    ...aggregated
  };
}

module.exports = {
  CACHE_VERSION,
  TRACKS,
  aggregateStatistics,
  buildContributorIdentities,
  countCharacters,
  countLines,
  currentPathFromNumstat,
  getContentStatistics,
  lineStatsFromNumstat,
  trackForHistoryPath
};
