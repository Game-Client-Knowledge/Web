const path = require("node:path");
const MarkdownIt = require("markdown-it");

const GRAPH_VERSION = 1;

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

function uniqueDocuments(catalog) {
  const byPath = new Map();
  const add = (item, fallbackDirectory) => {
    if (!item || !item.sourceRelative || byPath.has(item.sourceRelative)) {
      return;
    }
    byPath.set(item.sourceRelative, {
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
    });
  };

  for (const track of catalog.tracks || []) {
    add(track, track.key);
  }
  for (const module of catalog.modules || []) {
    add(module, module.key);
  }
  for (const document of catalog.documents || []) {
    if (document.kind === "markdown") add(document);
  }
  return Array.from(byPath.values());
}

function edgeKey(type, left, right) {
  return `${type}:${[left, right].sort().join("\u0000")}`;
}

function buildHomeStarGraph(catalog) {
  const documents = uniqueDocuments(catalog);
  const documentPaths = new Set(
    documents.map((document) => document.sourceRelative)
  );
  const overall =
    (catalog.contentStatistics?.scopes || []).find(
      (scope) => scope.key === "all"
    ) || { contributors: [] };
  const contributionLinks = (
    catalog.contentStatistics?.documentContributions || []
  ).filter((link) => documentPaths.has(link.path));
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
        lastContributedAt: link.lastContributedAt
      });
    }
  }

  const stars = [];
  const documentStarByPath = new Map();
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
        lastActiveAt: contributor.lastContributedAt || ""
      }
    });
  }
  for (const document of documents) {
    const star = {
      id: `document:${document.sourceRelative}`,
      kind: "document",
      sourcePath: document.sourceRelative,
      title: document.title,
      route: document.route,
      trackKey: document.trackKey,
      moduleKey: document.moduleKey,
      clusterKey: document.sourceDirectory,
      brightness: 10,
      metrics: {
        contributorCount: 0,
        referenceDegree: 0,
        lastContributedAt: ""
      }
    };
    stars.push(star);
    documentStarByPath.set(document.sourceRelative, star);
  }

  const edges = new Map();
  const clusters = new Map();
  for (const star of documentStarByPath.values()) {
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
    const source = documentStarByPath.get(document.sourceRelative);
    for (const reference of markdownReferences(
      document.sourceRelative,
      document.body,
      catalog.sourceRoutes || {}
    )) {
      const target = documentStarByPath.get(reference);
      if (!source || !target) continue;
      edges.set(edgeKey("reference", source.id, target.id), {
        type: "reference",
        source: source.id,
        target: target.id
      });
    }
  }

  const contributorSets = new Map();
  for (const link of contributionLinks) {
    const source = `contributor:${link.contributorId}`;
    const target = `document:${link.path}`;
    if (!contributorById.has(link.contributorId) || !documentPaths.has(link.path)) {
      continue;
    }
    edges.set(edgeKey("contribution", source, target), {
      type: "contribution",
      source,
      target,
      commitCount: Number(link.commitCount || 0),
      lastContributedAt: link.lastContributedAt || ""
    });
    if (!contributorSets.has(link.path)) contributorSets.set(link.path, new Set());
    contributorSets.get(link.path).add(link.contributorId);
    const documentStar = documentStarByPath.get(link.path);
    if (
      link.lastContributedAt &&
      link.lastContributedAt > documentStar.metrics.lastContributedAt
    ) {
      documentStar.metrics.lastContributedAt = link.lastContributedAt;
    }
  }

  for (const star of documentStarByPath.values()) {
    star.metrics.contributorCount =
      contributorSets.get(star.sourcePath)?.size || 0;
  }
  for (const edge of edges.values()) {
    if (edge.type !== "reference") continue;
    const source = documentStarByPath.get(
      edge.source.replace(/^document:/, "")
    );
    const target = documentStarByPath.get(
      edge.target.replace(/^document:/, "")
    );
    if (source) source.metrics.referenceDegree += 1;
    if (target) target.metrics.referenceDegree += 1;
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
