(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.GCKWorkspaceStore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const BASE_PREFIX = "gck-workspace-base:v1:";
  const CURRENT_PREFIX = "gck-workspace-current:v1:";
  const METADATA_FIELDS = [
    "title",
    "description",
    "kind",
    "route",
    "moduleKey",
    "trackKey",
    "moduleSlug",
    "sourceDirectory",
    "order",
    "isReadme"
  ];

  function key(prefix, userId, repository) {
    return (
      prefix +
      encodeURIComponent(String(userId)) +
      ":" +
      encodeURIComponent(String(repository || "content"))
    );
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function normalizeEntry(entry) {
    const hasBaseSha = Object.prototype.hasOwnProperty.call(
      entry,
      "baseSha"
    );
    return {
      path: String(entry.path || ""),
      sha: entry.sha || entry.baseSha || null,
      baseSha: hasBaseSha ? entry.baseSha : entry.sha || null,
      baseContent:
        typeof entry.baseContent === "string"
          ? entry.baseContent
          : null,
      size: Number(entry.size) || 0,
      kind: entry.kind || (
        String(entry.path || "").toLowerCase().endsWith(".md")
          ? "markdown"
          : "code"
      ),
      title: entry.title || String(entry.path || "").split("/").pop() || "",
      description: entry.description || "",
      route: entry.route || "",
      moduleKey: entry.moduleKey || "",
      trackKey: entry.trackKey || "",
      moduleSlug: entry.moduleSlug || "",
      sourceDirectory: entry.sourceDirectory || "",
      order: Number.isFinite(Number(entry.order))
        ? Number(entry.order)
        : 1000,
      isReadme: Boolean(entry.isReadme),
      content:
        typeof entry.content === "string"
          ? entry.content
          : null,
      operation: entry.operation || "base",
      conflict: Boolean(entry.conflict),
      lineDiff: Array.isArray(entry.lineDiff)
        ? clone(entry.lineDiff)
        : [],
      diffSummary: entry.diffSummary &&
        typeof entry.diffSummary === "object"
        ? clone(entry.diffSummary)
        : { added: 0, modified: 0, deleted: 0 },
      updatedAt: Number(entry.updatedAt) || 0
    };
  }

  function applyEntryMetadata(entry, metadata) {
    if (!metadata) return entry;
    const merged = { ...entry };
    for (const field of METADATA_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(metadata, field)) {
        merged[field] = clone(metadata[field]);
      }
    }
    return merged;
  }

  function read(storage, storageKey) {
    try {
      const value = JSON.parse(storage.getItem(storageKey) || "null");
      if (
        !value ||
        value.version !== 1 ||
        !Array.isArray(value.entries)
      ) {
        return null;
      }
      return {
        ...value,
        entries: value.entries.map(normalizeEntry)
      };
    } catch {
      return null;
    }
  }

  function write(storage, storageKey, snapshot) {
    const payload = {
      version: 1,
      revision: snapshot.revision || "local",
      updatedAt: Number(snapshot.updatedAt) || Date.now(),
      entries: (snapshot.entries || []).map(normalizeEntry)
    };
    try {
      storage.setItem(storageKey, JSON.stringify(payload));
      return payload;
    } catch {
      return null;
    }
  }

  function readBase(storage, userId, repository) {
    return read(storage, key(BASE_PREFIX, userId, repository));
  }

  function readCurrent(storage, userId, repository) {
    return read(storage, key(CURRENT_PREFIX, userId, repository));
  }

  function entryMap(entries) {
    return new Map(
      (entries || [])
        .map(normalizeEntry)
        .filter((entry) => entry.path)
        .map((entry) => [entry.path, entry])
    );
  }

  function deriveChanges(base, current) {
    const baseEntries = entryMap(base?.entries);
    const currentEntries = entryMap(current?.entries);
    const paths = new Set([
      ...baseEntries.keys(),
      ...currentEntries.keys()
    ]);
    const changes = [];
    paths.forEach((path) => {
      const baseEntry = baseEntries.get(path);
      const currentEntry = currentEntries.get(path);
      if (!currentEntry) return;
      if (currentEntry.operation === "delete") {
        if (baseEntry) {
          changes.push({
            ...clone(currentEntry),
            path,
            status: "D",
            operation: "delete",
            baseSha: baseEntry.sha,
            baseContent: baseEntry.content
          });
        }
        return;
      }
      if (!baseEntry) {
        changes.push({
          ...clone(currentEntry),
          path,
          status: currentEntry.baseSha ? "M" : "A",
          operation: "upsert",
          baseSha: currentEntry.baseSha || null,
          baseContent:
            typeof currentEntry.baseContent === "string"
              ? currentEntry.baseContent
              : ""
        });
        return;
      }
      if (
        currentEntry.operation === "upsert" ||
        (
          typeof currentEntry.content === "string" &&
          typeof baseEntry.content === "string" &&
          currentEntry.content !== baseEntry.content
        )
      ) {
        changes.push({
          ...clone(currentEntry),
          path,
          status: "M",
          operation: "upsert",
          baseSha: currentEntry.baseSha || baseEntry.sha,
          baseContent:
            typeof currentEntry.baseContent === "string"
              ? currentEntry.baseContent
              : baseEntry.content
        });
      }
    });
    return changes.sort((left, right) =>
      Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
    );
  }

  function overlayChanges(baseEntries, changes) {
    const entries = entryMap(baseEntries);
    for (const change of changes || []) {
      const base = entries.get(change.path);
      if (change.operation === "delete") {
        if (base) {
          entries.set(change.path, {
            ...base,
            ...clone(change),
            operation: "delete"
          });
        }
        continue;
      }
      entries.set(change.path, normalizeEntry({
        ...(base || {}),
        ...clone(change),
        sha: (base && base.sha) || null,
        baseSha: Object.prototype.hasOwnProperty.call(
          change,
          "baseSha"
        )
          ? change.baseSha
          : (base && base.sha) || null,
        operation: "upsert"
      }));
    }
    return Array.from(entries.values()).sort((left, right) =>
      left.path.localeCompare(right.path, "zh-CN", { numeric: true })
    );
  }

  function syncBase(
    storage,
    userId,
    repository,
    revision,
    remoteEntries
  ) {
    const oldBase = readBase(storage, userId, repository);
    const oldCurrent = readCurrent(storage, userId, repository);
    const changes = deriveChanges(oldBase, oldCurrent);
    const oldBaseByPath = entryMap(oldBase?.entries);
    const hydrated = (remoteEntries || []).map((entry) => {
      const remote = normalizeEntry(entry);
      const previous = oldBaseByPath.get(remote.path);
      const normalized = applyEntryMetadata(remote, previous);
      return {
        ...normalized,
        content:
          previous && previous.sha === normalized.sha
            ? previous.content
            : normalized.content
      };
    });
    const base = write(
      storage,
      key(BASE_PREFIX, userId, repository),
      {
        revision,
        updatedAt: Date.now(),
        entries: hydrated
      }
    );
    if (!base) return null;
    const current = write(
      storage,
      key(CURRENT_PREFIX, userId, repository),
      {
        revision,
        updatedAt: Date.now(),
        entries: overlayChanges(base.entries, changes)
      }
    );
    return { base, current, changes: deriveChanges(base, current) };
  }

  function ensure(
    storage,
    userId,
    repository,
    revision,
    entries
  ) {
    const base = readBase(storage, userId, repository);
    const current = readCurrent(storage, userId, repository);
    if (!base || !current) {
      return syncBase(
        storage,
        userId,
        repository,
        revision,
        entries
      );
    }
    const changes = deriveChanges(base, current);
    const metadataByPath = entryMap(entries);
    const repairedBase = write(
      storage,
      key(BASE_PREFIX, userId, repository),
      {
        ...base,
        entries: base.entries.map((entry) => {
          return applyEntryMetadata(
            entry,
            metadataByPath.get(entry.path)
          );
        })
      }
    );
    const repairedCurrent = write(
      storage,
      key(CURRENT_PREFIX, userId, repository),
      {
        ...current,
        entries: overlayChanges(repairedBase.entries, changes)
      }
    );
    return {
      base: repairedBase,
      current: repairedCurrent,
      changes: deriveChanges(repairedBase, repairedCurrent)
    };
  }

  function hydrateBaseFile(
    storage,
    userId,
    repository,
    path,
    sha,
    content
  ) {
    const base = readBase(storage, userId, repository);
    const current = readCurrent(storage, userId, repository);
    if (!base || !current) return null;
    const baseEntries = entryMap(base.entries);
    const baseEntry = baseEntries.get(path);
    if (!baseEntry || (sha && baseEntry.sha && baseEntry.sha !== sha)) {
      return null;
    }
    baseEntry.content = content;
    if (sha) baseEntry.sha = sha;
    base.entries = Array.from(baseEntries.values());
    const changes = deriveChanges(
      readBase(storage, userId, repository),
      current
    );
    const savedBase = write(
      storage,
      key(BASE_PREFIX, userId, repository),
      base
    );
    const savedCurrent = write(
      storage,
      key(CURRENT_PREFIX, userId, repository),
      {
        ...current,
        entries: overlayChanges(savedBase.entries, changes)
      }
    );
    return { base: savedBase, current: savedCurrent };
  }

  function applyChange(
    storage,
    userId,
    repository,
    change
  ) {
    const base = readBase(storage, userId, repository);
    const current = readCurrent(storage, userId, repository);
    if (!base || !current) return null;
    const entries = entryMap(current.entries);
    const baseEntry = entryMap(base.entries).get(change.path);
    if (change.operation === "delete") {
      if (!baseEntry) {
        entries.delete(change.path);
      } else {
        entries.set(change.path, normalizeEntry({
          ...baseEntry,
          ...change,
          baseSha: baseEntry.sha,
          baseContent: baseEntry.content,
          operation: "delete",
          updatedAt: change.updatedAt || Date.now()
        }));
      }
    } else {
      entries.set(change.path, normalizeEntry({
        ...(baseEntry || {}),
        ...change,
        baseSha: baseEntry
          ? baseEntry.sha
          : Object.prototype.hasOwnProperty.call(change, "baseSha")
            ? change.baseSha
            : null,
        baseContent: baseEntry
          ? (
              typeof baseEntry.content === "string"
                ? baseEntry.content
                : typeof change.baseContent === "string"
                  ? change.baseContent
                  : null
            )
          : "",
        operation: "upsert",
        updatedAt: change.updatedAt || Date.now()
      }));
    }
    const saved = write(
      storage,
      key(CURRENT_PREFIX, userId, repository),
      {
        ...current,
        updatedAt: Date.now(),
        entries: Array.from(entries.values())
      }
    );
    return saved
      ? { base, current: saved, changes: deriveChanges(base, saved) }
      : null;
  }

  function discardChange(
    storage,
    userId,
    repository,
    path
  ) {
    const base = readBase(storage, userId, repository);
    const current = readCurrent(storage, userId, repository);
    if (!base || !current) return null;
    const baseEntry = entryMap(base.entries).get(path);
    const entries = entryMap(current.entries);
    if (baseEntry) entries.set(path, clone(baseEntry));
    else entries.delete(path);
    const saved = write(
      storage,
      key(CURRENT_PREFIX, userId, repository),
      {
        ...current,
        updatedAt: Date.now(),
        entries: Array.from(entries.values())
      }
    );
    return saved
      ? { base, current: saved, changes: deriveChanges(base, saved) }
      : null;
  }

  function release(storage, userId, repository) {
    const base = readBase(storage, userId, repository);
    if (!base) return null;
    const current = write(
      storage,
      key(CURRENT_PREFIX, userId, repository),
      {
        revision: base.revision,
        updatedAt: Date.now(),
        entries: clone(base.entries)
      }
    );
    return { base, current, changes: [] };
  }

  return {
    BASE_PREFIX,
    CURRENT_PREFIX,
    applyChange,
    deriveChanges,
    discardChange,
    ensure,
    hydrateBaseFile,
    key,
    readBase,
    readCurrent,
    release,
    syncBase
  };
});
