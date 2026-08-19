const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const site = fs.readFileSync(
  path.join(root, "src/assets/js/site.js"),
  "utf8"
);
const loader = site.match(
  /function setupReaderComments\(\) \{[\s\S]*?\n  \}/
)?.[0];

assert.ok(loader, "reader comments loader is missing");
assert.match(
  loader,
  /GCK_CONFIG\.assetVersion/,
  "reader comments must be versioned by the Web asset revision"
);
assert.doesNotMatch(
  loader,
  /GCK_CONFIG\.contentVersion/,
  "content revisions cannot invalidate changed Web assets"
);
assert.match(
  loader,
  /reader-comments\.js\?v=/,
  "reader comments must use a versioned URL"
);

process.stdout.write("Reader comments asset checks passed\n");
