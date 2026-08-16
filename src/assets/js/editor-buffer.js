(function (root) {
  "use strict";

  const PREFIX = "gck-reader-buffer:v1:";
  const AUTO_SYNC_MS = 30000;

  function storageKey(userId, path) {
    return (
      PREFIX +
      encodeURIComponent(String(userId)) +
      ":" +
      encodeURIComponent(path)
    );
  }

  function read(storage, userId, path) {
    const key = storageKey(userId, path);
    try {
      const value = JSON.parse(storage.getItem(key));
      if (
        !value ||
        value.version !== 1 ||
        String(value.userId) !== String(userId) ||
        value.path !== path ||
        typeof value.content !== "string" ||
        !Number.isFinite(value.updatedAt)
      ) {
        storage.removeItem(key);
        return null;
      }
      return value;
    } catch {
      try {
        storage.removeItem(key);
      } catch {
        // Storage can be unavailable in hardened browsing contexts.
      }
      return null;
    }
  }

  function write(storage, userId, path, value) {
    const payload = {
      version: 1,
      userId: String(userId),
      path,
      content: value.content,
      baseSha: value.baseSha || null,
      serverRevision: Number(value.serverRevision) || 0,
      updatedAt: value.updatedAt || Date.now()
    };
    try {
      storage.setItem(
        storageKey(userId, path),
        JSON.stringify(payload)
      );
      return payload;
    } catch {
      return null;
    }
  }

  function remove(storage, userId, path) {
    try {
      storage.removeItem(storageKey(userId, path));
      return true;
    } catch {
      return false;
    }
  }

  const api = {
    AUTO_SYNC_MS,
    PREFIX,
    read,
    remove,
    storageKey,
    write
  };
  root.GCKEditorBuffer = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
