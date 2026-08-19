const path = require("node:path");
const MarkdownIt = require("markdown-it");

const GRAPH_VERSION = 4;
const GENERATED_DIRECTORIES = new Set(["bin", "obj"]);

function isGeneratedPath(sourceRelative) {
  return String(sourceRelative || "")
    .split("/")
    .some((part) => GENERATED_DIRECTORIES.has(part));
}

function normalizeSourceTarget(sourceRelative, href, sourceRoutes) {
  const raw = String(href || "").trim();
  if (
    !raw ||
    raw.startsWith("#") ||
    /^(?:[a-z]+:)?\/\//i.test(raw) ||
    /^(?:mailto|tel|data):/i.test(raw)
  ) {
    return "";
  }
  const pathname = raw.split(/[?#]/, 1)[0];
  if (!pathname) return "";
  let decoded = pathname;
  try {
    decoded = decodeURI(pathname);
  } catch {
    return "";
  }

  if (decoded.startsWith("/")) {
    const route = `/${decoded.replace(/^\/+|\/+$/g, "")}/`.replace(
      /\/+/g,
      "/"
    );
    const routeEntry = Object.entries(sourceRoutes).find(([, value]) => {
      return value === route;
    });
    return routeEntry ? routeEntry[0] : "";
  }

  const joined = path.posix.normalize(
    path.posix.join(path.posix.dirname(sourceRelative), decoded)
  );
  const candidates = [
    joined,
    `${joined}.md`,
    path.posix.join(joined, "README.md")
  ];
  if (decoded.endsWith("/")) {
    candidates.unshift(path.posix.join(joined, "README.md"));
  }
  return candidates.find((candidate) => sourceRoutes[candidate]) || "";
}

function markdownReferences(sourceRelative, markdown, sourceRoutes) {
  const parser = new MarkdownIt({ html: false, linkify: false });
  const references = new Set();

  function visit(tokens) {
    for (const token of tokens || []) {
      if (token.type === "link_open") {
        const href = token.attrGet("href");
        const target = normalizeSourceTarget(
          sourceRelative,
          href,
          sourceRoutes
        );
        if (target && target !== sourceRelative) references.add(target);
      }
      if (token.children) visit(token.children);
    }
  }

  visit(parser.parse(String(markdown || ""), {}));
  return Array.from(references);
}

function codeSystemPath(item) {
  const moduleParts = String(item?.moduleKey || "").split("/");
  const sourceParts = String(item?.sourceRelative || "").split("/");
  if (
    moduleParts.at(-1) !== "code" ||
    sourceParts.length <= moduleParts.length + 1 ||
    !moduleParts.every((part, index) => sourceParts[index] === part)
  ) {
    return "";
  }
  return sourceParts.slice(0, moduleParts.length + 1).join("/");
}

function normalizedDocument(item, fallbackDirectory) {
  return {
    kind: item.kind || "markdown",
    sourceRelative: item.sourceRelative,
    sourceDirectory:
      item.sourceDirectory ||
      fallbackDirectory ||
      path.posix.dirname(item.sourceRelative),
    title: item.title,
    route: item.route,
    trackKey: item.trackKey || item.sourceRelative.split("/")[0] || null,
    moduleKey: item.moduleKey || fallbackDirectory || null,
    body: item.body || ""
  };
}

function uniqueDocuments(catalog) {
  const byPath = new Map();
  const add = (item, fallbackDirectory) => {
    if (!item || !item.sourceRelative || byPath.has(item.sourceRelative)) {
      return;
    }
    byPath.set(
      item.sourceRelative,
      normalizedDocument(item, fallbackDirectory)
    );
  };

  for (const track of catalog.tracks || []) {
    add(track, track.key);
  }
  for (const module of catalog.modules || []) {
    add(module, module.key);
  }
  const codeSystems = new Map();
  for (const document of catalog.documents || []) {
    if (isGeneratedPath(document.sourceRelative)) continue;
    const systemPath = codeSystemPath(document);
    if (!systemPath) {
      add(document);
      continue;
    }
    if (!codeSystems.has(systemPath)) codeSystems.set(systemPath, []);
    codeSystems.get(systemPath).push(normalizedDocument(document));
  }
  for (const [systemPath, members] of codeSystems) {
    const introduction = members.find(
      (member) => member.sourceRelative === `${systemPath}/README.md`
    );
    const representative =
      introduction ||
      members.find((member) => member.kind === "markdown") ||
      members[0];
    const sourceRelative =
      introduction?.sourceRelative || representative.sourceRelative;
    byPath.set(`system:${systemPath}`, {
      ...representative,
      sourceRelative,
      sourceDirectory: representative.moduleKey,
      title:
        introduction?.title ||
        systemPath.split("/").at(-1).replace(/[-_]+/g, " "),
      route: introduction?.route || `/${systemPath}/`,
      resourceKind: "code_system",
      systemPath,
      sourcePaths: members.map((member) => member.sourceRelative),
      referenceSources: members.filter((member) => member.body)
    });
  }
  return Array.from(byPath.values());
}

function edgeKey(type, left, right) {
  const endpoints =
    type === "strong"
      ? [left, right].sort().join("\u0000")
      : `${left}\u0000${right}`;
  return `${type}:${endpoints}`;
}

function buildHomeStarGraph(catalog) {
  const documents = uniqueDocuments(catalog);
  const documentByPath = new Map();
  const codeSystems = [];
  for (const document of documents) {
    const sourcePaths = document.sourcePaths || [document.sourceRelative];
    for (const sourcePath of sourcePaths) {
      documentByPath.set(sourcePath, document);
    }
    if (document.systemPath) codeSystems.push(document);
  }
  const documentForPath = (sourcePath) => {
    if (isGeneratedPath(sourcePath)) return null;
    const exact = documentByPath.get(sourcePath);
    if (exact) return exact;
    return codeSystems.find((document) => {
      return sourcePath.startsWith(`${document.systemPath}/`);
    }) || null;
  };
  const overall =
    (catalog.contentStatistics?.scopes || []).find(
      (scope) => scope.key === "all"
    ) || { contributors: [] };
  const contributionLinks = (
    catalog.contentStatistics?.documentContributions || []
  ).filter((link) => documentForPath(link.path));
  const documentMetrics = catalog.contentStatistics?.documentMetrics || [];
  const contributorById = new Map(
    (overall.contributors || []).map((contributor) => [
      contributor.id,
      contributor
    ])
  );
  for (const link of contributionLinks) {
    if (!contributorById.has(link.contributorId)) {
      contributorById.set(link.contributorId, {
        id: link.contributorId,
        name: link.contributorName,
        added: 0,
        modified: 0,
        deleted: 0,
        commitCount: link.commitCount,
        lastContributedAt: link.lastContributedAt,
        activity7Count: 0,
        activity30Count: 0,
        modification7Count: 0,
        modification30Count: 0
      });
    }
  }

  const stars = [];
  const documentStarByPath = new Map();
  const documentStarById = new Map();
  const codeSystemStars = [];
  for (const contributor of contributorById.values()) {
    const contributionCount =
      Number(contributor.added || 0) +
      Number(contributor.modified || 0) +
      Number(contributor.deleted || 0);
    stars.push({
      id: `contributor:${contributor.id}`,
      kind: "contributor",
      contributorId: contributor.id,
      name: contributor.name,
      brightness: 10,
      metrics: {
        contributionCount,
        commitCount: Number(contributor.commitCount || 0),
        lastActiveAt: contributor.lastContributedAt || "",
        referenceCount: 0,
        referencedByCount: 0,
        strongRelationCount: 0,
        activity7Count: Number(contributor.activity7Count || 0),
        activity30Count: Number(contributor.activity30Count || 0),
        modification7Count: Number(
          contributor.modification7Count || 0
        ),
        modification30Count: Number(
          contributor.modification30Count || 0
        )
      }
    });
  }
  for (const document of documents) {
    const star = {
      id: `document:${document.sourceRelative}`,
      kind: "document",
      resourceKind: document.resourceKind || "document",
      sourcePath: document.sourceRelative,
      sourcePaths: document.sourcePaths || [document.sourceRelative],
      systemPath: document.systemPath || "",
      title: document.title,
      route: document.route,
      trackKey: document.trackKey,
      moduleKey: document.moduleKey,
      clusterKey: document.sourceDirectory,
      brightness: 10,
      metrics: {
        contributorCount: 0,
        referenceDegree: 0,
        referenceCount: 0,
        referencedByCount: 0,
        strongRelationCount: 0,
        activity7Count: 0,
        activity30Count: 0,
        modification7Count: 0,
        modification30Count: 0,
        lastContributedAt: ""
      }
    };
    stars.push(star);
    documentStarById.set(star.id, star);
    for (const sourcePath of star.sourcePaths) {
      documentStarByPath.set(sourcePath, star);
    }
    if (star.systemPath) codeSystemStars.push(star);
  }
  const documentStarForPath = (sourcePath) => {
    if (isGeneratedPath(sourcePath)) return null;
    const exact = documentStarByPath.get(sourcePath);
    if (exact) return exact;
    return codeSystemStars.find((star) => {
      return sourcePath.startsWith(`${star.systemPath}/`);
    }) || null;
  };
  const documentCommitWindows = new Map();
  for (const metric of documentMetrics) {
    const star = documentStarForPath(metric.path);
    if (!star) continue;
    star.metrics.modification7Count += Number(
      metric.modification7Count || 0
    );
    star.metrics.modification30Count += Number(
      metric.modification30Count || 0
    );
    if (!documentCommitWindows.has(star.id)) {
      documentCommitWindows.set(star.id, {
        seven: new Set(),
        thirty: new Set(),
        fallbackSeven: 0,
        fallbackThirty: 0
      });
    }
    const windows = documentCommitWindows.get(star.id);
    if (metric._commitWindows?.seven instanceof Set) {
      metric._commitWindows.seven.forEach((sha) => {
        windows.seven.add(sha);
      });
      metric._commitWindows.thirty.forEach((sha) => {
        windows.thirty.add(sha);
      });
    } else {
      windows.fallbackSeven += Number(metric.activity7Count || 0);
      windows.fallbackThirty += Number(metric.activity30Count || 0);
    }
  }
  for (const star of documentStarById.values()) {
    const windows = documentCommitWindows.get(star.id);
    if (!windows) continue;
    star.metrics.activity7Count =
      windows.seven.size + windows.fallbackSeven;
    star.metrics.activity30Count =
      windows.thirty.size + windows.fallbackThirty;
  }

  const edges = new Map();
  const clusters = new Map();
  for (const star of documentStarById.values()) {
    if (!clusters.has(star.clusterKey)) clusters.set(star.clusterKey, []);
    clusters.get(star.clusterKey).push(star);
  }
  for (const clusterStars of clusters.values()) {
    for (let left = 0; left < clusterStars.length; left += 1) {
      for (let right = left + 1; right < clusterStars.length; right += 1) {
        const source = clusterStars[left].id;
        const target = clusterStars[right].id;
        edges.set(edgeKey("strong", source, target), {
          type: "strong",
          source,
          target
        });
      }
    }
  }

  for (const document of documents) {
    const source = documentStarForPath(document.sourceRelative);
    const referenceSources = document.referenceSources || [document];
    for (const referenceSource of referenceSources) {
      for (const reference of markdownReferences(
        referenceSource.sourceRelative,
        referenceSource.body,
        catalog.sourceRoutes || {}
      )) {
        const target = documentStarForPath(reference);
        if (!source || !target || source.id === target.id) continue;
        edges.set(edgeKey("reference", source.id, target.id), {
          type: "reference",
          source: source.id,
          target: target.id
        });
      }
    }
  }

  const contributorSets = new Map();
  for (const link of contributionLinks) {
    const source = `contributor:${link.contributorId}`;
    const documentStar = documentStarForPath(link.path);
    if (!contributorById.has(link.contributorId) || !documentStar) {
      continue;
    }
    const target = documentStar.id;
    const key = edgeKey("contribution", source, target);
    const existing = edges.get(key);
    if (existing) {
      existing.commitCount += Number(link.commitCount || 0);
      existing.lastContributedAt =
        link.lastContributedAt > existing.lastContributedAt
          ? link.lastContributedAt
          : existing.lastContributedAt;
    } else {
      edges.set(key, {
        type: "contribution",
        source,
        target,
        commitCount: Number(link.commitCount || 0),
        lastContributedAt: link.lastContributedAt || ""
      });
    }
    if (!contributorSets.has(target)) contributorSets.set(target, new Set());
    contributorSets.get(target).add(link.contributorId);
    if (
      link.lastContributedAt &&
      link.lastContributedAt > documentStar.metrics.lastContributedAt
    ) {
      documentStar.metrics.lastContributedAt = link.lastContributedAt;
    }
  }

  for (const star of documentStarById.values()) {
    star.metrics.contributorCount =
      contributorSets.get(star.id)?.size || 0;
  }
  for (const edge of edges.values()) {
    const source = documentStarById.get(edge.source);
    const target = documentStarById.get(edge.target);
    if (edge.type === "reference") {
      if (source) {
        source.metrics.referenceCount += 1;
        source.metrics.referenceDegree += 1;
      }
      if (target) {
        target.metrics.referencedByCount += 1;
        target.metrics.referenceDegree += 1;
      }
    } else if (edge.type === "strong") {
      if (source) source.metrics.strongRelationCount += 1;
      if (target) target.metrics.strongRelationCount += 1;
    }
  }

  return {
    version: GRAPH_VERSION,
    revision: catalog.repository?.commit || "local",
    generatedAt:
      catalog.contentStatistics?.generatedAt || new Date().toISOString(),
    stars,
    edges: Array.from(edges.values())
  };
}

module.exports = {
  GRAPH_VERSION,
  buildHomeStarGraph,
  markdownReferences,
  normalizeSourceTarget,
  uniqueDocuments
};
