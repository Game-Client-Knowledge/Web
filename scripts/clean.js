const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.resolve(projectRoot, "_site");

if (path.dirname(outputDirectory) !== projectRoot || path.basename(outputDirectory) !== "_site") {
  throw new Error(`Refusing to clean unexpected path: ${outputDirectory}`);
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
