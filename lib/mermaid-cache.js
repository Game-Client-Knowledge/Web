const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CACHE_VERSION = 1;
const cachePath = path.resolve(
  __dirname,
  "..",
  ".cache",
  "mermaid-rendered.json"
);

function normalizeMermaidSource(source) {
  return String(source || "").replace(/\r\n?/g, "\n");
}

function createMermaidCacheKey(sourceRelative, index, source) {
  return crypto
    .createHash("sha256")
    .update(String(sourceRelative || "").split(path.sep).join("/"))
    .update("\0")
    .update(String(index))
    .update("\0")
    .update(normalizeMermaidSource(source))
    .digest("hex");
}

function loadMermaidCache() {
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (cache.version === CACHE_VERSION && cache.diagrams) {
      return cache;
    }
  } catch {
    // A missing cache keeps local watch mode on the client rendering fallback.
  }
  return {
    version: CACHE_VERSION,
    diagrams: {}
  };
}

module.exports = {
  CACHE_VERSION,
  cachePath,
  createMermaidCacheKey,
  loadMermaidCache,
  normalizeMermaidSource
};
