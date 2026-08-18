const assert = require("node:assert/strict");
const {
  buildHomeStarGraph,
  markdownReferences,
  normalizeSourceTarget
} = require("../lib/home-star-graph");

function fixtureCatalog() {
  return {
    repository: { commit: "abc1234" },
    sourceRoutes: {
      "program/README.md": "/program/",
      "program/knowledge/README.md": "/program/knowledge/",
      "program/knowledge/root/README.md": "/program/knowledge/root/",
      "program/knowledge/root/01-a.md": "/program/knowledge/root/01-a/",
      "program/knowledge/root/02-b.md": "/program/knowledge/root/02-b/",
      "program/knowledge/root/child/README.md":
        "/program/knowledge/root/child/",
      "program/knowledge/root/child/01-c.md":
        "/program/knowledge/root/child/01-c/"
    },
    tracks: [
      {
        key: "program",
        sourceRelative: "program/README.md",
        title: "Program",
        route: "/program/",
        body: ""
      }
    ],
    modules: [
      {
        key: "program/knowledge",
        trackKey: "program",
        sourceRelative: "program/knowledge/README.md",
        title: "Knowledge",
        route: "/program/knowledge/",
        body: ""
      }
    ],
    documents: [
      {
        kind: "markdown",
        trackKey: "program",
        moduleKey: "program/knowledge",
        sourceRelative: "program/knowledge/root/README.md",
        sourceDirectory: "program/knowledge/root",
        title: "Root",
        route: "/program/knowledge/root/",
        body: ""
      },
      {
        kind: "markdown",
        trackKey: "program",
        moduleKey: "program/knowledge",
        sourceRelative: "program/knowledge/root/01-a.md",
        sourceDirectory: "program/knowledge/root",
        title: "A",
        route: "/program/knowledge/root/01-a/",
        body: "[B](./02-b.md) and [C](./child/01-c.md)"
      },
      {
        kind: "markdown",
        trackKey: "program",
        moduleKey: "program/knowledge",
        sourceRelative: "program/knowledge/root/02-b.md",
        sourceDirectory: "program/knowledge/root",
        title: "B",
        route: "/program/knowledge/root/02-b/",
        body: ""
      },
      {
        kind: "markdown",
        trackKey: "program",
        moduleKey: "program/knowledge",
        sourceRelative: "program/knowledge/root/child/README.md",
        sourceDirectory: "program/knowledge/root/child",
        title: "Child",
        route: "/program/knowledge/root/child/",
        body: ""
      },
      {
        kind: "markdown",
        trackKey: "program",
        moduleKey: "program/knowledge",
        sourceRelative: "program/knowledge/root/child/01-c.md",
        sourceDirectory: "program/knowledge/root/child",
        title: "C",
        route: "/program/knowledge/root/child/01-c/",
        body: ""
      },
      {
        kind: "code",
        trackKey: "program",
        moduleKey: "program/knowledge",
        sourceRelative: "program/knowledge/root/example.cpp",
        sourceDirectory: "program/knowledge/root",
        title: "example.cpp",
        route: "/program/knowledge/root/files/example.cpp/",
        source: "int main() {}"
      },
      {
        kind: "code",
        trackKey: "program",
        moduleKey: "program/knowledge",
        sourceRelative: "program/knowledge/root/obj/generated.cpp",
        sourceDirectory: "program/knowledge/root/obj",
        title: "generated.cpp",
        route: "/program/knowledge/root/obj/files/generated.cpp/",
        source: "generated"
      }
    ],
    contentStatistics: {
      generatedAt: "2026-08-18T00:00:00Z",
      scopes: [
        {
          key: "all",
          contributors: [
            {
              id: "alice",
              name: "Alice",
              added: 20,
              modified: 4,
              deleted: 1,
              commitCount: 2,
              lastContributedAt: "2026-08-18T00:00:00Z"
            }
          ]
        }
      ],
      documentContributions: [
        {
          path: "program/knowledge/root/01-a.md",
          contributorId: "alice",
          contributorName: "Alice",
          commitCount: 2,
          lastContributedAt: "2026-08-18T00:00:00Z"
        }
      ]
    }
  };
}

const catalog = fixtureCatalog();
assert.equal(
  normalizeSourceTarget(
    "program/knowledge/root/01-a.md",
    "./02-b.md",
    catalog.sourceRoutes
  ),
  "program/knowledge/root/02-b.md"
);
assert.deepEqual(
  markdownReferences(
    "program/knowledge/root/01-a.md",
    "[B](./02-b.md) and [C](./child/01-c.md)",
    catalog.sourceRoutes
  ),
  [
    "program/knowledge/root/02-b.md",
    "program/knowledge/root/child/01-c.md"
  ]
);

const graph = buildHomeStarGraph(catalog);
const strongEdges = graph.edges.filter((edge) => edge.type === "strong");
const referenceEdges = graph.edges.filter(
  (edge) => edge.type === "reference"
);
const contributionEdges = graph.edges.filter(
  (edge) => edge.type === "contribution"
);

assert.equal(graph.revision, "abc1234");
assert.equal(
  graph.stars.filter((star) => star.kind === "contributor").length,
  1
);
assert.equal(
  graph.stars.filter((star) => star.kind === "document").length,
  8
);
assert.ok(
  graph.stars.some((star) => {
    return (
      star.kind === "document" &&
      star.sourcePath === "program/knowledge/root/example.cpp"
    );
  }),
  "readable source files must receive document stars"
);
assert.ok(
  !graph.stars.some((star) => {
    return star.sourcePath?.includes("/obj/");
  }),
  "generated build directories must not receive document stars"
);
assert.ok(
  strongEdges.some((edge) => {
    return (
      edge.source.includes("root/01-a.md") &&
      edge.target.includes("root/02-b.md")
    );
  }),
  "documents in the same smallest directory must have a strong edge"
);
assert.ok(
  !strongEdges.some((edge) => {
    return (
      edge.source.includes("root/01-a.md") &&
      edge.target.includes("root/child/01-c.md")
    );
  }),
  "parent and child topic documents must not share a strong edge"
);
assert.equal(referenceEdges.length, 2);
assert.deepEqual(contributionEdges, [
  {
    type: "contribution",
    source: "contributor:alice",
    target: "document:program/knowledge/root/01-a.md",
    commitCount: 2,
    lastContributedAt: "2026-08-18T00:00:00Z"
  }
]);

console.log("Homepage star graph checks passed");
