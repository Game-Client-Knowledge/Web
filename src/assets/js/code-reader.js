(function () {
  "use strict";

  const root = document.querySelector("[data-code-workspace]");
  const config = window.GCK_CODE_CONFIG || {};
  if (!root) {
    return;
  }

  const state = {
    project: null,
    fileByPath: new Map(),
    contents: new Map(),
    openFiles: [],
    activePath: "",
    symbols: [],
    symbolsByName: new Map(),
    symbolsByPath: new Map(),
    referencesByName: new Map(),
    worker: null,
    indexPromise: null,
    indexingComplete: false,
    searchTimer: 0
  };

  const query = (selector, target = document) =>
    target.querySelector(selector);
  const queryAll = (selector, target = document) =>
    Array.from(target.querySelectorAll(selector));

  function refreshIcons(target) {
    if (window.lucide) {
      window.lucide.createIcons({
        attrs: { "stroke-width": 1.8 },
        root: target || document
      });
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function rawUrl(file) {
    return (
      config.rawBase +
      file.sourcePath
        .split("/")
        .map(encodeURIComponent)
        .join("/")
    );
  }

  function activeFile() {
    return state.fileByPath.get(state.activePath);
  }

  function setStatus(message) {
    query("[data-code-index-status]").textContent = message;
  }

  function setInspectorTab(name) {
    queryAll("[data-code-inspector-tab]").forEach((button) => {
      button.classList.toggle(
        "is-active",
        button.dataset.codeInspectorTab === name
      );
    });
    queryAll("[data-code-inspector-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.codeInspectorPane !== name;
    });
  }

  async function loadFile(path) {
    if (state.contents.has(path)) {
      return state.contents.get(path);
    }
    const file = state.fileByPath.get(path);
    if (!file) {
      throw new Error(`项目中不存在文件：${path}`);
    }
    const response = await fetch(rawUrl(file), {
      credentials: "same-origin"
    });
    if (!response.ok) {
      throw new Error(`文件加载失败（HTTP ${response.status}）`);
    }
    const content = await response.text();
    state.contents.set(path, content);
    return content;
  }

  function languageForPrism(file) {
    const aliases = {
      csharp: "csharp",
      cpp: "cpp",
      c: "c",
      xml: "markup",
      markdown: "markdown",
      text: "text"
    };
    return aliases[file.language] || file.language || "text";
  }

  function highlightLine(line, file) {
    const Prism = window.GCKCodePrism;
    const language = languageForPrism(file);
    if (!Prism || !Prism.languages[language]) {
      return escapeHtml(line || " ");
    }
    return Prism.highlight(line || " ", Prism.languages[language], language);
  }

  function renderTabs() {
    const target = query("[data-code-tabs]");
    target.replaceChildren();
    state.openFiles.forEach((path) => {
      const file = state.fileByPath.get(path);
      const tab = document.createElement("div");
      tab.className = "code-tab";
      tab.classList.toggle("is-active", path === state.activePath);
      const open = document.createElement("button");
      open.type = "button";
      open.dataset.codeOpenFile = path;
      open.title = path;
      open.innerHTML =
        '<i data-lucide="file-code-2" aria-hidden="true"></i>' +
        `<span>${escapeHtml(file.name)}</span>`;
      const close = document.createElement("button");
      close.type = "button";
      close.dataset.codeCloseFile = path;
      close.title = `关闭 ${file.name}`;
      close.setAttribute("aria-label", `关闭 ${file.name}`);
      close.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
      tab.append(open, close);
      target.append(tab);
    });
    refreshIcons(target);
  }

  function renderBreadcrumbs(file) {
    const target = query("[data-code-breadcrumbs]");
    target.replaceChildren();
    file.path.split("/").forEach((part, index, parts) => {
      const span = document.createElement("span");
      span.textContent = part;
      target.append(span);
      if (index < parts.length - 1) {
        const icon = document.createElement("i");
        icon.dataset.lucide = "chevron-right";
        icon.setAttribute("aria-hidden", "true");
        target.append(icon);
      }
    });
    refreshIcons(target);
  }

  function decorateSymbols(target) {
    if (!state.symbolsByName.size) {
      return;
    }
    const names = Array.from(state.symbolsByName.keys())
      .filter((name) => /^[A-Za-z_]\w*$/.test(name))
      .sort((left, right) => right.length - left.length);
    if (!names.length) {
      return;
    }
    const pattern = new RegExp(
      `\\b(${names
        .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|")})\\b`,
      "g"
    );
    queryAll(".code-line-content", target).forEach((line) => {
      const walker = document.createTreeWalker(
        line,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (
              !pattern.test(node.nodeValue) ||
              node.parentElement.closest(
                ".token.comment, .token.string, .code-symbol"
              )
            ) {
              pattern.lastIndex = 0;
              return NodeFilter.FILTER_REJECT;
            }
            pattern.lastIndex = 0;
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((node) => {
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        node.nodeValue.replace(pattern, (match, name, offset) => {
          fragment.append(node.nodeValue.slice(cursor, offset));
          const button = document.createElement("button");
          button.type = "button";
          button.className = "code-symbol";
          button.dataset.codeSymbol = name;
          button.title = `转到 ${name} 的定义`;
          button.textContent = match;
          fragment.append(button);
          cursor = offset + match.length;
          return match;
        });
        fragment.append(node.nodeValue.slice(cursor));
        node.replaceWith(fragment);
      });
    });
  }

  function renderSource(file, content, line) {
    const target = query("[data-code-source]");
    target.replaceChildren();
    content.split("\n").forEach((value, index) => {
      const row = document.createElement("span");
      row.className = "code-line";
      row.dataset.line = String(index + 1);
      row.id = `code-line-${index + 1}`;
      const number = document.createElement("button");
      number.type = "button";
      number.className = "code-line-number";
      number.dataset.codeLine = String(index + 1);
      number.textContent = String(index + 1);
      number.setAttribute("aria-label", `第 ${index + 1} 行`);
      const code = document.createElement("span");
      code.className = "code-line-content";
      code.innerHTML = highlightLine(value, file);
      row.append(number, code);
      target.append(row);
    });
    decorateSymbols(target);
    query("[data-code-empty]").hidden = true;
    query("[data-code-source-panel]").hidden = false;
    query("[data-code-language]").textContent =
      file.language.toUpperCase();
    renderOutline(file.path);
    focusLine(line || 1, false);
  }

  function focusLine(line, smooth = true) {
    queryAll(".code-line.is-focused").forEach((item) =>
      item.classList.remove("is-focused")
    );
    const target = query(`[data-line="${Math.max(1, Number(line) || 1)}"]`);
    if (!target) {
      return;
    }
    target.classList.add("is-focused");
    target.scrollIntoView({
      block: "center",
      behavior: smooth ? "smooth" : "auto"
    });
    query("[data-code-cursor-status]").textContent =
      `Ln ${target.dataset.line}, Col 1`;
  }

  function updateUrl(path, line, replace = false) {
    const url = new URL(window.location.href);
    url.searchParams.set("project", state.project.id);
    url.searchParams.set("file", path);
    if (line && Number(line) > 1) {
      url.searchParams.set("line", String(line));
    } else {
      url.searchParams.delete("line");
    }
    history[replace ? "replaceState" : "pushState"](
      { path, line },
      "",
      url.pathname + url.search
    );
  }

  async function openFile(path, line = 1, options = {}) {
    const file = state.fileByPath.get(path);
    if (!file) {
      return;
    }
    state.activePath = path;
    if (!state.openFiles.includes(path)) {
      state.openFiles.push(path);
    }
    renderTabs();
    renderBreadcrumbs(file);
    setStatus(`正在读取 ${file.name}`);
    try {
      const content = await loadFile(path);
      renderSource(file, content, line);
      setStatus(
        state.indexingComplete
          ? `索引完成 · ${state.symbols.length} 个符号`
          : "客户端正在建立项目索引"
      );
      if (!options.skipHistory) {
        updateUrl(path, line, Boolean(options.replace));
      }
      queryAll("[data-code-file]").forEach((button) => {
        button.classList.toggle(
          "is-active",
          button.dataset.codeFile === path
        );
      });
      window.GCK_ACTIVE_CODE_SOURCE = file.sourcePath;
      window.dispatchEvent(
        new CustomEvent("gck:code-file-view", {
          detail: { path: file.sourcePath }
        })
      );
    } catch (error) {
      setStatus(error.message);
    }
  }

  function closeFile(path) {
    const index = state.openFiles.indexOf(path);
    if (index < 0) return;
    state.openFiles.splice(index, 1);
    if (path === state.activePath) {
      const next =
        state.openFiles[index] ||
        state.openFiles[index - 1] ||
        "";
      state.activePath = next;
      if (next) {
        openFile(next);
      } else {
        query("[data-code-source-panel]").hidden = true;
        query("[data-code-empty]").hidden = false;
        query("[data-code-breadcrumbs]").replaceChildren();
        renderOutline("");
      }
    }
    renderTabs();
  }

  function fileTree(files) {
    const rootNode = { folders: new Map(), files: [] };
    files.forEach((file) => {
      const parts = file.path.split("/");
      const name = parts.pop();
      let node = rootNode;
      parts.forEach((part) => {
        if (!node.folders.has(part)) {
          node.folders.set(part, { folders: new Map(), files: [] });
        }
        node = node.folders.get(part);
      });
      node.files.push({ ...file, name });
    });
    return rootNode;
  }

  function renderTreeNode(node, target, depth, expandAll) {
    Array.from(node.folders.entries())
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .forEach(([name, child]) => {
        const details = document.createElement("details");
        details.className = "code-tree-folder";
        details.open = expandAll || depth < 2;
        const summary = document.createElement("summary");
        summary.innerHTML =
          '<i data-lucide="chevron-right" aria-hidden="true"></i>' +
          '<i data-lucide="folder" aria-hidden="true"></i>' +
          `<span>${escapeHtml(name)}</span>`;
        details.append(summary);
        const children = document.createElement("div");
        renderTreeNode(child, children, depth + 1, expandAll);
        details.append(children);
        target.append(details);
      });
    node.files
      .sort((left, right) =>
        left.name.localeCompare(right.name, "en", { numeric: true })
      )
      .forEach((file) => {
        const button = document.createElement("button");
        button.className = "code-tree-file";
        button.type = "button";
        button.dataset.codeFile = file.path;
        button.title = file.path;
        button.classList.toggle("is-active", file.path === state.activePath);
        button.innerHTML =
          '<i data-lucide="file-code-2" aria-hidden="true"></i>' +
          `<span>${escapeHtml(file.name)}</span>` +
          (file.recommended
            ? '<i data-lucide="bookmark" aria-label="推荐阅读"></i>'
            : "");
        target.append(button);
      });
  }

  function renderFileTree(filter = "") {
    const normalized = filter.trim().toLowerCase();
    const files = state.project.files.filter(
      (file) => !normalized || file.path.toLowerCase().includes(normalized)
    );
    const target = query("[data-code-file-tree]");
    target.replaceChildren();
    renderTreeNode(fileTree(files), target, 0, Boolean(normalized));
    if (!files.length) {
      target.textContent = "没有匹配文件";
    }
    refreshIcons(target);
  }

  function renderReadingOrder() {
    const target = query("[data-code-reading-order] ol");
    target.replaceChildren();
    state.project.readingOrder.forEach((path) => {
      if (!state.fileByPath.has(path)) return;
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.codeFile = path;
      button.textContent = path.split("/").pop();
      button.title = path;
      item.append(button);
      target.append(item);
    });
    query("[data-code-reading-order]").hidden = !target.children.length;
  }

  function renderOutline(path) {
    const target = query("[data-code-outline]");
    target.replaceChildren();
    const symbols = state.symbolsByPath.get(path) || [];
    symbols.forEach((symbol) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.codeTargetPath = symbol.path;
      button.dataset.codeTargetLine = String(symbol.line);
      button.className = `code-outline-item is-${symbol.kind}`;
      const copy = symbol.container
        ? `${symbol.container}.${symbol.name}`
        : symbol.name;
      button.innerHTML =
        `<i data-lucide="${iconForSymbol(symbol.kind)}" aria-hidden="true"></i>` +
        `<span><strong>${escapeHtml(copy)}</strong>` +
        `<small>${escapeHtml(symbol.kind)} · Ln ${symbol.line}</small></span>`;
      target.append(button);
    });
    if (!symbols.length) {
      target.innerHTML =
        '<p class="code-inspector-empty">索引完成后显示当前文件符号。</p>';
    }
    refreshIcons(target);
  }

  function iconForSymbol(kind) {
    if (["class", "struct", "record", "interface"].includes(kind)) {
      return "box";
    }
    if (["method", "function", "constructor"].includes(kind)) {
      return "function-square";
    }
    if (kind === "namespace") return "braces";
    if (kind === "property" || kind === "field") return "variable";
    return "circle-dot";
  }

  async function loadAllContents() {
    const files = state.project.files.slice();
    const workers = Array.from(
      { length: Math.min(6, files.length) },
      async function () {
        while (files.length) {
          const file = files.shift();
          try {
            await loadFile(file.path);
          } catch {
            // A missing optional file does not block the rest of the project.
          }
          setStatus(
            `缓存源码 ${state.contents.size}/${state.project.fileCount}`
          );
        }
      }
    );
    await Promise.all(workers);
  }

  function initializeWorker() {
    return new Promise((resolve, reject) => {
      if (!window.Worker || !state.project.parsers.length) {
        resolve(false);
        return;
      }
      const worker = new Worker(config.workerUrl);
      state.worker = worker;
      const onMessage = (event) => {
        if (event.data.type === "ready") {
          worker.removeEventListener("message", onMessage);
          resolve(true);
        } else if (event.data.type === "error") {
          reject(new Error(event.data.message));
        }
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({
        type: "init",
        runtimeUrl: config.treeSitterUrl,
        runtimeWasmUrl: config.treeSitterWasmUrl,
        grammarBase: config.grammarBase,
        parsers: state.project.parsers
      });
    });
  }

  function applyCodeIndex(payload) {
    state.symbols = payload.symbols || [];
    state.symbolsByName.clear();
    state.symbolsByPath.clear();
    state.referencesByName.clear();
    state.symbols.forEach((symbol) => {
      if (!state.symbolsByName.has(symbol.name)) {
        state.symbolsByName.set(symbol.name, []);
      }
      state.symbolsByName.get(symbol.name).push(symbol);
      if (!state.symbolsByPath.has(symbol.path)) {
        state.symbolsByPath.set(symbol.path, []);
      }
      state.symbolsByPath.get(symbol.path).push(symbol);
    });
    (payload.references || []).forEach((reference) => {
      if (!state.referencesByName.has(reference.name)) {
        state.referencesByName.set(reference.name, []);
      }
      state.referencesByName.get(reference.name).push(reference);
    });
    state.symbolsByPath.forEach((symbols) =>
      symbols.sort((left, right) => left.line - right.line)
    );
    state.indexingComplete = true;
    setStatus(
      `索引完成 · ${state.project.fileCount} 文件 · ${state.symbols.length} 符号`
    );
    renderOutline(state.activePath);
    const file = activeFile();
    if (file && state.contents.has(file.path)) {
      renderSource(file, state.contents.get(file.path), currentLine());
    }
  }

  function startProjectIndex() {
    if (state.indexPromise) {
      return state.indexPromise;
    }
    state.indexPromise = Promise.all([
      loadAllContents(),
      initializeWorker()
    ]).then(async ([, workerReady]) => {
      if (!workerReady) {
        state.indexingComplete = true;
        setStatus(`文本索引完成 · ${state.project.fileCount} 文件`);
        return;
      }
      await new Promise((resolve, reject) => {
        const listener = (event) => {
          const payload = event.data;
          if (payload.type === "progress") {
            setStatus(
              `解析符号 ${payload.parsed}/${payload.total} · ${payload.path}`
            );
          } else if (payload.type === "indexed") {
            state.worker.removeEventListener("message", listener);
            applyCodeIndex(payload);
            resolve();
          } else if (payload.type === "error") {
            state.worker.removeEventListener("message", listener);
            reject(new Error(payload.message));
          }
        };
        state.worker.addEventListener("message", listener);
        state.worker.postMessage({
          type: "index",
          files: state.project.files
            .filter((file) => state.contents.has(file.path))
            .map((file) => ({
              path: file.path,
              parser: file.parser,
              content: state.contents.get(file.path)
            }))
        });
      });
    }).catch((error) => {
      state.indexingComplete = true;
      setStatus(`文本搜索可用，符号解析失败：${error.message}`);
    });
    return state.indexPromise;
  }

  function currentLine() {
    const focused = query(".code-line.is-focused");
    return focused ? Number(focused.dataset.line) : 1;
  }

  function textOccurrences(term) {
    const normalized = term.toLowerCase().trim();
    const terms = normalized.split(/\s+/).filter(Boolean);
    const results = [];
    state.project.files.forEach((file) => {
      const content = state.contents.get(file.path);
      if (!content) return;
      if (file.path.toLowerCase().includes(normalized)) {
        results.push({
          path: file.path,
          line: 1,
          column: 1,
          preview: file.path
        });
      }
      content.split("\n").forEach((line, index) => {
        const normalizedLine = line.toLowerCase();
        const column = normalizedLine.indexOf(terms[0]);
        if (
          column >= 0 &&
          terms.every((item) => normalizedLine.includes(item))
        ) {
          results.push({
            path: file.path,
            line: index + 1,
            column: column + 1,
            preview: line.trim() || " "
          });
        }
      });
    });
    return results.slice(0, 300);
  }

  function renderSearchResults(results, label) {
    const target = query("[data-code-search-results]");
    target.replaceChildren();
    query("[data-code-search-count]").textContent = results.length
      ? String(results.length)
      : "";
    query("[data-code-search-summary]").textContent =
      `${label} · ${results.length} 个结果`;
    results.forEach((result) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.codeTargetPath = result.path;
      button.dataset.codeTargetLine = String(result.line);
      button.innerHTML =
        `<strong>${escapeHtml(result.path)}</strong>` +
        `<span>Ln ${result.line}, Col ${result.column || 1}</span>` +
        `<code>${escapeHtml(result.preview || result.signature || "")}</code>`;
      target.append(button);
    });
    if (!results.length) {
      target.innerHTML =
        '<p class="code-inspector-empty">没有匹配结果。</p>';
    }
    setInspectorTab("search");
  }

  async function searchProject(value) {
    const term = value.trim();
    if (term.length < 2) {
      query("[data-code-search-results]").replaceChildren();
      query("[data-code-search-summary]").textContent =
        "输入至少两个字符";
      query("[data-code-search-count]").textContent = "";
      return;
    }
    query("[data-code-search-summary]").textContent = "正在客户端搜索…";
    setInspectorTab("search");
    await startProjectIndex();
    renderSearchResults(textOccurrences(term), `“${term}”`);
  }

  function showReferences(name) {
    const references = (state.referencesByName.get(name) || []).map(
      (reference) => ({
        ...reference,
        preview: state.contents
          .get(reference.path)
          ?.split("\n")[reference.line - 1]
          ?.trim()
      })
    );
    renderSearchResults(references, `${name} 的引用`);
  }

  function showQuickPick(title, items) {
    const dialog = query("[data-code-quick-pick]");
    query("[data-code-quick-pick-title]").textContent = title;
    const target = query("[data-code-quick-pick-results]");
    target.replaceChildren();
    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.codeTargetPath = item.path;
      button.dataset.codeTargetLine = String(item.line);
      button.innerHTML =
        `<strong>${escapeHtml(item.name || item.path)}</strong>` +
        `<span>${escapeHtml(item.path)}:${item.line}</span>` +
        `<code>${escapeHtml(item.signature || "")}</code>`;
      target.append(button);
    });
    if (!dialog.open) dialog.showModal();
  }

  function goToDefinition(name) {
    const definitions = state.symbolsByName.get(name) || [];
    showReferences(name);
    if (definitions.length === 1) {
      openFile(definitions[0].path, definitions[0].line);
    } else if (definitions.length > 1) {
      showQuickPick(`选择 ${name} 的定义`, definitions);
    } else {
      renderSearchResults(textOccurrences(name), `“${name}” 的文本匹配`);
    }
  }

  function bindEvents() {
    root.addEventListener("click", (event) => {
      const file = event.target.closest("[data-code-file]");
      const open = event.target.closest("[data-code-open-file]");
      const close = event.target.closest("[data-code-close-file]");
      const target = event.target.closest("[data-code-target-path]");
      const symbol = event.target.closest("[data-code-symbol]");
      const line = event.target.closest("[data-code-line]");
      if (file) {
        openFile(file.dataset.codeFile);
        if (window.innerWidth <= 820) {
          root.classList.add("is-explorer-hidden");
        }
      } else if (open) {
        openFile(open.dataset.codeOpenFile);
      } else if (close) {
        closeFile(close.dataset.codeCloseFile);
      } else if (target) {
        const quickPick = target.closest("[data-code-quick-pick]");
        if (quickPick) quickPick.close();
        openFile(
          target.dataset.codeTargetPath,
          Number(target.dataset.codeTargetLine)
        );
        if (window.innerWidth <= 820) {
          root.classList.remove("is-inspector-open");
        }
      } else if (symbol) {
        goToDefinition(symbol.dataset.codeSymbol);
      } else if (line) {
        focusLine(Number(line.dataset.codeLine));
        updateUrl(state.activePath, Number(line.dataset.codeLine), true);
      }
    });

    queryAll("[data-code-inspector-tab]").forEach((button) => {
      button.addEventListener("click", () =>
        setInspectorTab(button.dataset.codeInspectorTab)
      );
    });
    query("[data-code-file-filter]").addEventListener("input", (event) =>
      renderFileTree(event.currentTarget.value)
    );
    query("[data-code-global-search]").addEventListener("input", (event) => {
      const value = event.currentTarget.value;
      if (window.innerWidth <= 820 && value.trim()) {
        root.classList.add("is-inspector-open");
      }
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(
        () => searchProject(value),
        180
      );
    });
    query("[data-code-toggle-explorer]").addEventListener("click", () => {
      root.classList.toggle("is-explorer-hidden");
    });
    query("[data-code-toggle-inspector]").addEventListener("click", () => {
      root.classList.toggle("is-inspector-open");
    });
    query("[data-code-copy-link]").addEventListener("click", async () => {
      await navigator.clipboard.writeText(window.location.href);
      setStatus("当前位置链接已复制");
    });
    query("[data-code-close-quick-pick]").addEventListener("click", () =>
      query("[data-code-quick-pick]").close()
    );
    document.addEventListener("keydown", (event) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && !event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        query("[data-code-file-filter]").focus();
      } else if (
        modifier &&
        event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        query("[data-code-global-search]").focus();
      }
    });
    window.addEventListener("popstate", () => {
      const url = new URL(window.location.href);
      const file = url.searchParams.get("file");
      if (file) {
        openFile(file, Number(url.searchParams.get("line")) || 1, {
          skipHistory: true
        });
      }
    });
  }

  async function initialize() {
    const response = await fetch(config.indexUrl);
    if (!response.ok) {
      throw new Error(`代码项目索引加载失败（HTTP ${response.status}）`);
    }
    const payload = await response.json();
    const url = new URL(window.location.href);
    const projectId = url.searchParams.get("project");
    state.project =
      payload.projects.find((project) => project.id === projectId) ||
      payload.projects[0];
    if (!state.project) {
      throw new Error("当前内容仓库没有代码工程");
    }
    state.project.files.forEach((file) =>
      state.fileByPath.set(file.path, file)
    );
    query("[data-code-project-title]").textContent = state.project.title;
    query("[data-code-project-meta]").textContent =
      `${state.project.language} · ${state.project.fileCount} files · ` +
      `${state.project.lineCount} lines`;
    query("[data-code-file-count]").textContent =
      `${state.project.fileCount} files`;
    query("[data-code-repository-link]").href =
      `${config.repositoryUrl}/tree/main/${state.project.sourceRoot}`;
    renderFileTree();
    renderReadingOrder();
    bindEvents();
    refreshIcons(root);
    const requested = url.searchParams.get("file");
    const initial = state.fileByPath.has(requested)
      ? requested
      : state.project.entry;
    await openFile(initial, Number(url.searchParams.get("line")) || 1, {
      replace: true
    });
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() => startProjectIndex(), {
        timeout: 800
      });
    } else {
      window.setTimeout(() => startProjectIndex(), 200);
    }
  }

  initialize().catch((error) => {
    setStatus(error.message);
    query("[data-code-empty] strong").textContent = "代码项目加载失败";
    query("[data-code-empty] span").textContent = error.message;
  });
})();
