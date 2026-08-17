(function () {
  "use strict";

  const config = window.GCK_CONFIG || {};
  const editorApi = (config.editorApi || "/editor/api").replace(/\/$/, "");
  const editorUrl = config.editorUrl || "/editor/";
  const state = {
    config: null,
    session: null,
    csrf: "",
    serverDrafts: [],
    drafts: [],
    localChanges: [],
    draftRevision: "",
    workspaceSnapshot: null,
    workspaceSyncTimer: 0,
    workspaceSyncPromise: null,
    workspaceRenderFrame: 0,
    editMode: window.localStorage.getItem("gck-edit-mode") === "1",
    inlinePanel: null,
    inlineEditor: null,
    onboardingStep: 0,
    onboardingSaving: false
  };

  function query(selector, root) {
    return (root || document).querySelector(selector);
  }

  function queryAll(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function refreshIcons(root) {
    if (!window.lucide) {
      return;
    }
    window.lucide.createIcons({
      attrs: { "stroke-width": 1.8 },
      root: root || document
    });
  }

  async function api(path, options) {
    const request = options || {};
    const headers = new Headers(request.headers || {});
    if (request.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (
      state.csrf &&
      !["GET", "HEAD"].includes((request.method || "GET").toUpperCase())
    ) {
      headers.set("X-CSRF-Token", state.csrf);
    }
    const response = await fetch(editorApi + path, {
      credentials: "same-origin",
      ...request,
      headers
    });
    const payload =
      response.status === 204
        ? null
        : await response.json().catch(function () {
            return {};
          });
    if (!response.ok) {
      const detail = payload && payload.detail;
      const error = new Error(
        Array.isArray(detail)
          ? detail.join("；")
          : typeof detail === "object"
            ? detail.message || "工作区状态发生冲突"
            : detail || "请求失败（HTTP " + response.status + "）"
      );
      error.status = response.status;
      error.detail = detail;
      throw error;
    }
    return payload;
  }

  function formPayload(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function feedback(target, message, success) {
    if (!target) {
      return;
    }
    target.textContent = message || "";
    target.className =
      "account-feedback" +
      (message ? " is-visible" : "") +
      (success ? " is-success" : "");
  }

  function currentReturnPath() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function githubAuthUrl(mode) {
    const parameters = new URLSearchParams({
      mode: mode,
      return_to: currentReturnPath()
    });
    return editorApi + "/auth/github?" + parameters.toString();
  }

  function takeGithubAuthError() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("github_auth_error");
    if (!code) {
      return "";
    }
    url.searchParams.delete("github_auth_error");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    return code === "access_denied"
      ? "GitHub 授权已取消，账号尚未绑定。"
      : "GitHub 认证失败，请重新尝试。";
  }

  function setAccountTab(name) {
    queryAll("[data-account-tab]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.accountTab === name);
    });
    query("[data-account-login-form]").hidden = name !== "login";
    query("[data-account-register-form]").hidden = name !== "register";
    feedback(query("[data-account-feedback]"), "");
  }

  function updateAccountView() {
    const trigger = query("[data-account-trigger]");
    const editButton = query("[data-edit-mode-trigger]");
    const label = query("[data-account-label]");
    const guest = query("[data-account-guest]");
    const profile = query("[data-account-user]");
    const githubLogin = query("[data-account-github-login]");
    const registerTab = query('[data-account-tab="register"]');
    document.body.dataset.editorState = "ready";
    trigger.disabled = false;
    trigger.removeAttribute("aria-busy");
    editButton.disabled = false;

    if (state.config) {
      registerTab.disabled = !state.config.registration_enabled;
      query("[data-account-policy]").textContent =
        state.config.edit_policy === "github_verified"
          ? "当前策略要求 GitHub 认证后才能编辑。"
          : "当前策略允许本地账号直接编辑。";
      if (state.config.github_oauth_enabled) {
        githubLogin.href = githubAuthUrl("login");
        githubLogin.removeAttribute("aria-disabled");
        githubLogin.innerHTML =
          '<i data-lucide="github" aria-hidden="true"></i>使用 GitHub 登录';
      } else {
        githubLogin.removeAttribute("href");
        githubLogin.setAttribute("aria-disabled", "true");
        githubLogin.innerHTML =
          '<i data-lucide="github" aria-hidden="true"></i>GitHub 登录未配置';
      }
    }

    if (!state.session || !state.session.authenticated) {
      document.body.classList.remove("can-edit-content");
      guest.hidden = false;
      profile.hidden = true;
      trigger.classList.remove("is-authenticated");
      label.textContent = "登录";
      applyEditMode(false);
      refreshIcons();
      return;
    }

    const user = state.session.user;
    document.body.classList.toggle(
      "can-edit-content",
      Boolean(state.session.can_edit && !user.must_change_password)
    );
    guest.hidden = true;
    profile.hidden = false;
    trigger.classList.add("is-authenticated");
    label.textContent = user.username;
    query("[data-account-avatar]").textContent =
      user.username.slice(0, 1).toUpperCase();
    query("[data-account-username]").textContent = user.username;
    query("[data-account-email]").textContent = user.email;
    query("[data-account-github-status]").textContent = user.github_login
      ? "@" + user.github_login
      : "未绑定";
    query("[data-account-draft-count]").textContent =
      state.drafts.length + " 个";
    query("[data-account-admin]").hidden = user.role !== "admin";

    const bind = query("[data-account-bind-github]");
    const unlink = query("[data-account-unlink-github]");
    bind.hidden = Boolean(user.github_login);
    unlink.hidden = !user.github_login;
    if (state.config && state.config.github_oauth_enabled) {
      bind.href = githubAuthUrl("bind");
      bind.removeAttribute("aria-disabled");
    } else {
      bind.removeAttribute("href");
      bind.setAttribute("aria-disabled", "true");
      bind.title = "需要先配置 GitHub OAuth";
    }

    if (user.must_change_password) {
      feedback(
        query("[data-account-feedback]"),
        "首次登录需要先在编辑工作台修改密码。"
      );
    }
    applyEditMode(state.editMode && state.session.can_edit);
    refreshIcons();
  }

  async function loadDrafts() {
    if (!state.session || !state.session.authenticated || !state.session.can_edit) {
      state.serverDrafts = [];
      state.drafts = [];
      return;
    }
    try {
      const payload = await api("/drafts");
      state.serverDrafts = payload.items || [];
      state.draftRevision = payload.revision || "";
      refreshEffectiveDrafts();
    } catch {
      refreshEffectiveDrafts();
    }
  }

  function localBufferChanges() {
    const buffers = editorBufferApi();
    const userId = editorUserId();
    if (!buffers || !buffers.list || !userId) {
      return [];
    }
    return buffers.list(window.localStorage, userId);
  }

  function refreshEffectiveDrafts() {
    state.localChanges = localBufferChanges();
    const drafts = new Map(
      state.serverDrafts.map(function (draft) {
        return [draft.path, { ...draft, local: false }];
      })
    );
    state.localChanges.forEach(function (change) {
      const remote = drafts.get(change.path);
      drafts.set(change.path, {
        ...(remote || {}),
        path: change.path,
        content: change.content,
        operation: change.operation || "upsert",
        base_sha: change.baseSha || (remote && remote.base_sha) || null,
        revision: Number(change.serverRevision) || 0,
        updated_at: change.updatedAt,
        local: true,
        conflict: Boolean(change.conflict)
      });
    });
    state.drafts = Array.from(drafts.values()).sort(function (left, right) {
      return Number(right.updated_at || 0) - Number(left.updated_at || 0);
    });
    rebuildWorkspaceSnapshot();
  }

  function rebuildWorkspaceSnapshot() {
    const tree = window.GCKWorkspaceTree;
    const root = config.editorContext && config.editorContext.root;
    if (!tree || !root) {
      state.workspaceSnapshot = null;
      return;
    }
    const entries = tree.mergeEntries(
      config.workspaceEntries || [],
      state.serverDrafts,
      state.localChanges
    );
    state.workspaceSnapshot = tree.buildModuleTree(root, entries);
    const userId = editorUserId();
    if (userId) {
      tree.cacheSnapshot(
        window.localStorage,
        userId,
        config.contentVersion,
        root,
        state.workspaceSnapshot
      );
    }
  }

  async function discardDraft(draft) {
    removeEditorBuffer(draft.path);
    if (draft.id) {
      await api("/drafts/" + draft.id, { method: "DELETE" });
      state.serverDrafts = state.serverDrafts.filter(function (item) {
        return item.id !== draft.id;
      });
      state.draftRevision = "";
    }
    refreshEffectiveDrafts();
    updateAccountView();
    addDraftNavigation();
  }

  function requestedDraftPath() {
    return new URLSearchParams(window.location.search).get("draft");
  }

  function draftLink(path) {
    const url = new URL(window.location.href);
    url.searchParams.set("draft", path);
    url.hash = "";
    return url.pathname + url.search;
  }

  function resolveEditorLink(href, sourcePath) {
    const value = (href || "").trim();
    if (!value) {
      return "";
    }
    if (
      value.startsWith("#") ||
      /^(?:https?:|mailto:|tel:)/i.test(value)
    ) {
      return value;
    }
    if (
      value.startsWith("//") ||
      /^[a-z][a-z0-9+.-]*:/i.test(value)
    ) {
      return "";
    }

    let targetUrl;
    try {
      targetUrl = new URL(
        value,
        "https://content.invalid/" + sourcePath.replace(/^\/+/, "")
      );
    } catch {
      return "";
    }

    let target;
    try {
      target = decodeURI(targetUrl.pathname).replace(/^\/+/, "");
    } catch {
      return "";
    }
    const routes = config.contentRoutes || {};
    const directRoute = Object.values(routes).find(function (route) {
      return route === targetUrl.pathname;
    });
    if (directRoute) {
      return targetUrl.pathname + targetUrl.search + targetUrl.hash;
    }
    if (targetUrl.pathname.endsWith("/")) {
      target += "README.md";
    }
    const route =
      routes[target] ||
      routes[target + ".md"] ||
      routes[target.replace(/\/?$/, "/README.md")];
    if (route) {
      const base = (config.basePath || "").replace(/\/$/, "");
      return base + route + targetUrl.search + targetUrl.hash;
    }
    return (
      (config.rawBase || "/raw/") +
      target
        .split("/")
        .map(function (part) {
          return encodeURIComponent(part);
        })
        .join("/") +
      targetUrl.search +
      targetUrl.hash
    );
  }

  function draftTitle(draft) {
    const heading = draft.content.match(/^#\s+(.+?)\s*$/m);
    return heading
      ? heading[1].replace(/[*_`]/g, "")
      : draft.path.split("/").pop();
  }

  function draftStatus(draft) {
    return draft.operation === "delete" ? "D" : draft.base_sha ? "M" : "A";
  }

  function showDraftBadge(host, draft) {
    const header = query(".article-header, .module-page-header", host);
    if (!header) {
      return;
    }
    const status = draftStatus(draft);
    let badge = query("[data-draft-badge]", header);
    if (!badge) {
      badge = document.createElement("p");
      badge.dataset.draftBadge = "";
      header.append(badge);
    }
    badge.className =
      "draft-page-badge " +
      (status === "A"
        ? "is-add"
        : status === "M"
          ? "is-modify"
          : "is-delete");
    badge.dataset.status = status;
    badge.textContent = draft.conflict
      ? "冲突 · 本地更改已保留"
      : (
          status === "A"
            ? "新增"
            : status === "M"
              ? "已修改"
              : "已删除"
        ) + " · 个人未提交草稿";
  }

  function addDraftNavigation() {
    const snapshot = state.workspaceSnapshot;
    if (!snapshot) return;
    const docsNavigation = query(".docs-navigation");
    if (docsNavigation) {
      docsNavigation.replaceChildren();
      if (snapshot.rootDocuments.length) {
        docsNavigation.append(
          renderRootDocumentsNavigation(snapshot.rootDocuments)
        );
      }
      snapshot.rootUnits.forEach(function (unit) {
        docsNavigation.append(renderNavigationUnit(unit, 0));
      });
      refreshIcons(docsNavigation);
    }

    const unitList = query(".module-unit-list");
    if (unitList) {
      unitList.replaceChildren();
      if (snapshot.rootDocuments.length) {
        unitList.append(renderRootDocuments(snapshot.rootDocuments));
      }
      snapshot.rootUnits.forEach(function (unit) {
        unitList.append(renderModuleUnit(unit, 0));
      });
      if (!snapshot.rootUnits.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "该模块暂无内容。";
        unitList.append(empty);
      }
      refreshIcons(unitList);
    }
    updateWorkspaceDeleteControls();
  }

  function renderRootDocumentsNavigation(entries) {
    const section = document.createElement("section");
    section.className = "docs-nav-unit workspace-nav-unit";
    const title = document.createElement("p");
    title.className = "docs-nav-unit-title";
    title.textContent = "直属文件";
    const list = document.createElement("ol");
    entries.forEach(function (entry) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = workspaceEntryHref(entry);
      const icon = document.createElement("i");
      icon.dataset.lucide =
        entry.kind === "code" ? "file-code-2" : "file-text";
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = entry.title;
      link.append(icon, label);
      appendWorkspaceStatus(link, entry.status, entry.conflict);
      item.append(link);
      list.append(item);
    });
    section.append(title, list);
    return section;
  }

  function renderRootDocuments(entries) {
    const branch = document.createElement("section");
    branch.className = "module-unit-branch workspace-unit-branch";
    const article = document.createElement("article");
    article.className = "module-unit";
    const summary = document.createElement("div");
    summary.className = "module-unit-summary";
    const meta = document.createElement("p");
    meta.className = "unit-meta";
    meta.textContent = entries.length + " 篇";
    const heading = document.createElement("h3");
    heading.textContent = "直属文件";
    const description = document.createElement("p");
    description.textContent = "直接归属于当前大模块的内容。";
    summary.append(meta, heading, description);
    const content = document.createElement("div");
    content.className = "module-unit-content";
    const list = document.createElement("ol");
    list.className = "module-unit-documents";
    entries.forEach(function (entry) {
      const item = document.createElement("li");
      item.className = "module-document-row";
      const link = document.createElement("a");
      link.href = workspaceEntryHref(entry);
      const icon = document.createElement("i");
      icon.dataset.lucide =
        entry.kind === "code" ? "file-code-2" : "file-text";
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = entry.title;
      const chevron = document.createElement("i");
      chevron.dataset.lucide = "chevron-right";
      chevron.setAttribute("aria-hidden", "true");
      link.append(icon, label);
      appendWorkspaceStatus(link, entry.status, entry.conflict);
      link.append(chevron);
      item.append(
        link,
        createWorkspaceDeleteAction(
          entry.path,
          "file",
          entry.title,
          "删除文件"
        )
      );
      list.append(item);
    });
    content.append(list);
    article.append(summary, content);
    branch.append(article);
    return branch;
  }

  function workspaceEntryHref(entry) {
    if (!entry) return "#";
    if (entry.status || !entry.route) {
      return draftLink(entry.path);
    }
    return (
      (config.basePath || "").replace(/\/$/, "") +
      entry.route
    );
  }

  function appendWorkspaceStatus(target, status, conflict) {
    if (!status) return;
    target.dataset.status = status;
    const badge = document.createElement("small");
    badge.className = "draft-change-badge";
    badge.dataset.status = status;
    badge.textContent = conflict ? "!" : status;
    badge.title = conflict ? "本地与服务器草稿冲突" : "Git " + status;
    target.append(badge);
  }

  function renderNavigationUnit(unit, depth) {
    const section = document.createElement("section");
    section.className =
      "docs-nav-unit workspace-nav-unit" +
      (depth ? " is-subunit" : "");
    if (unit.status) section.dataset.status = unit.status;
    const title = document.createElement("a");
    title.className = "docs-nav-unit-title";
    title.href = workspaceEntryHref(unit.readme);
    title.textContent = unit.title;
    if (unit.readme.operation === "delete") {
      title.classList.add("is-deleted-draft");
    }
    appendWorkspaceStatus(title, unit.status, unit.readme.conflict);
    section.append(title);
    if (unit.documents.length) {
      const list = document.createElement("ol");
      unit.documents.forEach(function (entry) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = workspaceEntryHref(entry);
        if (entry.operation === "delete") {
          link.classList.add("is-deleted-draft");
        }
        const icon = document.createElement("i");
        icon.dataset.lucide =
          entry.kind === "code" ? "file-code-2" : "file-text";
        icon.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.textContent = entry.title;
        link.append(icon, label);
        appendWorkspaceStatus(link, entry.status, entry.conflict);
        item.append(link);
        list.append(item);
      });
      section.append(list);
    }
    if (unit.children.length) {
      const children = document.createElement("div");
      children.className = "docs-nav-children";
      unit.children.forEach(function (child) {
        children.append(renderNavigationUnit(child, depth + 1));
      });
      section.append(children);
    }
    return section;
  }

  function createWorkspaceAction(kind, root, parent, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.createContext = kind;
    button.dataset.createRoot = root;
    button.dataset.createParent = parent;
    button.title = label;
    button.setAttribute("aria-label", label);
    const icon = document.createElement("i");
    icon.dataset.lucide = kind === "module" ? "folder-plus" : "file-plus-2";
    icon.setAttribute("aria-hidden", "true");
    button.append(icon, document.createTextNode(
      kind === "module" ? "子模块" : "文件"
    ));
    return button;
  }

  function createWorkspaceDeleteAction(path, kind, label, text) {
    const button = document.createElement("button");
    button.className =
      kind === "file"
        ? "workspace-delete-action edit-mode-only"
        : "workspace-scope-delete edit-mode-only";
    button.type = "button";
    button.dataset.deletePath = path;
    button.dataset.deleteKind = kind;
    button.dataset.deleteLabel = label;
    button.dataset.editModeOnly = "";
    button.title = text;
    button.setAttribute("aria-label", text + "：" + label);
    const icon = document.createElement("i");
    icon.dataset.lucide = "trash-2";
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
    if (kind !== "file") {
      button.append(document.createTextNode(text));
    }
    return button;
  }

  function renderModuleUnit(unit, depth) {
    const branch = document.createElement("section");
    branch.className =
      "module-unit-branch workspace-unit-branch" +
      (depth ? " is-subunit" : "");
    branch.dataset.unitDepth = String(depth);
    if (unit.status) branch.dataset.status = unit.status;
    const article = document.createElement("article");
    article.className = "module-unit";
    const summary = document.createElement("div");
    summary.className = "module-unit-summary";
    const metadata = document.createElement("p");
    metadata.className = "unit-meta";
    const articleCount = unit.documents.filter(function (entry) {
      return entry.kind === "markdown" && entry.operation !== "delete";
    }).length;
    const codeCount = unit.documents.filter(function (entry) {
      return entry.kind === "code" && entry.operation !== "delete";
    }).length;
    metadata.textContent =
      (depth ? "子专题 · " : "") +
      articleCount +
      " 篇" +
      (codeCount ? " · " + codeCount + " 个源码文件" : "");
    if (unit.changeCount) {
      metadata.textContent += " · " + unit.changeCount + " 项更改";
    }
    const heading = document.createElement("h3");
    const headingLink = document.createElement("a");
    headingLink.href = workspaceEntryHref(unit.readme);
    headingLink.textContent = unit.title;
    if (unit.readme.operation === "delete") {
      headingLink.classList.add("is-deleted-draft");
    }
    heading.append(headingLink);
    appendWorkspaceStatus(heading, unit.status, unit.readme.conflict);
    const description = document.createElement("p");
    description.textContent = unit.description || "待补充专题简介。";
    const actions = document.createElement("div");
    actions.className = "unit-editor-actions edit-mode-only";
    actions.dataset.editModeOnly = "";
    actions.append(
      createWorkspaceAction(
        "module",
        state.workspaceSnapshot.root,
        unit.id,
        "在 " + unit.title + " 下新建子模块"
      ),
      createWorkspaceAction(
        "file",
        state.workspaceSnapshot.root,
        unit.id,
        "在 " + unit.title + " 下新建文件"
      ),
      createWorkspaceDeleteAction(
        unit.id,
        "directory",
        unit.title,
        depth ? "删除子模块" : "删除模块"
      )
    );
    summary.append(metadata, heading, description, actions);

    const content = document.createElement("div");
    content.className = "module-unit-content";
    if (unit.children.length) {
      const group = document.createElement("section");
      group.className = "module-unit-content-group";
      const label = document.createElement("p");
      label.className = "module-unit-content-label";
      label.textContent = "子专题";
      const children = document.createElement("div");
      children.className = "module-subunit-list";
      unit.children.forEach(function (child) {
        children.append(renderModuleUnit(child, depth + 1));
      });
      group.append(label, children);
      content.append(group);
    }
    if (unit.documents.length) {
      const group = document.createElement("section");
      group.className = "module-unit-content-group";
      if (unit.children.length) {
        const label = document.createElement("p");
        label.className = "module-unit-content-label";
        label.textContent = "文件";
        group.append(label);
      }
      const list = document.createElement("ol");
      list.className = "module-unit-documents";
      unit.documents.forEach(function (entry) {
        const item = document.createElement("li");
        item.className = "module-document-row";
        const link = document.createElement("a");
        link.href = workspaceEntryHref(entry);
        if (entry.operation === "delete") {
          link.classList.add("is-deleted-draft");
        }
        const icon = document.createElement("i");
        icon.dataset.lucide =
          entry.kind === "code" ? "file-code-2" : "file-text";
        icon.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.textContent = entry.title;
        const chevron = document.createElement("i");
        chevron.dataset.lucide = "chevron-right";
        chevron.setAttribute("aria-hidden", "true");
        link.append(icon, label);
        appendWorkspaceStatus(link, entry.status, entry.conflict);
        link.append(chevron);
        item.append(
          link,
          createWorkspaceDeleteAction(
            entry.path,
            "file",
            entry.title,
            "删除文件"
          )
        );
        list.append(item);
      });
      group.append(list);
      content.append(group);
    }
    article.append(summary, content);
    branch.append(article);
    return branch;
  }

  function showDeletedDraft(host, draft) {
    const rendered = query("[data-editable-rendered]", host);
    if (!rendered) {
      return;
    }
    const notice = document.createElement("section");
    notice.className = "deleted-draft-notice";
    notice.dataset.status = "D";
    const copy = document.createElement("div");
    copy.innerHTML =
      '<i data-lucide="file-x-2" aria-hidden="true"></i>' +
      "<div><strong>此文件已标记删除</strong>" +
      "<span>提交 Draft PR 后，该文件会从内容仓库移除。</span></div>";
    const undo = document.createElement("button");
    undo.className = "secondary-button";
    undo.type = "button";
    undo.textContent = "撤销删除";
    undo.addEventListener("click", async function () {
      await discardDraft(draft);
      window.location.reload();
    });
    notice.append(copy, undo);
    rendered.replaceChildren(notice);
    rendered.dataset.draftOverlay = "true";
    showDraftBadge(host, draft);
    refreshIcons(notice);
  }

  async function applyDraftsToReader(activeDraftHtml) {
    addDraftNavigation();
    const host = query("[data-editor-host]");
    if (!host) {
      return;
    }
    const requested = requestedDraftPath();
    const sourcePath = requested || host.dataset.editorSource;
    const draft = state.drafts.find(function (item) {
      return item.path === sourcePath;
    });
    if (!draft) {
      return;
    }
    host.dataset.editorSource = draft.path;
    if (draft.operation === "delete") {
      showDeletedDraft(host, draft);
      return;
    }
    try {
      const html =
        (!draft.local && activeDraftHtml) ||
        (
          await api("/preview", {
            method: "POST",
            body: JSON.stringify({ content: draft.content })
          })
        ).html;
      renderMarkdownIntoHost(host, html);
      showDraftBadge(host, draft);
    } catch {
      // Invalid drafts stay available in the workspace for correction.
    }
  }

  async function loadIdentity() {
    const sourcePath =
      requestedDraftPath() ||
      (config.editorContext && config.editorContext.sourcePath) ||
      "";
    const bootstrapPath =
      "/bootstrap" +
      (sourcePath ? "?path=" + encodeURIComponent(sourcePath) : "");
    const bootstrap =
      window.GCK_EDITOR_BOOTSTRAP ||
      api(bootstrapPath);
    let payload = await bootstrap;
    if (payload.bootstrap_error) {
      payload = await api(bootstrapPath);
    }
    window.GCK_EDITOR_BOOTSTRAP = null;
    state.config = payload.config;
    state.session = payload.session;
    state.csrf = state.session.authenticated
      ? state.session.csrf_token
      : "";
    state.serverDrafts = payload.drafts || [];
    state.draftRevision = payload.draft_revision || "";
    refreshEffectiveDrafts();
    const githubAuthError = takeGithubAuthError();
    updateAccountView();
    if (githubAuthError) {
      openAccount();
      feedback(query("[data-account-feedback]"), githubAuthError);
    }
    await applyDraftsToReader(payload.active_draft_html);
    const onboardingOpen = openOnboardingIfNeeded();
    if (
      !onboardingOpen &&
      state.editMode &&
      state.session.authenticated &&
      state.session.can_edit &&
      !state.session.user.must_change_password
    ) {
      await openCurrentEditor();
    }
    beginWorkspaceSync();
  }

  function renderOnboarding() {
    const steps = queryAll("[data-onboarding-step]");
    const progress = queryAll("[data-onboarding-progress]");
    steps.forEach(function (step, index) {
      step.hidden = index !== state.onboardingStep;
    });
    progress.forEach(function (item, index) {
      item.classList.toggle("is-active", index <= state.onboardingStep);
    });
    query("[data-onboarding-counter]").textContent =
      state.onboardingStep + 1 + " / " + steps.length;
    query("[data-onboarding-previous]").hidden = state.onboardingStep === 0;
    query("[data-onboarding-next]").hidden =
      state.onboardingStep === steps.length - 1;
    query("[data-onboarding-finish]").hidden =
      state.onboardingStep !== steps.length - 1;
    refreshIcons(query("[data-onboarding-dialog]"));
  }

  function openOnboardingIfNeeded() {
    const user =
      state.session && state.session.authenticated
        ? state.session.user
        : null;
    if (!user || user.must_change_password || !user.needs_onboarding) {
      return false;
    }
    const account = query("[data-account-dialog]");
    const dialog = query("[data-onboarding-dialog]");
    if (account && account.open) {
      account.close();
    }
    state.onboardingStep = 0;
    renderOnboarding();
    feedback(query("[data-onboarding-feedback]"), "");
    if (!dialog.open) {
      dialog.showModal();
    }
    return true;
  }

  async function completeOnboarding() {
    if (state.onboardingSaving) {
      return;
    }
    state.onboardingSaving = true;
    const dialog = query("[data-onboarding-dialog]");
    const buttons = queryAll("button", dialog);
    buttons.forEach(function (button) {
      button.disabled = true;
    });
    feedback(query("[data-onboarding-feedback]"), "");
    try {
      await api("/onboarding/complete", { method: "POST" });
      state.session.user.needs_onboarding = false;
      dialog.close();
    } catch (error) {
      feedback(query("[data-onboarding-feedback]"), error.message);
    } finally {
      state.onboardingSaving = false;
      buttons.forEach(function (button) {
        button.disabled = false;
      });
    }
  }

  function openAccount() {
    const dialog = query("[data-account-dialog]");
    feedback(query("[data-account-feedback]"), "");
    if (!dialog.open) {
      dialog.showModal();
    }
  }

  function ensureEditorAccess() {
    if (!state.session || !state.session.authenticated) {
      openAccount();
      feedback(query("[data-account-feedback]"), "请先登录后再编辑。");
      return false;
    }
    if (state.session.user.must_change_password) {
      openAccount();
      feedback(
        query("[data-account-feedback]"),
        "首次登录需要先在编辑工作台修改密码。"
      );
      return false;
    }
    if (!state.session.can_edit) {
      openAccount();
      feedback(
        query("[data-account-feedback]"),
        "当前策略要求先绑定并验证 GitHub 账号。"
      );
      return false;
    }
    return true;
  }

  function readerEditMode() {
    return state.config && state.config.reader_edit_mode === "new"
      ? "new"
      : "old";
  }

  function applyEditMode(enabled) {
    state.editMode = Boolean(enabled);
    document.body.classList.toggle("is-edit-mode", state.editMode);
    document.body.classList.toggle(
      "reader-edit-new",
      state.editMode && readerEditMode() === "new"
    );
    document.body.classList.toggle(
      "reader-edit-old",
      state.editMode && readerEditMode() === "old"
    );
    window.localStorage.setItem("gck-edit-mode", state.editMode ? "1" : "0");
    const button = query("[data-edit-mode-trigger]");
    if (button) {
      const label = query("[data-edit-mode-label]", button);
      button.classList.toggle("is-active", state.editMode);
      button.setAttribute(
        "aria-label",
        state.editMode ? "退出编辑模式" : "进入编辑模式"
      );
      if (label) {
        label.textContent = state.editMode ? "退出" : "编辑";
      }
      button.innerHTML = state.editMode
        ? '<i data-lucide="eye" aria-hidden="true"></i><span data-edit-mode-label>退出</span>'
        : '<i data-lucide="square-pen" aria-hidden="true"></i><span data-edit-mode-label>编辑</span>';
      refreshIcons(button);
    }
  }

  async function openCurrentEditor() {
    const host = query("[data-editor-host]");
    if (!host || state.inlinePanel) {
      return;
    }
    const sourcePath =
      host.dataset.editorSource ||
      (config.editorContext && config.editorContext.sourcePath);
    const draft = state.drafts.find(function (item) {
      return item.path === sourcePath;
    });
    if (draft && draft.operation === "delete") {
      return;
    }
    await openInlineEditor(host);
  }

  function setInlineFeedback(panel, message, kind) {
    const target = query("[data-inline-feedback]", panel);
    target.textContent = message;
    target.className =
      "inline-editor-feedback" +
      (kind ? " is-" + kind : "");
  }

  function editorBufferApi() {
    return window.GCKEditorBuffer || null;
  }

  function editorUserId() {
    return (
      state.session &&
      state.session.authenticated &&
      state.session.user.id
    );
  }

  function readEditorBuffer(path) {
    const buffers = editorBufferApi();
    const userId = editorUserId();
    if (!buffers || !userId) {
      return null;
    }
    return buffers.read(window.localStorage, userId, path);
  }

  function removeEditorBuffer(path) {
    const buffers = editorBufferApi();
    const userId = editorUserId();
    if (buffers && userId) {
      buffers.remove(window.localStorage, userId, path);
    }
  }

  function writeEditorBuffer(path, value) {
    const buffers = editorBufferApi();
    const userId = editorUserId();
    if (!buffers || !userId) return null;
    const saved = buffers.write(window.localStorage, userId, path, value);
    scheduleWorkspaceRender();
    return saved;
  }

  function scheduleWorkspaceRender() {
    if (state.workspaceRenderFrame) return;
    state.workspaceRenderFrame = window.requestAnimationFrame(function () {
      state.workspaceRenderFrame = 0;
      refreshEffectiveDrafts();
      addDraftNavigation();
      updateAccountView();
    });
  }

  function replaceServerDraft(saved) {
    const index = state.serverDrafts.findIndex(function (item) {
      return item.path === saved.path;
    });
    if (index >= 0) state.serverDrafts[index] = saved;
    else state.serverDrafts.push(saved);
    state.draftRevision = "";
    refreshEffectiveDrafts();
  }

  function mergeLocalWithRemote(change, remote) {
    if (
      !remote ||
      typeof change.baseContent !== "string" ||
      !window.JsDiff
    ) {
      return null;
    }
    const patch = window.JsDiff.createPatch(
      change.path,
      change.baseContent,
      change.content,
      "",
      ""
    );
    const merged = window.JsDiff.applyPatch(remote.content, patch);
    return typeof merged === "string" ? merged : null;
  }

  async function syncBufferedChange(change, options, retried) {
    try {
      const saved = await api("/drafts", {
        method: "PUT",
        keepalive: Boolean(options && options.keepalive),
        body: JSON.stringify({
          path: change.path,
          content: change.operation === "delete" ? "" : change.content,
          base_sha: change.baseSha || null,
          base_revision: Number(change.serverRevision) || 0,
          operation: change.operation || "upsert"
        })
      });
      replaceServerDraft(saved);
      const latest = readEditorBuffer(change.path);
      if (!latest || latest.updatedAt === change.updatedAt) {
        removeEditorBuffer(change.path);
      } else {
        latest.serverRevision = saved.revision;
        latest.baseContent = saved.content;
        writeEditorBuffer(change.path, latest);
      }
      refreshEffectiveDrafts();
      const panel = state.inlinePanel;
      if (
        panel &&
        panel.dataset.path === change.path &&
        panel.bufferedContent === change.content
      ) {
        panel.dataset.draftId = String(saved.id);
        panel.serverRevision = saved.revision;
        panel.lastSyncedContent = saved.content;
        panel.originalContent = saved.content;
        setEditorSyncState(
          panel,
          "synced",
          "更改已同步到服务器。",
          "success"
        );
      }
      return saved;
    } catch (error) {
      const remote =
        error.status === 409 &&
        error.detail &&
        error.detail.code === "draft_revision_conflict"
          ? error.detail.draft
          : null;
      if (
        !retried &&
        remote &&
        change.operation === "delete"
      ) {
        const updated = {
          ...change,
          serverRevision: remote.revision,
          conflict: false,
          updatedAt: Date.now()
        };
        writeEditorBuffer(change.path, updated);
        replaceServerDraft(remote);
        return syncBufferedChange(updated, options, true);
      }
      if (!retried && remote) {
        const merged = mergeLocalWithRemote(change, remote);
        if (merged !== null) {
          const updated = {
            ...change,
            content: merged,
            baseContent: remote.content,
            serverRevision: remote.revision,
            conflict: false,
            updatedAt: Date.now()
          };
          writeEditorBuffer(change.path, updated);
          replaceServerDraft(remote);
          return syncBufferedChange(updated, options, true);
        }
      }
      writeEditorBuffer(change.path, {
        ...change,
        conflict:
          error.status === 409 ||
          Boolean(change.conflict),
        updatedAt: change.updatedAt || Date.now()
      });
      return null;
    }
  }

  async function pullServerDrafts() {
    if (!state.session || !state.session.can_edit) return false;
    const suffix = state.draftRevision
      ? "?revision=" + encodeURIComponent(state.draftRevision)
      : "";
    const payload = await api("/drafts" + suffix);
    state.draftRevision = payload.revision || state.draftRevision;
    if (!payload.changed) return false;
    state.serverDrafts = payload.items || [];
    refreshEffectiveDrafts();
    addDraftNavigation();
    return true;
  }

  async function syncWorkspaceState(options) {
    if (
      state.workspaceSyncPromise ||
      !state.session ||
      !state.session.can_edit
    ) {
      return state.workspaceSyncPromise;
    }
    state.workspaceSyncPromise = (async function () {
      try {
        await pullServerDrafts();
      } catch {
        // Local changes remain authoritative while the server is unavailable.
      }
      const changes = localBufferChanges();
      for (const change of changes) {
        await syncBufferedChange(change, options, false);
      }
      refreshEffectiveDrafts();
      addDraftNavigation();
      updateAccountView();
    })().finally(function () {
      state.workspaceSyncPromise = null;
    });
    return state.workspaceSyncPromise;
  }

  function beginWorkspaceSync() {
    window.clearInterval(state.workspaceSyncTimer);
    if (!state.session || !state.session.can_edit) return;
    const seconds = Math.max(
      15,
      Math.min(
        3600,
        Number(state.config.workspace_sync_interval_seconds) || 60
      )
    );
    window.setTimeout(function () {
      pullServerDrafts()
        .then(function () {
          refreshEffectiveDrafts();
          addDraftNavigation();
          updateAccountView();
        })
        .catch(function () {
          // Cached worktree remains usable while the server is unavailable.
        });
    }, 0);
    state.workspaceSyncTimer = window.setInterval(function () {
      if (!document.hidden) syncWorkspaceState();
    }, seconds * 1000);
  }

  function createInlinePanel(host, sourcePath) {
    const panel = document.createElement("section");
    panel.className = "inline-editor";
    const modern = readerEditMode() === "new";
    panel.classList.toggle("is-modern", modern);
    panel.classList.toggle(
      "is-compact",
      Boolean(host.closest(".module-page-shell"))
    );
    panel.dataset.inlineEditor = "";
    panel.hidden = modern;
    document.body.classList.add("has-inline-editor");

    const visualEditor = document.createElement("div");
    visualEditor.dataset.visualEditor = "";
    const textarea = document.createElement("textarea");
    textarea.dataset.inlineInput = "";
    textarea.setAttribute("aria-label", "编辑 " + sourcePath);
    textarea.spellcheck = false;
    const status = document.createElement("div");
    status.className = "inline-editor-feedback";
    status.dataset.inlineFeedback = "";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "正在加载源文件…";
    if (!modern) {
      const toolbar = document.createElement("div");
      toolbar.className = "inline-editor-toolbar";
      const path = document.createElement("span");
      path.className = "inline-editor-path";
      path.textContent = sourcePath;
      const actions = document.createElement("div");
      actions.className = "inline-editor-actions";
      const remove = document.createElement("button");
      remove.className = "danger-button";
      remove.type = "button";
      remove.dataset.inlineDelete = "";
      remove.textContent = "删除文件";
      const close = document.createElement("button");
      close.className = "secondary-button";
      close.type = "button";
      close.dataset.inlineClose = "";
      close.textContent = "关闭";
      const save = document.createElement("button");
      save.className = "primary-button";
      save.dataset.inlineSave = "";
      save.textContent = "保存草稿";
      actions.append(remove, close, save);
      toolbar.append(path, actions);
      panel.append(toolbar);
    }
    panel.append(visualEditor, textarea, status);

    const rendered = query("[data-editable-rendered]", host);
    if (rendered) {
      rendered.before(panel);
      if (!modern) {
        rendered.hidden = true;
      }
    } else {
      host.append(panel);
    }
    return panel;
  }

  async function closeInlineEditor(options) {
    if (!state.inlinePanel) {
      return;
    }
    const panel = state.inlinePanel;
    const settings = options || {};
    const host = panel.closest("[data-editor-host]");
    const rendered = query("[data-editable-rendered]", host);
    panel.closing = true;
    if (panel.classList.contains("is-modern") && panel.ready) {
      const buffered = cacheInlineEditor(panel);
      panel.inert = true;
      if (panel.titleElement) {
        panel.titleElement.removeAttribute("contenteditable");
        panel.titleElement.removeAttribute("role");
        panel.titleElement.removeAttribute("aria-label");
      }
      if (
        settings.renderLatest !== false &&
        buffered &&
        buffered.serialized !== panel.renderedContent &&
        panel.dataset.path.toLowerCase().endsWith(".md")
      ) {
        try {
          const preview = await api("/preview", {
            method: "POST",
            body: JSON.stringify({ content: buffered.serialized })
          });
          renderMarkdownIntoHost(host, preview.html);
        } catch {
          // The latest local buffer remains available for the next edit session.
        }
      }
    }
    window.clearInterval(panel.syncTimer);
    if (rendered) {
      rendered.hidden = false;
    }
    if (panel.titleElement && !panel.inert) {
      panel.titleElement.removeAttribute("contenteditable");
      panel.titleElement.removeAttribute("role");
      panel.titleElement.removeAttribute("aria-label");
    }
    if (state.inlineEditor) {
      state.inlineEditor.destroy();
      state.inlineEditor = null;
    }
    panel.remove();
    state.inlinePanel = null;
    document.body.classList.remove("has-inline-editor");
  }

  function renderMarkdownIntoHost(host, html) {
    const rendered = query("[data-editable-rendered]", host);
    if (!rendered) {
      return;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    const heading = template.content.querySelector("h1");
    if (heading) {
      const pageTitle = query(
        ".article-header h1, .module-page-header h1",
        host
      );
      if (pageTitle && !pageTitle.isContentEditable) {
        pageTitle.textContent = heading.textContent;
      }
      heading.remove();
    }
    const prose = document.createElement("div");
    prose.className = host.closest(".module-page-shell")
      ? "module-introduction prose compact-prose draft-rendered-content"
      : "prose draft-rendered-content";
    prose.append(template.content);
    rendered.replaceChildren(prose);
    rendered.dataset.draftOverlay = "true";
    if (window.GCKMermaid) {
      window.GCKMermaid.render(prose);
    }
  }

  function splitMarkdownDocument(content) {
    const match = content.match(/^#\s+(.+?)\s*$/m);
    if (!match || match.index === undefined) {
      return {
        prefix: "",
        title: "",
        body: content
      };
    }
    const lineEnd = content.indexOf("\n", match.index + match[0].length);
    return {
      prefix: content.slice(0, match.index),
      title: match[1].replace(/[*_`]/g, "").trim(),
      body:
        lineEnd < 0
          ? ""
          : content.slice(lineEnd + 1).replace(/^\r?\n/, "")
    };
  }

  function assembleMarkdownDocument(parts, title, body) {
    const prefix = parts.prefix || "";
    const heading = title ? "# " + title.trim() + "\n" : "";
    const normalizedBody = (body || "").replace(/^\n+/, "");
    return (
      prefix +
      heading +
      (heading && normalizedBody ? "\n" : "") +
      normalizedBody
    );
  }

  function setupModernTitle(panel, host, parts) {
    const title = query(".article-header h1, .module-page-header h1", host);
    if (!title || !parts.title) {
      return;
    }
    panel.titleElement = title;
    title.textContent = parts.title;
    title.contentEditable = "plaintext-only";
    title.setAttribute("role", "textbox");
    title.setAttribute("aria-label", "文档标题");
    title.addEventListener("input", function () {
      if (state.inlinePanel === panel && panel.ready) {
        cacheInlineEditor(panel);
      }
    });
    title.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        title.blur();
      }
    });
  }

  function bindModernEditorLinks(panel, mount) {
    mount.addEventListener("click", function (event) {
      if (event.button !== 0) {
        return;
      }
      const anchor = event.target.closest(".ProseMirror a[href]");
      if (!anchor) {
        return;
      }
      const destination = resolveEditorLink(
        anchor.getAttribute("href"),
        panel.dataset.path
      );
      if (!destination) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        window.open(destination, "_blank", "noopener");
      } else {
        window.location.assign(destination);
      }
    });
  }

  function initializeVisualEditor(panel, host, content) {
    const mount = query("[data-visual-editor]", panel);
    const textarea = query("[data-inline-input]", panel);
    const modern = readerEditMode() === "new";
    const parts = modern
      ? splitMarkdownDocument(content)
      : { prefix: "", title: "", body: content };
    panel.documentParts = parts;
    if (modern) {
      setupModernTitle(panel, host, parts);
    }
    const editorValue = modern ? parts.body : content;
    panel.originalContent = content;
    if (!window.toastui || !window.toastui.Editor) {
      mount.hidden = true;
      textarea.hidden = false;
      textarea.value = editorValue;
      panel.canonicalContent = modern
        ? assembleMarkdownDocument(parts, parts.title, editorValue)
        : content;
      return;
    }
    textarea.hidden = true;
    mount.hidden = false;
    state.inlineEditor = new window.toastui.Editor({
      el: mount,
      height: modern ? "auto" : "600px",
      initialEditType: "wysiwyg",
      previewStyle: "tab",
      initialValue: editorValue,
      usageStatistics: false,
      autofocus: !modern,
      toolbarItems: modern
        ? []
        : [
            ["heading", "bold", "italic"],
            ["hr", "quote"],
            ["ul", "ol", "task"],
            ["table", "link"],
            ["code", "codeblock"]
          ],
      events: {
        change: function () {
          if (panel.ready && panel.classList.contains("is-modern")) {
            cacheInlineEditor(panel);
          }
        }
      }
    });
    if (modern) {
      bindModernEditorLinks(panel, mount);
    }
    panel.canonicalContent = modern
      ? assembleMarkdownDocument(
          parts,
          parts.title,
          state.inlineEditor.getMarkdown()
        )
      : state.inlineEditor.getMarkdown();
  }

  function inlineContent(panel) {
    const body = state.inlineEditor
      ? state.inlineEditor.getMarkdown()
      : query("[data-inline-input]", panel).value;
    if (panel.classList.contains("is-modern") && panel.documentParts) {
      const title = panel.titleElement
        ? panel.titleElement.textContent
        : panel.documentParts.title;
      return assembleMarkdownDocument(panel.documentParts, title, body);
    }
    if (state.inlineEditor) {
      return body;
    }
    return body;
  }

  function serializedInlineContent(panel) {
    const canonical = inlineContent(panel);
    const serialized =
      state.inlineEditor &&
      window.GCKMarkdown &&
      panel.originalContent !== undefined
        ? window.GCKMarkdown.preserveSourceFormatting(
            panel.originalContent,
            panel.canonicalContent,
            canonical
          )
        : canonical;
    return { canonical, serialized };
  }

  function setEditorSyncState(panel, value, message, kind) {
    panel.dataset.syncState = value;
    document.body.dataset.editorSyncState = value;
    setInlineFeedback(panel, message, kind);
  }

  function cacheInlineEditor(panel) {
    if (!panel.ready) {
      return null;
    }
    const path = panel.dataset.path;
    const content = serializedInlineContent(panel);
    panel.currentCanonical = content.canonical;
    panel.bufferedContent = content.serialized;
    if (content.serialized === panel.lastSyncedContent) {
      removeEditorBuffer(path);
      scheduleWorkspaceRender();
      setEditorSyncState(panel, "synced", "所有更改已同步。", "success");
      return content;
    }

    const cached = writeEditorBuffer(path, {
        content: content.serialized,
        baseSha: panel.dataset.baseSha || null,
        baseContent: panel.lastSyncedContent,
        operation: "upsert",
        serverRevision: panel.serverRevision,
        updatedAt: Date.now()
      });
    setEditorSyncState(
      panel,
      cached ? "local" : "memory",
      cached
        ? "更改已保存到本地缓存。"
        : "本地缓存不可用，将尽快同步到服务器。",
      cached ? "success" : "error"
    );
    if (!cached && !panel.syncPromise) {
      window.setTimeout(function () {
        syncInlineBuffer(panel);
      }, 0);
    }
    return content;
  }

  function replaceDraft(saved) {
    replaceServerDraft(saved);
  }

  async function syncInlineBuffer(panel, options) {
    if (
      !panel ||
      !panel.ready ||
      !panel.classList.contains("is-modern")
    ) {
      return null;
    }
    const content = cacheInlineEditor(panel);
    if (!content || content.serialized === panel.lastSyncedContent) {
      return null;
    }
    if (panel.syncPromise) {
      return panel.syncPromise;
    }

    const path = panel.dataset.path;
    const contentAtRequest = content.serialized;
    const canonicalAtRequest = content.canonical;
    const buffered = readEditorBuffer(path) || {
      path,
      content: contentAtRequest,
      baseSha: panel.dataset.baseSha || null,
      baseContent: panel.lastSyncedContent,
      operation: "upsert",
      serverRevision: panel.serverRevision,
      updatedAt: Date.now()
    };
    setEditorSyncState(panel, "syncing", "正在同步更改…");
    panel.syncPromise = syncBufferedChange(
      buffered,
      options,
      false
    )
      .then(function (saved) {
        if (!saved) {
          setEditorSyncState(
            panel,
            "local",
            "服务器内容已变化；本地更改已保留，请检查冲突。",
            "error"
          );
          return null;
        }
        replaceDraft(saved);
        panel.dataset.draftId = String(saved.id);
        panel.serverRevision = saved.revision;
        panel.lastSyncedContent = saved.content;
        panel.originalContent = saved.content;
        panel.canonicalContent = canonicalAtRequest;
        if (panel.titleElement) {
          panel.documentParts = splitMarkdownDocument(saved.content);
        }
        if (panel.bufferedContent === contentAtRequest) {
          removeEditorBuffer(path);
          setEditorSyncState(
            panel,
            "synced",
            "更改已同步到服务器。",
            "success"
          );
        } else if (state.inlinePanel === panel && !panel.closing) {
          cacheInlineEditor(panel);
        } else {
          document.body.dataset.editorSyncState = "local";
        }
        updateAccountView();
        addDraftNavigation();
        const host = panel.closest("[data-editor-host]");
        if (host) {
          showDraftBadge(host, saved);
        }
        return saved;
      })
      .catch(function (error) {
        setEditorSyncState(
          panel,
          "local",
          error.message + "；更改仍保存在本地缓存。",
          "error"
        );
        return null;
      })
      .finally(function () {
        panel.syncPromise = null;
      });
    return panel.syncPromise;
  }

  function beginInlineAutoSync(panel) {
    window.clearInterval(panel.syncTimer);
    panel.syncTimer = 0;
  }

  function activateInlinePanel(panel, host) {
    const rendered = query("[data-editable-rendered]", host);
    panel.hidden = false;
    panel.classList.add("is-ready");
    if (rendered) {
      rendered.hidden = true;
    }
  }

  async function loadDeployedSource(path) {
    if (!window.GCKSource) {
      return null;
    }
    const prefetched = window.GCK_SOURCE_PREFETCH;
    if (
      prefetched &&
      prefetched.path === path &&
      prefetched.version === config.contentVersion
    ) {
      const source = await prefetched.promise;
      return source
        ? { ...source, sourceType: "head-" + source.sourceType }
        : null;
    }
    try {
      return await window.GCKSource.load(path, {
        version: config.contentVersion,
        rawBase: config.rawBase
      });
    } catch {
      return null;
    }
  }

  async function openInlineEditor(target) {
    if (!ensureEditorAccess()) {
      return;
    }
    applyEditMode(true);
    const host = target.matches("[data-editor-host]")
      ? target
      : target.closest("[data-editor-host]");
    const sourcePath =
      host && (host.dataset.editorSource || config.editorContext.sourcePath);
    if (!host || !sourcePath) {
      return;
    }
    await closeInlineEditor();
    const panel = createInlinePanel(host, sourcePath);
    panel.dataset.path = sourcePath;
    state.inlinePanel = panel;
    const textarea = query("[data-inline-input]", panel);
    try {
      const draft = state.drafts.find(function (item) {
        return item.path === sourcePath;
      });
      const remoteDraft = state.serverDrafts.find(function (item) {
        return item.path === sourcePath;
      });
      let source = remoteDraft
        ? { ...remoteDraft, sourceType: "draft" }
        : await loadDeployedSource(sourcePath);
      const cached = readEditorBuffer(sourcePath);
      if (!source && cached && !cached.baseSha) {
        source = {
          path: sourcePath,
          content: cached.baseContent || "",
          sha: null,
          sourceType: "local-new"
        };
      }
      if (!source) {
        source = await api(
          "/repository/file?path=" + encodeURIComponent(sourcePath)
        );
        source.sourceType = "repository-api";
      }
      const editorContent = cached ? cached.content : source.content;
      panel.dataset.baseSha =
        (cached && cached.baseSha) ||
        source.base_sha ||
        source.sha ||
        "";
      panel.dataset.draftId = remoteDraft ? String(remoteDraft.id) : "";
      panel.serverRevision = remoteDraft
        ? remoteDraft.revision
        : cached
          ? cached.serverRevision
          : 0;
      panel.lastSyncedContent = source.content;
      panel.renderedContent = draft ? draft.content : source.content;
      panel.bufferedContent = editorContent;
      const deleteButton = query("[data-inline-delete]", panel);
      if (deleteButton) {
        deleteButton.textContent =
          panel.dataset.baseSha ? "删除文件" : "删除新增文件";
      }
      if (sourcePath.toLowerCase().endsWith(".md")) {
        initializeVisualEditor(panel, host, editorContent);
      } else {
        query("[data-visual-editor]", panel).hidden = true;
        textarea.hidden = false;
        textarea.value = editorContent;
        panel.originalContent = editorContent;
        panel.canonicalContent = editorContent;
      }
      panel.ready = true;
      textarea.addEventListener("input", function () {
        if (panel.classList.contains("is-modern")) {
          cacheInlineEditor(panel);
        }
      });
      if (cached && cached.content !== source.content) {
        setEditorSyncState(
          panel,
          "local",
          "已从本地缓存恢复尚未同步的更改。",
          "success"
        );
      } else {
        removeEditorBuffer(sourcePath);
        setEditorSyncState(
          panel,
          "synced",
          remoteDraft
            ? "已加载服务器更改。"
            : "已加载 main 分支源文件。",
          "success"
        );
      }
      activateInlinePanel(panel, host);
      if (panel.classList.contains("is-modern")) {
        beginInlineAutoSync(panel);
      } else {
        textarea.focus();
      }
    } catch (error) {
      panel.hidden = false;
      setInlineFeedback(panel, error.message, "error");
    }
  }

  async function saveInlineEditor(panel) {
    const host = panel.closest("[data-editor-host]");
    const path = panel.dataset.path || host.dataset.editorSource;
    const button = query("[data-inline-save]", panel);
    if (!button) {
      return syncInlineBuffer(panel);
    }
    button.disabled = true;
    try {
      const content = serializedInlineContent(panel);
      const canonicalContent = content.canonical;
      const serializedContent = content.serialized;
      if (serializedContent === panel.originalContent) {
        setInlineFeedback(
          panel,
          "没有检测到需要保存的更改。",
          "success"
        );
        return;
      }
      const saved = await api("/drafts", {
        method: "PUT",
        body: JSON.stringify({
          path: path,
          content: serializedContent,
          base_sha: panel.dataset.baseSha || null,
          operation: "upsert"
        })
      });
      replaceDraft(saved);
      panel.dataset.draftId = String(saved.id);
      panel.originalContent = saved.content;
      panel.canonicalContent = canonicalContent;
      if (path.toLowerCase().endsWith(".md")) {
        const preview = await api("/preview", {
          method: "POST",
          body: JSON.stringify({ content: saved.content })
        });
        renderMarkdownIntoHost(host, preview.html);
      }
      setInlineFeedback(
        panel,
        "草稿已保存，可在编辑工作台统一查看并提交。",
        "success"
      );
      updateAccountView();
      addDraftNavigation();
      showDraftBadge(host, saved);
    } catch (error) {
      setInlineFeedback(panel, error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function deleteInlineFile(panel) {
    const host = panel.closest("[data-editor-host]");
    const path = panel.dataset.path || host.dataset.editorSource;
    const existing = state.drafts.find(function (item) {
      return item.path === path;
    });
    const remoteSha = panel.dataset.baseSha || null;
    const message = remoteSha
      ? "将此文件标记为删除？提交 Draft PR 后它会从仓库中移除。"
      : "删除这个尚未提交的新文件？";
    if (!window.confirm(message)) {
      return;
    }
    try {
      if (!remoteSha) {
        if (existing) {
          await discardDraft(existing);
        }
        removeEditorBuffer(path);
        window.location.href = "/" + path.split("/")[0] + "/";
        return;
      }
      const remoteDraft = state.serverDrafts.find(function (item) {
        return item.path === path;
      });
      const deleted = writeEditorBuffer(path, {
        content: "",
        baseSha: remoteSha,
        baseContent: panel.lastSyncedContent || "",
        operation: "delete",
        serverRevision: remoteDraft ? remoteDraft.revision : 0,
        updatedAt: Date.now()
      });
      refreshEffectiveDrafts();
      await closeInlineEditor({ renderLatest: false });
      showDeletedDraft(host, deleted);
      updateAccountView();
      addDraftNavigation();
      syncWorkspaceState();
    } catch (error) {
      setInlineFeedback(panel, error.message, "error");
    }
  }

  function workspacePathMatches(path, target, kind) {
    return kind === "file"
      ? path === target
      : path === target || path.startsWith(target.replace(/\/$/, "") + "/");
  }

  function workspaceTargetEntries(target, kind) {
    return state.workspaceSnapshot
      ? state.workspaceSnapshot.entries.filter(function (entry) {
          return workspacePathMatches(entry.path, target, kind);
        })
      : [];
  }

  function workspaceTargetDrafts(target, kind) {
    return state.drafts.filter(function (draft) {
      return workspacePathMatches(draft.path, target, kind);
    });
  }

  function workspaceTargetIsDeleted(target, kind) {
    const entries = workspaceTargetEntries(target, kind);
    const repositoryEntries = entries.filter(function (entry) {
      return entry.baseExists;
    });
    return (
      repositoryEntries.length > 0 &&
      repositoryEntries.every(function (entry) {
        return entry.operation === "delete";
      })
    );
  }

  function updateWorkspaceDeleteControls() {
    queryAll("[data-delete-path]").forEach(function (button) {
      const kind = button.dataset.deleteKind || "file";
      const deleted = workspaceTargetIsDeleted(
        button.dataset.deletePath,
        kind
      );
      button.dataset.restoreDelete = deleted ? "true" : "false";
      const text = deleted
        ? "撤销删除"
        : kind === "file"
          ? "删除文件"
          : button.dataset.deletePath.includes("/")
            ? "删除子模块"
            : "删除大模块";
      button.title = text;
      button.setAttribute(
        "aria-label",
        text + "：" + (button.dataset.deleteLabel || button.dataset.deletePath)
      );
      const icon = query("svg, i", button);
      if (icon) {
        const replacement = document.createElement("i");
        replacement.dataset.lucide = deleted ? "undo-2" : "trash-2";
        replacement.setAttribute("aria-hidden", "true");
        icon.replaceWith(replacement);
      }
      if (kind !== "file") {
        Array.from(button.childNodes)
          .filter(function (node) {
            return node.nodeType === Node.TEXT_NODE;
          })
          .forEach(function (node) {
            node.remove();
          });
        button.append(document.createTextNode(text));
      }
      refreshIcons(button);
    });
  }

  async function restoreWorkspaceTarget(target, kind) {
    const localPaths = new Set(
      localBufferChanges()
        .filter(function (change) {
          return workspacePathMatches(change.path, target, kind);
        })
        .map(function (change) {
          return change.path;
        })
    );
    localPaths.forEach(removeEditorBuffer);
    const serverDeletes = state.serverDrafts.filter(function (draft) {
      return (
        draft.operation === "delete" &&
        workspacePathMatches(draft.path, target, kind)
      );
    });
    await Promise.all(
      serverDeletes.map(function (draft) {
        return api("/drafts/" + draft.id, { method: "DELETE" });
      })
    );
    state.serverDrafts = state.serverDrafts.filter(function (draft) {
      return !serverDeletes.some(function (deleted) {
        return deleted.id === draft.id;
      });
    });
    state.draftRevision = "";
    refreshEffectiveDrafts();
    addDraftNavigation();
    updateAccountView();
  }

  async function deleteWorkspaceTarget(button) {
    if (!ensureEditorAccess()) return;
    const target = button.dataset.deletePath;
    const kind = button.dataset.deleteKind || "file";
    const label = button.dataset.deleteLabel || target;
    if (button.dataset.restoreDelete === "true") {
      if (window.confirm("撤销 " + label + " 的删除标记？")) {
        button.disabled = true;
        try {
          await restoreWorkspaceTarget(target, kind);
        } finally {
          button.disabled = false;
        }
      }
      return;
    }

    const localEntries = workspaceTargetEntries(target, kind);
    const localDrafts = workspaceTargetDrafts(target, kind);
    const hasRepositoryFiles = localEntries.some(function (entry) {
      return entry.baseExists;
    });
    let repositoryItems = [];
    if (hasRepositoryFiles) {
      try {
        const payload = await api(
          "/repository/delete-tree?path=" +
            encodeURIComponent(target) +
            "&kind=" +
            encodeURIComponent(kind)
        );
        repositoryItems = payload.items || [];
      } catch (error) {
        window.alert(error.message);
        return;
      }
    }
    const count = new Set(
      repositoryItems
        .map(function (entry) {
          return entry.path;
        })
        .concat(
          localEntries.map(function (entry) {
            return entry.path;
          })
        )
    ).size;
    const scope = kind === "file"
      ? "文件"
      : target.includes("/")
        ? "子模块"
        : "大模块";
    if (
      !window.confirm(
        "删除" +
          scope +
          "“" +
          label +
          "”？将标记 " +
          count +
          " 个文件为删除，提交 Draft PR 后才会从仓库移除。"
      )
    ) {
      return;
    }
    if (
      kind === "directory" &&
      !target.includes("/") &&
      !window.confirm(
        "这是大模块删除操作，模块入口及全部子模块都会被删除。确认继续？"
      )
    ) {
      return;
    }

    button.disabled = true;
    try {
      const activePath =
        state.inlinePanel && state.inlinePanel.dataset.path;
      if (
        activePath &&
        workspacePathMatches(activePath, target, kind)
      ) {
        await closeInlineEditor({ renderLatest: false });
      }
      const repositoryByPath = new Map(
        repositoryItems.map(function (entry) {
          return [entry.path, entry];
        })
      );
      const allPaths = new Set(
        repositoryItems
          .map(function (entry) {
            return entry.path;
          })
          .concat(
            localEntries.map(function (entry) {
              return entry.path;
            }),
            localDrafts.map(function (draft) {
              return draft.path;
            })
          )
      );
      const discardServerDrafts = [];
      allPaths.forEach(function (path) {
        const entry = localEntries.find(function (item) {
          return item.path === path;
        });
        const remoteDraft = state.serverDrafts.find(function (item) {
          return item.path === path;
        });
        const repository = repositoryByPath.get(path);
        const baseSha =
          (repository && repository.sha) ||
          (entry && entry.baseSha) ||
          (remoteDraft && remoteDraft.base_sha) ||
          null;
        if (!baseSha) {
          removeEditorBuffer(path);
          if (remoteDraft && remoteDraft.id) {
            discardServerDrafts.push(remoteDraft);
          }
          return;
        }
        writeEditorBuffer(path, {
          content: "",
          baseSha,
          baseContent: "",
          operation: "delete",
          serverRevision: remoteDraft ? remoteDraft.revision : 0,
          updatedAt: Date.now()
        });
      });
      await Promise.all(
        discardServerDrafts.map(function (draft) {
          return api("/drafts/" + draft.id, { method: "DELETE" });
        })
      );
      state.serverDrafts = state.serverDrafts.filter(function (draft) {
        return !discardServerDrafts.some(function (discarded) {
          return discarded.id === draft.id;
        });
      });
      state.draftRevision = "";
      refreshEffectiveDrafts();
      addDraftNavigation();
      updateAccountView();
      const host = query("[data-editor-host]");
      const sourcePath = host && host.dataset.editorSource;
      if (
        host &&
        sourcePath &&
        workspacePathMatches(sourcePath, target, kind)
      ) {
        const draft = state.drafts.find(function (item) {
          return item.path === sourcePath;
        });
        if (draft) showDeletedDraft(host, draft);
      }
      syncWorkspaceState();
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
      updateWorkspaceDeleteControls();
    }
  }

  function normalizeParent(root, value) {
    const parts = (value || "").split("/").filter(Boolean);
    if (parts[0] === root) {
      parts.shift();
    }
    return parts.join("/");
  }

  function currentSourceParent(root, fallback) {
    const sourcePath =
      query("[data-editor-host]")?.dataset.editorSource ||
      (config.editorContext && config.editorContext.sourcePath);
    if (!sourcePath || !sourcePath.startsWith(root + "/")) {
      return normalizeParent(root, fallback);
    }
    const parts = sourcePath.split("/");
    parts.pop();
    return normalizeParent(root, parts.join("/"));
  }

  function openCreateDialog(button) {
    if (!ensureEditorAccess()) {
      return;
    }
    applyEditMode(true);
    const dialog = query("[data-content-create-dialog]");
    const form = query("[data-content-create-form]", dialog);
    const kind = button.dataset.createContext;
    const root = button.dataset.createRoot;
    const parent = button.hasAttribute("data-create-use-current")
      ? currentSourceParent(root, button.dataset.createParent)
      : normalizeParent(root, button.dataset.createParent);
    form.reset();
    form.elements.root.value = root;
    form.elements.parent.value = parent;
    form.elements.kind.value = kind;
    query("[data-create-dialog-title]", form).textContent =
      kind === "module" ? "新建子模块" : "新建文件";
    query("[data-create-location]", form).textContent =
      [root, parent].filter(Boolean).join("/") + "/";
    query("[data-create-description-field]", form).hidden = kind !== "module";
    form.elements.slug.placeholder =
      kind === "module" ? "polymorphism" : "01-overview.md";
    feedback(query("[data-create-feedback]", form), "");
    dialog.showModal();
  }

  async function submitCreateDialog(form) {
    const values = formPayload(form);
    const target = query("[data-create-feedback]", form);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const slug = values.slug
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "");
      if (
        !slug ||
        slug.includes("/") ||
        slug === "." ||
        slug === ".."
      ) {
        throw new Error("目录或文件名无效");
      }
      let path;
      let content;
      if (values.kind === "module") {
        path = [
          values.root,
          values.parent,
          slug,
          "README.md"
        ].filter(Boolean).join("/");
        content = "# " + values.title.trim() + "\n\n";
        if (values.description.trim()) {
          content += values.description.trim() + "\n\n";
        }
        content +=
          "## 阅读导航\n\n请在此处补充章节入口和推荐阅读顺序。\n";
      } else {
        let filename = slug;
        if (!filename.includes(".")) {
          filename += ".md";
        }
        path = [values.root, values.parent, filename]
          .filter(Boolean)
          .join("/");
        const markdown = filename.toLowerCase().endsWith(".md");
        content = markdown ? "# " + values.title.trim() + "\n\n" : "";
      }
      const occupied = (
        state.workspaceSnapshot
          ? state.workspaceSnapshot.entries
          : []
      ).some(function (entry) {
        return entry.path === path && entry.operation !== "delete";
      });
      if (occupied) {
        throw new Error("工作树中已存在同名内容");
      }
      const saved = writeEditorBuffer(path, {
        content,
        baseSha: null,
        baseContent: "",
        operation: "upsert",
        serverRevision: 0,
        updatedAt: Date.now()
      });
      if (!saved) {
        throw new Error("本地缓存不可用，无法安全创建内容");
      }
      refreshEffectiveDrafts();
      feedback(
        target,
        "已创建 " + saved.path + "，正在打开预览。",
        true
      );
      updateAccountView();
      addDraftNavigation();
      syncWorkspaceState({ keepalive: true });
      window.setTimeout(function () {
        window.location.href = draftLink(saved.path);
      }, 180);
    } catch (error) {
      feedback(target, error.message);
    } finally {
      submit.disabled = false;
    }
  }

  function bindEvents() {
    query("[data-account-trigger]").addEventListener("click", openAccount);
    queryAll("[data-close-account]").forEach(function (button) {
      button.addEventListener("click", function () {
        query("[data-account-dialog]").close();
      });
    });
    queryAll("[data-account-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        setAccountTab(button.dataset.accountTab);
      });
    });
    query("[data-account-login-form]").addEventListener("submit", async function (event) {
      event.preventDefault();
      const target = query("[data-account-feedback]");
      feedback(target, "");
      try {
        const payload = await api("/auth/login", {
          method: "POST",
          body: JSON.stringify(formPayload(event.currentTarget))
        });
        state.session = { authenticated: true, ...payload };
        state.csrf = payload.csrf_token;
        await loadDrafts();
        updateAccountView();
        await applyDraftsToReader();
        beginWorkspaceSync();
        openOnboardingIfNeeded();
      } catch (error) {
        feedback(target, error.message);
      }
    });
    query("[data-account-register-form]").addEventListener("submit", async function (event) {
      event.preventDefault();
      const target = query("[data-account-feedback]");
      feedback(target, "");
      try {
        const payload = await api("/auth/register", {
          method: "POST",
          body: JSON.stringify(formPayload(event.currentTarget))
        });
        state.session = { authenticated: true, ...payload };
        state.csrf = payload.csrf_token;
        await loadDrafts();
        updateAccountView();
        await applyDraftsToReader();
        beginWorkspaceSync();
        openOnboardingIfNeeded();
      } catch (error) {
        feedback(target, error.message);
      }
    });
    query("[data-edit-mode-trigger]").addEventListener("click", async function () {
      if (!ensureEditorAccess()) {
        return;
      }
      const next = !state.editMode;
      if (!next) {
        await closeInlineEditor();
      }
      applyEditMode(next);
      if (next) {
        await openCurrentEditor();
      }
    });
    query("[data-account-logout]").addEventListener("click", async function () {
      try {
        await api("/auth/logout", { method: "POST" });
      } finally {
        window.localStorage.removeItem("gck-edit-mode");
        window.location.reload();
      }
    });
    query("[data-account-unlink-github]").addEventListener("click", async function () {
      const target = query("[data-account-feedback]");
      try {
        await api("/auth/github/unlink", { method: "POST" });
        await loadIdentity();
        feedback(target, "GitHub 账号已解绑。", true);
      } catch (error) {
        feedback(target, error.message);
      }
    });
    query("[data-account-bind-github]").addEventListener("click", function (event) {
      const link = event.currentTarget;
      if (!link.href || link.getAttribute("aria-disabled") === "true") {
        return;
      }
      event.preventDefault();
      link.setAttribute("aria-busy", "true");
      link.textContent = "正在前往 GitHub";
      window.location.assign(link.href);
    });
    document.addEventListener("click", function (event) {
      const removeTarget = event.target.closest("[data-delete-path]");
      if (removeTarget) {
        event.preventDefault();
        deleteWorkspaceTarget(removeTarget);
        return;
      }
      const create = event.target.closest("[data-create-context]");
      if (create) {
        event.preventDefault();
        openCreateDialog(create);
        return;
      }
      const panel = event.target.closest("[data-inline-editor]");
      if (!panel) {
        return;
      }
      if (event.target.closest("[data-inline-close]")) {
        closeInlineEditor();
      } else if (event.target.closest("[data-inline-save]")) {
        saveInlineEditor(panel);
      } else if (event.target.closest("[data-inline-delete]")) {
        deleteInlineFile(panel);
      }
    });
    queryAll("[data-close-content-create]").forEach(function (button) {
      button.addEventListener("click", function () {
        query("[data-content-create-dialog]").close();
      });
    });
    query("[data-content-create-form]").addEventListener("submit", function (event) {
      event.preventDefault();
      submitCreateDialog(event.currentTarget);
    });
    query("[data-onboarding-next]").addEventListener("click", function () {
      state.onboardingStep = Math.min(
        state.onboardingStep + 1,
        queryAll("[data-onboarding-step]").length - 1
      );
      renderOnboarding();
    });
    query("[data-onboarding-previous]").addEventListener("click", function () {
      state.onboardingStep = Math.max(0, state.onboardingStep - 1);
      renderOnboarding();
    });
    query("[data-onboarding-skip]").addEventListener(
      "click",
      completeOnboarding
    );
    query("[data-onboarding-finish]").addEventListener(
      "click",
      completeOnboarding
    );
    query("[data-onboarding-dialog]").addEventListener("cancel", function (event) {
      event.preventDefault();
    });
    document.addEventListener("visibilitychange", function () {
      if (
        document.hidden &&
        state.inlinePanel &&
        state.inlinePanel.classList.contains("is-modern")
      ) {
        cacheInlineEditor(state.inlinePanel);
      }
      if (!document.hidden) {
        syncWorkspaceState();
      }
    });
    window.addEventListener("pagehide", function () {
      if (
        state.inlinePanel &&
        state.inlinePanel.classList.contains("is-modern")
      ) {
        cacheInlineEditor(state.inlinePanel);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindEvents();
    loadIdentity().catch(function (error) {
      feedback(query("[data-account-feedback]"), error.message);
      updateAccountView();
    });
  });
})();
