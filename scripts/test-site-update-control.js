const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8")
);
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
const failureNotifier = fs.readFileSync(
  path.join(
    root,
    "editor/app/site_update_notifications.py"
  ),
  "utf8"
);

assert.match(updater, /site_auto_update_interval_minutes/);
assert.match(updater, /UPDATE_REQUEST_FILE/);
assert.match(updater, /write_status "building"/);
assert.match(updater, /npm ci \\\n  --include=dev/);
assert.match(updater, /exec > >\(tee -a "\$run_log_file"\) 2>&1/);
assert.match(updater, /update_stage="audit-and-build"/);
assert.match(updater, /-m app\.site_update_notifications/);
assert.match(updater, /FAILURE_NOTIFICATION_STATE_FILE/);
assert.match(updater, /SNAPSHOT_CACHE_ROOT/);
assert.match(updater, /falling back to git/);
assert.equal(manifest.dependencies["playwright-core"], "1.62.1");
assert.equal(manifest.devDependencies?.["playwright-core"], undefined);
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
assert.match(failureNotifier, /site_update_failed/);
assert.match(failureNotifier, /previous\.get\("status"\) == "sent"/);

process.stdout.write("Site update control checks passed\n");
