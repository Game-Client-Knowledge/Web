(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.GCK_HOME_STAR_ILLUMINATION = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RULES = new Set([
    "bfs",
    "depth",
    "bfs_contributor_terminal",
    "depth_contributor_terminal",
    "direct_neighbors",
    "strong_component",
    "reference_depth"
  ]);

  function normalizedDepth(value) {
    const depth = Number(value);
    return Math.max(1, Math.min(20, Number.isFinite(depth) ? depth : 3));
  }

  function buildGraph(stars, edges) {
    const starById = new Map(
      (stars || []).map((star) => [star.id, star])
    );
    const adjacency = new Map(
      Array.from(starById.keys(), (id) => [id, []])
    );
    for (const edge of edges || []) {
      if (!starById.has(edge.source) || !starById.has(edge.target)) {
        continue;
      }
      adjacency.get(edge.source).push({
        id: edge.target,
        type: edge.type
      });
      adjacency.get(edge.target).push({
        id: edge.source,
        type: edge.type
      });
    }
    return { starById, adjacency };
  }

  function ruleOptions(rule, depth) {
    const normalizedRule = RULES.has(rule) ? rule : "bfs";
    const options = {
      maxDepth: Infinity,
      contributorTerminal: false,
      edgeTypes: null
    };
    if (
      normalizedRule === "depth" ||
      normalizedRule === "depth_contributor_terminal" ||
      normalizedRule === "reference_depth"
    ) {
      options.maxDepth = normalizedDepth(depth);
    }
    if (normalizedRule === "direct_neighbors") {
      options.maxDepth = 1;
    }
    if (
      normalizedRule === "bfs_contributor_terminal" ||
      normalizedRule === "depth_contributor_terminal"
    ) {
      options.contributorTerminal = true;
    }
    if (normalizedRule === "strong_component") {
      options.edgeTypes = new Set(["strong"]);
    } else if (normalizedRule === "reference_depth") {
      options.edgeTypes = new Set(["reference"]);
    }
    return options;
  }

  function illuminate(stars, edges, startId, rule, depth) {
    const graph = buildGraph(stars, edges);
    if (!graph.starById.has(startId)) return new Set();
    const options = ruleOptions(rule, depth);
    const visited = new Set([startId]);
    const queue = [{ id: startId, depth: 0 }];

    while (queue.length) {
      const current = queue.shift();
      if (current.depth >= options.maxDepth) continue;
      const star = graph.starById.get(current.id);
      if (
        options.contributorTerminal &&
        current.id !== startId &&
        star.kind === "contributor"
      ) {
        continue;
      }
      for (const neighbor of graph.adjacency.get(current.id) || []) {
        if (
          options.edgeTypes &&
          !options.edgeTypes.has(neighbor.type)
        ) {
          continue;
        }
        if (visited.has(neighbor.id)) continue;
        visited.add(neighbor.id);
        queue.push({
          id: neighbor.id,
          depth: current.depth + 1
        });
      }
    }
    return visited;
  }

  function brightnessPresentation(value, kind, selected) {
    const brightness = Math.max(0, Math.min(30, Number(value) || 0));
    const normalized = brightness / 30;
    const luminous = Math.pow(normalized, 1.55);
    const radius =
      kind === "contributor"
        ? 1.1 + Math.pow(normalized, 0.72) * 4.6
        : 0.45 + Math.pow(normalized, 0.78) * 2.8;
    return {
      brightness,
      luminous,
      radius: radius + (selected ? 0.8 : 0),
      alpha: Math.min(1, 0.12 + luminous * 0.88 + (selected ? 0.1 : 0)),
      shadowBlur:
        1.5 + luminous * 17 + (selected ? 9 : 0),
      haloRadius: radius * (2.2 + luminous * 1.8),
      haloAlpha: Math.min(
        0.46,
        0.025 + luminous * 0.3 + (selected ? 0.12 : 0)
      )
    };
  }

  return {
    RULES,
    brightnessPresentation,
    buildGraph,
    illuminate,
    normalizedDepth,
    ruleOptions
  };
});
