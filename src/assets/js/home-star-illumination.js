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
    "reverse_depth",
    "bidirectional_depth",
    "bfs_contributor_terminal",
    "depth_contributor_terminal",
    "direct_neighbors",
    "strong_component",
    "reference_depth",
    "reference_sources_depth"
  ]);
  const DIRECTION_MODES = new Set(["directed", "undirected"]);

  function normalizedDepth(value) {
    const depth = Number(value);
    return Math.max(1, Math.min(20, Number.isFinite(depth) ? depth : 3));
  }

  function normalizedDirectionMode(value) {
    return DIRECTION_MODES.has(value) ? value : "directed";
  }

  function appendNeighbor(adjacency, source, target, type) {
    const neighbors = adjacency.get(source);
    if (
      neighbors.some((neighbor) => {
        return neighbor.id === target && neighbor.type === type;
      })
    ) {
      return;
    }
    neighbors.push({ id: target, type });
  }

  function buildGraph(stars, edges, directionMode) {
    const starById = new Map(
      (stars || []).map((star) => [star.id, star])
    );
    const outgoing = new Map(
      Array.from(starById.keys(), (id) => [id, []])
    );
    const incoming = new Map(
      Array.from(starById.keys(), (id) => [id, []])
    );
    const mode = normalizedDirectionMode(directionMode);
    for (const edge of edges || []) {
      if (!starById.has(edge.source) || !starById.has(edge.target)) {
        continue;
      }
      appendNeighbor(outgoing, edge.source, edge.target, edge.type);
      appendNeighbor(incoming, edge.target, edge.source, edge.type);
      if (mode === "undirected" || edge.type === "strong") {
        appendNeighbor(outgoing, edge.target, edge.source, edge.type);
        appendNeighbor(incoming, edge.source, edge.target, edge.type);
      }
    }
    return {
      starById,
      adjacency: outgoing,
      incoming,
      outgoing,
      directionMode: mode
    };
  }

  function ruleOptions(rule, depth) {
    const normalizedRule = RULES.has(rule) ? rule : "bfs";
    const options = {
      maxDepth: Infinity,
      contributorTerminal: false,
      edgeTypes: null,
      traversal: "outgoing"
    };
    if (
      normalizedRule === "depth" ||
      normalizedRule === "reverse_depth" ||
      normalizedRule === "bidirectional_depth" ||
      normalizedRule === "depth_contributor_terminal" ||
      normalizedRule === "reference_depth" ||
      normalizedRule === "reference_sources_depth"
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
    } else if (
      normalizedRule === "reference_depth" ||
      normalizedRule === "reference_sources_depth"
    ) {
      options.edgeTypes = new Set(["reference"]);
    }
    if (
      normalizedRule === "reverse_depth" ||
      normalizedRule === "reference_sources_depth"
    ) {
      options.traversal = "incoming";
    } else if (normalizedRule === "bidirectional_depth") {
      options.traversal = "both";
    }
    return options;
  }

  function neighborsFor(graph, id, traversal) {
    if (traversal === "incoming") {
      return graph.incoming.get(id) || [];
    }
    if (traversal !== "both") {
      return graph.outgoing.get(id) || [];
    }
    const merged = [];
    const seen = new Set();
    for (const neighbor of [
      ...(graph.outgoing.get(id) || []),
      ...(graph.incoming.get(id) || [])
    ]) {
      const key = `${neighbor.type}\u0000${neighbor.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(neighbor);
    }
    return merged;
  }

  function illuminate(
    stars,
    edges,
    startId,
    rule,
    depth,
    directionMode
  ) {
    const graph = buildGraph(stars, edges, directionMode);
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
      for (const neighbor of neighborsFor(
        graph,
        current.id,
        options.traversal
      )) {
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

  function edgeId(edge) {
    const endpoints =
      edge.type === "strong"
        ? [edge.source, edge.target].sort().join("\u0000")
        : `${edge.source}\u0000${edge.target}`;
    return `${edge.type}:${endpoints}`;
  }

  function coveredRelations(edges, selectedIds) {
    return (edges || []).filter((edge) => {
      return (
        selectedIds.has(edge.source) &&
        selectedIds.has(edge.target)
      );
    });
  }

  function minimumRelationTree(stars, relations, selectedIds) {
    if (selectedIds.size <= 1) return [];
    const starById = new Map(
      (stars || []).map((star) => [star.id, star])
    );
    const parent = new Map(
      Array.from(selectedIds, (id) => [id, id])
    );

    function find(id) {
      const current = parent.get(id);
      if (current !== id) {
        parent.set(id, find(current));
      }
      return parent.get(id);
    }

    function union(left, right) {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot === rightRoot) return false;
      parent.set(rightRoot, leftRoot);
      return true;
    }

    const typeOrder = {
      strong: 0,
      reference: 1,
      contribution: 2
    };
    const candidates = relations
      .map((edge) => {
        const source = starById.get(edge.source);
        const target = starById.get(edge.target);
        const dx = Number(source?.x || 0) - Number(target?.x || 0);
        const dy = Number(source?.y || 0) - Number(target?.y || 0);
        return {
          edge,
          typeOrder: typeOrder[edge.type] ?? 3,
          distanceSquared: dx * dx + dy * dy,
          id: edgeId(edge)
        };
      })
      .sort((left, right) => {
        return (
          left.typeOrder - right.typeOrder ||
          left.distanceSquared - right.distanceSquared ||
          left.id.localeCompare(right.id)
        );
      });
    const tree = [];
    for (const candidate of candidates) {
      if (union(candidate.edge.source, candidate.edge.target)) {
        tree.push(candidate.edge);
      }
      if (tree.length >= selectedIds.size - 1) break;
    }
    return tree;
  }

  function longestTreePath(tree) {
    if (!tree.length) return [];
    const adjacency = new Map();
    for (const edge of tree) {
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
      if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
      adjacency.get(edge.source).push({ id: edge.target, edge });
      adjacency.get(edge.target).push({ id: edge.source, edge });
    }
    for (const neighbors of adjacency.values()) {
      neighbors.sort((left, right) => left.id.localeCompare(right.id));
    }

    function farthest(start) {
      const queue = [{ id: start, distance: 0 }];
      const seen = new Set([start]);
      const parent = new Map();
      let result = queue[0];
      while (queue.length) {
        const current = queue.shift();
        if (
          current.distance > result.distance ||
          (
            current.distance === result.distance &&
            current.id.localeCompare(result.id) < 0
          )
        ) {
          result = current;
        }
        for (const neighbor of adjacency.get(current.id) || []) {
          if (seen.has(neighbor.id)) continue;
          seen.add(neighbor.id);
          parent.set(neighbor.id, {
            id: current.id,
            edge: neighbor.edge
          });
          queue.push({
            id: neighbor.id,
            distance: current.distance + 1
          });
        }
      }
      return { ...result, parent };
    }

    const first = Array.from(adjacency.keys()).sort()[0];
    const endpoint = farthest(first).id;
    const opposite = farthest(endpoint);
    const path = [];
    let current = opposite.id;
    while (current !== endpoint) {
      const step = opposite.parent.get(current);
      if (!step) break;
      path.push(step.edge);
      current = step.id;
    }
    return path.reverse();
  }

  function relationPlan(stars, edges, selectedIds, mode) {
    const coverageEdges = coveredRelations(edges, selectedIds);
    const minimalTree =
      mode === "full"
        ? null
        : minimumRelationTree(stars, coverageEdges, selectedIds);
    const visualEdges =
      mode === "single_path"
        ? longestTreePath(minimalTree)
        : mode === "minimal_tree"
          ? minimalTree
          : coverageEdges.slice();
    const totalCount = (edges || []).length;
    return {
      coverageEdges,
      visualEdges,
      coverageCount: coverageEdges.length,
      visualCount: visualEdges.length,
      totalCount,
      coverageRate: totalCount
        ? coverageEdges.length / totalCount
        : 0
    };
  }

  function brightnessPresentation(value, kind, selected, maxValue = 100) {
    const maximum = Math.max(
      1,
      Math.min(100, Number(maxValue) || 100)
    );
    const brightness = Math.max(
      0,
      Math.min(maximum, Number(value) || 0)
    );
    const normalized = brightness / maximum;
    const luminous = Math.pow(normalized, 1.55);
    const radius =
      kind === "contributor"
        ? 1.3 + Math.pow(normalized, 0.72) * 4.4
        : 0.7 + Math.pow(normalized, 0.78) * 2.55;
    return {
      brightness,
      maximum,
      luminous,
      radius: radius + (selected ? 0.8 : 0),
      alpha: Math.min(1, 0.3 + luminous * 0.7 + (selected ? 0.1 : 0)),
      shadowBlur:
        1.5 + luminous * 17 + (selected ? 9 : 0),
      haloRadius: radius * (2.4 + luminous * 2.1),
      haloAlpha: Math.min(
        0.5,
        0.05 + luminous * 0.38 + (selected ? 0.14 : 0)
      ),
      coreAlpha: Math.max(0, Math.min(0.95, (luminous - 0.28) * 1.35))
    };
  }

  return {
    DIRECTION_MODES,
    RULES,
    brightnessPresentation,
    buildGraph,
    coveredRelations,
    edgeId,
    illuminate,
    longestTreePath,
    minimumRelationTree,
    normalizedDepth,
    normalizedDirectionMode,
    relationPlan,
    ruleOptions
  };
});
