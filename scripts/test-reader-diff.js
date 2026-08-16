const assert = require("node:assert/strict");

global.JsDiff = require("diff");
const { buildLineDiff } = require("../src/assets/js/reader-diff.js");

const rows = buildLineDiff(
  "# Title\n\nsame\nold line\nremove only\n",
  "# Title\n\nsame\nnew line\nadded only\n"
);

assert.deepEqual(
  rows.map((row) => row.type),
  [
    "context",
    "context",
    "context",
    "deleted",
    "deleted",
    "modified",
    "modified"
  ]
);
assert.deepEqual(
  rows.slice(3).map((row) => row.marker),
  ["-", "-", "~", "~"]
);
assert.equal(rows[3].oldNumber, 4);
assert.equal(rows[5].newNumber, 4);

const addition = buildLineDiff("one\n", "one\ntwo\n");
assert.equal(addition.at(-1).type, "added");
assert.equal(addition.at(-1).marker, "+");
assert.equal(addition.at(-1).newNumber, 2);

const deletion = buildLineDiff("one\ntwo\n", "one\n");
assert.equal(deletion.at(-1).type, "deleted");
assert.equal(deletion.at(-1).oldNumber, 2);

process.stdout.write("Reader line diff checks passed\n");
