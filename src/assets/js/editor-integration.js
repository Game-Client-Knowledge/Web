(function () {
  "use strict";

  const config = window.GCK_CONFIG || {};
  const editorApi = (config.editorApi || "/editor/api").replace(/\/$/, "");
  const editorUrl = config.editorUrl || "/editor/";
  const state = {
    config: null,
    session: null,
    csrf: "",
    drafts: [],
    editMode: window.localStorage.getItem("gck-edit-mode") === "1",
    inlinePanel: null,
    inlineEditor: null,
    renderTimer: null
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
      throw new Error(
        Array.isArray(detail)
          ? detail.join("；")
          : detail || "请求失败（HTTP " + response.status + "）"
      );
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
    const label = query("[data-account-label]");
    const guest = query("[data-account-guest]");
    const profile = query("[data-account-user]");
    const githubLogin = query("[data-account-github-login]");
    const registerTab = query('[data-account-tab="register"]');

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
      guest.hidden = false;
      profile.hidden = true;
      trigger.classList.remove("is-authenticated");
      label.textContent = "登录";
      applyEditMode(false);
      refreshIcons();
      return;
    }

    const user = state.session.user;
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

    const editButton = query("[data-edit-mode-trigger]");
    editButton.disabled =
      !state.session.can_edit || user.must_change_password;

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
      state.drafts = [];
      return;
    }
    try {
      const payload = await api("/drafts");
      state.drafts = payload.items;
    } catch {
      state.drafts = [];
    }
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

  function draftTitle(draft) {
    const heading = draft.content.match(/^#\s+(.+?)\s*$/m);
    return heading
      ? heading[1].replace(/[*_`]/g, "")
      : draft.path.split("/").pop();
  }

  function addDraftNavigation() {
    queryAll("[data-draft-navigation]").forEach(function (element) {
      element.remove();
    });
    const root = config.editorContext && config.editorContext.root;
    if (!root) {
      return;
    }
    const currentPaths = new Set(
      queryAll("[data-editor-source]").map(function (element) {
        return element.dataset.editorSource;
      })
    );
    const relevant = state.drafts.filter(function (draft) {
      return (
        draft.path.startsWith(root + "/") &&
        (!currentPaths.has(draft.path) || !draft.base_sha)
      );
    });
    if (!relevant.length) {
      return;
    }

    const docsNavigation = query(".docs-navigation");
    if (docsNavigation) {
      const section = document.createElement("section");
      section.className = "docs-nav-unit draft-navigation";
      section.dataset.draftNavigation = "";
      const title = document.createElement("p");
      title.className = "docs-nav-unit-title";
      title.textContent = "个人草稿";
      const list = document.createElement("ol");
      relevant.forEach(function (draft) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = draftLink(draft.path);
        const icon = document.createElement("i");
        icon.dataset.lucide = "file-diff";
        icon.setAttribute("aria-hidden", "true");
        link.append(icon);
        const label = document.createElement("span");
        label.textContent = draftTitle(draft);
        link.append(label);
        item.append(link);
        list.append(item);
      });
      section.append(title, list);
      docsNavigation.append(section);
      refreshIcons(section);
    }

    const unitList = query(".module-unit-list");
    if (unitList) {
      const section = document.createElement("section");
      section.className = "draft-content-list";
      section.dataset.draftNavigation = "";
      const heading = document.createElement("div");
      heading.className = "draft-content-list-heading";
      heading.innerHTML =
        '<i data-lucide="git-branch" aria-hidden="true"></i><strong>个人未提交内容</strong>';
      const list = document.createElement("div");
      relevant.forEach(function (draft) {
        const link = document.createElement("a");
        link.className = "draft-content-link";
        link.href = draftLink(draft.path);
        const change = document.createElement("span");
        change.textContent = draft.base_sha ? "M" : "A";
        const copy = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = draftTitle(draft);
        const path = document.createElement("small");
        path.textContent = draft.path;
        copy.append(strong, path);
        link.append(change, copy);
        list.append(link);
      });
      section.append(heading, list);
      unitList.prepend(section);
      refreshIcons(section);
    }
  }

  async function applyDraftsToReader() {
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
    try {
      const result = await api("/preview", {
        method: "POST",
        body: JSON.stringify({ content: draft.content })
      });
      renderMarkdownIntoHost(host, result.html);
      const header = query(".article-header, .module-page-header", host);
      if (header) {
        let badge = query("[data-draft-badge]", header);
        if (!badge) {
          badge = document.createElement("p");
          badge.className = "draft-page-badge";
          badge.dataset.draftBadge = "";
          header.append(badge);
        }
        badge.textContent =
          (draft.base_sha ? "已修改" : "新增") + " · 个人未提交草稿";
      }
    } catch {
      // Invalid drafts stay available in the workspace for correction.
    }
  }

  async function loadIdentity() {
    state.config = await api("/config");
    state.session = await api("/session");
    state.csrf = state.session.authenticated
      ? state.session.csrf_token
      : "";
    await loadDrafts();
    updateAccountView();
    await applyDraftsToReader();
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

  function applyEditMode(enabled) {
    state.editMode = Boolean(enabled);
    document.body.classList.toggle("is-edit-mode", state.editMode);
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

  function setInlineFeedback(panel, message, kind) {
    const target = query("[data-inline-feedback]", panel);
    target.textContent = message;
    target.className =
      "inline-editor-feedback" +
      (kind ? " is-" + kind : "");
  }

  function createInlinePanel(host, sourcePath) {
    const panel = document.createElement("section");
    panel.className = "inline-editor";
    panel.dataset.inlineEditor = "";

    const toolbar = document.createElement("div");
    toolbar.className = "inline-editor-toolbar";
    const path = document.createElement("span");
    path.className = "inline-editor-path";
    path.textContent = sourcePath;
    const actions = document.createElement("div");
    actions.className = "inline-editor-actions";

    const close = document.createElement("button");
    close.className = "secondary-button";
    close.type = "button";
    close.dataset.inlineClose = "";
    close.textContent = "关闭";
    const save = document.createElement("button");
    save.className = "primary-button";
    save.dataset.inlineSave = "";
    save.textContent = "保存草稿";
    actions.append(close, save);
    toolbar.append(path, actions);

    const visualEditor = document.createElement("div");
    visualEditor.dataset.visualEditor = "";
    const textarea = document.createElement("textarea");
    textarea.dataset.inlineInput = "";
    textarea.setAttribute("aria-label", "编辑 " + sourcePath);
    textarea.spellcheck = false;
    const status = document.createElement("div");
    status.className = "inline-editor-feedback";
    status.dataset.inlineFeedback = "";
    status.textContent = "正在加载源文件…";
    panel.append(toolbar, visualEditor, textarea, status);

    const rendered = query("[data-editable-rendered]", host);
    if (rendered) {
      rendered.before(panel);
      rendered.hidden = true;
    } else {
      host.append(panel);
    }
    return panel;
  }

  function closeInlineEditor() {
    if (!state.inlinePanel) {
      return;
    }
    const host = state.inlinePanel.closest("[data-editor-host]");
    const rendered = query("[data-editable-rendered]", host);
    if (rendered) {
      rendered.hidden = false;
    }
    if (state.inlineEditor) {
      state.inlineEditor.destroy();
      state.inlineEditor = null;
    }
    window.clearTimeout(state.renderTimer);
    state.inlinePanel.remove();
    state.inlinePanel = null;
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
      if (pageTitle) {
        pageTitle.textContent = heading.textContent;
      }
      heading.remove();
    }
    const prose = document.createElement("div");
    prose.className = "prose draft-rendered-content";
    prose.append(template.content);
    rendered.replaceChildren(prose);
    rendered.dataset.draftOverlay = "true";
  }

  function scheduleLiveRender(host, markdown) {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(async function () {
      try {
        const result = await api("/preview", {
          method: "POST",
          body: JSON.stringify({ content: markdown })
        });
        renderMarkdownIntoHost(host, result.html);
      } catch {
        // Saving still performs server-side validation and reports the error.
      }
    }, 250);
  }

  function initializeVisualEditor(panel, host, content) {
    const mount = query("[data-visual-editor]", panel);
    const textarea = query("[data-inline-input]", panel);
    if (!window.toastui || !window.toastui.Editor) {
      mount.hidden = true;
      textarea.hidden = false;
      textarea.value = content;
      return;
    }
    textarea.hidden = true;
    mount.hidden = false;
    state.inlineEditor = new window.toastui.Editor({
      el: mount,
      height: "600px",
      initialEditType: "wysiwyg",
      previewStyle: "tab",
      initialValue: content,
      usageStatistics: false,
      autofocus: true,
      toolbarItems: [
        ["heading", "bold", "italic"],
        ["hr", "quote"],
        ["ul", "ol", "task"],
        ["table", "link"],
        ["code", "codeblock"]
      ],
      events: {
        change: function () {
          scheduleLiveRender(host, state.inlineEditor.getMarkdown());
        }
      }
    });
  }

  function inlineContent(panel) {
    if (state.inlineEditor) {
      return state.inlineEditor.getMarkdown();
    }
    return query("[data-inline-input]", panel).value;
  }

  async function openInlineEditor(button) {
    if (!ensureEditorAccess()) {
      return;
    }
    applyEditMode(true);
    const host = button.closest("[data-editor-host]");
    const sourcePath =
      host && (host.dataset.editorSource || config.editorContext.sourcePath);
    if (!host || !sourcePath) {
      return;
    }
    closeInlineEditor();
    const panel = createInlinePanel(host, sourcePath);
    state.inlinePanel = panel;
    const textarea = query("[data-inline-input]", panel);
    try {
      const draft = state.drafts.find(function (item) {
        return item.path === sourcePath;
      });
      const source = draft
        ? draft
        : await api(
            "/repository/file?path=" + encodeURIComponent(sourcePath)
          );
      panel.dataset.baseSha = source.base_sha || source.sha || "";
      panel.dataset.draftId = draft ? String(draft.id) : "";
      if (sourcePath.toLowerCase().endsWith(".md")) {
        initializeVisualEditor(panel, host, source.content);
      } else {
        query("[data-visual-editor]", panel).hidden = true;
        textarea.hidden = false;
        textarea.value = source.content;
        textarea.focus();
      }
      setInlineFeedback(
        panel,
        draft ? "已加载个人草稿。" : "已加载 main 分支源文件。"
      );
    } catch (error) {
      setInlineFeedback(panel, error.message, "error");
    }
  }

  async function saveInlineEditor(panel) {
    const host = panel.closest("[data-editor-host]");
    const path = host.dataset.editorSource;
    const button = query("[data-inline-save]", panel);
    button.disabled = true;
    try {
      const saved = await api("/drafts", {
        method: "PUT",
        body: JSON.stringify({
          path: path,
          content: inlineContent(panel),
          base_sha: panel.dataset.baseSha || null,
          operation: "upsert"
        })
      });
      const index = state.drafts.findIndex(function (item) {
        return item.path === saved.path;
      });
      if (index >= 0) {
        state.drafts[index] = saved;
      } else {
        state.drafts.push(saved);
      }
      panel.dataset.draftId = String(saved.id);
      if (path.toLowerCase().endsWith(".md")) {
        scheduleLiveRender(host, saved.content);
      }
      setInlineFeedback(
        panel,
        "草稿已保存，可在编辑工作台统一查看并提交。",
        "success"
      );
      updateAccountView();
    } catch (error) {
      setInlineFeedback(panel, error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  function normalizeParent(root, value) {
    const parts = (value || "").split("/").filter(Boolean);
    if (parts[0] === root) {
      parts.shift();
    }
    return parts.join("/");
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
    const parent = normalizeParent(root, button.dataset.createParent);
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
      let saved;
      if (values.kind === "module") {
        saved = await api("/topics", {
          method: "POST",
          body: JSON.stringify({
            root: values.root,
            parent: values.parent,
            slug: values.slug,
            title: values.title,
            description: values.description
          })
        });
      } else {
        let filename = values.slug.trim();
        if (!filename.includes(".")) {
          filename += ".md";
        }
        const path = [values.root, values.parent, filename]
          .filter(Boolean)
          .join("/");
        const markdown = filename.toLowerCase().endsWith(".md");
        saved = await api("/drafts", {
          method: "PUT",
          body: JSON.stringify({
            path: path,
            content: markdown ? "# " + values.title.trim() + "\n\n" : "",
            base_sha: null,
            operation: "upsert"
          })
        });
      }
      const existing = state.drafts.findIndex(function (item) {
        return item.path === saved.path;
      });
      if (existing >= 0) {
        state.drafts[existing] = saved;
      } else {
        state.drafts.push(saved);
      }
      feedback(
        target,
        "已创建 " + saved.path + "，正在打开预览。",
        true
      );
      updateAccountView();
      addDraftNavigation();
      window.setTimeout(function () {
        window.location.href = draftLink(saved.path);
      }, 450);
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
      } catch (error) {
        feedback(target, error.message);
      }
    });
    query("[data-edit-mode-trigger]").addEventListener("click", function () {
      if (!ensureEditorAccess()) {
        return;
      }
      const next = !state.editMode;
      if (!next) {
        closeInlineEditor();
      }
      applyEditMode(next);
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
    queryAll("[data-edit-current]").forEach(function (button) {
      button.addEventListener("click", function () {
        openInlineEditor(button);
      });
    });
    queryAll("[data-create-context]").forEach(function (button) {
      button.addEventListener("click", function () {
        openCreateDialog(button);
      });
    });
    document.addEventListener("click", function (event) {
      const panel = event.target.closest("[data-inline-editor]");
      if (!panel) {
        return;
      }
      if (event.target.closest("[data-inline-close]")) {
        closeInlineEditor();
      } else if (event.target.closest("[data-inline-save]")) {
        saveInlineEditor(panel);
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
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindEvents();
    loadIdentity().catch(function (error) {
      feedback(query("[data-account-feedback]"), error.message);
      updateAccountView();
    });
  });
})();
