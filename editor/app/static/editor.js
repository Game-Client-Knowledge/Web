const state = {
  config: null,
  session: null,
  csrf: "",
  drafts: [],
  repository: [],
  active: null,
  previewing: false,
  resourceFilter: "",
  visualEditor: null
};

const byId = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (state.csrf && !["GET", "HEAD"].includes((options.method || "GET").toUpperCase())) {
    headers.set("X-CSRF-Token", state.csrf);
  }
  const response = await fetch(`api${path}`, {
    credentials: "same-origin",
    ...options,
    headers
  });
  let payload = null;
  if (response.status !== 204) {
    payload = await response.json().catch(() => ({}));
  }
  if (!response.ok) {
    const detail = payload?.detail;
    const message = Array.isArray(detail) ? detail.join("；") : detail;
    throw new Error(message || `请求失败（HTTP ${response.status}）`);
  }
  return payload;
}

function formPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function feedback(element, message, kind = "error") {
  element.textContent = message;
  element.className = `feedback is-visible ${kind}`;
}

function clearFeedback(element) {
  element.textContent = "";
  element.className = "feedback";
}

function slugify(value) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, "-")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "update"
  );
}

function setAuthTab(name) {
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.authTab === name);
  });
  byId("loginForm").hidden = name !== "login";
  byId("registerForm").hidden = name !== "register";
  clearFeedback(byId("authFeedback"));
}

function showView(name) {
  byId("authView").hidden = name !== "auth";
  byId("passwordView").hidden = name !== "password";
  byId("workspaceView").hidden = name !== "workspace";
  byId("logoutButton").hidden = name === "auth";
}

function applyConfig() {
  const registerTab = document.querySelector('[data-auth-tab="register"]');
  registerTab.disabled = !state.config.registration_enabled;
  const githubLogin = byId("githubLogin");
  if (state.config.github_oauth_enabled) {
    githubLogin.href =
      "api/auth/github?mode=login&return_to=" +
      encodeURIComponent("/editor/");
    githubLogin.removeAttribute("aria-disabled");
    githubLogin.textContent = "使用 GitHub 登录";
  } else {
    githubLogin.removeAttribute("href");
    githubLogin.setAttribute("aria-disabled", "true");
    githubLogin.textContent = "GitHub 登录未配置";
  }
  byId("authPolicyHint").textContent =
    state.config.edit_policy === "github_verified"
      ? "当前策略：必须完成 GitHub 认证后才能编辑。"
      : "当前策略：本地账号登录后即可编辑。";
}

async function loadSession() {
  state.config = await api("/config");
  applyConfig();
  const session = await api("/session");
  state.session = session;
  if (!session.authenticated) {
    showView("auth");
    return;
  }
  state.csrf = session.csrf_token;
  if (session.user.must_change_password) {
    showView("password");
    return;
  }
  showView("workspace");
  await initializeWorkspace();
}

async function initializeWorkspace() {
  const { user, can_edit: canEdit, edit_policy: policy } = state.session;
  byId("accountSummary").textContent =
    `${user.username} · ${user.email}` +
    (user.email_verified ? " · 邮箱已验证" : " · 邮箱未验证") +
    (user.github_login ? ` · GitHub @${user.github_login}` : "");
  byId("policyBadge").textContent =
    policy === "github_verified" ? "GitHub 认证模式" : "本地账号模式";
  byId("adminLink").hidden = user.role !== "admin";
  byId("adminApplicationSection").hidden = user.role === "admin";
  byId("editBlocked").hidden = canEdit;
  byId("branchPreview").textContent = `web/${slugify(user.username)}/update`;
  const bindButton = byId("githubBindingButton");
  const unlinkButton = byId("githubUnlinkButton");
  bindButton.hidden = Boolean(user.github_login);
  unlinkButton.hidden = !user.github_login;
  if (state.config.github_oauth_enabled) {
    bindButton.href =
      "api/auth/github?mode=bind&return_to=" +
      encodeURIComponent("/editor/");
    bindButton.removeAttribute("aria-disabled");
  } else {
    bindButton.removeAttribute("href");
    bindButton.setAttribute("aria-disabled", "true");
    bindButton.title = "需要先配置 GitHub OAuth";
  }
  document
    .querySelectorAll(
      "#newFileButton, #newTopicButton, #saveDraftButton, " +
        "#deleteDraftButton, #submitAllButton"
    )
    .forEach((element) => {
      element.disabled = !canEdit;
    });
  await Promise.all([loadDrafts(), loadRepository(), loadSubmissions()]);
  const requestedFile = new URLSearchParams(location.search).get("file");
  if (requestedFile) {
    await openResource(requestedFile);
  }
}

async function loadDrafts() {
  if (!state.session?.can_edit) {
    state.drafts = [];
    renderResources();
    return;
  }
  const payload = await api("/drafts");
  state.drafts = payload.items;
  renderResources();
}

function resourceEntries() {
  const entries = new Map();
  for (const item of state.repository) {
    entries.set(item.path, {
      path: item.path,
      sha: item.sha,
      size: item.size,
      draft: null
    });
  }
  for (const draft of state.drafts) {
    const existing = entries.get(draft.path) || {
      path: draft.path,
      sha: null,
      size: draft.content.length,
      draft: null
    };
    existing.draft = draft;
    entries.set(draft.path, existing);
  }
  return Array.from(entries.values()).sort((left, right) =>
    left.path.localeCompare(right.path, "zh-CN", { numeric: true })
  );
}

function buildResourceTree(entries) {
  const root = { folders: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    const filename = parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.folders.has(part)) {
        node.folders.set(part, { folders: new Map(), files: [] });
      }
      node = node.folders.get(part);
    }
    node.files.push({ ...entry, filename });
  }
  return root;
}

function icon(name) {
  const element = document.createElement("i");
  element.dataset.lucide = name;
  element.setAttribute("aria-hidden", "true");
  return element;
}

function refreshIcons(root) {
  if (window.lucide) {
    window.lucide.createIcons({
      attrs: { "stroke-width": 1.8 },
      root: root || document
    });
  }
}

function renderTreeNode(node, target, depth) {
  for (const [name, child] of Array.from(node.folders.entries()).sort()) {
    const details = document.createElement("details");
    details.className = "resource-folder";
    details.open = depth < 2 || Boolean(state.resourceFilter);
    const summary = document.createElement("summary");
    summary.append(icon("folder"), document.createTextNode(name));
    const count = document.createElement("small");
    count.textContent = String(child.files.length + child.folders.size);
    summary.append(count);
    details.append(summary);
    const children = document.createElement("div");
    children.className = "resource-folder-children";
    renderTreeNode(child, children, depth + 1);
    details.append(children);
    target.append(details);
  }
  for (const file of node.files) {
    const button = document.createElement("button");
    button.className = "resource-file";
    button.type = "button";
    button.title = file.path;
    button.dataset.path = file.path;
    if (state.active?.path === file.path) {
      button.classList.add("is-active");
    }
    button.append(
      icon(file.filename.endsWith(".md") ? "file-text" : "file-code-2")
    );
    const label = document.createElement("span");
    label.textContent = file.filename;
    button.append(label);
    if (file.draft) {
      const badge = document.createElement("small");
      badge.className = "resource-change-badge";
      badge.textContent =
        file.draft.operation === "delete"
          ? "D"
          : file.sha
            ? "M"
            : "A";
      button.append(badge);
    }
    button.addEventListener("click", () => openResource(file.path));
    target.append(button);
  }
}

function renderChanges() {
  const list = byId("changeList");
  list.replaceChildren();
  byId("changeCount").textContent = String(state.drafts.length);
  byId("draftCount").textContent = `${state.drafts.length} 个草稿`;
  for (const draft of state.drafts) {
    const button = document.createElement("button");
    button.className = "change-item";
    button.type = "button";
    const change = document.createElement("small");
    change.textContent =
      draft.operation === "delete" ? "D" : draft.base_sha ? "M" : "A";
    change.dataset.status = change.textContent;
    const label = document.createElement("span");
    label.textContent = draft.path.split("/").pop();
    const meta = document.createElement("small");
    meta.textContent = draft.path;
    button.append(change, label, meta);
    button.addEventListener("click", () => openDraft(draft));
    list.append(button);
  }
  if (!state.drafts.length) {
    const empty = document.createElement("p");
    empty.className = "form-hint";
    empty.textContent = "尚无未提交更改";
    list.append(empty);
  }
}

function renderResources() {
  const target = byId("resourceTree");
  target.replaceChildren();
  const filter = state.resourceFilter.trim().toLowerCase();
  const entries = resourceEntries().filter(
    (item) => !filter || item.path.toLowerCase().includes(filter)
  );
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "form-hint";
    empty.textContent = filter ? "没有匹配的目录或文件" : "仓库中暂无可编辑文件";
    target.append(empty);
  } else {
    renderTreeNode(buildResourceTree(entries), target, 0);
  }
  renderChanges();
  refreshIcons(target);
}

function destroyVisualEditor() {
  if (state.visualEditor) {
    state.visualEditor.destroy();
    state.visualEditor = null;
  }
  byId("visualEditor").replaceChildren();
}

function showContentEditor(path, content) {
  destroyVisualEditor();
  state.previewing = false;
  byId("previewPane").hidden = true;
  const markdown = path.toLowerCase().endsWith(".md");
  if (markdown && window.toastui?.Editor) {
    byId("contentEditor").hidden = true;
    byId("visualEditor").hidden = false;
    byId("previewButton").hidden = true;
    state.visualEditor = new window.toastui.Editor({
      el: byId("visualEditor"),
      height: "560px",
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
      ]
    });
    return;
  }
  byId("visualEditor").hidden = true;
  byId("contentEditor").hidden = false;
  byId("contentEditor").value = content;
  byId("previewButton").hidden = !markdown;
  byId("previewButton").textContent = "预览";
}

function editorContent() {
  return state.visualEditor
    ? state.visualEditor.getMarkdown()
    : byId("contentEditor").value;
}

function openDraft(draft) {
  state.active = {
    draftId: draft.id,
    path: draft.path,
    baseSha: draft.base_sha,
    content: draft.content
  };
  state.previewing = false;
  byId("emptyEditor").hidden = true;
  byId("activeEditor").hidden = false;
  byId("filePath").value = draft.path;
  byId("filePath").readOnly = true;
  showContentEditor(draft.path, draft.content);
  clearFeedback(byId("editorFeedback"));
  renderResources();
}

function showEditorLoading(path) {
  byId("emptyEditor").hidden = false;
  byId("activeEditor").hidden = true;
  byId("emptyEditor").replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "正在加载文件";
  const copy = document.createElement("span");
  copy.textContent = path;
  byId("emptyEditor").append(title, copy);
}

function resetEmptyEditor() {
  byId("emptyEditor").replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "选择文件开始编辑";
  const copy = document.createElement("span");
  copy.textContent = "也可以新建文件或创建专题目录。";
  byId("emptyEditor").append(title, copy);
}

async function loadRepository(force = false) {
  if (state.repository.length && !force) {
    renderResources();
    return;
  }
  byId("resourceTree").textContent = "正在读取仓库目录…";
  try {
    const payload = await api("/repository/tree");
    state.repository = payload.items;
    renderResources();
  } catch (error) {
    byId("resourceTree").textContent = error.message;
  }
}

async function openResource(path) {
  const draft = state.drafts.find((item) => item.path === path);
  if (draft) {
    openDraft(draft);
    return;
  }
  showEditorLoading(path);
  try {
    const file = await api(
      `/repository/file?path=${encodeURIComponent(path)}`
    );
    state.active = {
      draftId: null,
      path: file.path,
      baseSha: file.sha,
      content: file.content
    };
    byId("emptyEditor").hidden = true;
    byId("activeEditor").hidden = false;
    byId("filePath").value = file.path;
    byId("filePath").readOnly = true;
    showContentEditor(file.path, file.content);
    clearFeedback(byId("editorFeedback"));
    renderResources();
  } catch (error) {
    byId("emptyEditor").replaceChildren();
    const title = document.createElement("strong");
    title.textContent = "文件加载失败";
    const copy = document.createElement("span");
    copy.textContent = error.message;
    byId("emptyEditor").append(title, copy);
    byId("emptyEditor").hidden = false;
  }
}

async function saveActiveDraft() {
  if (!state.active) return;
  clearFeedback(byId("editorFeedback"));
  try {
    const saved = await api("/drafts", {
      method: "PUT",
      body: JSON.stringify({
        path: byId("filePath").value,
        content: editorContent(),
        base_sha: state.active.baseSha,
        operation: "upsert"
      })
    });
    state.active.draftId = saved.id;
    state.active.path = saved.path;
    state.active.content = saved.content;
    feedback(byId("editorFeedback"), "草稿已保存到个人工作区", "success");
    await loadDrafts();
  } catch (error) {
    feedback(byId("editorFeedback"), error.message);
  }
}

async function deleteActiveDraft() {
  if (!state.active) return;
  if (
    state.active.draftId &&
    !window.confirm(`删除草稿 ${state.active.path}？`)
  ) {
    return;
  }
  try {
    if (state.active.draftId) {
      await api(`/drafts/${state.active.draftId}`, { method: "DELETE" });
    }
    state.active = null;
    destroyVisualEditor();
    byId("activeEditor").hidden = true;
    byId("emptyEditor").hidden = false;
    resetEmptyEditor();
    await loadDrafts();
  } catch (error) {
    feedback(byId("editorFeedback"), error.message);
  }
}

async function togglePreview() {
  if (!state.active) return;
  if (state.previewing) {
    state.previewing = false;
    byId("contentEditor").hidden = false;
    byId("previewPane").hidden = true;
    byId("previewButton").textContent = "预览";
    return;
  }
  try {
    const result = await api("/preview", {
      method: "POST",
      body: JSON.stringify({ content: editorContent() })
    });
    byId("previewPane").innerHTML = result.html;
    state.previewing = true;
    byId("contentEditor").hidden = true;
    byId("previewPane").hidden = false;
    byId("previewButton").textContent = "返回编辑";
  } catch (error) {
    feedback(byId("editorFeedback"), error.message);
  }
}

async function loadSubmissions() {
  if (!state.session?.authenticated) return;
  const payload = await api("/submissions");
  const list = byId("submissionList");
  list.replaceChildren();
  for (const item of payload.items.slice(0, 8)) {
    const wrapper = document.createElement("div");
    wrapper.className = "submission-item";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const meta = document.createElement("span");
    meta.textContent = `${item.status} · ${item.branch_name}`;
    wrapper.append(title, meta);
    if (item.pr_url) {
      const link = document.createElement("a");
      link.href = item.pr_url;
      link.rel = "noreferrer";
      link.textContent = `PR #${item.pr_number}`;
      wrapper.append(link);
    }
    list.append(wrapper);
  }
  if (!payload.items.length) {
    list.textContent = "暂无提交";
  }
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    location.href = "./";
  }
}

document.querySelectorAll("[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => setAuthTab(button.dataset.authTab));
});

byId("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFeedback(byId("authFeedback"));
  try {
    const payload = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify(formPayload(event.currentTarget))
    });
    state.session = { authenticated: true, ...payload };
    state.csrf = payload.csrf_token;
    if (payload.user.must_change_password) {
      showView("password");
    } else {
      showView("workspace");
      await initializeWorkspace();
    }
  } catch (error) {
    feedback(byId("authFeedback"), error.message);
  }
});

byId("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFeedback(byId("authFeedback"));
  try {
    const payload = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify(formPayload(event.currentTarget))
    });
    state.session = { authenticated: true, ...payload };
    state.csrf = payload.csrf_token;
    showView("workspace");
    await initializeWorkspace();
  } catch (error) {
    feedback(byId("authFeedback"), error.message);
  }
});

byId("passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/auth/change-password", {
      method: "POST",
      body: JSON.stringify(formPayload(event.currentTarget))
    });
    location.reload();
  } catch (error) {
    feedback(byId("passwordFeedback"), error.message);
  }
});

byId("logoutButton").addEventListener("click", logout);
byId("saveDraftButton").addEventListener("click", saveActiveDraft);
byId("deleteDraftButton").addEventListener("click", deleteActiveDraft);
byId("previewButton").addEventListener("click", togglePreview);
byId("newFileButton").addEventListener("click", () => {
  clearFeedback(byId("fileDialogFeedback"));
  byId("fileDialog").showModal();
});
byId("newTopicButton").addEventListener("click", () => {
  clearFeedback(byId("topicDialogFeedback"));
  byId("topicDialog").showModal();
});
byId("resourceSearch").addEventListener("input", (event) => {
  state.resourceFilter = event.currentTarget.value;
  renderResources();
});
byId("refreshRepositoryButton").addEventListener("click", async () => {
  state.repository = [];
  await Promise.all([loadRepository(true), loadDrafts()]);
});
byId("githubUnlinkButton").addEventListener("click", async () => {
  try {
    await api("/auth/github/unlink", { method: "POST" });
    location.reload();
  } catch (error) {
    feedback(byId("editorFeedback"), error.message);
  }
});
document.querySelectorAll("[data-workspace-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.workspaceView;
    document.querySelectorAll("[data-workspace-view]").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    document.querySelectorAll("[data-workspace-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.workspacePane !== view;
    });
  });
});

byId("fileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    byId("fileDialog").close();
    return;
  }
  clearFeedback(byId("fileDialogFeedback"));
  const payload = formPayload(event.currentTarget);
  state.active = {
    draftId: null,
    path: payload.path,
    baseSha: null,
    content: `# ${payload.title}\n\n`
  };
  byId("fileDialog").close();
  byId("emptyEditor").hidden = true;
  byId("activeEditor").hidden = false;
  byId("filePath").value = state.active.path;
  byId("filePath").readOnly = false;
  showContentEditor(state.active.path, state.active.content);
});

byId("topicForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    byId("topicDialog").close();
    return;
  }
  clearFeedback(byId("topicDialogFeedback"));
  try {
    const result = await api("/topics", {
      method: "POST",
      body: JSON.stringify(formPayload(event.currentTarget))
    });
    byId("topicDialog").close();
    event.currentTarget.reset();
    await loadDrafts();
    openDraft(result);
  } catch (error) {
    feedback(byId("topicDialogFeedback"), error.message);
  }
});

byId("submitForm").custom_head.addEventListener("input", (event) => {
  const username = state.session?.user?.username || "user";
  byId("branchPreview").textContent =
    `web/${slugify(username)}/${slugify(event.currentTarget.value)}`;
});

byId("submitForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFeedback(byId("submitFeedback"));
  const button = byId("submitAllButton");
  button.disabled = true;
  button.textContent = "正在创建分支和 PR";
  try {
    const result = await api("/submit", {
      method: "POST",
      body: JSON.stringify(formPayload(event.currentTarget))
    });
    const link = document.createElement("a");
    link.href = result.pr_url;
    link.rel = "noreferrer";
    link.textContent = `Draft PR #${result.pr_number}`;
    const box = byId("submitFeedback");
    box.replaceChildren(document.createTextNode("提交成功："), link);
    box.className = "feedback is-visible success";
    state.active = null;
    destroyVisualEditor();
    byId("activeEditor").hidden = true;
    byId("emptyEditor").hidden = false;
    resetEmptyEditor();
    await Promise.all([loadDrafts(), loadSubmissions()]);
  } catch (error) {
    feedback(byId("submitFeedback"), error.message);
  } finally {
    button.disabled = !state.session.can_edit;
    button.textContent = "提交全部更改";
  }
});

byId("adminApplicationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/admin-applications", {
      method: "POST",
      body: JSON.stringify(formPayload(event.currentTarget))
    });
    feedback(byId("adminApplicationFeedback"), "申请已提交，等待管理员处理", "success");
    event.currentTarget.reset();
  } catch (error) {
    feedback(byId("adminApplicationFeedback"), error.message);
  }
});

loadSession().catch((error) => {
  showView("auth");
  feedback(byId("authFeedback"), error.message);
});

refreshIcons();
