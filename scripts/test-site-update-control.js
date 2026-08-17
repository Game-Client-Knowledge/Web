const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const updater = fs.readFileSync(
  path.join(root, "deploy/server/update-site.sh"),
  "utf8"
);
const timer = fs.readFileSync(
  path.join(
    root,
    "deploy/server/game-client-knowledge-update.timer"
  ),
  "utf8"
);
const trigger = fs.readFileSync(
  path.join(
    root,
    "deploy/server/game-client-knowledge-update.path"
  ),
  "utf8"
);

assert.match(updater, /site_auto_update_interval_minutes/);
assert.match(updater, /UPDATE_REQUEST_FILE/);
assert.match(updater, /write_status "building"/);
assert.match(updater, /npm ci \\\n  --include=dev/);
assert.doesNotMatch(
  updater,
  /npm ci[\s\\]*--omit=dev/,
  "the remote Mermaid build requires playwright-core"
);
assert.match(timer, /OnUnitActiveSec=1min/);
assert.match(
  trigger,
  /PathExists=\/var\/lib\/game-client-knowledge-editor\/site-update\.request/
);

process.stdout.write("Site update control checks passed\n");
