const assert = require("node:assert/strict");
const {
  brightnessPresentation,
  illuminate,
  relationPlan
} = require("../src/assets/js/home-star-illumination");

const stars = [
  { id: "d:a", kind: "document" },
  { id: "d:b", kind: "document" },
  { id: "d:c", kind: "document" },
  { id: "d:d", kind: "document" },
  { id: "d:e", kind: "document" },
  { id: "u:one", kind: "contributor" },
  { id: "u:two", kind: "contributor" }
];
const edges = [
  { source: "d:a", target: "d:b", type: "strong" },
  { source: "d:b", target: "d:c", type: "reference" },
  { source: "u:one", target: "d:c", type: "contribution" },
  { source: "u:one", target: "d:d", type: "contribution" },
  { source: "d:d", target: "d:e", type: "strong" },
  { source: "u:two", target: "d:e", type: "contribution" }
];

function values(
  rule,
  depth,
  startId = "d:a",
  directionMode = "undirected"
) {
  return Array.from(
    illuminate(stars, edges, startId, rule, depth, directionMode)
  ).sort();
}

assert.deepEqual(values("bfs", 3), [
  "d:a",
  "d:b",
  "d:c",
  "d:d",
  "d:e",
  "u:one",
  "u:two"
]);
assert.deepEqual(values("depth", 2), ["d:a", "d:b", "d:c"]);
assert.deepEqual(values("direct_neighbors", 20), ["d:a", "d:b"]);
assert.deepEqual(values("bfs_contributor_terminal", 3), [
  "d:a",
  "d:b",
  "d:c",
  "u:one"
]);
assert.deepEqual(values("depth_contributor_terminal", 10), [
  "d:a",
  "d:b",
  "d:c",
  "u:one"
]);
assert.deepEqual(values("bfs_contributor_terminal", 1, "u:one"), [
  "d:a",
  "d:b",
  "d:c",
  "d:d",
  "d:e",
  "u:one",
  "u:two"
]);
assert.deepEqual(values("depth_contributor_terminal", 1, "u:one"), [
  "d:c",
  "d:d",
  "u:one"
]);
assert.deepEqual(values("strong_component", 2), ["d:a", "d:b"]);
assert.deepEqual(values("reference_depth", 3, "d:b"), ["d:b", "d:c"]);
assert.deepEqual(values("unsupported", 1), values("bfs", 1));

assert.deepEqual(values("bfs", 20, "d:a", "directed"), [
  "d:a",
  "d:b",
  "d:c"
]);
assert.deepEqual(values("bfs", 20, "u:one", "directed"), [
  "d:c",
  "d:d",
  "d:e",
  "u:one"
]);
assert.deepEqual(values("depth", 1, "d:b", "directed"), [
  "d:a",
  "d:b",
  "d:c"
]);
assert.deepEqual(values("direct_neighbors", 20, "d:c", "directed"), [
  "d:c"
]);
assert.deepEqual(values("reverse_depth", 2, "d:c", "directed"), [
  "d:a",
  "d:b",
  "d:c",
  "u:one"
]);
assert.deepEqual(
  values("bidirectional_depth", 1, "d:c", "directed"),
  ["d:b", "d:c", "u:one"]
);
assert.deepEqual(
  values("reference_depth", 3, "d:b", "directed"),
  ["d:b", "d:c"]
);
assert.deepEqual(
  values("reference_depth", 3, "d:c", "directed"),
  ["d:c"]
);
assert.deepEqual(
  values("reference_sources_depth", 3, "d:c", "directed"),
  ["d:b", "d:c"]
);
assert.deepEqual(
  values("strong_component", 20, "d:b", "directed"),
  ["d:a", "d:b"]
);

const planStars = [
  { id: "a", kind: "document", x: 0, y: 0 },
  { id: "b", kind: "document", x: 1, y: 0 },
  { id: "c", kind: "document", x: 2, y: 0 },
  { id: "d", kind: "document", x: 3, y: 0 }
];
const planEdges = [
  { source: "a", target: "b", type: "strong" },
  { source: "b", target: "c", type: "strong" },
  { source: "c", target: "d", type: "strong" },
  { source: "a", target: "d", type: "reference" },
  { source: "a", target: "c", type: "reference" }
];
const allPlanIds = new Set(["a", "b", "c", "d"]);
const fullPlan = relationPlan(
  planStars,
  planEdges,
  allPlanIds,
  "full"
);
assert.equal(fullPlan.coverageCount, 5);
assert.equal(fullPlan.visualCount, 5);
assert.equal(fullPlan.totalCount, 5);
assert.equal(fullPlan.coverageRate, 1);

const minimalPlan = relationPlan(
  planStars,
  planEdges,
  allPlanIds,
  "minimal_tree"
);
assert.equal(minimalPlan.coverageCount, 5);
assert.equal(minimalPlan.visualCount, 3);
assert.equal(minimalPlan.totalCount, 5);
assert.deepEqual(
  minimalPlan.visualEdges.map((edge) => {
    return [edge.source, edge.target].sort().join("-");
  }).sort(),
  ["a-b", "b-c", "c-d"]
);
assert.ok(
  minimalPlan.visualEdges.every((edge) => {
    return minimalPlan.coverageEdges.includes(edge);
  })
);

const partialPlan = relationPlan(
  planStars,
  planEdges,
  new Set(["a", "b", "c"]),
  "minimal_tree"
);
assert.equal(partialPlan.coverageCount, 3);
assert.equal(partialPlan.visualCount, 2);
assert.equal(partialPlan.totalCount, 5);
assert.equal(partialPlan.coverageRate, 3 / 5);

const topologyStars = [
  { id: "doc:left", kind: "document", x: -2, y: 0 },
  { id: "doc:top", kind: "document", x: 0, y: 2 },
  { id: "doc:right", kind: "document", x: 2, y: 0 },
  { id: "user", kind: "contributor", x: 0, y: 1.9 }
];
const topologyEdges = [
  { source: "doc:left", target: "doc:top", type: "strong" },
  { source: "doc:top", target: "doc:right", type: "strong" },
  { source: "user", target: "doc:left", type: "contribution" },
  { source: "user", target: "doc:top", type: "contribution" },
  { source: "user", target: "doc:right", type: "contribution" }
];
const topologyIds = new Set([
  "doc:left",
  "doc:top",
  "doc:right",
  "user"
]);
const topologyPlan = relationPlan(
  topologyStars,
  topologyEdges,
  topologyIds,
  "minimal_tree"
);
assert.equal(topologyPlan.visualCount, 3);
assert.equal(
  topologyPlan.visualEdges.filter(
    (edge) => edge.type === "contribution"
  ).length,
  1,
  "content topology must be preferred over contributor spokes"
);
assert.equal(
  topologyPlan.visualEdges.filter((edge) => edge.type === "strong").length,
  2
);
const singlePathPlan = relationPlan(
  topologyStars,
  topologyEdges,
  topologyIds,
  "single_path"
);
assert.equal(singlePathPlan.coverageCount, 5);
assert.equal(singlePathPlan.visualCount, 2);
assert.ok(
  singlePathPlan.visualEdges.every((edge) => {
    return singlePathPlan.coverageEdges.includes(edge);
  })
);

const low = brightnessPresentation(5, "document", false, 100);
const medium = brightnessPresentation(25, "document", false, 100);
const high = brightnessPresentation(90, "document", false, 100);
assert.ok(low.alpha < medium.alpha && medium.alpha < high.alpha);
assert.ok(low.radius < medium.radius && medium.radius < high.radius);
assert.ok(
  low.haloRadius < medium.haloRadius &&
    medium.haloRadius < high.haloRadius
);
assert.ok(high.luminous > medium.luminous * 3);
const selected = brightnessPresentation(
  25,
  "document",
  true,
  100,
  {
    radiusBoost: 1.4,
    alphaBoost: 0.2,
    haloAlphaBoost: 0.24,
    glowScale: 1.5
  }
);
assert.equal(selected.radius, medium.radius + 1.4);
assert.equal(selected.alpha, Math.min(1, medium.alpha + 0.2));
assert.equal(
  selected.haloAlpha,
  Math.min(0.5, medium.haloAlpha + 0.24)
);
assert.equal(selected.haloRadius, medium.haloRadius * 1.5);
const disabledSelectionBoost = brightnessPresentation(
  25,
  "document",
  true,
  100,
  {
    radiusBoost: 0,
    alphaBoost: 0,
    haloAlphaBoost: 0,
    glowScale: 1
  }
);
assert.equal(disabledSelectionBoost.radius, medium.radius);
assert.equal(disabledSelectionBoost.alpha, medium.alpha);
assert.equal(disabledSelectionBoost.haloAlpha, medium.haloAlpha);
assert.equal(disabledSelectionBoost.haloRadius, medium.haloRadius);
assert.ok(
  brightnessPresentation(25, "contributor", false, 100).radius >
    medium.radius
);
assert.equal(
  brightnessPresentation(140, "document", false, 100).brightness,
  100
);
assert.equal(
  brightnessPresentation(40, "document", false, 80).luminous,
  brightnessPresentation(50, "document", false, 100).luminous
);

console.log("Homepage star illumination checks passed");
