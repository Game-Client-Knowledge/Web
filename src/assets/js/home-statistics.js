(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.GCKHomeStatistics = api;
    api.mount(root);
  }
})(typeof globalThis === "object" ? globalThis : window, function () {
  "use strict";

  const PREFERENCE_KEY = "gck-contribution-ledger:v1";
  const DEFAULT_PREFERENCES = {
    pageSize: 3,
    totalLimit: 10,
    sortKey: "total",
    sortDirection: "desc"
  };
  const NUMERIC_FIELDS = [
    "added",
    "modified",
    "deleted",
    "commitCount",
    "activity7Count",
    "activity30Count",
    "modification7Count",
    "modification30Count"
  ];

  function emptyLineStats() {
    return { added: 0, modified: 0, deleted: 0 };
  }

  function addLineStats(target, source) {
    target.added += Number(source.added) || 0;
    target.modified += Number(source.modified) || 0;
    target.deleted += Number(source.deleted) || 0;
    return target;
  }

  function contributorTotal(contributor) {
    return (
      Number(contributor.added || 0) +
      Number(contributor.modified || 0) +
      Number(contributor.deleted || 0)
    );
  }

  function matchingRevision(value, expected) {
    const actual = String(value || "");
    const target = String(expected || "");
    return Boolean(
      actual &&
      target &&
      (
        actual.startsWith(target) ||
        target.startsWith(actual)
      )
    );
  }

  function createIdentityResolver(graph) {
    const aliasToCanonical = new Map();
    const canonicalNames = new Map();
    const aliases =
      graph && typeof graph.identity_aliases === "object"
        ? graph.identity_aliases
        : {};

    for (const [rawCanonical, rawAliases] of Object.entries(aliases)) {
      const canonical = String(rawCanonical);
      aliasToCanonical.set(canonical, canonical);
      for (const alias of Array.isArray(rawAliases) ? rawAliases : []) {
        aliasToCanonical.set(String(alias), canonical);
      }
    }

    function canonicalId(value) {
      const identity = String(value || "unknown");
      return aliasToCanonical.get(identity) || identity;
    }

    for (const link of Array.isArray(graph?.links) ? graph.links : []) {
      const canonical = canonicalId(link.contributor_id);
      const name = String(link.contributor_name || "").trim();
      const timestamp = String(link.last_contributed_at || "");
      const existing = canonicalNames.get(canonical);
      if (
        name &&
        (!existing || timestamp >= existing.timestamp)
      ) {
        canonicalNames.set(canonical, { name, timestamp });
      }
    }

    return {
      canonicalId,
      canonicalName(value) {
        return canonicalNames.get(canonicalId(value))?.name || "";
      }
    };
  }

  function mergeContributors(contributors, graph) {
    const resolver = createIdentityResolver(graph);
    const merged = new Map();

    for (const source of contributors || []) {
      const id = resolver.canonicalId(source.id);
      if (!merged.has(id)) {
        merged.set(id, {
          id,
          name: resolver.canonicalName(id) || source.name || "未命名贡献者",
          lastContributedAt: "",
          ...emptyLineStats()
        });
      }
      const target = merged.get(id);
      for (const field of NUMERIC_FIELDS) {
        target[field] =
          Number(target[field] || 0) +
          Number(source[field] || 0);
      }
      const contributedAt = String(source.lastContributedAt || "");
      if (contributedAt >= target.lastContributedAt) {
        target.lastContributedAt = contributedAt;
        if (!resolver.canonicalName(id) && source.name) {
          target.name = source.name;
        }
      }
    }

    for (const contributor of merged.values()) {
      contributor.name =
        resolver.canonicalName(contributor.id) ||
        contributor.name;
    }
    return Array.from(merged.values());
  }

  function sortContributors(contributors, sortKey, sortDirection) {
    const direction = sortDirection === "asc" ? 1 : -1;
    const values = Array.from(contributors || []);
    values.sort(function (left, right) {
      let comparison = 0;
      if (sortKey === "name") {
        comparison = String(left.name || "").localeCompare(
          String(right.name || ""),
          "zh-CN",
          { numeric: true, sensitivity: "base" }
        );
      } else if (sortKey === "recent") {
        comparison = String(left.lastContributedAt || "").localeCompare(
          String(right.lastContributedAt || "")
        );
      } else {
        const leftValue =
          sortKey === "total"
            ? contributorTotal(left)
            : Number(left[sortKey] || 0);
        const rightValue =
          sortKey === "total"
            ? contributorTotal(right)
            : Number(right[sortKey] || 0);
        comparison = leftValue - rightValue;
      }
      return (
        comparison * direction ||
        String(left.name || "").localeCompare(
          String(right.name || ""),
          "zh-CN",
          { numeric: true, sensitivity: "base" }
        )
      );
    });
    return values;
  }

  function paginateContributors(
    contributors,
    pageSize,
    totalLimit,
    requestedPage
  ) {
    const normalizedPageSize = Math.max(1, Number(pageSize) || 1);
    const normalizedLimit = Math.max(0, Number(totalLimit) || 0);
    const limited = normalizedLimit
      ? contributors.slice(0, normalizedLimit)
      : contributors.slice();
    const pageCount = Math.max(
      1,
      Math.ceil(limited.length / normalizedPageSize)
    );
    const page = Math.max(
      1,
      Math.min(pageCount, Number(requestedPage) || 1)
    );
    const start = (page - 1) * normalizedPageSize;
    return {
      items: limited.slice(start, start + normalizedPageSize),
      page,
      pageCount,
      start,
      total: contributors.length,
      limitedTotal: limited.length
    };
  }

  function recentContributors(
    statistics,
    scopeKey,
    graph,
    now = Date.now()
  ) {
    const boundary = now - 7 * 24 * 60 * 60 * 1000;
    const contributors = new Map();
    for (const event of statistics.recentEvents || []) {
      if (
        new Date(event.timestamp).getTime() < boundary ||
        (scopeKey !== "all" && event.trackKey !== scopeKey)
      ) {
        continue;
      }
      if (!contributors.has(event.contributorId)) {
        contributors.set(event.contributorId, {
          id: event.contributorId,
          name: event.contributorName,
          commitCount: 0,
          lastContributedAt: "",
          ...emptyLineStats()
        });
      }
      const contributor = contributors.get(event.contributorId);
      addLineStats(contributor, event);
      contributor.commitCount += 1;
      contributor.lastContributedAt =
        String(event.timestamp || "") > contributor.lastContributedAt
          ? String(event.timestamp || "")
          : contributor.lastContributedAt;
    }
    return mergeContributors(
      Array.from(contributors.values()),
      graph
    );
  }

  function readContributionGraph(root) {
    const expected = root.GCK_CONFIG?.contentVersion;
    const candidates = [];
    try {
      const identity = JSON.parse(
        root.localStorage.getItem("gck-editor-identity:v1") || "null"
      );
      candidates.push(identity?.payload?.config?.contribution_graph);
      for (const key of [
        `gck-contribution-graph:v2:${expected}`,
        `gck-contribution-graph:v1:${expected}`,
        `gck-contribution-graph:v1:${String(expected || "").slice(0, 7)}`
      ]) {
        candidates.push(
          JSON.parse(root.localStorage.getItem(key) || "null")
        );
      }
    } catch {
      return null;
    }
    return candidates.find(function (graph) {
      return (
        Number(graph?.version) === 2 &&
        matchingRevision(graph.revision, expected)
      );
    }) || null;
  }

  function mount(root) {
    const document = root.document;
    const statistics = root.GCK_CONTRIBUTION_STATS;
    const rows = document?.querySelector("[data-contribution-rows]");
    if (!statistics || !rows) return null;

    const scopes = new Map(
      (statistics.scopes || []).map(function (scope) {
        return [scope.key, scope];
      })
    );
    const number = new Intl.NumberFormat("zh-CN");
    const pageSizeSelect = document.querySelector(
      "[data-contribution-page-size]"
    );
    const totalLimitSelect = document.querySelector(
      "[data-contribution-total-limit]"
    );
    const sortSelect = document.querySelector(
      "[data-contribution-sort]"
    );
    const sortDirectionButton = document.querySelector(
      "[data-contribution-sort-direction]"
    );
    const previousButton = document.querySelector(
      "[data-contribution-page-previous]"
    );
    const nextButton = document.querySelector(
      "[data-contribution-page-next]"
    );
    const pageStatus = document.querySelector(
      "[data-contribution-page-status]"
    );
    let activeScope = "all";
    let activePeriod = "all";
    let activePage = 1;
    let identityGraph = readContributionGraph(root);
    let preferences = { ...DEFAULT_PREFERENCES };

    try {
      preferences = {
        ...preferences,
        ...JSON.parse(
          root.localStorage.getItem(PREFERENCE_KEY) || "{}"
        )
      };
    } catch {
      // Defaults remain active when the preference cache is unavailable.
    }

    function normalizedSelectValue(select, value, fallback) {
      const option = Array.from(select?.options || []).find(function (item) {
        return item.value === String(value);
      });
      return option ? option.value : String(fallback);
    }

    if (pageSizeSelect) {
      pageSizeSelect.value = normalizedSelectValue(
        pageSizeSelect,
        preferences.pageSize,
        DEFAULT_PREFERENCES.pageSize
      );
      preferences.pageSize = Number(pageSizeSelect.value);
    }
    if (totalLimitSelect) {
      totalLimitSelect.value = normalizedSelectValue(
        totalLimitSelect,
        preferences.totalLimit || "all",
        DEFAULT_PREFERENCES.totalLimit
      );
      preferences.totalLimit =
        totalLimitSelect.value === "all"
          ? 0
          : Number(totalLimitSelect.value);
    }
    if (sortSelect) {
      sortSelect.value = normalizedSelectValue(
        sortSelect,
        preferences.sortKey,
        DEFAULT_PREFERENCES.sortKey
      );
      preferences.sortKey = sortSelect.value;
    }
    preferences.sortDirection =
      preferences.sortDirection === "asc" ? "asc" : "desc";

    function savePreferences() {
      try {
        root.localStorage.setItem(
          PREFERENCE_KEY,
          JSON.stringify(preferences)
        );
      } catch {
        // Controls continue to work for the current page without storage.
      }
    }

    function contributorRows() {
      const scope = scopes.get(activeScope) || scopes.get("all");
      const contributors =
        activePeriod === "week"
          ? recentContributors(
              statistics,
              scope.key,
              identityGraph
            )
          : mergeContributors(
              scope.contributors || [],
              identityGraph
            );
      return sortContributors(
        contributors,
        preferences.sortKey,
        preferences.sortDirection
      );
    }

    function lineCell(value, type, marker) {
      const cell = document.createElement("td");
      cell.className = `line-${type}`;
      const normalized = Number(value) || 0;
      cell.textContent =
        normalized > 0
          ? marker + number.format(normalized)
          : "0";
      return cell;
    }

    function renderRows(contributors) {
      rows.replaceChildren();
      if (!contributors.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.className = "contribution-empty";
        cell.colSpan = 5;
        cell.textContent =
          activePeriod === "week"
            ? "最近 7 天暂无贡献记录"
            : "暂无贡献记录";
        row.append(cell);
        rows.append(row);
        return;
      }
      contributors.forEach(function (contributor) {
        const row = document.createElement("tr");
        row.dataset.contributorId = contributor.id;
        const name = document.createElement("th");
        name.scope = "row";
        const avatar = document.createElement("span");
        avatar.className = "contributor-avatar";
        avatar.setAttribute("aria-hidden", "true");
        avatar.textContent =
          Array.from(contributor.name || "?")[0]?.toLocaleUpperCase() || "?";
        const label = document.createElement("span");
        label.textContent = contributor.name;
        name.append(avatar, label);
        const total = document.createElement("td");
        total.textContent = number.format(contributorTotal(contributor));
        row.append(
          name,
          lineCell(contributor.added, "added", "+"),
          lineCell(contributor.modified, "modified", "~"),
          lineCell(contributor.deleted, "deleted", "-"),
          total
        );
        rows.append(row);
      });
    }

    function renderTotals(contributors) {
      const totals = contributors.reduce(function (result, contributor) {
        return addLineStats(result, contributor);
      }, emptyLineStats());
      const values = {
        added:
          totals.added > 0 ? `+${number.format(totals.added)}` : "0",
        modified:
          totals.modified > 0
            ? `~${number.format(totals.modified)}`
            : "0",
        deleted:
          totals.deleted > 0
            ? `-${number.format(totals.deleted)}`
            : "0",
        all: number.format(
          totals.added + totals.modified + totals.deleted
        )
      };
      Object.entries(values).forEach(function ([key, value]) {
        const target = document.querySelector(
          `[data-contribution-total="${key}"]`
        );
        if (target) target.textContent = value;
      });
    }

    function renderCounts() {
      for (const scope of scopes.values()) {
        const count = mergeContributors(
          scope.contributors || [],
          identityGraph
        ).length;
        document
          .querySelectorAll(`[data-contribution-count="${scope.key}"]`)
          .forEach(function (target) {
            target.textContent = number.format(count);
          });
      }
    }

    function renderSortDirection() {
      if (!sortDirectionButton) return;
      const ascending = preferences.sortDirection === "asc";
      sortDirectionButton.replaceChildren();
      const icon = document.createElement("i");
      icon.dataset.lucide = ascending
        ? "arrow-up-narrow-wide"
        : "arrow-down-wide-narrow";
      icon.setAttribute("aria-hidden", "true");
      sortDirectionButton.append(icon);
      sortDirectionButton.title = ascending ? "升序" : "降序";
      sortDirectionButton.setAttribute(
        "aria-label",
        ascending ? "当前升序，切换为降序" : "当前降序，切换为升序"
      );
      root.GCKRefreshIcons?.(sortDirectionButton);
    }

    function renderSortHeaders() {
      document
        .querySelectorAll("[data-contribution-sort-column]")
        .forEach(function (heading) {
          const active =
            heading.dataset.contributionSortColumn ===
            preferences.sortKey;
          heading.setAttribute(
            "aria-sort",
            active
              ? preferences.sortDirection === "asc"
                ? "ascending"
                : "descending"
              : "none"
          );
        });
    }

    function renderPagination(page) {
      if (previousButton) {
        previousButton.disabled = page.page <= 1;
      }
      if (nextButton) {
        nextButton.disabled = page.page >= page.pageCount;
      }
      if (pageStatus) {
        const first = page.limitedTotal ? page.start + 1 : 0;
        const last = Math.min(
          page.start + page.items.length,
          page.limitedTotal
        );
        pageStatus.textContent =
          `第 ${page.page} / ${page.pageCount} 页 · ` +
          `${first}-${last} / ${page.limitedTotal}`;
      }
    }

    function render() {
      const scope = scopes.get(activeScope) || scopes.get("all");
      const contributors = contributorRows();
      const page = paginateContributors(
        contributors,
        preferences.pageSize,
        preferences.totalLimit,
        activePage
      );
      activePage = page.page;

      document
        .querySelectorAll("[data-contribution-scope]")
        .forEach(function (button) {
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.contributionScope === activeScope)
          );
        });
      document
        .querySelectorAll("[data-contribution-period]")
        .forEach(function (button) {
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.contributionPeriod === activePeriod)
          );
        });
      const title = document.querySelector(
        "[data-contribution-scope-title]"
      );
      const summary = document.querySelector(
        "[data-contribution-scope-summary]"
      );
      if (title) title.textContent = scope.title;
      if (summary) {
        const limitText =
          page.limitedTotal < contributors.length
            ? ` · 显示前 ${page.limitedTotal} 位`
            : "";
        summary.textContent =
          activePeriod === "week"
            ? `${contributors.length} 位活跃贡献者 · 最近 7 天${limitText}`
            : `${contributors.length} 位贡献者 · ` +
              `${number.format(scope.fileCount)} 个文本资源${limitText}`;
      }
      renderRows(page.items);
      renderTotals(contributors);
      renderCounts();
      renderSortDirection();
      renderSortHeaders();
      renderPagination(page);
    }

    document
      .querySelectorAll("[data-contribution-scope]")
      .forEach(function (button) {
        button.addEventListener("click", function () {
          activeScope = button.dataset.contributionScope;
          activePage = 1;
          render();
        });
      });
    document
      .querySelectorAll("[data-contribution-period]")
      .forEach(function (button) {
        button.addEventListener("click", function () {
          activePeriod = button.dataset.contributionPeriod;
          activePage = 1;
          render();
        });
      });
    pageSizeSelect?.addEventListener("change", function () {
      preferences.pageSize = Number(pageSizeSelect.value);
      activePage = 1;
      savePreferences();
      render();
    });
    totalLimitSelect?.addEventListener("change", function () {
      preferences.totalLimit =
        totalLimitSelect.value === "all"
          ? 0
          : Number(totalLimitSelect.value);
      activePage = 1;
      savePreferences();
      render();
    });
    sortSelect?.addEventListener("change", function () {
      preferences.sortKey = sortSelect.value;
      preferences.sortDirection =
        sortSelect.value === "name" ? "asc" : "desc";
      activePage = 1;
      savePreferences();
      render();
    });
    sortDirectionButton?.addEventListener("click", function () {
      preferences.sortDirection =
        preferences.sortDirection === "asc" ? "desc" : "asc";
      activePage = 1;
      savePreferences();
      render();
    });
    previousButton?.addEventListener("click", function () {
      activePage -= 1;
      render();
    });
    nextButton?.addEventListener("click", function () {
      activePage += 1;
      render();
    });
    root.addEventListener("gck:visual-settings", function (event) {
      const graph = event.detail?.contribution_graph;
      if (
        Number(graph?.version) === 2 &&
        matchingRevision(
          graph.revision,
          root.GCK_CONFIG?.contentVersion
        )
      ) {
        identityGraph = graph;
        activePage = 1;
        render();
      }
    });

    render();
    return { render };
  }

  return {
    contributorTotal,
    createIdentityResolver,
    mergeContributors,
    mount,
    paginateContributors,
    recentContributors,
    sortContributors
  };
});
