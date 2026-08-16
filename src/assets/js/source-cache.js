(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.GCKSource = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function (root) {
  "use strict";

  const cachePrefix = "gck-source:";
  const inFlight = new Map();

  function encodePath(path) {
    return String(path)
      .split("/")
      .map(function (part) {
        return encodeURIComponent(part);
      })
      .join("/");
  }

  function cacheKey(version, path) {
    return cachePrefix + encodeURIComponent(version) + ":" + path;
  }

  function storageFor(options) {
    if (options && options.storage) {
      return options.storage;
    }
    try {
      return root.sessionStorage;
    } catch {
      return null;
    }
  }

  function readCache(storage, key, path, expectedSha) {
    if (!storage) {
      return null;
    }
    try {
      const value = JSON.parse(storage.getItem(key));
      if (
        !value ||
        value.path !== path ||
        typeof value.content !== "string" ||
        typeof value.sha !== "string"
      ) {
        return null;
      }
      if (expectedSha && value.sha !== expectedSha) {
        storage.removeItem(key);
        return null;
      }
      return {
        path: value.path,
        content: value.content,
        sha: value.sha,
        sourceType: "session-cache"
      };
    } catch {
      return null;
    }
  }

  function writeCache(storage, key, value) {
    if (!storage) {
      return;
    }
    try {
      storage.setItem(
        key,
        JSON.stringify({
          path: value.path,
          content: value.content,
          sha: value.sha
        })
      );
    } catch {
      // Storage may be disabled or full; the network result remains usable.
    }
  }

  async function gitBlobSha(content, cryptoApi) {
    const cryptoValue = cryptoApi || root.crypto;
    if (!cryptoValue || !cryptoValue.subtle) {
      const error = new Error("当前浏览器不支持本地 Git SHA 演算");
      error.code = "SOURCE_HASH_UNAVAILABLE";
      throw error;
    }
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    const header = encoder.encode("blob " + bytes.length + "\0");
    const payload = new Uint8Array(header.length + bytes.length);
    payload.set(header);
    payload.set(bytes, header.length);
    const digest = await cryptoValue.subtle.digest("SHA-1", payload);
    return Array.from(new Uint8Array(digest))
      .map(function (byte) {
        return byte.toString(16).padStart(2, "0");
      })
      .join("");
  }

  function rawUrl(path, rawBase, version) {
    const base = (rawBase || "/raw/").replace(/\/?$/, "/");
    const separator = base.includes("?") ? "&" : "?";
    return (
      base +
      encodePath(path) +
      (version ? separator + "v=" + encodeURIComponent(version) : "")
    );
  }

  async function fetchSource(path, options, storage, key) {
    const fetchImpl = options.fetchImpl || root.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("当前环境无法读取静态源文件");
    }
    const response = await fetchImpl(
      rawUrl(path, options.rawBase, options.version),
      {
        credentials: "same-origin",
        cache: "force-cache"
      }
    );
    if (!response.ok) {
      const error = new Error("静态源文件不可用（HTTP " + response.status + "）");
      error.code = "SOURCE_FETCH_FAILED";
      throw error;
    }
    const content = await response.text();
    const sha = await gitBlobSha(content, options.crypto);
    if (options.expectedSha && sha !== options.expectedSha) {
      const error = new Error("静态源文件版本与仓库不一致");
      error.code = "SOURCE_SHA_MISMATCH";
      throw error;
    }
    const value = {
      path: path,
      content: content,
      sha: sha,
      sourceType: "static-raw"
    };
    writeCache(storage, key, value);
    return value;
  }

  async function load(path, options) {
    const settings = options || {};
    const version = settings.version || settings.expectedSha || "deployed";
    const storage = storageFor(settings);
    const key = cacheKey(version, path);
    const cached = readCache(storage, key, path, settings.expectedSha);
    if (cached) {
      return cached;
    }
    if (!inFlight.has(key)) {
      inFlight.set(
        key,
        fetchSource(path, { ...settings, version: version }, storage, key)
          .finally(function () {
            inFlight.delete(key);
          })
      );
    }
    return inFlight.get(key);
  }

  return {
    encodePath: encodePath,
    gitBlobSha: gitBlobSha,
    load: load,
    rawUrl: rawUrl
  };
});
