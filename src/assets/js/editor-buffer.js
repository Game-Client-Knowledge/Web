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
        ![1, 2, 3].includes(value.version) ||
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
      version: 3,
      userId: String(userId),
      path,
      content: value.content,
      baseSha: value.baseSha || null,
      baseContent:
        typeof value.baseContent === "string" ? value.baseContent : null,
      syncBaseContent:
        typeof value.syncBaseContent === "string"
          ? value.syncBaseContent
          : (
              typeof value.baseContent === "string"
                ? value.baseContent
                : null
            ),
      operation: value.operation === "delete" ? "delete" : "upsert",
      serverRevision: Number(value.serverRevision) || 0,
      conflict: Boolean(value.conflict),
      lineDiff: Array.isArray(value.lineDiff)
        ? value.lineDiff.map(function (row) {
            return {
              type: row.type,
              marker: row.marker,
              oldNumber: row.oldNumber ?? null,
              newNumber: row.newNumber ?? null,
              text: String(row.text || " ")
            };
          })
        : [],
      diffSummary: value.diffSummary &&
        typeof value.diffSummary === "object"
        ? {
            added: Number(value.diffSummary.added) || 0,
            modified: Number(value.diffSummary.modified) || 0,
            deleted: Number(value.diffSummary.deleted) || 0
          }
        : { added: 0, modified: 0, deleted: 0 },
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

  function list(storage, userId) {
    const prefix =
      PREFIX + encodeURIComponent(String(userId)) + ":";
    const values = [];
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !key.startsWith(prefix)) continue;
        const path = decodeURIComponent(key.slice(prefix.length));
        const value = read(storage, userId, path);
        if (value) values.push(value);
      }
    } catch {
      return [];
    }
    return values.sort(function (left, right) {
      return right.updatedAt - left.updatedAt;
    });
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
    list,
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
