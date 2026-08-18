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
        "/program/knowledge/root/child/01-c/",
      "program/code/README.md": "/program/code/",
      "program/code/project-convention.md":
        "/program/code/project-convention/",
      "program/code/ecs/README.md": "/program/code/ecs/",
      "program/code/ecs/combat/README.md":
        "/program/code/ecs/combat/",
      "program/code/ecs/combat/Main.cs":
        "/program/code/ecs/combat/files/Main.cs/",
      "program/code/rendering/README.md":
        "/program/code/rendering/",
      "program/code/rendering/Renderer.cpp":
        "/program/code/rendering/files/Renderer.cpp/"
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
      },
      {
        key: "program/code",
        trackKey: "program",
        sourceRelative: "program/code/README.md",
        title: "Code",
        route: "/program/code/",
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
        body: "[A](./01-a.md)"
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
      },
      {
        kind: "markdown",
        trackKey: "program",
        moduleKey: "program/code",
        sourceRelative: "program/code/project-convention.md",
        sourceDirectory: "program/code",
        title: "Project convention",
        route: "/program/code/project-convention/",
        body: ""
      },
      {
        kind: "markdown",
        trackKey: "program",
        moduleKey: "program/code",
        sourceRelative: "program/code/ecs/README.md",
        sourceDirectory: "program/code/ecs",
        title: "ECS system",
        route: "/program/code/ecs/",
        body: "[Knowledge](../../knowledge/root/01-a.md)"
      },
      {
        kind: "markdown",
        trackKey: "program",
        moduleKey: "program/code",
        sourceRelative: "program/code/ecs/combat/README.md",
        sourceDirectory: "program/code/ecs/combat",
        title: "Combat implementation",
        route: "/program/code/ecs/combat/",
        body:
          "[System](../README.md) and " +
          "[Knowledge](../../../knowledge/root/01-a.md)"
      },
      {
        kind: "code",
        trackKey: "program",
        moduleKey: "program/code",
        sourceRelative: "program/code/ecs/combat/Main.cs",
        sourceDirectory: "program/code/ecs/combat",
        title: "Main.cs",
        route: "/program/code/ecs/combat/files/Main.cs/",
        source: "public class Main {}"
      },
      {
        kind: "code",
        trackKey: "program",
        moduleKey: "program/code",
        sourceRelative: "program/code/ecs/combat/obj/generated.cs",
        sourceDirectory: "program/code/ecs/combat/obj",
        title: "generated.cs",
        route: "/program/code/ecs/combat/obj/files/generated.cs/",
        source: "generated"
      },
      {
        kind: "markdown",
        trackKey: "program",
        moduleKey: "program/code",
        sourceRelative: "program/code/rendering/README.md",
        sourceDirectory: "program/code/rendering",
        title: "Rendering system",
        route: "/program/code/rendering/",
        body: ""
      },
      {
        kind: "code",
        trackKey: "program",
        moduleKey: "program/code",
        sourceRelative: "program/code/rendering/Renderer.cpp",
        sourceDirectory: "program/code/rendering",
        title: "Renderer.cpp",
        route: "/program/code/rendering/files/Renderer.cpp/",
        source: "void render() {}"
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
        },
        {
          path: "program/code/ecs/combat/Main.cs",
          contributorId: "alice",
          contributorName: "Alice",
          commitCount: 2,
          lastContributedAt: "2026-08-17T00:00:00Z"
        },
        {
          path: "program/code/ecs/combat/project.csproj",
          contributorId: "alice",
          contributorName: "Alice",
          commitCount: 3,
          lastContributedAt: "2026-08-18T01:00:00Z"
        },
        {
          path: "program/code/ecs/combat/obj/generated.cs",
          contributorId: "alice",
          contributorName: "Alice",
          commitCount: 9,
          lastContributedAt: "2026-08-18T02:00:00Z"
        },
        {
          path: "program/code/rendering/Renderer.cpp",
          contributorId: "alice",
          contributorName: "Alice",
          commitCount: 1,
          lastContributedAt: "2026-08-16T00:00:00Z"
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

assert.equal(graph.version, 3);
assert.equal(graph.revision, "abc1234");
assert.equal(
  graph.stars.filter((star) => star.kind === "contributor").length,
  1
);
assert.equal(
  graph.stars.filter((star) => star.kind === "document").length,
  12
);
assert.ok(
  graph.stars.some((star) => {
    return (
      star.kind === "document" &&
      star.sourcePath === "program/knowledge/root/example.cpp"
    );
  }),
  "source files outside the code module must remain document stars"
);
const codeSystemStars = graph.stars.filter(
  (star) => star.resourceKind === "code_system"
);
assert.deepEqual(
  codeSystemStars.map((star) => star.systemPath).sort(),
  ["program/code/ecs", "program/code/rendering"]
);
const ecsStar = codeSystemStars.find(
  (star) => star.systemPath === "program/code/ecs"
);
assert.equal(ecsStar.title, "ECS system");
assert.equal(ecsStar.route, "/program/code/ecs/");
assert.ok(
  ecsStar.sourcePaths.includes("program/code/ecs/combat/Main.cs")
);
assert.ok(
  !ecsStar.sourcePaths.some((sourcePath) => sourcePath.includes("/obj/"))
);
assert.ok(
  !graph.stars.some((star) => {
    return star.sourcePath === "program/code/ecs/combat/Main.cs";
  }),
  "code-system members must not receive separate stars"
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
assert.ok(
  strongEdges.some((edge) => {
    return (
      edge.source === "document:program/code/ecs/README.md" &&
      edge.target === "document:program/code/rendering/README.md"
    ) || (
      edge.target === "document:program/code/ecs/README.md" &&
      edge.source === "document:program/code/rendering/README.md"
    );
  }),
  "systems under the code module must share their parent cluster"
);
assert.equal(referenceEdges.length, 4);
assert.ok(
  referenceEdges.some((edge) => {
    return (
      edge.source === "document:program/knowledge/root/02-b.md" &&
      edge.target === "document:program/knowledge/root/01-a.md"
    );
  }),
  "opposite reference directions must remain distinct"
);
assert.ok(
  referenceEdges.some((edge) => {
    return (
      edge.source === "document:program/code/ecs/README.md" &&
      edge.target === "document:program/knowledge/root/01-a.md"
    ) || (
      edge.target === "document:program/code/ecs/README.md" &&
      edge.source === "document:program/knowledge/root/01-a.md"
    );
  }),
  "references from system members must belong to the system star"
);
assert.deepEqual(contributionEdges, [
  {
    type: "contribution",
    source: "contributor:alice",
    target: "document:program/knowledge/root/01-a.md",
    commitCount: 2,
    lastContributedAt: "2026-08-18T00:00:00Z"
  },
  {
    type: "contribution",
    source: "contributor:alice",
    target: "document:program/code/ecs/README.md",
    commitCount: 5,
    lastContributedAt: "2026-08-18T01:00:00Z"
  },
  {
    type: "contribution",
    source: "contributor:alice",
    target: "document:program/code/rendering/README.md",
    commitCount: 1,
    lastContributedAt: "2026-08-16T00:00:00Z"
  }
]);
assert.equal(ecsStar.metrics.contributorCount, 1);
assert.equal(
  ecsStar.metrics.lastContributedAt,
  "2026-08-18T01:00:00Z"
);

console.log("Homepage star graph checks passed");
