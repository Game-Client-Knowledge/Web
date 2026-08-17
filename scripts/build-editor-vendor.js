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
  entryPoints: [path.join(__dirname, "mermaid-entry.mjs")],
  outdir: mermaidOutput,
  bundle: true,
  splitting: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  entryNames: "mermaid-client",
  chunkNames: "chunks/[name]-[hash]",
  legalComments: "none"
});
