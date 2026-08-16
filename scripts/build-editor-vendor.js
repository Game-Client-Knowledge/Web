const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, ".cache", "vendor");

fs.mkdirSync(outputDirectory, { recursive: true });

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
