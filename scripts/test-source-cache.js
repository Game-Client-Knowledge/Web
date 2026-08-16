const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");

const {
  gitBlobSha,
  load,
  rawUrl
} = require("../src/assets/js/source-cache.js");

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

async function run() {
  const content = "hello\n";
  const expectedSha = "ce013625030ba8dba906f756967f9e9ca394464a";

  assert.equal(
    await gitBlobSha(content, webcrypto),
    expectedSha,
    "browser SHA calculation must match Git's blob object ID"
  );
  assert.equal(
    rawUrl("knowledge/C++ 入门.md", "/raw/", "commit 1"),
    "/raw/knowledge/C%2B%2B%20%E5%85%A5%E9%97%A8.md?v=commit%201",
    "raw source URLs must encode each path segment"
  );

  const storage = new MemoryStorage();
  let fetchCount = 0;
  const fetchImpl = async function () {
    fetchCount += 1;
    return {
      ok: true,
      status: 200,
      text: async function () {
        return content;
      }
    };
  };
  const options = {
    version: "content-commit",
    expectedSha,
    storage,
    crypto: webcrypto,
    fetchImpl
  };

  const first = await load("knowledge/example.md", options);
  assert.equal(first.sourceType, "static-raw");
  assert.equal(first.sha, expectedSha);
  assert.equal(fetchCount, 1);

  const second = await load("knowledge/example.md", options);
  assert.equal(second.sourceType, "session-cache");
  assert.equal(second.content, content);
  assert.equal(fetchCount, 1, "a cache hit must not issue another fetch");

  await assert.rejects(
    load("knowledge/example.md", {
      ...options,
      version: "different-commit",
      expectedSha: "0000000000000000000000000000000000000000"
    }),
    function (error) {
      return error.code === "SOURCE_SHA_MISMATCH";
    },
    "a static source with a different Git blob SHA must be rejected"
  );

  process.stdout.write("Source cache checks passed\n");
}

run().catch(function (error) {
  process.stderr.write(error.stack + "\n");
  process.exitCode = 1;
});
