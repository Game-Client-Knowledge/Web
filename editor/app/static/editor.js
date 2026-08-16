const state = {
  config: null,
  session: null,
  csrf: "",
  drafts: [],
  repository: [],
  active: null,
  previewing: false
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
    githubLogin.href = "api/auth/github";
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
  document
    .querySelectorAll(
      "#newFileButton, #newTopicButton, #saveDraftButton, " +
        "#deleteDraftButton, #submitAllButton"
    )
    .forEach((element) => {
      element.disabled = !canEdit;
    });
  await Promise.all([loadDrafts(), loadSubmissions()]);
}

async function loadDrafts() {
  if (!state.session?.can_edit) {
    state.drafts = [];
    renderDrafts();
    return;
  }
  const payload = await api("/drafts");
  state.drafts = payload.items;
  renderDrafts();
}

function renderDrafts() {
  const list = byId("draftList");
  list.replaceChildren();
  byId("draftCount").textContent = `${state.drafts.length} 个草稿`;
  for (const draft of state.drafts) {
    const button = document.createElement("button");
    button.className = "file-item";
    if (state.active?.draftId === draft.id) {
      button.classList.add("is-active");
    }
    button.type = "button";
    const label = document.createElement("span");
    label.textContent = draft.path;
    const meta = document.createElement("small");
    meta.textContent = `v${draft.revision}`;
    button.append(label, meta);
    button.addEventListener("click", () => openDraft(draft));
    list.append(button);
  }
  if (!state.drafts.length) {
    const empty = document.createElement("p");
    empty.className = "form-hint";
    empty.textContent = "尚无草稿";
    list.append(empty);
  }
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
  byId("contentEditor").value = draft.content;
  byId("contentEditor").hidden = false;
  byId("previewPane").hidden = true;
  byId("previewButton").textContent = "预览";
  clearFeedback(byId("editorFeedback"));
  renderDrafts();
}

async function loadRepository() {
  if (state.repository.length) {
    renderRepository();
    return;
  }
  const list = byId("repositoryList");
  list.textContent = "正在读取仓库目录…";
  try {
    const payload = await api("/repository/tree");
    state.repository = payload.items;
    renderRepository();
  } catch (error) {
    list.textContent = error.message;
  }
}

function renderRepository() {
  const list = byId("repositoryList");
  list.replaceChildren();
  for (const item of state.repository) {
    const button = document.createElement("button");
    button.className = "file-item";
    button.type = "button";
    const label = document.createElement("span");
    label.textContent = item.path;
    button.append(label);
    button.addEventListener("click", async () => {
      try {
        const file = await api(`/repository/file?path=${encodeURIComponent(item.path)}`);
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
        byId("contentEditor").value = file.content;
        byId("contentEditor").hidden = false;
        byId("previewPane").hidden = true;
        state.previewing = false;
        clearFeedback(byId("editorFeedback"));
      } catch (error) {
        feedback(byId("editorFeedback"), error.message);
      }
    });
    list.append(button);
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
        content: byId("contentEditor").value,
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
    byId("activeEditor").hidden = true;
    byId("emptyEditor").hidden = false;
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
      body: JSON.stringify({ content: byId("contentEditor").value })
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
byId("newFileButton").addEventListener("click", () => byId("fileDialog").showModal());
byId("newTopicButton").addEventListener("click", () => byId("topicDialog").showModal());

document.querySelectorAll("[data-side-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.sideTab;
    document.querySelectorAll("[data-side-tab]").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    byId("draftList").hidden = tab !== "drafts";
    byId("repositoryList").hidden = tab !== "repository";
    if (tab === "repository") loadRepository();
  });
});

byId("fileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    byId("fileDialog").close();
    return;
  }
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
  byId("contentEditor").value = state.active.content;
  byId("contentEditor").hidden = false;
  byId("previewPane").hidden = true;
});

byId("topicForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    byId("topicDialog").close();
    return;
  }
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
    alert(error.message);
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
    byId("activeEditor").hidden = true;
    byId("emptyEditor").hidden = false;
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
