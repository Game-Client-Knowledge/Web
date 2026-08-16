const assert = require("node:assert/strict");
const {
  AUTO_SYNC_MS,
  read,
  remove,
  storageKey,
  write
} = require("../src/assets/js/editor-buffer.js");

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    values
  };
}

const storage = memoryStorage();
const path = "knowledge/cpp/01-cpp98.md";
const saved = write(storage, 7, path, {
  content: "# C++\n",
  baseSha: "abc123",
  serverRevision: 3,
  updatedAt: 1000
});

assert.equal(AUTO_SYNC_MS, 30000);
assert.equal(saved.content, "# C++\n");
assert.deepEqual(read(storage, 7, path), saved);
assert.equal(read(storage, 8, path), null, "buffers must be user-scoped");
assert.equal(
  read(storage, 7, "knowledge/cpp/02-cpp11.md"),
  null,
  "buffers must be path-scoped"
);
assert.notEqual(
  storageKey(7, "knowledge/a:b.md"),
  storageKey(7, "knowledge/a/b.md"),
  "encoded paths must not collide"
);

storage.setItem(storageKey(7, path), "{not-json");
assert.equal(read(storage, 7, path), null, "invalid buffers must be discarded");
assert.equal(storage.getItem(storageKey(7, path)), null);

write(storage, 7, path, {
  content: "pending",
  baseSha: null,
  serverRevision: 0
});
assert.equal(remove(storage, 7, path), true);
assert.equal(read(storage, 7, path), null);

process.stdout.write("Reader editor buffer checks passed\n");
