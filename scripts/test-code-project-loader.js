const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadCodeProjects } = require("../lib/code-project-loader");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gck-code-project-"));

function write(relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

try {
  write(
    "code/demo/code-project.json",
    JSON.stringify({
      schemaVersion: 1,
      id: "demo-project",
      title: "Demo Project",
      description: "Processor fixture",
      language: "csharp",
      entry: "src/Program.cs",
      readme: "README.md",
      includeExtensions: [".cs", ".md", ".json"],
      exclude: ["generated"],
      readingOrder: ["src/World.cs", "src/Program.cs"]
    })
  );
  write("code/demo/README.md", "# Demo\n");
  write("code/demo/src/Program.cs", "World.Run();\n");
  write("code/demo/src/World.cs", "public class World {}\n");
  write("code/demo/obj/Generated.cs", "public class Hidden {}\n");
  write("code/demo/generated/Other.cs", "public class Other {}\n");
  write("code/demo/asset.png", "not source");

  const projects = loadCodeProjects(root);
  assert.equal(projects.length, 1);
  const project = projects[0];
  assert.equal(project.id, "demo-project");
  assert.equal(project.entry, "src/Program.cs");
  assert.equal(project.fileCount, 3);
  assert.equal(project.files[0].path, "src/World.cs");
  assert.equal(project.files[0].parser, "c_sharp");
  assert.equal(project.files[0].recommended, true);
  assert(
    project.files.every(
      (file) =>
        !file.path.startsWith("obj/") &&
        !file.path.startsWith("generated/")
    )
  );
  assert.equal(
    project.workspaceRoute,
    "/code/workspace/?project=demo-project"
  );

  write(
    "code/invalid/code-project.json",
    JSON.stringify({
      schemaVersion: 1,
      id: "Invalid ID",
      title: "Invalid",
      entry: "../outside.cs"
    })
  );
  assert.throws(
    () => loadCodeProjects(root),
    /id must be a lowercase kebab-case slug/
  );
  process.stdout.write("Code project processor checks passed\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
