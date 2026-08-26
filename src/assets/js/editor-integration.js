(function () {
  "use strict";

  const config = window.GCK_CONFIG || {};
  const editorApi = (config.editorApi || "/editor/api").replace(/\/$/, "");
  const editorUrl = config.editorUrl || "/editor/";
  const IDENTITY_CACHE_KEY = "gck-editor-identity:v1";
  const IDENTITY_CACHE_TTL = 5 * 60 * 1000;
  const UPDATE_VERSION_PREFIX = "gck-content-version:v1:";
  const UPDATE_PENDING_PREFIX = "gck-update-announcement:v1:";
  const state = {
    config: null,
    session: null,
    csrf: "",
    baseTree: null,
    currentTree: null,
    legacyDrafts: [],
    drafts: [],
    localChanges: [],
    workspaceSnapshot: null,
    remoteSyncPromise: null,
    workspaceRenderFrame: 0,
    editMode: window.localStorage.getItem("gck-edit-mode") === "1",
    inlinePanel: null,
    inlineEditor: null,
    onboardingStep: 0,
    onboardingManual: false,
    onboardingSaving: false,
    pendingUpdateAnnouncement: null,
    updateAnnouncementChecking: false,
    identityLoaded: false,
    identityPromise: null,
    cachedDraftCount: 0
  };

  function query(selector, root) {
    return (root || document).querySelector(selector);
  }

  function queryAll(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function refreshIcons(root) {
    // site.js exposes a scoped converter that only renders new
    // <i data-lucide> placeholders without repainting existing SVGs.
    if (typeof window.GCKRefreshIcons === "function") {
      window.GCKRefreshIcons(root);
      return;
    }
    if (window.lucide) {
      window.lucide.createIcons({
        attrs: { "stroke-width": 1.8 },
        root: root || document
      });
    }
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

  function bootstrapPath() {
    return window.GCK_EDITOR_BOOTSTRAP_PATH || "/bootstrap";
  }

  function readIdentityCache(options) {
    const settings = options || {};
    try {
      const cached = JSON.parse(
        window.localStorage.getItem(IDENTITY_CACHE_KEY) || "null"
      );
      if (
        !cached ||
        (
          !settings.allowExpired &&
          Date.now() - Number(cached.cachedAt || 0) > IDENTITY_CACHE_TTL
        )
      ) {
        return null;
      }
      return cached.payload || null;
    } catch {
      return null;
    }
  }

  function writeIdentityCache(payload) {
    try {
      const session = payload && payload.session;
      window.localStorage.setItem(
        IDENTITY_CACHE_KEY,
        JSON.stringify({
          cachedAt: Date.now(),
          payload: {
            config: payload.config || null,
            session: session || { authenticated: false },
            draft_count: (payload.drafts || []).length,
            draft_revision: payload.draft_revision || ""
          }
        })
      );
    } catch {
      // Login state is still resolved by the server when localStorage is full.
    }
  }

  function clearIdentityCache() {
    try {
      window.localStorage.removeItem(IDENTITY_CACHE_KEY);
    } catch {
      // Nothing to clear when localStorage is unavailable.
    }
  }

  function cacheContributionGraph(value, revision) {
    if (!value || !value.revision || !revision) return;
    const graphRevision = String(value.revision);
    const treeRevision = String(revision);
    if (
      !graphRevision.startsWith(treeRevision) &&
      !treeRevision.startsWith(graphRevision)
    ) {
      return;
    }
    try {
      for (const key of new Set([
        graphRevision,
        graphRevision.slice(0, 7),
        treeRevision,
        treeRevision.slice(0, 7)
      ])) {
        window.localStorage.setItem(
          `gck-contribution-graph:v1:${key}`,
          JSON.stringify(value)
        );
      }
    } catch {
      // The embedded baseline graph remains available when storage is full.
    }
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
    const changeOverview = query("[data-change-overview-link]");
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
      if (changeOverview) changeOverview.hidden = true;
      guest.hidden = false;
      profile.hidden = true;
      trigger.classList.remove("is-authenticated");
      label.textContent = "登录";
      applyEditMode(false);
      refreshIcons();
      return;
    }

    const user = state.session.user;
    if (changeOverview) changeOverview.hidden = false;
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
      (state.drafts.length || state.cachedDraftCount || 0) + " 个";
    query("[data-account-admin]").hidden = user.role !== "admin";

    const bind = query("[data-account-bind-github]");
    const unlink = query("[data-account-unlink-github]");
    const githubBound = Boolean(user.github_login);
    bind.hidden = false;
    unlink.hidden = !user.github_login;
    bind.innerHTML =
      '<i data-lucide="github" aria-hidden="true"></i>' +
      (githubBound ? "刷新 GitHub 授权" : "绑定 GitHub");
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
      state.baseTree = null;
      state.currentTree = null;
      state.drafts = [];
      return;
    }
    const store = window.GCKWorkspaceStore;
    const userId = editorUserId();
    if (!store || !userId) return;
    applyWorkspaceState(
      store.ensure(
        window.localStorage,
        userId,
        workspaceRepository(),
        config.contentRevision || config.contentVersion,
        config.workspaceEntries || []
      )
    );
    migrateLegacyChanges();
    const buffers = editorBufferApi();
    if (buffers && buffers.list) {
      buffers.list(window.localStorage, userId).forEach(function (change) {
        applyWorkspaceChange(change);
        buffers.remove(window.localStorage, userId, change.path);
      });
    }
  }

  function workspaceRepository(cachedConfig) {
    const repository =
      (cachedConfig && cachedConfig.repository) ||
      (state.config && state.config.repository) ||
      config.repository ||
      "Game-Client-Knowledge/Game-Client-Knowledge";
    return repository
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\.git$/, "");
  }

  function readLocalWorkspace() {
    const store = window.GCKWorkspaceStore;
    const userId = editorUserId();
    if (!store || !userId) return null;
    const base = store.readBase(
      window.localStorage,
      userId,
      workspaceRepository()
    );
    const current = store.readCurrent(
      window.localStorage,
      userId,
      workspaceRepository()
    );
    if (!base || !current) return null;
    return {
      base,
      current,
      changes: store.deriveChanges(base, current)
    };
  }

  function restoreCachedWorkspaceNavigation() {
    const cached = readIdentityCache({ allowExpired: true });
    const session = cached && cached.session;
    const userId = session && session.user && session.user.id;
    const store = window.GCKWorkspaceStore;
    if (
      !session ||
      !session.authenticated ||
      !session.can_edit ||
      !userId ||
      !store
    ) {
      return false;
    }
    const repository = workspaceRepository(cached.config);
    const base = store.readBase(
      window.localStorage,
      userId,
      repository
    );
    const current = store.readCurrent(
      window.localStorage,
      userId,
      repository
    );
    if (!base || !current) return false;
    const changes = store.deriveChanges(base, current);
    const embeddedEntries = config.workspaceEntries || [];
    applyWorkspaceState({
      base: {
        ...base,
        entries: embeddedEntries.length ? embeddedEntries : base.entries
      },
      current,
      changes
    });
    addDraftNavigation();
    return true;
  }

  function updateStorageKey(prefix) {
    const userId = editorUserId();
    return userId ? prefix + encodeURIComponent(String(userId)) : "";
  }

  function readStoredJson(key) {
    if (!key) return null;
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || "null");
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  }

  function writeStoredValue(key, value) {
    if (!key) return false;
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function removeStoredValue(key) {
    if (!key) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // The in-memory dismissal still applies for the current page.
    }
  }

  function validContentRevision(value) {
    return /^[0-9a-f]{7,40}$/i.test(String(value || ""));
  }

  function announcementFileTitle(path) {
    const entry = state.workspaceSnapshot &&
      state.workspaceSnapshot.entries.find(function (item) {
        return item.path === path;
      });
    return entry && entry.title
      ? entry.title
      : path.split("/").pop() || path;
  }

  function appendUpdateFileGroup(container, status, files) {
    if (!files.length) return;
    const labels = {
      added: "新增",
      modified: "修改",
      removed: "删除",
      renamed: "重命名"
    };
    const section = document.createElement("section");
    section.className = "update-announcement-group";
    section.dataset.status = status;
    const heading = document.createElement("h3");
    const badge = document.createElement("span");
    badge.textContent = String(files.length);
    heading.append(badge, document.createTextNode(labels[status] || "变更"));
    const list = document.createElement("ul");
    list.className = "update-announcement-list";
    files.forEach(function (file) {
      const item = document.createElement("li");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      const path = document.createElement("small");
      title.textContent = announcementFileTitle(file.path);
      path.textContent =
        status === "renamed" && file.previous_path
          ? file.previous_path + " → " + file.path
          : file.path;
      copy.append(title, path);
      const lines = document.createElement("span");
      lines.className = "update-announcement-lines";
      const additions = document.createElement("span");
      additions.className = "is-added";
      additions.textContent = "+" + (Number(file.additions) || 0);
      const deletions = document.createElement("span");
      deletions.className = "is-deleted";
      deletions.textContent = "-" + (Number(file.deletions) || 0);
      lines.append(additions, deletions);
      item.append(copy, lines);
      list.append(item);
    });
    section.append(heading, list);
    container.append(section);
  }

  function appendUpdateCommits(container, commits) {
    if (!commits.length) return;
    const section = document.createElement("section");
    section.className = "update-announcement-group";
    const heading = document.createElement("h3");
    heading.textContent = "提交摘要";
    const list = document.createElement("ul");
    list.className = "update-announcement-commits";
    commits.forEach(function (commit) {
      const item = document.createElement("li");
      const message = document.createElement("strong");
      const meta = document.createElement("small");
      message.textContent = commit.message || "内容更新";
      meta.textContent =
        String(commit.sha || "").slice(0, 7) +
        " · " +
        (commit.author || "unknown");
      item.append(message, meta);
      list.append(item);
    });
    section.append(heading, list);
    container.append(section);
  }

  function renderUpdateAnnouncement(payload) {
    const dialog = query("[data-update-announcement-dialog]");
    const content = query("[data-update-announcement-content]", dialog);
    const files = Array.isArray(payload.files) ? payload.files : [];
    const commits = Array.isArray(payload.commits) ? payload.commits : [];
    query("[data-update-announcement-version]", dialog).textContent =
      String(payload.from_revision || "").slice(0, 7) +
      " → " +
      String(payload.to_revision || "").slice(0, 7);
    query("[data-update-commit-count]", dialog).textContent = String(
      Number(payload.total_commits) || commits.length
    );
    query("[data-update-file-count]", dialog).textContent = String(
      files.length
    );
    content.replaceChildren();
    ["added", "modified", "removed", "renamed"].forEach(function (status) {
      appendUpdateFileGroup(
        content,
        status,
        files.filter(function (file) {
          return file.status === status;
        })
      );
    });
    appendUpdateCommits(content, commits);
    query("[data-update-announcement-note]", dialog).hidden =
      !payload.truncated;
    refreshIcons(dialog);
  }

  function showPendingUpdateAnnouncement() {
    const payload = state.pendingUpdateAnnouncement;
    const dialog = query("[data-update-announcement-dialog]");
    if (
      !payload ||
      !dialog ||
      dialog.open ||
      query("dialog[open]")
    ) {
      return false;
    }
    renderUpdateAnnouncement(payload);
    dialog.showModal();
    return true;
  }

  function queueUpdateAnnouncement(payload) {
    const key = updateStorageKey(UPDATE_PENDING_PREFIX);
    state.pendingUpdateAnnouncement = payload;
    writeStoredValue(key, JSON.stringify(payload));
    showPendingUpdateAnnouncement();
  }

  function restorePendingUpdateAnnouncement() {
    const payload = readStoredJson(
      updateStorageKey(UPDATE_PENDING_PREFIX)
    );
    if (!payload || !validContentRevision(payload.to_revision)) {
      return false;
    }
    state.pendingUpdateAnnouncement = payload;
    showPendingUpdateAnnouncement();
    return true;
  }

  function acknowledgeUpdateAnnouncement() {
    const dialog = query("[data-update-announcement-dialog]");
    removeStoredValue(updateStorageKey(UPDATE_PENDING_PREFIX));
    state.pendingUpdateAnnouncement = null;
    if (dialog && dialog.open) dialog.close();
  }

  async function checkForUpdateAnnouncement() {
    if (
      state.updateAnnouncementChecking ||
      !state.session ||
      !state.session.authenticated ||
      state.session.user.must_change_password
    ) {
      return;
    }
    if (restorePendingUpdateAnnouncement()) return;
    const currentRevision =
      config.contentRevision || config.contentVersion || "";
    if (!validContentRevision(currentRevision)) return;
    const versionKey = updateStorageKey(UPDATE_VERSION_PREFIX);
    let previousRevision = "";
    try {
      previousRevision = window.localStorage.getItem(versionKey) || "";
    } catch {
      previousRevision = "";
    }
    if (!validContentRevision(previousRevision)) {
      const workspace = readLocalWorkspace();
      previousRevision =
        workspace && workspace.base ? workspace.base.revision : "";
    }
    if (
      !validContentRevision(previousRevision) ||
      currentRevision.startsWith(previousRevision)
    ) {
      writeStoredValue(versionKey, currentRevision);
      return;
    }

    state.updateAnnouncementChecking = true;
    try {
      const payload = await api(
        "/repository/update-announcement?from_revision=" +
          encodeURIComponent(previousRevision)
      );
      if (
        !payload ||
        !validContentRevision(payload.to_revision) ||
        !(
          currentRevision.startsWith(payload.to_revision) ||
          payload.to_revision.startsWith(currentRevision)
        )
      ) {
        return;
      }
      writeStoredValue(versionKey, payload.to_revision);
      if (
        (Array.isArray(payload.files) && payload.files.length) ||
        (Array.isArray(payload.commits) && payload.commits.length)
      ) {
        queueUpdateAnnouncement(payload);
      }
    } catch {
      // Keep the previous version so a later login can retry the summary.
    } finally {
      state.updateAnnouncementChecking = false;
    }
  }

  function applyWorkspaceState(workspace) {
    if (!workspace) return false;
    state.baseTree = workspace.base;
    state.currentTree = workspace.current;
    state.localChanges = workspace.changes || [];
    state.drafts = state.localChanges.map(function (change) {
      return {
        ...change,
        base_sha: change.baseSha || null,
        base_content:
          typeof change.baseContent === "string"
            ? change.baseContent
            : null,
        line_diff: change.lineDiff || [],
        diff_summary: change.diffSummary || {
          added: 0,
          modified: 0,
          deleted: 0
        },
        updated_at: change.updatedAt,
        local: true
      };
    });
    rebuildWorkspaceSnapshot();
    return true;
  }

  function applyWorkspaceChange(change) {
    const store = window.GCKWorkspaceStore;
    const userId = editorUserId();
    if (!store || !userId) return null;
    const workspace = store.applyChange(
      window.localStorage,
      userId,
      workspaceRepository(),
      change
    );
    applyWorkspaceState(workspace);
    return state.drafts.find(function (draft) {
      return draft.path === change.path;
    }) || null;
  }

  function migrateLegacyChanges() {
    const userId = editorUserId();
    if (!userId || !state.legacyDrafts.length) return;
    const legacyDrafts = state.legacyDrafts.slice();
    const key =
      "gck-workspace-legacy-migrated:v1:" +
      encodeURIComponent(String(userId)) +
      ":" +
      encodeURIComponent(workspaceRepository());
    if (window.localStorage.getItem(key) !== "1") {
      legacyDrafts.forEach(function (draft) {
        applyWorkspaceChange({
          path: draft.path,
          content: draft.content,
          operation: draft.operation || "upsert",
          baseSha: draft.base_sha || null,
          baseContent:
            typeof draft.base_content === "string"
              ? draft.base_content
              : null,
          updatedAt: Date.parse(draft.updated_at) || Date.now()
        });
      });
      window.localStorage.setItem(key, "1");
    }
    state.legacyDrafts = [];
    Promise.allSettled(
      legacyDrafts
        .filter(function (draft) {
          return draft.id;
        })
        .map(function (draft) {
          return api("/drafts/" + draft.id, { method: "DELETE" });
        })
    );
  }

  function refreshEffectiveDrafts() {
    applyWorkspaceState(readLocalWorkspace());
  }

  function rebuildWorkspaceSnapshot() {
    const tree = window.GCKWorkspaceTree;
    const root = config.editorContext && config.editorContext.root;
    if (!tree || !root) {
      state.workspaceSnapshot = null;
      return;
    }
    const entries = tree.mergeEntries(
      (state.baseTree && state.baseTree.entries) ||
        config.workspaceEntries ||
        [],
      [],
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
    document.body.dataset.workspaceRevision = String(Date.now());
    window.dispatchEvent(
      new CustomEvent("gck:workspace-updated", {
        detail: {
          root,
          changedCount: state.workspaceSnapshot.changedCount,
          changedPaths: state.drafts.map(function (draft) {
            return draft.path;
          }),
          snapshot: state.workspaceSnapshot
        }
      })
    );
  }

  async function discardDraft(draft) {
    const store = window.GCKWorkspaceStore;
    if (store) {
      applyWorkspaceState(
        store.discardChange(
          window.localStorage,
          editorUserId(),
          workspaceRepository(),
          draft.path
        )
      );
    }
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
        ) + " · 本地未提交更改";
  }

  function normalizeRoutePath(value) {
    return (value || "").replace(/\/+$/, "");
  }

  function currentDraftPath() {
    return (
      new URLSearchParams(window.location.search).get("draft") || ""
    );
  }

  function entryMatchesCurrentPage(entry) {
    if (!entry) return false;
    if (entry.status || !entry.route) {
      return currentDraftPath() === entry.path;
    }
    const base = (config.basePath || "").replace(/\/$/, "");
    return (
      normalizeRoutePath(window.location.pathname) ===
      normalizeRoutePath(base + entry.route)
    );
  }

  function unitContainsCurrentPage(unit) {
    if (!unit) return false;
    if (unit.readme && entryMatchesCurrentPage(unit.readme)) {
      return true;
    }
    const draft = currentDraftPath();
    if (draft && unit.id) {
      const unitPath = normalizeRoutePath(unit.id) + "/";
      if (draft.startsWith(unitPath)) {
        return true;
      }
    }
    if (unit.readme && unit.readme.route) {
      const base = (config.basePath || "").replace(/\/$/, "");
      const prefix = normalizeRoutePath(base + unit.readme.route) + "/";
      return (
        (normalizeRoutePath(window.location.pathname) + "/").startsWith(
          prefix
        )
      );
    }
    return false;
  }

  function unitIsCurrent(unit) {
    if (!unit) return false;
    if (unit.readme && entryMatchesCurrentPage(unit.readme)) {
      return true;
    }
    if ((unit.documents || []).some(function (entry) {
      return entryMatchesCurrentPage(entry);
    })) {
      return true;
    }
    const draft = currentDraftPath();
    if (draft && unit.id) {
      const unitPath = normalizeRoutePath(unit.id) + "/";
      if (draft.startsWith(unitPath)) {
        return true;
      }
    }
    return false;
  }

  // Attributes that reflect runtime/user state and must survive a sync.
  const SYNC_KEEP_ATTRIBUTES = {
    open: true,
    style: true,
    "data-restore-delete": true
  };

  function syncNodeKey(node) {
    if (node.nodeType === Node.TEXT_NODE) return "#text";
    if (node.nodeType !== Node.ELEMENT_NODE) return "#node";
    const dataset = node.dataset || {};
    if (dataset.workspaceKey) return "workspace:" + dataset.workspaceKey;
    if (dataset.lucide) return "icon:" + dataset.lucide;
    if (dataset.createContext) return "create:" + dataset.createContext;
    if (dataset.deletePath) {
      return "delete:" + dataset.deleteKind + ":" + dataset.deletePath;
    }
    if (node.classList.contains("draft-change-badge")) return "badge";
    if (node.tagName === "A") {
      return "a:" + (node.getAttribute("href") || "");
    }
    if (node.classList.contains("docs-nav-unit")) {
      const title = node.querySelector(":scope > .docs-nav-unit-title");
      const href = title && title.getAttribute("href");
      return "unit:" + (href || (title && title.textContent.trim()) || "");
    }
    if (node.tagName === "LI") {
      const anchor = node.querySelector("a[href]");
      return "li:" + (anchor ? anchor.getAttribute("href") : node.textContent.trim());
    }
    if (node.classList.contains("module-unit-branch")) {
      const headingLink = node.querySelector(":scope h3 a[href]");
      if (headingLink) return "branch:" + headingLink.getAttribute("href");
      const summaryTitle = node.querySelector(":scope > summary strong");
      return "branch:" + (summaryTitle ? summaryTitle.textContent.trim() : "");
    }
    const classToken =
      typeof node.className === "string" && node.className.trim()
        ? node.className.trim().split(/\s+/)[0]
        : "";
    return node.tagName.toLowerCase() + "." + classToken;
  }

  function syncableChildren(parent) {
    return Array.from(parent.childNodes).filter(function (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent.trim().length > 0;
      }
      return node.nodeType === Node.ELEMENT_NODE;
    });
  }

  // Coarse structural key used as a fallback when exact key matching fails,
  // e.g. when an entry gains a draft status and its href switches to a draft
  // link. Pairing by structure lets us patch the existing node in place
  // instead of replacing the whole subtree.
  function looseNodeKey(node) {
    if (node.nodeType === Node.TEXT_NODE) return "#text";
    if (node.nodeType !== Node.ELEMENT_NODE) return "#node";
    const dataset = node.dataset || {};
    if (dataset.lucide) return "icon:" + dataset.lucide;
    // Ignore transient state classes (is-*) so status toggles like
    // is-deleted-draft do not break structural pairing.
    const classToken =
      typeof node.className === "string"
        ? node.className
            .trim()
            .split(/\s+/)
            .find(function (token) {
              return token && !token.startsWith("is-");
            }) || ""
        : "";
    return node.tagName.toLowerCase() + "." + classToken;
  }

  function syncAttributes(oldEl, newEl) {
    Array.from(oldEl.attributes).forEach(function (attr) {
      if (SYNC_KEEP_ATTRIBUTES[attr.name]) return;
      if (!newEl.hasAttribute(attr.name)) {
        oldEl.removeAttribute(attr.name);
      }
    });
    Array.from(newEl.attributes).forEach(function (attr) {
      if (SYNC_KEEP_ATTRIBUTES[attr.name]) return;
      if (oldEl.getAttribute(attr.name) !== attr.value) {
        oldEl.setAttribute(attr.name, attr.value);
      }
    });
  }

  function syncNode(oldNode, newNode) {
    if (oldNode.nodeType !== newNode.nodeType) {
      oldNode.replaceWith(newNode);
      return;
    }
    if (oldNode.nodeType === Node.TEXT_NODE) {
      if (oldNode.textContent.trim() !== newNode.textContent.trim()) {
        oldNode.textContent = newNode.textContent;
      }
      return;
    }
    const oldIcon = oldNode.dataset && oldNode.dataset.lucide;
    const newIcon = newNode.dataset && newNode.dataset.lucide;
    if (oldIcon || newIcon) {
      // Same-key icons keep the already-rendered node; anything else was
      // handled by key-based insertion/removal in syncChildren.
      return;
    }
    if (oldNode.tagName !== newNode.tagName) {
      oldNode.replaceWith(newNode);
      return;
    }
    syncAttributes(oldNode, newNode);
    syncChildren(oldNode, newNode);
  }

  function syncChildren(oldParent, newParent) {
    const oldNodes = syncableChildren(oldParent);
    const newNodes = syncableChildren(newParent);
    const buckets = new Map();
    const looseBuckets = new Map();
    oldNodes.forEach(function (node) {
      const key = syncNodeKey(node);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(node);
      const loose = looseNodeKey(node);
      if (!looseBuckets.has(loose)) looseBuckets.set(loose, []);
      looseBuckets.get(loose).push(node);
    });
    const used = new Set();
    const take = function (bucket) {
      if (!bucket) return null;
      return (
        bucket.find(function (candidate) {
          return !used.has(candidate);
        }) || null
      );
    };
    let anchor = null;
    newNodes.forEach(function (newNode) {
      const oldNode =
        take(buckets.get(syncNodeKey(newNode))) ||
        take(looseBuckets.get(looseNodeKey(newNode)));
      if (oldNode) {
        used.add(oldNode);
        syncNode(oldNode, newNode);
        // Move only when the node is not already the next syncable sibling.
        let next = anchor ? anchor.nextSibling : oldParent.firstChild;
        while (
          next &&
          next.nodeType === Node.TEXT_NODE &&
          !next.textContent.trim()
        ) {
          next = next.nextSibling;
        }
        if (next !== oldNode) {
          oldParent.insertBefore(
            oldNode,
            anchor ? anchor.nextSibling : oldParent.firstChild
          );
        }
        anchor = oldNode;
      } else {
        oldParent.insertBefore(
          newNode,
          anchor ? anchor.nextSibling : oldParent.firstChild
        );
        anchor = newNode;
      }
    });
    oldNodes.forEach(function (node) {
      if (!used.has(node)) {
        node.remove();
      }
    });
  }

  // Incrementally reconcile a live container with freshly rendered nodes so
  // unchanged subtrees keep their DOM identity (no reflow/repaint), and only
  // newly inserted icon placeholders get converted afterwards.
  function syncContainer(container, freshNodes) {
    const staging = document.createElement("div");
    freshNodes.forEach(function (node) {
      staging.append(node);
    });
    syncChildren(container, staging);
    refreshIcons(container);
  }

  function addDraftNavigation() {
    const snapshot = state.workspaceSnapshot;
    if (!snapshot) return;
    const sidebar = document.querySelector("[data-docs-sidebar]");
    const previousTop = sidebar ? sidebar.scrollTop : 0;
    const docsNavigation = query(".docs-navigation");
    if (docsNavigation) {
      const navNodes = [];
      if (snapshot.rootDocuments.length) {
        navNodes.push(renderRootDocumentsNavigation(snapshot.rootDocuments));
      }
      snapshot.rootUnits.forEach(function (unit) {
        navNodes.push(renderNavigationUnit(unit, 0));
      });
      syncContainer(docsNavigation, navNodes);
    }

    const unitList = query(".module-unit-list");
    if (unitList) {
      const listNodes = [];
      if (snapshot.rootDocuments.length) {
        listNodes.push(renderRootDocuments(snapshot.rootDocuments));
      }
      snapshot.rootUnits.forEach(function (unit) {
        listNodes.push(renderModuleUnit(unit, 0));
      });
      if (!snapshot.rootUnits.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "该模块暂无内容。";
        listNodes.push(empty);
      }
      syncContainer(unitList, listNodes);
    }
    if (sidebar) {
      sidebar.scrollTop = previousTop;
      const current = sidebar.querySelector(
        '.docs-nav-unit li a[aria-current="page"], ' +
          '.docs-nav-unit-title[aria-current="true"]'
      );
      if (current) {
        const linkBox = current.getBoundingClientRect();
        const sidebarBox = sidebar.getBoundingClientRect();
        if (
          linkBox.top < sidebarBox.top + 24 ||
          linkBox.bottom > sidebarBox.bottom - 24
        ) {
          sidebar.scrollTop = Math.max(
            0,
            current.offsetTop - sidebar.clientHeight / 2
          );
        }
      }
    }
    updateWorkspaceDeleteControls();
  }

  function renderRootDocumentsNavigation(entries) {
    const section = document.createElement("section");
    section.className = "docs-nav-unit workspace-nav-unit";
    section.dataset.workspaceKey = "root-documents";
    const title = document.createElement("p");
    title.className = "docs-nav-unit-title";
    title.textContent = "直属文件";
    const list = document.createElement("ol");
    entries.forEach(function (entry) {
      const item = document.createElement("li");
      item.dataset.workspaceKey = "file:" + entry.path;
      const link = document.createElement("a");
      link.href = workspaceEntryHref(entry);
      link.dataset.workspaceKey = "entry:" + entry.path;
      if (entryMatchesCurrentPage(entry)) {
        link.setAttribute("aria-current", "page");
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
    badge.title = conflict ? "本地更改与远端基树冲突" : "Git " + status;
    target.append(badge);
  }

  function renderNavigationUnit(unit, depth) {
    const section = document.createElement("section");
    section.className =
      "docs-nav-unit workspace-nav-unit" +
      (depth ? " is-subunit" : "");
    section.dataset.workspaceKey = "unit:" + unit.id;
    if (unit.status) section.dataset.status = unit.status;
    const title = document.createElement("a");
    title.className = "docs-nav-unit-title";
    title.href = workspaceEntryHref(unit.readme);
    title.dataset.workspaceKey = "entry:" + unit.readme.path;
    title.textContent = unit.title;
    if (unitContainsCurrentPage(unit)) {
      title.setAttribute("aria-current", "true");
    }
    if (unit.readme.operation === "delete") {
      title.classList.add("is-deleted-draft");
    }
    appendWorkspaceStatus(title, unit.status, unit.readme.conflict);
    section.append(title);
    if (unit.children.length) {
      const children = document.createElement("div");
      children.className = "docs-nav-children";
      unit.children.forEach(function (child) {
        children.append(renderNavigationUnit(child, depth + 1));
      });
      section.append(children);
    }
    const visibleDocuments = unit.documents.filter(function (entry) {
      return !entry.isReadme;
    });
    if (visibleDocuments.length && unitIsCurrent(unit)) {
      const list = document.createElement("ol");
      visibleDocuments.forEach(function (entry) {
        const item = document.createElement("li");
        item.dataset.workspaceKey = "file:" + entry.path;
        const link = document.createElement("a");
        link.href = workspaceEntryHref(entry);
        link.dataset.workspaceKey = "entry:" + entry.path;
        if (entryMatchesCurrentPage(entry)) {
          link.setAttribute("aria-current", "page");
        }
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
    const articleCount = unit.documents.filter(function (entry) {
      return entry.kind === "markdown" && entry.operation !== "delete";
    }).length;
    const codeCount = unit.documents.filter(function (entry) {
      return entry.kind === "code" && entry.operation !== "delete";
    }).length;
    const metadataText =
      (depth ? "子专题 · " : "") +
      articleCount +
      " 篇" +
      (codeCount ? " · " + codeCount + " 个源码文件" : "") +
      (unit.changeCount ? " · " + unit.changeCount + " 项更改" : "");

    function renderActions() {
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
      return actions;
    }

    function renderContent() {
      const content = document.createElement("div");
      content.className = "module-unit-content";
      if (unit.children.length) {
        const group = document.createElement("section");
        group.className = "module-unit-content-group";
        const children = document.createElement("div");
        children.className = "module-subunit-list";
        unit.children.forEach(function (child) {
          children.append(renderModuleUnit(child, depth + 1));
        });
        group.append(children);
        content.append(group);
      }
      const visibleDocuments = unit.documents.filter(function (entry) {
        return !entry.isReadme;
      });
      if (visibleDocuments.length) {
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
        visibleDocuments.forEach(function (entry) {
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
      return content;
    }

    if (depth) {
      const details = document.createElement("details");
      details.className =
        "module-unit-branch workspace-unit-branch is-subunit module-subunit-details";
      details.dataset.unitDepth = String(depth);
      if (unit.status) details.dataset.status = unit.status;
      const summary = document.createElement("summary");
      summary.className = "module-subunit-summary";
      const copy = document.createElement("span");
      const meta = document.createElement("small");
      meta.className = "unit-meta";
      meta.textContent = metadataText;
      const title = document.createElement("strong");
      title.textContent = unit.title;
      appendWorkspaceStatus(title, unit.status, unit.readme.conflict);
      const description = document.createElement("em");
      description.textContent = unit.description || "待补充专题简介。";
      copy.append(meta, title, description);
      const chevron = document.createElement("i");
      chevron.dataset.lucide = "chevron-right";
      chevron.setAttribute("aria-hidden", "true");
      summary.append(copy, chevron);
      const body = document.createElement("div");
      body.className = "module-subunit-body";
      body.append(renderActions(), renderContent());
      details.append(summary, body);
      return details;
    }

    const branch = document.createElement("section");
    branch.className = "module-unit-branch workspace-unit-branch";
    branch.dataset.unitDepth = String(depth);
    if (unit.status) branch.dataset.status = unit.status;
    const article = document.createElement("article");
    article.className = "module-unit";
    const summary = document.createElement("div");
    summary.className = "module-unit-summary";
    const metadata = document.createElement("p");
    metadata.className = "unit-meta";
    metadata.textContent = metadataText;
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
    summary.append(metadata, heading, description, renderActions());
    const content = renderContent();
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

  function applyIdentityPayload(payload, options) {
    const settings = options || {};
    state.config = payload.config;
    state.session = payload.session;
    state.csrf = state.session && state.session.authenticated
      ? state.session.csrf_token
      : "";
    state.legacyDrafts = payload.drafts || [];
    if (state.session && state.session.authenticated) {
      loadDrafts();
    }
    state.cachedDraftCount = state.drafts.length;
    updateAccountView();
    if (payload.config) {
      window.dispatchEvent(
        new CustomEvent("gck:visual-settings", {
          detail: payload.config
        })
      );
    }
    if (!settings.fromCache) {
      state.identityLoaded = true;
      writeIdentityCache(payload);
    }
  }

  async function loadIdentity(options) {
    const settings = options || {};
    if (!settings.force) {
      const cached = readIdentityCache();
      if (cached) {
        applyIdentityPayload(cached, { fromCache: true });
        if (settings.cacheOnly) {
          return cached;
        }
      } else if (settings.cacheOnly) {
        state.config = state.config || {};
        state.session = { authenticated: false };
        updateAccountView();
        return state.session;
      }
    }
    if (settings.cacheOnly) {
      return state.session;
    }
    if (state.identityPromise) {
      return state.identityPromise;
    }
    state.identityPromise = (async function () {
      let payload = await api(bootstrapPath());
      if (payload.bootstrap_error) {
        payload = await api(bootstrapPath());
      }
      applyIdentityPayload(payload);
      return payload;
    })().finally(function () {
      state.identityPromise = null;
      window.GCK_EDITOR_BOOTSTRAP = null;
    });
    const payload = await state.identityPromise;
    const githubAuthError = takeGithubAuthError();
    if (githubAuthError) {
      openAccount();
      feedback(query("[data-account-feedback]"), githubAuthError);
    }
    await applyDraftsToReader(payload.active_draft_html);
    const onboardingOpen = openOnboardingIfNeeded();
    checkForUpdateAnnouncement();
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
    return payload;
  }

  async function ensureIdentityLoaded() {
    if (state.identityLoaded) {
      return state.session;
    }
    await loadIdentity({ force: true });
    return state.session;
  }

  function refreshIdentityWhenIdle() {
    const refresh = function () {
      loadIdentity({ force: true }).catch(function () {
        // Cached identity keeps the header usable while the editor API is slow.
      });
    };
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(refresh, { timeout: 3500 });
    } else {
      window.setTimeout(refresh, 1800);
    }
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
    query("[data-onboarding-skip]").textContent =
      state.onboardingManual ? "关闭引导" : "跳过引导";
    query("[data-onboarding-finish]").textContent =
      state.onboardingManual ? "完成浏览" : "完成引导";
    refreshIcons(query("[data-onboarding-dialog]"));
  }

  function openOnboarding(manual) {
    const user =
      state.session && state.session.authenticated
        ? state.session.user
        : null;
    if (!user || user.must_change_password) {
      return false;
    }
    const account = query("[data-account-dialog]");
    const dialog = query("[data-onboarding-dialog]");
    if (account && account.open) {
      account.close();
    }
    state.onboardingManual = Boolean(manual);
    state.onboardingStep = 0;
    renderOnboarding();
    feedback(query("[data-onboarding-feedback]"), "");
    if (!dialog.open) {
      dialog.showModal();
    }
    return true;
  }

  function openOnboardingIfNeeded() {
    const user =
      state.session && state.session.authenticated
        ? state.session.user
        : null;
    if (!user || user.must_change_password || !user.needs_onboarding) {
      return false;
    }
    return openOnboarding(false);
  }

  async function completeOnboarding() {
    if (state.onboardingSaving) {
      return;
    }
    state.onboardingSaving = true;
    const dialog = query("[data-onboarding-dialog]");
    if (
      state.onboardingManual ||
      !state.session?.user?.needs_onboarding
    ) {
      state.onboardingManual = false;
      state.onboardingSaving = false;
      dialog.close();
      return;
    }
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
    const draft = state.drafts.find(function (item) {
      return item.path === path;
    });
    if (!draft) return null;
    return {
      ...draft,
      baseSha: draft.base_sha || draft.baseSha || null,
      baseContent:
        typeof draft.base_content === "string"
          ? draft.base_content
          : draft.baseContent,
      lineDiff: draft.line_diff || draft.lineDiff || [],
      diffSummary: draft.diff_summary || draft.diffSummary,
      updatedAt: draft.updated_at || draft.updatedAt
    };
  }

  function removeEditorBuffer(path) {
    const store = window.GCKWorkspaceStore;
    if (!store || !editorUserId()) return;
    applyWorkspaceState(
      store.discardChange(
        window.localStorage,
        editorUserId(),
        workspaceRepository(),
        path
      )
    );
  }

  function cachedLineDiff(baseContent, nextContent, operation) {
    if (
      !window.GCKReaderDiff ||
      typeof window.GCKReaderDiff.buildLineDiff !== "function"
    ) {
      return {
        rows: [],
        summary: { added: 0, modified: 0, deleted: 0 }
      };
    }
    const rows = window.GCKReaderDiff
      .buildLineDiff(
        typeof baseContent === "string" ? baseContent : "",
        operation === "delete" ? "" : nextContent || ""
      )
      .filter(function (row) {
        return row.type !== "context";
      });
    return {
      rows,
      summary: rows.reduce(
        function (summary, row) {
          if (row.type === "added") summary.added += 1;
          else if (row.type === "modified") summary.modified += 1;
          else if (row.type === "deleted") summary.deleted += 1;
          return summary;
        },
        { added: 0, modified: 0, deleted: 0 }
      )
    };
  }

  function writeEditorBuffer(path, value) {
    const diff = cachedLineDiff(
      value.baseContent,
      value.content,
      value.operation
    );
    if (
      value.operation !== "delete" &&
      value.baseSha &&
      value.content === value.baseContent
    ) {
      removeEditorBuffer(path);
      scheduleWorkspaceRender();
      return null;
    }
    const saved = applyWorkspaceChange({
      path,
      ...value,
      lineDiff: diff.rows,
      diffSummary: diff.summary
    });
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

  async function rebaseWorkspaceChanges(changes, remoteEntries) {
    const remoteByPath = new Map(
      remoteEntries.map(function (entry) {
        return [entry.path, entry];
      })
    );
    for (const change of changes) {
      const remote = remoteByPath.get(change.path);
      if (!remote) {
        if (change.baseSha && change.operation === "delete") {
          removeEditorBuffer(change.path);
        } else if (change.baseSha) {
          applyWorkspaceChange({
            ...change,
            conflict: true,
            conflictReason: "远端文件已删除"
          });
        }
        continue;
      }
      if (!change.baseSha) {
        applyWorkspaceChange({
          ...change,
          conflict: true,
          conflictReason: "远端已创建同名文件"
        });
        continue;
      }
      if (remote.sha === change.baseSha) continue;
      if (change.operation === "delete") {
        applyWorkspaceChange({
          ...change,
          conflict: true,
          conflictReason: "远端文件在本地删除后发生了修改"
        });
        continue;
      }
      try {
        const latest = await api(
          "/repository/file?path=" + encodeURIComponent(change.path)
        );
        const patch = window.JsDiff
          ? window.JsDiff.createPatch(
              change.path,
              change.baseContent || "",
              change.content,
              "",
              ""
            )
          : null;
        const merged = patch
          ? window.JsDiff.applyPatch(latest.content, patch)
          : null;
        applyWorkspaceChange({
          ...change,
          content:
            typeof merged === "string" ? merged : change.content,
          baseSha: latest.sha,
          baseContent: latest.content,
          conflict: typeof merged !== "string",
          conflictReason:
            typeof merged === "string"
              ? ""
              : "远端与本地修改了相同内容",
          updatedAt: Date.now()
        });
      } catch (error) {
        applyWorkspaceChange({
          ...change,
          conflict: true,
          conflictReason: error.message
        });
      }
    }
  }

  async function syncRemoteWorkspace() {
    if (
      state.remoteSyncPromise ||
      !state.session ||
      !state.session.can_edit ||
      !window.GCKWorkspaceStore
    ) {
      return state.remoteSyncPromise;
    }
    const previous = readLocalWorkspace();
    const previousChanges = previous ? previous.changes : [];
    if (previousChanges.length) {
      return previous;
    }
    state.remoteSyncPromise = (async function () {
      const payload = await api("/repository/tree");
      if (
        !payload ||
        !payload.revision ||
        !Array.isArray(payload.items)
      ) {
        throw new Error("远端目录树响应不完整");
      }
      cacheContributionGraph(
        payload.contribution_graph,
        payload.revision
      );
      applyWorkspaceState(
        window.GCKWorkspaceStore.syncBase(
          window.localStorage,
          editorUserId(),
          workspaceRepository(),
          payload.revision,
          payload.items || []
        )
      );
      await rebaseWorkspaceChanges(
        previousChanges,
        payload.items || []
      );
      refreshEffectiveDrafts();
      addDraftNavigation();
      updateAccountView();
      return readLocalWorkspace();
    })().catch(function () {
      return readLocalWorkspace();
    }).finally(function () {
      state.remoteSyncPromise = null;
    });
    return state.remoteSyncPromise;
  }

  function syncWorkspaceState() {
    refreshEffectiveDrafts();
    addDraftNavigation();
    updateAccountView();
    return Promise.resolve(readLocalWorkspace());
  }

  function beginWorkspaceSync() {
    if (!state.session || !state.session.can_edit) return;
    window.setTimeout(syncRemoteWorkspace, 0);
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
    if (modern) {
      const modebar = document.createElement("div");
      modebar.className = "inline-editor-modebar";
      modebar.setAttribute("role", "tablist");
      modebar.setAttribute("aria-label", "Markdown 编辑视图");
      const sourceMode = document.createElement("button");
      sourceMode.className = "is-active";
      sourceMode.type = "button";
      sourceMode.dataset.inlineMode = "source";
      sourceMode.setAttribute("role", "tab");
      sourceMode.setAttribute("aria-selected", "true");
      sourceMode.innerHTML =
        '<i data-lucide="braces" aria-hidden="true"></i><span>Markdown</span>';
      const previewMode = document.createElement("button");
      previewMode.type = "button";
      previewMode.dataset.inlineMode = "preview";
      previewMode.setAttribute("role", "tab");
      previewMode.setAttribute("aria-selected", "false");
      previewMode.innerHTML =
        '<i data-lucide="eye" aria-hidden="true"></i><span>预览</span>';
      modebar.append(sourceMode, previewMode);
      panel.append(modebar);
    } else {
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
      save.textContent = "保存到本地";
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
    refreshIcons(panel);
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
    if (panel.ready) {
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
    panel.removeMarkdownInputRules?.();
    if (state.inlineEditor) {
      state.inlineEditor.destroy();
      state.inlineEditor = null;
    }
    if (panel.livePreview) {
      panel.livePreview.destroy();
      panel.livePreview = null;
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
    queryAll("table", prose).forEach(function (table) {
      if (table.parentElement?.classList.contains("table-scroll")) {
        return;
      }
      const wrapper = document.createElement("div");
      wrapper.className = "table-scroll";
      wrapper.tabIndex = 0;
      table.before(wrapper);
      wrapper.append(table);
    });
    rendered.replaceChildren(prose);
    rendered.dataset.draftOverlay = "true";
    if (window.GCKMermaid) {
      window.GCKMermaid.render(prose);
    }
  }

  function splitMarkdownDocument(content) {
    if (window.GCKEditorDocument) {
      return window.GCKEditorDocument.splitMarkdownDocument(content);
    }
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
    if (window.GCKEditorDocument) {
      return window.GCKEditorDocument.assembleMarkdownDocument(
        parts,
        title,
        body
      );
    }
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
      const anchor = event.target.closest("a[href]");
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

  function resizeInlineSource(textarea) {
    if (!textarea.closest(".inline-editor.is-modern") || textarea.hidden) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height =
      Math.max(420, textarea.scrollHeight + 2) + "px";
  }

  function setInlineEditorMode(panel, mode) {
    const mount = query("[data-visual-editor]", panel);
    const textarea = query("[data-inline-input]", panel);
    const sourceMode = query('[data-inline-mode="source"]', panel);
    const previewMode = query('[data-inline-mode="preview"]', panel);
    const previewing = mode === "preview";
    if (!previewing && state.inlineEditor) {
      textarea.value = state.inlineEditor.getMarkdown();
    }
    panel.dataset.editorMode = previewing ? "preview" : "source";
    textarea.hidden = previewing;
    mount.hidden = !previewing;
    if (sourceMode) {
      sourceMode.classList.toggle("is-active", !previewing);
      sourceMode.setAttribute("aria-selected", String(!previewing));
    }
    if (previewMode) {
      previewMode.classList.toggle("is-active", previewing);
      previewMode.setAttribute("aria-selected", String(previewing));
    }
    if (!previewing) {
      window.requestAnimationFrame(function () {
        resizeInlineSource(textarea);
        textarea.focus();
      });
    }
  }

  function updateInlinePreviewSource(panel, source) {
    const textarea = query("[data-inline-input]", panel);
    const parts = splitMarkdownDocument(source);
    panel.documentParts = parts;
    textarea.value = parts.body;
    if (
      panel.titleElement &&
      panel.titleElement.textContent !== parts.title
    ) {
      panel.titleElement.textContent = parts.title;
    }
    resizeInlineSource(textarea);
    const cached = cacheInlineEditor(panel);
    if (!cached) {
      throw new Error(
        query("[data-inline-feedback]", panel)?.textContent ||
          "当前 Markdown 块无法写入完整文档"
      );
    }
  }

  function initializeInlineLivePreview(panel, mount) {
    if (
      panel.livePreview ||
      !window.GCKMarkdownLivePreview
    ) {
      panel.livePreview?.refresh();
      return;
    }
    panel.livePreview = window.GCKMarkdownLivePreview.create(
      mount,
      {
        getSource: function () {
          return serializedInlineContent(panel).serialized;
        },
        setSource: function (source) {
          updateInlinePreviewSource(panel, source);
        },
        render: function () {
          return renderInlineMarkdownPreview(panel);
        },
        onError: function (error) {
          setInlineFeedback(panel, error.message, "error");
        }
      }
    );
  }

  async function renderInlineMarkdownPreview(panel) {
    const previewMode = query('[data-inline-mode="preview"]', panel);
    if (previewMode) previewMode.disabled = true;
    try {
      const content = serializedInlineContent(panel);
      const result = await api("/preview", {
        method: "POST",
        body: JSON.stringify({ content: content.serialized })
      });
      const mount = query("[data-visual-editor]", panel);
      const template = document.createElement("template");
      template.innerHTML = result.html;
      template.content.querySelector("h1")?.remove();
      const prose = document.createElement("div");
      prose.className = "prose inline-editor-source-preview";
      prose.append(template.content);
      queryAll("table", prose).forEach(function (table) {
        if (table.parentElement?.classList.contains("table-scroll")) return;
        const wrapper = document.createElement("div");
        wrapper.className = "table-scroll";
        wrapper.tabIndex = 0;
        table.before(wrapper);
        wrapper.append(table);
      });
      mount.replaceChildren(prose);
      initializeInlineLivePreview(panel, mount);
      panel.livePreview?.refresh();
      if (window.GCKMermaid) {
        window.GCKMermaid.render(prose);
      }
      setInlineEditorMode(panel, "preview");
    } catch (error) {
      setInlineFeedback(panel, error.message, "error");
    } finally {
      if (previewMode) previewMode.disabled = false;
    }
  }

  async function initializeVisualEditor(panel, host, content) {
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
    mount.hidden = true;
    textarea.hidden = false;
    textarea.value = editorValue;
    textarea.dataset.markdownSource = "";
    if (
      !window.toastui?.Editor &&
      window.GCKMarkdownLivePreview?.ensureWysiwygAssets
    ) {
      try {
        await window.GCKMarkdownLivePreview.ensureWysiwygAssets();
      } catch (error) {
        setInlineFeedback(panel, error.message, "error");
      }
    }
    textarea.addEventListener("keydown", function (event) {
      if (event.key !== "Tab") return;
      event.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.setRangeText("  ", start, end, "end");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    if (modern) {
      bindModernEditorLinks(panel, mount);
      query('[data-inline-mode="source"]', panel)?.addEventListener(
        "click",
        function () {
          panel.livePreview?.close(false);
          setInlineEditorMode(panel, "source");
        }
      );
      query('[data-inline-mode="preview"]', panel)?.addEventListener(
        "click",
        function () {
          if (state.inlineEditor) {
            state.inlineEditor.setMarkdown(textarea.value, false);
            cacheInlineEditor(panel);
            setInlineEditorMode(panel, "preview");
          } else {
            renderInlineMarkdownPreview(panel);
          }
        }
      );
    }
    if (window.toastui?.Editor) {
      mount.replaceChildren();
      textarea.hidden = true;
      mount.hidden = false;
      state.inlineEditor = new window.toastui.Editor({
        el: mount,
        height: modern ? "auto" : "600px",
        minHeight: modern ? "0" : "600px",
        initialEditType: "wysiwyg",
        previewStyle: "tab",
        initialValue: editorValue,
        usageStatistics: false,
        autofocus: false,
        hideModeSwitch: true,
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
            if (panel.ready) {
              cacheInlineEditor(panel);
            }
          },
          focus: function () {
            mount.classList.add("is-markdown-editing");
          },
          blur: function () {
            mount.classList.remove("is-markdown-editing");
          }
        }
      });
      mount.dataset.markdownWysiwyg = "";
      panel.removeMarkdownInputRules =
        window.GCKMarkdownLivePreview?.installWysiwygInputRules(
          state.inlineEditor
        );
      const canonicalBody = state.inlineEditor.getMarkdown();
      textarea.value = canonicalBody;
      panel.canonicalContent = modern
        ? assembleMarkdownDocument(parts, parts.title, canonicalBody)
        : canonicalBody;
      if (modern) {
        setInlineEditorMode(panel, "preview");
      }
    } else {
      panel.canonicalContent = modern
        ? assembleMarkdownDocument(parts, parts.title, editorValue)
        : content;
    }
    window.requestAnimationFrame(function () {
      resizeInlineSource(textarea);
    });
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
    const integrity = window.GCKEditorDocument
      ? window.GCKEditorDocument.validateCompleteSnapshot(
          path,
          content.serialized
        )
      : { valid: true, message: "" };
    if (!integrity.valid) {
      setEditorSyncState(
        panel,
        "invalid",
        integrity.message,
        "error"
      );
      return null;
    }
    if (
      panel.dataset.baseSha &&
      content.serialized === panel.repositoryBaseContent
    ) {
      removeEditorBuffer(path);
      scheduleWorkspaceRender();
      setEditorSyncState(
        panel,
        "synced",
        "当前内容与 Base Tree 一致。",
        "success"
      );
      return content;
    }

    const cached = writeEditorBuffer(path, {
      content: content.serialized,
      baseSha: panel.dataset.baseSha || null,
      baseContent: panel.repositoryBaseContent,
      operation: "upsert",
      updatedAt: Date.now()
    });
    setEditorSyncState(
      panel,
      cached ? "local" : "memory",
      cached
        ? "更改已写入本地 Current Tree。"
        : "本地缓存不可用，当前更改仅保留在内存中。",
      cached ? "success" : "error"
    );
    return content;
  }

  async function syncInlineBuffer(panel) {
    if (
      !panel ||
      !panel.ready ||
      !panel.classList.contains("is-modern")
    ) {
      return null;
    }
    const content = cacheInlineEditor(panel);
    return content
      ? readEditorBuffer(panel.dataset.path)
      : null;
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
      let draft = state.drafts.find(function (item) {
        return item.path === sourcePath;
      });
      let baseEntry = (state.baseTree?.entries || []).find(function (item) {
        return item.path === sourcePath;
      });
      let currentEntry = (state.currentTree?.entries || []).find(
        function (item) {
          return item.path === sourcePath &&
            item.operation !== "delete";
        }
      );
      let cached = readEditorBuffer(sourcePath);
      const markdownDocument = sourcePath.toLowerCase().endsWith(".md");
      const baseNeedsHydration = Boolean(
        baseEntry &&
        (
          typeof baseEntry.content !== "string" ||
          (
            markdownDocument &&
            window.GCKEditorDocument &&
            !window.GCKEditorDocument.validateCompleteSnapshot(
              sourcePath,
              baseEntry.content
            ).valid
          )
        )
      );
      let deployedBase = null;
      if (baseNeedsHydration) {
        deployedBase = await loadDeployedSource(sourcePath);
        if (!deployedBase) {
          deployedBase = await api(
            "/repository/file?path=" + encodeURIComponent(sourcePath)
          );
          deployedBase.sourceType = "repository-api";
        }
        if (
          deployedBase &&
          (!baseEntry.sha || deployedBase.sha === baseEntry.sha)
        ) {
          const hydrated = window.GCKWorkspaceStore.hydrateBaseFile(
            window.localStorage,
            editorUserId(),
            workspaceRepository(),
            sourcePath,
            deployedBase.sha,
            deployedBase.content
          );
          applyWorkspaceState(hydrated);
          baseEntry = (state.baseTree?.entries || []).find(function (item) {
            return item.path === sourcePath;
          });
          currentEntry = (state.currentTree?.entries || []).find(
            function (item) {
              return item.path === sourcePath &&
                item.operation !== "delete";
            }
          );
          cached = readEditorBuffer(sourcePath);
          draft = state.drafts.find(function (item) {
            return item.path === sourcePath;
          });
        }
      }
      let source =
        currentEntry && typeof currentEntry.content === "string"
          ? { ...currentEntry, sourceType: "current-tree" }
          : deployedBase || await loadDeployedSource(sourcePath);
      if (!source && cached && !cached.baseSha) {
        source = {
          path: sourcePath,
          content: cached.content || "",
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
      if (
        baseEntry &&
        typeof baseEntry.content !== "string" &&
        source.sourceType !== "current-tree" &&
        source.sha === baseEntry.sha
      ) {
        const hydrated = window.GCKWorkspaceStore.hydrateBaseFile(
          window.localStorage,
          editorUserId(),
          workspaceRepository(),
          sourcePath,
          source.sha,
          source.content
        );
        applyWorkspaceState(hydrated);
        baseEntry = (state.baseTree?.entries || []).find(function (item) {
          return item.path === sourcePath;
        });
      }
      const cachedMatchesBase = Boolean(
        cached &&
        baseEntry &&
        (!cached.baseSha || cached.baseSha === baseEntry.sha)
      );
      const repositoryBaseContent =
        cachedMatchesBase && typeof baseEntry.content === "string"
          ? baseEntry.content
          : cached && typeof cached.baseContent === "string"
            ? cached.baseContent
            : typeof baseEntry?.content === "string"
              ? baseEntry.content
              : source.content;
      let editorContent = cached ? cached.content : source.content;
      if (
        cachedMatchesBase &&
        window.GCKEditorDocument &&
        !window.GCKEditorDocument.validateCompleteSnapshot(
          sourcePath,
          editorContent
        ).valid
      ) {
        const repaired =
          window.GCKEditorDocument.repairLegacyPartialSnapshot(
            sourcePath,
            repositoryBaseContent,
            cached.baseContent,
            editorContent
          );
        if (repaired.repaired) {
          editorContent = repaired.content;
          writeEditorBuffer(sourcePath, {
            content: editorContent,
            baseSha: baseEntry.sha,
            baseContent: repositoryBaseContent,
            operation: "upsert",
            updatedAt: Date.now()
          });
          cached = readEditorBuffer(sourcePath);
          draft = state.drafts.find(function (item) {
            return item.path === sourcePath;
          });
          panel.repairedLegacySnapshot = true;
        } else {
          editorContent = repositoryBaseContent;
          panel.unrepairedLegacySnapshot = true;
        }
      }
      panel.dataset.baseSha =
        (cached && cached.baseSha) ||
        baseEntry?.sha ||
        source.sha ||
        "";
      panel.repositoryBaseContent = repositoryBaseContent;
      panel.lastSyncedContent = editorContent;
      panel.renderedContent = editorContent;
      panel.bufferedContent = editorContent;
      const deleteButton = query("[data-inline-delete]", panel);
      if (deleteButton) {
        deleteButton.textContent =
          panel.dataset.baseSha ? "删除文件" : "删除新增文件";
      }
      if (markdownDocument) {
        await initializeVisualEditor(panel, host, editorContent);
      } else {
        query("[data-visual-editor]", panel).hidden = true;
        textarea.hidden = false;
        textarea.value = editorContent;
        panel.originalContent = editorContent;
        panel.canonicalContent = editorContent;
      }
      panel.ready = true;
      textarea.addEventListener("input", function () {
        resizeInlineSource(textarea);
        cacheInlineEditor(panel);
      });
      if (panel.repairedLegacySnapshot) {
        setEditorSyncState(
          panel,
          "local",
          "已将旧的局部缓存修复为完整文档。",
          "success"
        );
      } else if (panel.unrepairedLegacySnapshot) {
        setEditorSyncState(
          panel,
          "invalid",
          "检测到不完整旧缓存，已加载 Base Tree 完整文档；" +
            "重新编辑后会替换损坏缓存。",
          "error"
        );
      } else if (cached && cached.content !== source.content) {
        setEditorSyncState(
          panel,
          "local",
          "已从本地 Current Tree 恢复更改。",
          "success"
        );
      } else if (draft) {
        setEditorSyncState(
          panel,
          "local",
          "已加载本地 Current Tree 更改。",
          "success"
        );
      } else {
        setEditorSyncState(
          panel,
          "synced",
          "已加载本地 Base Tree 源文件。",
          "success"
        );
      }
      const startsInPreview =
        markdownDocument &&
        panel.classList.contains("is-modern");
      if (startsInPreview) {
        if (state.inlineEditor) {
          setInlineEditorMode(panel, "preview");
        } else {
          await renderInlineMarkdownPreview(panel);
        }
      }
      activateInlinePanel(panel, host);
      if (panel.classList.contains("is-modern")) {
        beginInlineAutoSync(panel);
      }
      if (panel.dataset.editorMode !== "preview") {
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
      if (
        panel.dataset.baseSha &&
        serializedContent === panel.repositoryBaseContent
      ) {
        removeEditorBuffer(path);
        setInlineFeedback(
          panel,
          "当前内容与 Base Tree 一致。",
          "success"
        );
        return;
      }
      const saved = writeEditorBuffer(path, {
        content: serializedContent,
        baseSha: panel.dataset.baseSha || null,
        baseContent: panel.repositoryBaseContent,
        operation: "upsert",
        updatedAt: Date.now()
      });
      panel.canonicalContent = canonicalContent;
      if (path.toLowerCase().endsWith(".md")) {
        const preview = await api("/preview", {
          method: "POST",
          body: JSON.stringify({ content: serializedContent })
        });
        renderMarkdownIntoHost(host, preview.html);
      }
      setInlineFeedback(
        panel,
        "更改已写入本地 Current Tree，可在工作台统一提交。",
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
      const deleted = writeEditorBuffer(path, {
        content: "",
        baseSha: remoteSha,
        baseContent: panel.repositoryBaseContent,
        operation: "delete",
        updatedAt: Date.now()
      });
      refreshEffectiveDrafts();
      await closeInlineEditor({ renderLatest: false });
      showDeletedDraft(host, deleted);
      updateAccountView();
      addDraftNavigation();
    } catch (error) {
      setInlineFeedback(panel, error.message, "error");
    }
  }

  function workspacePathMatches(path, target, kind) {
    return kind === "file"
      ? path === target
      : path === target || path.startsWith(target.replace(/\/$/, "") + "/");
  }

  function isTopLevelModulePath(path) {
    const parts = path.split("/").filter(Boolean);
    return parts[0] === "program" || parts[0] === "planning"
      ? parts.length === 2
      : parts.length === 1;
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
          : isTopLevelModulePath(button.dataset.deletePath)
            ? "删除大模块"
            : "删除子模块";
      button.title = text;
      button.setAttribute(
        "aria-label",
        text + "：" + (button.dataset.deleteLabel || button.dataset.deletePath)
      );
      const icon = query("svg, i", button);
      if (icon) {
        const wantedIcon = deleted ? "undo-2" : "trash-2";
        if (icon.dataset.lucide !== wantedIcon) {
          const replacement = document.createElement("i");
          replacement.dataset.lucide = wantedIcon;
          replacement.setAttribute("aria-hidden", "true");
          icon.replaceWith(replacement);
          refreshIcons(button);
        }
      }
      if (kind !== "file") {
        const textNodes = Array.from(button.childNodes).filter(function (node) {
          return node.nodeType === Node.TEXT_NODE;
        });
        const currentText = textNodes
          .map(function (node) {
            return node.textContent;
          })
          .join("")
          .trim();
        if (currentText !== text) {
          textNodes.forEach(function (node) {
            node.remove();
          });
          button.append(document.createTextNode(text));
        }
      }
    });
  }

  async function restoreWorkspaceTarget(target, kind) {
    state.drafts
      .filter(function (change) {
        return workspacePathMatches(change.path, target, kind);
      })
      .map(function (change) {
        return change.path;
      })
      .forEach(removeEditorBuffer);
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
    const count = new Set(
      localEntries
        .map(function (entry) {
          return entry.path;
        })
        .concat(localDrafts.map(function (draft) {
          return draft.path;
        }))
    ).size;
    const topLevelModule =
      kind === "directory" && isTopLevelModulePath(target);
    const scope = kind === "file"
      ? "文件"
      : topLevelModule
        ? "大模块"
        : "子模块";
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
      topLevelModule &&
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
      const baseByPath = new Map(
        (state.baseTree?.entries || []).map(function (entry) {
          return [entry.path, entry];
        })
      );
      const allPaths = new Set(
        localEntries
          .map(function (entry) {
            return entry.path;
          })
          .concat(
            localDrafts.map(function (draft) {
              return draft.path;
            })
          )
      );
      allPaths.forEach(function (path) {
        const base = baseByPath.get(path);
        if (!base) {
          removeEditorBuffer(path);
          return;
        }
        writeEditorBuffer(path, {
          content: "",
          baseSha: base.sha,
          baseContent: base.content,
          operation: "delete",
          updatedAt: Date.now()
        });
      });
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
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
      updateWorkspaceDeleteControls();
    }
  }

  function normalizeParent(root, value) {
    const rootParts = (root || "").split("/").filter(Boolean);
    const parts = (value || "").split("/").filter(Boolean);
    const includesRoot =
      rootParts.length > 0 &&
      rootParts.every(function (part, index) {
        return parts[index] === part;
      });
    if (includesRoot) {
      parts.splice(0, rootParts.length);
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
      const parent = normalizeParent(values.root, values.parent);
      if (values.kind === "module") {
        path = [
          values.root,
          parent,
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
        path = [values.root, parent, filename]
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
    query("[data-account-trigger]").addEventListener("click", function () {
      openAccount();
      ensureIdentityLoaded().catch(function (error) {
        feedback(query("[data-account-feedback]"), error.message);
      });
    });
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
        writeIdentityCache({
          config: state.config,
          session: state.session
        });
        updateAccountView();
        await applyDraftsToReader();
        beginWorkspaceSync();
        openOnboardingIfNeeded();
        checkForUpdateAnnouncement();
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
        writeIdentityCache({
          config: state.config,
          session: state.session
        });
        updateAccountView();
        await applyDraftsToReader();
        beginWorkspaceSync();
        openOnboardingIfNeeded();
        checkForUpdateAnnouncement();
      } catch (error) {
        feedback(target, error.message);
      }
    });
    query("[data-edit-mode-trigger]").addEventListener("click", async function () {
      try {
        await ensureIdentityLoaded();
      } catch (error) {
        openAccount();
        feedback(query("[data-account-feedback]"), error.message);
        return;
      }
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
        clearIdentityCache();
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
    query("[data-onboarding-open]").addEventListener("click", function () {
      openOnboarding(true);
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
    queryAll("[data-close-update-announcement]").forEach(function (button) {
      button.addEventListener("click", acknowledgeUpdateAnnouncement);
    });
    query("[data-update-announcement-dialog]").addEventListener(
      "cancel",
      function (event) {
        event.preventDefault();
        acknowledgeUpdateAnnouncement();
      }
    );
    [
      "[data-search-dialog]",
      "[data-account-dialog]",
      "[data-onboarding-dialog]",
      "[data-content-create-dialog]"
    ].forEach(function (selector) {
      query(selector).addEventListener("close", function () {
        window.setTimeout(showPendingUpdateAnnouncement, 0);
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
      if (state.onboardingManual) {
        state.onboardingManual = false;
        return;
      }
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
    restoreCachedWorkspaceNavigation();
    loadIdentity({ cacheOnly: true });
    refreshIdentityWhenIdle();
  });
})();
