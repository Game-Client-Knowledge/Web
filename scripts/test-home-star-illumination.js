const assert = require("node:assert/strict");
const {
  brightnessPresentation,
  illuminate
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
  { source: "d:c", target: "u:one", type: "contribution" },
  { source: "u:one", target: "d:d", type: "contribution" },
  { source: "d:d", target: "d:e", type: "strong" },
  { source: "d:e", target: "u:two", type: "contribution" }
];

function values(rule, depth, startId = "d:a") {
  return Array.from(
    illuminate(stars, edges, startId, rule, depth)
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

const low = brightnessPresentation(2, "document", false);
const medium = brightnessPresentation(10, "document", false);
const high = brightnessPresentation(28, "document", false);
assert.ok(low.alpha < medium.alpha && medium.alpha < high.alpha);
assert.ok(low.radius < medium.radius && medium.radius < high.radius);
assert.ok(
  low.shadowBlur < medium.shadowBlur &&
    medium.shadowBlur < high.shadowBlur
);
assert.ok(high.luminous > medium.luminous * 3);
assert.ok(
  brightnessPresentation(10, "document", true).haloAlpha >
    medium.haloAlpha
);
assert.ok(
  brightnessPresentation(10, "contributor", false).radius >
    medium.radius
);

console.log("Homepage star illumination checks passed");
