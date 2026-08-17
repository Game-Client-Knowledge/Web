(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.GCKWorkspaceTree = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const CACHE_PREFIX = "gck-workspace-tree:v1:";

  function normalizePath(value) {
    return String(value || "")
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "")
      .replace(/\/+/g, "/");
  }

  function directoryOf(filePath) {
    const path = normalizePath(filePath);
    const index = path.lastIndexOf("/");
    return index < 0 ? "" : path.slice(0, index);
  }

  function basename(filePath) {
    return normalizePath(filePath).split("/").pop() || "";
  }

  function isReadme(filePath) {
    return basename(filePath).toLowerCase() === "readme.md";
  }

  function cleanInlineMarkdown(value) {
    return String(value || "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .trim();
  }

  function parseMarkdownMetadata(content, fallbackTitle, fallbackDescription) {
    const source = String(content || "").replace(/\r\n?/g, "\n");
    const withoutFrontMatter = source.replace(
      /^---\n[\s\S]*?\n---\n+/,
      ""
    );
    const heading = withoutFrontMatter.match(/^#\s+(.+?)\s*$/m);
    const blocks = withoutFrontMatter
      .replace(/^#\s+.+?\s*$/m, "")
      .split(/\n\s*\n/);
    let description = "";
    for (const block of blocks) {
      const value = block.trim();
      if (
        !value ||
        value.startsWith("#") ||
        value.startsWith("|") ||
        value.startsWith("- ") ||
        value.startsWith("* ") ||
        value.startsWith("```") ||
        /^\d+\.\s/.test(value)
      ) {
        continue;
      }
      description = cleanInlineMarkdown(value.replace(/\n/g, " "));
      if (description) break;
    }
    return {
      title:
        cleanInlineMarkdown(heading ? heading[1] : "") ||
        fallbackTitle ||
        basename(fallbackTitle),
      description: description || fallbackDescription || ""
    };
  }

  function changeStatus(change, baseExists) {
    if (!change) return "";
    if (change.operation === "delete") return "D";
    return change.base_sha || change.baseSha || baseExists ? "M" : "A";
  }

  function normalizeBaseEntry(entry) {
    const path = normalizePath(entry.path || entry.sourceRelative);
    return {
      path,
      title: entry.title || basename(path),
      description: entry.description || "",
      kind: entry.kind || (path.endsWith(".md") ? "markdown" : "code"),
      route: entry.route || "",
      moduleKey: entry.moduleKey || path.split("/")[0] || "",
      sourceDirectory: entry.sourceDirectory || directoryOf(path),
      order: Number.isFinite(Number(entry.order))
        ? Number(entry.order)
        : isReadme(path)
          ? -100
          : 1000,
      isReadme: entry.isReadme === true || isReadme(path),
      status: "",
      operation: "upsert",
      baseExists: true,
      local: false,
      conflict: false
    };
  }

  function applyChange(entry, change, local) {
    const path = normalizePath(change.path);
    const base = entry || {
      path,
      title: basename(path),
      description: "",
      kind: path.endsWith(".md") ? "markdown" : "code",
      route: "",
      moduleKey: path.split("/")[0] || "",
      sourceDirectory: directoryOf(path),
      order: 1000,
      isReadme: isReadme(path),
      baseExists: false
    };
    const metadata =
      base.kind === "markdown" && change.operation !== "delete"
        ? parseMarkdownMetadata(
            change.content,
            base.title,
            base.description
          )
        : { title: base.title, description: base.description };
    return {
      ...base,
      ...metadata,
      path,
      status: changeStatus(change, Boolean(base.baseExists)),
      operation: change.operation || "upsert",
      baseSha: change.base_sha || change.baseSha || null,
      serverRevision: Number(
        change.revision ?? change.serverRevision ?? 0
      ),
      updatedAt: change.updated_at || change.updatedAt || "",
      local: Boolean(local),
      conflict: Boolean(change.conflict),
      content:
        typeof change.content === "string" ? change.content : undefined
    };
  }

  function mergeEntries(baseEntries, serverDrafts, localChanges) {
    const entries = new Map();
    for (const item of baseEntries || []) {
      const entry = normalizeBaseEntry(item);
      if (entry.path) entries.set(entry.path, entry);
    }
    for (const draft of serverDrafts || []) {
      const path = normalizePath(draft.path);
      if (!path) continue;
      entries.set(path, applyChange(entries.get(path), draft, false));
    }
    for (const change of localChanges || []) {
      const path = normalizePath(change.path);
      if (!path) continue;
      entries.set(path, applyChange(entries.get(path), change, true));
    }
    return Array.from(entries.values()).sort(function (left, right) {
      return left.path.localeCompare(right.path, "zh-CN", {
        numeric: true
      });
    });
  }

  function nearestUnit(units, path, rootPath) {
    let directory = isReadme(path) ? directoryOf(path) : directoryOf(path);
    while (directory && directory !== rootPath) {
      if (units.has(directory)) return units.get(directory);
      const parent = directoryOf(directory);
      if (parent === directory) break;
      directory = parent;
    }
    return null;
  }

  function statusPriority(status) {
    return status === "D" ? 3 : status === "A" ? 2 : status === "M" ? 1 : 0;
  }

  function aggregateUnitStatus(unit) {
    const own = unit.readme ? unit.readme.status : "";
    const childStatuses = unit.children
      .map(aggregateUnitStatus)
      .concat(unit.documents.map(function (entry) {
        return entry.status;
      }))
      .filter(Boolean);
    if (own === "A" || own === "D") {
      unit.status = own;
    } else if (own === "M" || childStatuses.length) {
      unit.status = "M";
    } else {
      unit.status = "";
    }
    unit.changeCount =
      (own ? 1 : 0) +
      unit.documents.filter(function (entry) {
        return entry.status && entry !== unit.readme;
      }).length +
      unit.children.reduce(function (total, child) {
        return total + child.changeCount;
      }, 0);
    return unit.status;
  }

  function compareUnits(left, right) {
    const statusDifference =
      statusPriority(right.status) - statusPriority(left.status);
    if (statusDifference && (left.status === "A" || right.status === "A")) {
      return statusDifference;
    }
    return left.title.localeCompare(right.title, "zh-CN", {
      numeric: true
    });
  }

  function compareDocuments(left, right) {
    const orderDifference = Number(left.order) - Number(right.order);
    if (orderDifference) return orderDifference;
    return left.path.localeCompare(right.path, "zh-CN", {
      numeric: true
    });
  }

  function buildModuleTree(rootPath, entries) {
    const root = normalizePath(rootPath);
    const relevant = (entries || []).filter(function (entry) {
      return entry.path === root + "/README.md" ||
        entry.path.startsWith(root + "/");
    });
    const units = new Map();
    for (const entry of relevant) {
      if (
        !entry.isReadme ||
        entry.path === root + "/README.md"
      ) {
        continue;
      }
      const id = directoryOf(entry.path);
      units.set(id, {
        id,
        title: entry.title,
        description: entry.description,
        route: entry.route,
        readme: entry,
        documents: [],
        children: [],
        parentId: null,
        status: "",
        changeCount: 0
      });
    }
    for (const unit of units.values()) {
      let parent = directoryOf(unit.id);
      while (parent && parent !== root) {
        if (units.has(parent)) {
          unit.parentId = parent;
          units.get(parent).children.push(unit);
          break;
        }
        parent = directoryOf(parent);
      }
    }
    const rootDocuments = [];
    for (const entry of relevant) {
      if (entry.path === root + "/README.md") continue;
      const unit = nearestUnit(units, entry.path, root);
      if (unit) unit.documents.push(entry);
      else rootDocuments.push(entry);
    }
    for (const unit of units.values()) {
      unit.documents.sort(compareDocuments);
      unit.children.forEach(aggregateUnitStatus);
      aggregateUnitStatus(unit);
      unit.children.sort(compareUnits);
    }
    const rootUnits = Array.from(units.values())
      .filter(function (unit) {
        return !unit.parentId;
      })
      .sort(compareUnits);
    return {
      root,
      rootEntry: relevant.find(function (entry) {
        return entry.path === root + "/README.md";
      }) || null,
      rootUnits,
      rootDocuments: rootDocuments.sort(compareDocuments),
      entries: relevant,
      changedCount: relevant.filter(function (entry) {
        return Boolean(entry.status);
      }).length
    };
  }

  function cacheKey(userId, version, rootPath) {
    return (
      CACHE_PREFIX +
      encodeURIComponent(String(userId)) +
      ":" +
      encodeURIComponent(String(version || "local")) +
      ":" +
      encodeURIComponent(normalizePath(rootPath))
    );
  }

  function cacheSnapshot(storage, userId, version, rootPath, snapshot) {
    if (!storage) return false;
    const entries = (snapshot.entries || []).map(function (entry) {
      const copy = { ...entry };
      delete copy.content;
      return copy;
    });
    try {
      storage.setItem(
        cacheKey(userId, version, rootPath),
        JSON.stringify({
          version: 1,
          root: normalizePath(rootPath),
          updatedAt: Date.now(),
          entries
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  function readSnapshot(storage, userId, version, rootPath) {
    if (!storage) return null;
    try {
      const value = JSON.parse(
        storage.getItem(cacheKey(userId, version, rootPath))
      );
      if (
        !value ||
        value.version !== 1 ||
        value.root !== normalizePath(rootPath) ||
        !Array.isArray(value.entries)
      ) {
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }

  return {
    CACHE_PREFIX,
    buildModuleTree,
    cacheKey,
    cacheSnapshot,
    changeStatus,
    mergeEntries,
    normalizePath,
    parseMarkdownMetadata,
    readSnapshot
  };
});
