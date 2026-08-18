(function () {
  "use strict";

  const dialog = document.querySelector("[data-search-dialog]");
  const input = document.querySelector("[data-search-input]");
  const results = document.querySelector("[data-search-results]");
  const status = document.querySelector("[data-search-status]");
  const config = window.GCK_CONFIG || {};
  let indexPromise;
  let activeModule = "";
  let activeResult = -1;

  if (!dialog || !input || !results || !status) {
    return;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalize(value) {
    return String(value || "")
      .toLocaleLowerCase("zh-CN")
      .replace(/[^\p{Letter}\p{Number}+#.\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function refreshResultIcons() {
    if (typeof window.GCKRefreshIcons === "function") {
      window.GCKRefreshIcons(results);
    } else if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function withBase(route) {
    return `${config.basePath || ""}/${String(route).replace(/^\//, "")}`.replace(
      /\/+/g,
      "/"
    );
  }

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch(config.searchIndex)
        .then(function (response) {
          if (!response.ok) {
            throw new Error(`Search index request failed: ${response.status}`);
          }
          return response.json();
        })
        .then(function (payload) {
          return payload.items.map(function (item) {
            return {
              ...item,
              normalizedTitle: normalize(item.title),
              normalizedDescription: normalize(item.description),
              normalizedUnit: normalize(item.unitTitle),
              normalizedText: normalize(item.text)
            };
          });
        });
    }
    return indexPromise;
  }

  function getTerms(query) {
    const normalized = normalize(query);
    if (!normalized) {
      return [];
    }
    return Array.from(new Set([normalized].concat(normalized.split(" ")))).filter(
      function (term) {
        return term.length > 0;
      }
    );
  }

  function scoreItem(item, terms) {
    let score = 0;
    for (const term of terms) {
      let matched = false;
      if (item.normalizedTitle === term) {
        score += 160;
        matched = true;
      } else if (item.normalizedTitle.startsWith(term)) {
        score += 100;
        matched = true;
      } else if (item.normalizedTitle.includes(term)) {
        score += 72;
        matched = true;
      }
      if (item.normalizedUnit.includes(term)) {
        score += 36;
        matched = true;
      }
      if (item.normalizedDescription.includes(term)) {
        score += 24;
        matched = true;
      }
      if (item.normalizedText.includes(term)) {
        score += 8;
        matched = true;
      }
      if (!matched) {
        return 0;
      }
    }
    if (item.kind === "markdown") {
      score += 2;
    }
    return score;
  }

  function excerpt(item, terms) {
    const text = String(item.text || "").replace(/\s+/g, " ").trim();
    if (!text) {
      return item.description;
    }
    const normalizedText = normalize(text);
    const matchIndex = normalizedText.indexOf(terms[0]);
    const start = Math.max(0, matchIndex > -1 ? matchIndex - 46 : 0);
    const value = text.slice(start, start + 150);
    return `${start > 0 ? "…" : ""}${value}${start + 150 < text.length ? "…" : ""}`;
  }

  function labelFor(item) {
    if (item.kind === "code") {
      return "源码";
    }
    if (item.moduleSlug === "interviews") {
      return "面经";
    }
    if (item.moduleKey === "contribute") {
      return "规范";
    }
    return "知识";
  }

  function render(items, terms) {
    activeResult = -1;
    if (!items.length) {
      results.innerHTML =
        '<div class="search-empty"><i data-lucide="search-x" aria-hidden="true"></i>' +
        "<strong>没有匹配内容</strong><span>尝试更短的关键词或相关术语。</span></div>";
      status.textContent = "没有找到结果";
      refreshResultIcons();
      return;
    }

    status.textContent = `找到 ${items.length} 条结果${activeModule ? "，已限定当前模块" : ""}`;
    results.innerHTML = items
      .slice(0, 12)
      .map(function (item) {
        const icon = item.kind === "code" ? "file-code-2" : "file-text";
        return (
          `<a class="search-result" href="${withBase(item.route)}">` +
          `<span class="search-result-icon"><i data-lucide="${icon}" aria-hidden="true"></i></span>` +
          '<span class="search-result-copy">' +
          `<span class="search-result-meta">${escapeHtml(labelFor(item))} · ${escapeHtml(
            item.unitTitle
          )}</span>` +
          `<strong>${escapeHtml(item.title)}</strong>` +
          `<span>${escapeHtml(excerpt(item, terms))}</span>` +
          "</span>" +
          '<i data-lucide="arrow-up-right" aria-hidden="true"></i>' +
          "</a>"
        );
      })
      .join("");
    refreshResultIcons();
  }

  async function search() {
    const terms = getTerms(input.value);
    if (!terms.length) {
      results.innerHTML = "";
      status.textContent = activeModule
        ? "输入关键词搜索当前模块"
        : "输入关键词开始搜索";
      return;
    }

    status.textContent = "正在搜索…";
    try {
      const index = await loadIndex();
      const matches = index
        .filter(function (item) {
          return !activeModule || item.moduleKey === activeModule;
        })
        .map(function (item) {
          return { item, score: scoreItem(item, terms) };
        })
        .filter(function (result) {
          return result.score > 0;
        })
        .sort(function (left, right) {
          return right.score - left.score;
        })
        .map(function (result) {
          return result.item;
        });
      render(matches, terms);
    } catch {
      status.textContent = "搜索索引加载失败，请刷新页面重试";
    }
  }

  function openSearch(moduleKey) {
    activeModule = moduleKey || "";
    if (!dialog.open) {
      dialog.showModal();
    }
    window.setTimeout(function () {
      input.focus();
    }, 0);
    search();
  }

  document.querySelectorAll("[data-open-search]").forEach(function (button) {
    button.addEventListener("click", function () {
      openSearch(button.getAttribute("data-search-module"));
    });
  });
  document.querySelectorAll("[data-close-search]").forEach(function (button) {
    button.addEventListener("click", function () {
      dialog.close();
    });
  });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  let debounce;
  input.addEventListener("input", function () {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(search, 90);
  });
  input.addEventListener("keydown", function (event) {
    const links = Array.from(results.querySelectorAll(".search-result"));
    if (!links.length || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    if (event.key === "ArrowDown") {
      activeResult = Math.min(activeResult + 1, links.length - 1);
    } else if (event.key === "ArrowUp") {
      activeResult = Math.max(activeResult - 1, 0);
    } else if (activeResult >= 0) {
      links[activeResult].click();
      return;
    }
    links.forEach(function (link, index) {
      link.classList.toggle("is-active", index === activeResult);
    });
    links[activeResult].scrollIntoView({ block: "nearest" });
  });

  document.addEventListener("keydown", function (event) {
    const target = event.target;
    const editing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable;
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    } else if (event.key === "/" && !editing) {
      event.preventDefault();
      openSearch();
    }
  });
})();
