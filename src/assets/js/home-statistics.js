(function () {
  "use strict";

  const statistics = window.GCK_CONTRIBUTION_STATS;
  const rows = document.querySelector("[data-contribution-rows]");
  if (!statistics || !rows) return;

  const scopes = new Map(
    (statistics.scopes || []).map(function (scope) {
      return [scope.key, scope];
    })
  );
  const number = new Intl.NumberFormat("zh-CN");
  let activeScope = "all";
  let activePeriod = "all";

  function emptyLineStats() {
    return { added: 0, modified: 0, deleted: 0 };
  }

  function addLineStats(target, source) {
    target.added += Number(source.added) || 0;
    target.modified += Number(source.modified) || 0;
    target.deleted += Number(source.deleted) || 0;
    return target;
  }

  function recentContributors(scopeKey) {
    const boundary = Date.now() - 7 * 24 * 60 * 60 * 1000;
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
          ...emptyLineStats()
        });
      }
      addLineStats(contributors.get(event.contributorId), event);
    }
    return Array.from(contributors.values()).sort(function (left, right) {
      const leftTotal = left.added + left.modified + left.deleted;
      const rightTotal = right.added + right.modified + right.deleted;
      return rightTotal - leftTotal ||
        left.name.localeCompare(right.name, "zh-CN");
    });
  }

  function contributorRows() {
    const scope = scopes.get(activeScope) || scopes.get("all");
    return activePeriod === "week"
      ? recentContributors(scope.key)
      : scope.contributors || [];
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
      total.textContent = number.format(
        contributor.added +
          contributor.modified +
          contributor.deleted
      );
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
      all: number.format(totals.added + totals.modified + totals.deleted)
    };
    Object.entries(values).forEach(function ([key, value]) {
      const target = document.querySelector(
        `[data-contribution-total="${key}"]`
      );
      if (target) target.textContent = value;
    });
  }

  function render() {
    const scope = scopes.get(activeScope) || scopes.get("all");
    const contributors = contributorRows();
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
    const title = document.querySelector("[data-contribution-scope-title]");
    const summary = document.querySelector(
      "[data-contribution-scope-summary]"
    );
    if (title) title.textContent = scope.title;
    if (summary) {
      summary.textContent =
        activePeriod === "week"
          ? `${contributors.length} 位活跃贡献者 · 最近 7 天`
          : `${contributors.length} 位贡献者 · ` +
            `${number.format(scope.fileCount)} 个文本资源`;
    }
    renderRows(contributors);
    renderTotals(contributors);
  }

  document
    .querySelectorAll("[data-contribution-scope]")
    .forEach(function (button) {
      button.addEventListener("click", function () {
        activeScope = button.dataset.contributionScope;
        render();
      });
    });
  document
    .querySelectorAll("[data-contribution-period]")
    .forEach(function (button) {
      button.addEventListener("click", function () {
        activePeriod = button.dataset.contributionPeriod;
        render();
      });
    });
})();
