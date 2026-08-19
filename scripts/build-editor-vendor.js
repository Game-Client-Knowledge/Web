const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, ".cache", "vendor");
const mermaidOutput = path.join(outputDirectory, "mermaid");

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(mermaidOutput, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "toastui-entry.js")],
  outfile: path.join(outputDirectory, "toastui-editor.js"),
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  legalComments: "none"
});

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "diff-entry.js")],
  outfile: path.join(outputDirectory, "diff.js"),
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  legalComments: "none"
});

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "code-reader-vendor-entry.js")],
  outfile: path.join(outputDirectory, "code-reader-vendor.js"),
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  legalComments: "none"
});

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "star-formula-entry.js")],
  outfile: path.join(outputDirectory, "star-formula-engine.js"),
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  legalComments: "none"
});

esbuild.buildSync({
  entryPoints: [path.join(__dirname, "star3d-entry.js")],
  outfile: path.join(outputDirectory, "star3d-engine.js"),
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "GCK_STAR3D",
  platform: "browser",
  target: ["es2020"],
  legalComments: "none"
});

const commonMermaidModulePattern =
  /(?:flowDiagram|classDiagram|sequenceDiagram|stateDiagram|erDiagram|dagre-).*\.mjs$/;

async function buildMermaid() {
  await esbuild.build({
    entryPoints: [path.join(__dirname, "mermaid-entry.mjs")],
    outdir: path.join(mermaidOutput, "fallback"),
    bundle: true,
    splitting: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    entryNames: "mermaid-full",
    chunkNames: "chunks/[name]-[hash]",
    legalComments: "none"
  });

  await esbuild.build({
    entryPoints: [path.join(__dirname, "mermaid-entry.mjs")],
    outfile: path.join(mermaidOutput, "mermaid-common.js"),
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    legalComments: "none",
    plugins: [
      {
        name: "limit-common-mermaid-runtime",
        setup(build) {
          build.onResolve({ filter: /\.mjs$/ }, (args) => {
            if (
              args.kind !== "dynamic-import" ||
              commonMermaidModulePattern.test(args.path)
            ) {
              return;
            }
            return {
              path: `./fallback/unsupported/${path.basename(args.path)}`,
              external: true
            };
          });
        }
      }
    ]
  });

  esbuild.buildSync({
    entryPoints: [path.join(__dirname, "mermaid-bootstrap.mjs")],
    outfile: path.join(mermaidOutput, "mermaid-client.js"),
    bundle: false,
    minify: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    legalComments: "none"
  });
}

buildMermaid().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
