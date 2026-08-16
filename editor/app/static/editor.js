const state = {
  config: null,
  session: null,
  csrf: "",
  drafts: [],
  repository: [],
  active: null,
  previewing: false,
  workspaceView: "resources",
  resourceFilter: "",
  visualEditor: null,
  remoteContent: new Map()
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

function draftStatus(draft) {
  return draft.operation === "delete" ? "D" : draft.base_sha ? "M" : "A";
}

function takeGithubAuthError() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("github_auth_error");
  if (!code) return "";
  url.searchParams.delete("github_auth_error");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  return code === "access_denied"
    ? "GitHub 授权已取消，账号尚未绑定。"
    : "GitHub 认证失败，请重新尝试。";
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
  const githubAuthError = takeGithubAuthError();
  const bootstrap = await api("/bootstrap");
  state.config = bootstrap.config;
  applyConfig();
  const session = bootstrap.session;
  state.session = session;
  if (!session.authenticated) {
    showView("auth");
    if (githubAuthError) feedback(byId("authFeedback"), githubAuthError);
    return;
  }
  state.csrf = session.csrf_token;
  state.drafts = bootstrap.drafts || [];
  if (session.user.must_change_password) {
    showView("password");
    return;
  }
  showView("workspace");
  await initializeWorkspace(true);
  if (githubAuthError) feedback(byId("editorFeedback"), githubAuthError);
}

async function initializeWorkspace(draftsReady = false) {
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
        "#discardDraftButton, #markDeleteButton, #submitAllButton"
    )
    .forEach((element) => {
      element.disabled = !canEdit;
    });
  if (draftsReady) {
    renderResources();
  }
  await Promise.all([
    draftsReady ? Promise.resolve() : loadDrafts(),
    loadRepository(),
    loadSubmissions()
  ]);
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
      const status = draftStatus(file.draft);
      badge.dataset.status = status;
      badge.textContent = status;
      button.dataset.status = status;
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
    const row = document.createElement("div");
    row.className = "change-row";
    const button = document.createElement("button");
    button.className = "change-item";
    button.type = "button";
    const change = document.createElement("small");
    change.textContent = draftStatus(draft);
    change.dataset.status = change.textContent;
    const label = document.createElement("span");
    label.textContent = draft.path.split("/").pop();
    const meta = document.createElement("small");
    meta.textContent = draft.path;
    button.append(change, label, meta);
    button.addEventListener("click", () => openDraft(draft));
    const discard = document.createElement("button");
    discard.className = "change-discard";
    discard.type = "button";
    discard.title = "撤销此更改";
    discard.setAttribute("aria-label", `撤销 ${draft.path} 的更改`);
    discard.append(icon("undo-2"));
    discard.addEventListener("click", () => discardDraft(draft));
    row.append(button, discard);
    list.append(row);
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

function diffLines(value) {
  if (!value) return [];
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function appendDiffPart(target, value, type, counters) {
  for (const text of diffLines(value)) {
    const row = document.createElement("div");
    row.className = `diff-line is-${type}`;
    const oldNumber = document.createElement("span");
    const newNumber = document.createElement("span");
    const marker = document.createElement("span");
    const source = document.createElement("code");
    if (type === "removed") {
      oldNumber.textContent = String(counters.oldLine++);
      marker.textContent = "-";
    } else if (type === "added") {
      newNumber.textContent = String(counters.newLine++);
      marker.textContent = "+";
    } else if (type === "modified") {
      newNumber.textContent = String(counters.newLine++);
      marker.textContent = "~";
    } else {
      oldNumber.textContent = String(counters.oldLine++);
      newNumber.textContent = String(counters.newLine++);
      marker.textContent = " ";
    }
    source.textContent = text || " ";
    row.append(oldNumber, newNumber, marker, source);
    target.append(row);
  }
}

function renderSourceDiff(baseContent, draft) {
  const target = byId("diffSource");
  target.replaceChildren();
  const nextContent = draft.operation === "delete" ? "" : draft.content;
  const parts = window.JsDiff?.diffLines
    ? window.JsDiff.diffLines(baseContent, nextContent)
    : [{ value: nextContent || baseContent, added: !baseContent, removed: !nextContent }];
  const counters = { oldLine: 1, newLine: 1 };
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const next = parts[index + 1];
    if (part.removed && next?.added) {
      appendDiffPart(target, part.value, "removed", counters);
      appendDiffPart(target, next.value, "modified", counters);
      index += 1;
    } else if (part.added) {
      appendDiffPart(target, part.value, "added", counters);
    } else if (part.removed) {
      appendDiffPart(target, part.value, "removed", counters);
    } else {
      appendDiffPart(target, part.value, "context", counters);
    }
  }
  if (!target.children.length) {
    const empty = document.createElement("p");
    empty.className = "diff-empty";
    empty.textContent = "源文件内容没有行级变化";
    target.append(empty);
  }
}

async function baseContentForDraft(draft) {
  if (!draft.base_sha) return "";
  if (state.remoteContent.has(draft.path)) {
    return state.remoteContent.get(draft.path);
  }
  const file =
    (await loadStaticRepositoryFile(draft.path, draft.base_sha)) ||
    (await api(`/repository/file?path=${encodeURIComponent(draft.path)}`));
  state.remoteContent.set(draft.path, file.content);
  return file.content;
}

async function showChangeDiff(draft) {
  destroyVisualEditor();
  state.previewing = false;
  byId("emptyEditor").hidden = true;
  byId("activeEditor").hidden = false;
  byId("filePath").value = draft.path;
  byId("filePath").readOnly = true;
  byId("deletionNotice").hidden = true;
  byId("visualEditor").closest(".editor-surface").hidden = true;
  byId("diffViewer").hidden = false;
  byId("diffModeLabel").hidden = false;
  byId("editChangeButton").hidden = false;
  byId("previewButton").hidden = true;
  byId("discardDraftButton").hidden = false;
  byId("markDeleteButton").hidden = true;
  byId("saveDraftButton").hidden = true;
  byId("diffSource").replaceChildren();
  clearFeedback(byId("editorFeedback"));
  try {
    renderSourceDiff(await baseContentForDraft(draft), draft);
  } catch (error) {
    feedback(byId("editorFeedback"), error.message);
  }
}

function destroyVisualEditor() {
  if (state.visualEditor) {
    state.visualEditor.destroy();
    state.visualEditor = null;
  }
  byId("visualEditor").replaceChildren();
}

function showContentEditor(path, content) {
  const initializationStartedAt = performance.now();
  destroyVisualEditor();
  state.previewing = false;
  byId("diffViewer").hidden = true;
  byId("diffModeLabel").hidden = true;
  byId("editChangeButton").hidden = true;
  byId("deletionNotice").hidden = true;
  byId("visualEditor").closest(".editor-surface").hidden = false;
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
    if (state.active) {
      state.active.originalContent = content;
      state.active.canonicalContent = state.visualEditor.getMarkdown();
    }
    // #region debug-point H:workspace-editor-layout
    fetch("http://127.0.0.1:7778/event",{method:"POST",body:JSON.stringify({sessionId:"draft-markdown-churn",runId:"post-fix-latency",hypothesisId:"H",location:"editor.js:showContentEditor",msg:"[DEBUG] Workspace editor initialized",data:{sourceLength:content.length,initializationMs:Math.round((performance.now()-initializationStartedAt)*10)/10,totalOpenMs:Math.round((performance.now()-(state.active?.openStartedAt||initializationStartedAt))*10)/10},ts:Date.now()})}).catch(()=>{});
    // #endregion
    // #region debug-point C:workspace-initial-serialization
    fetch("http://127.0.0.1:7778/event",{method:"POST",body:JSON.stringify({sessionId:"draft-markdown-churn",runId:"post-fix",hypothesisId:"C",location:"editor.js:showContentEditor",msg:"[DEBUG] Workspace initial Markdown serialization",data:(()=>{const output=state.visualEditor.getMarkdown();return{inputLength:content.length,outputLength:output.length,same:output===content,escapedHeadings:(output.match(/^## \\d+\\\\\\./gm)||[]).length,dashBullets:(output.match(/^- /gm)||[]).length,starBullets:(output.match(/^\\* /gm)||[]).length,compactTable:output.includes("|---|"),spacedTable:output.includes("| --- |")}})(),ts:Date.now()})}).catch(()=>{});
    // #endregion
    return;
  }
  if (state.active) {
    state.active.originalContent = content;
    state.active.canonicalContent = content;
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

async function openDraft(draft, forceEditor = false) {
  state.active = {
    draftId: draft.id,
    path: draft.path,
    baseSha: draft.base_sha,
    content: draft.content,
    operation: draft.operation
  };
  if (state.workspaceView === "changes" && !forceEditor) {
    await showChangeDiff(draft);
    renderResources();
    return;
  }
  state.previewing = false;
  byId("emptyEditor").hidden = true;
  byId("activeEditor").hidden = false;
  byId("filePath").value = draft.path;
  byId("filePath").readOnly = true;
  byId("discardDraftButton").hidden = !draft.base_sha;
  byId("markDeleteButton").hidden = draft.operation === "delete";
  byId("markDeleteButton").textContent = draft.base_sha
    ? "删除文件"
    : "删除新增文件";
  byId("saveDraftButton").hidden = draft.operation === "delete";
  byId("diffViewer").hidden = true;
  byId("diffModeLabel").hidden = true;
  byId("editChangeButton").hidden = true;
  if (draft.operation === "delete") {
    destroyVisualEditor();
    byId("visualEditor").closest(".editor-surface").hidden = true;
    byId("deletionNotice").hidden = false;
    byId("previewButton").hidden = true;
    clearFeedback(byId("editorFeedback"));
    renderResources();
    return;
  }
  showContentEditor(draft.path, draft.content);
  clearFeedback(byId("editorFeedback"));
  renderResources();
}

function showEditorLoading(path) {
  byId("diffViewer").hidden = true;
  byId("diffModeLabel").hidden = true;
  byId("editChangeButton").hidden = true;
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
  if (force) state.remoteContent.clear();
  try {
    const payload = await api("/repository/tree");
    state.repository = payload.items;
    renderResources();
  } catch (error) {
    byId("resourceTree").textContent = error.message;
  }
}

async function loadStaticRepositoryFile(path, expectedSha) {
  if (!window.GCKSource || !expectedSha) {
    return null;
  }
  try {
    return await window.GCKSource.load(path, {
      version: expectedSha,
      expectedSha,
      rawBase: "/raw/"
    });
  } catch {
    return null;
  }
}

async function openResource(path) {
  const draft = state.drafts.find((item) => item.path === path);
  if (draft) {
    await openDraft(draft);
    return;
  }
  showEditorLoading(path);
  const openStartedAt = performance.now();
  try {
    const sourceStartedAt = performance.now();
    const repositoryEntry = state.repository.find((item) => item.path === path);
    let file = await loadStaticRepositoryFile(path, repositoryEntry?.sha);
    if (!file) {
      file = await api(`/repository/file?path=${encodeURIComponent(path)}`);
      file.sourceType = "repository-api";
    }
    // #region debug-point G:workspace-source-load
    fetch("http://127.0.0.1:7778/event",{method:"POST",body:JSON.stringify({sessionId:"draft-markdown-churn",runId:"post-fix-latency",hypothesisId:"G",location:"editor.js:openResource",msg:"[DEBUG] Workspace source loaded","data":{sourceType:file.sourceType,sourceMs:Math.round((performance.now()-sourceStartedAt)*10)/10,sourceLength:file.content.length,shaMatchesTree:Boolean(repositoryEntry&&file.sha===repositoryEntry.sha)},ts:Date.now()})}).catch(()=>{});
    // #endregion
    state.active = {
      draftId: null,
      path: file.path,
      baseSha: file.sha,
      content: file.content,
      operation: "upsert",
      openStartedAt
    };
    state.remoteContent.set(file.path, file.content);
    byId("emptyEditor").hidden = true;
    byId("activeEditor").hidden = false;
    byId("filePath").value = file.path;
    byId("filePath").readOnly = true;
    byId("discardDraftButton").hidden = true;
    byId("markDeleteButton").hidden = false;
    byId("markDeleteButton").textContent = "删除文件";
    byId("saveDraftButton").hidden = false;
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
    const canonicalContent = editorContent();
    const serializedContent =
      state.visualEditor &&
      window.GCKMarkdown &&
      state.active.originalContent !== undefined
        ? window.GCKMarkdown.preserveSourceFormatting(
            state.active.originalContent,
            state.active.canonicalContent,
            canonicalContent
          )
        : canonicalContent;
    // #region debug-point D:workspace-save-payload
    fetch("http://127.0.0.1:7778/event",{method:"POST",body:JSON.stringify({sessionId:"draft-markdown-churn",runId:"post-fix",hypothesisId:"D",location:"editor.js:saveActiveDraft",msg:"[DEBUG] Workspace draft save payload",data:{originalLength:state.active.originalContent.length,canonicalLength:canonicalContent.length,outputLength:serializedContent.length,canonicalSame:canonicalContent===state.active.canonicalContent,sourceSame:serializedContent===state.active.originalContent,escapedHeadings:(serializedContent.match(/^## \\d+\\\\\\./gm)||[]).length,dashBullets:(serializedContent.match(/^- /gm)||[]).length,starBullets:(serializedContent.match(/^\\* /gm)||[]).length,compactTable:serializedContent.includes("|---|"),spacedTable:serializedContent.includes("| --- |")},ts:Date.now()})}).catch(()=>{});
    // #endregion
    const unsavedNewFile =
      !state.active.draftId && !state.active.baseSha;
    if (
      serializedContent === state.active.originalContent &&
      !unsavedNewFile
    ) {
      // #region debug-point F:workspace-noop-skipped
      fetch("http://127.0.0.1:7778/event",{method:"POST",body:JSON.stringify({sessionId:"draft-markdown-churn",runId:"post-fix-latency",hypothesisId:"F",location:"editor.js:saveActiveDraft",msg:"[DEBUG] Workspace unchanged save skipped","data":{sourceSame:true,apiCalled:false,hadDraft:Boolean(state.active.draftId)},ts:Date.now()})}).catch(()=>{});
      // #endregion
      feedback(
        byId("editorFeedback"),
        "没有检测到需要保存的更改。",
        "success"
      );
      return;
    }
    const saved = await api("/drafts", {
      method: "PUT",
      body: JSON.stringify({
        path: byId("filePath").value,
        content: serializedContent,
        base_sha: state.active.baseSha,
        operation: "upsert"
      })
    });
    // #region debug-point F:workspace-noop-created
    fetch("http://127.0.0.1:7778/event",{method:"POST",body:JSON.stringify({sessionId:"draft-markdown-churn",runId:"post-fix-latency",hypothesisId:"F",location:"editor.js:saveActiveDraft",msg:"[DEBUG] Workspace changed or new save completed","data":{sourceSame:serializedContent===state.active.originalContent,apiCalled:true,savedDraftId:saved.id,hadDraft:Boolean(state.active.draftId),unsavedNewFile},ts:Date.now()})}).catch(()=>{});
    // #endregion
    state.active.draftId = saved.id;
    state.active.path = saved.path;
    state.active.content = saved.content;
    state.active.operation = saved.operation;
    state.active.originalContent = saved.content;
    state.active.canonicalContent = canonicalContent;
    feedback(byId("editorFeedback"), "草稿已保存到个人工作区", "success");
    await loadDrafts();
  } catch (error) {
    feedback(byId("editorFeedback"), error.message);
  }
}

async function discardDraft(draft, confirmChange = true) {
  if (
    confirmChange &&
    !window.confirm(`撤销 ${draft.path} 的未提交更改？`)
  ) {
    return;
  }
  try {
    await api(`/drafts/${draft.id}`, { method: "DELETE" });
    await loadDrafts();
    if (state.active?.path === draft.path) {
      const restoreRemote = Boolean(draft.base_sha);
      state.active = null;
      destroyVisualEditor();
      byId("activeEditor").hidden = true;
      byId("emptyEditor").hidden = false;
      resetEmptyEditor();
      if (restoreRemote && state.workspaceView === "resources") {
        await openResource(draft.path);
      }
    }
  } catch (error) {
    feedback(byId("editorFeedback"), error.message);
  }
}

async function discardActiveDraft() {
  if (!state.active?.draftId) return;
  const draft = state.drafts.find((item) => item.id === state.active.draftId);
  if (draft) {
    await discardDraft(draft);
  }
}

async function markActiveFileDeleted() {
  if (!state.active) return;
  const currentDraft = state.drafts.find(
    (item) => item.path === state.active.path
  );
  if (!state.active.baseSha) {
    if (currentDraft) {
      await discardDraft(currentDraft, false);
    } else {
      state.active = null;
      destroyVisualEditor();
      byId("activeEditor").hidden = true;
      byId("emptyEditor").hidden = false;
      resetEmptyEditor();
    }
    return;
  }
  if (
    !window.confirm(
      `将 ${state.active.path} 标记为删除？提交后它会从仓库中移除。`
    )
  ) {
    return;
  }
  try {
    const deleted = await api("/drafts", {
      method: "PUT",
      body: JSON.stringify({
        path: state.active.path,
        content: "",
        base_sha: state.active.baseSha,
        operation: "delete"
      })
    });
    await loadDrafts();
    await openDraft(deleted);
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

async function setWorkspaceView(view) {
  state.workspaceView = view;
  document.querySelectorAll("[data-workspace-view]").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.workspaceView === view);
  });
  document.querySelectorAll("[data-workspace-pane]").forEach((pane) => {
    pane.hidden = pane.dataset.workspacePane !== view;
  });
  if (!state.active) return;
  const draft = state.drafts.find((item) => item.path === state.active.path);
  if (view === "changes") {
    if (draft) {
      await showChangeDiff(draft);
    } else {
      byId("activeEditor").hidden = true;
      byId("emptyEditor").hidden = false;
      byId("emptyEditor").replaceChildren();
      const title = document.createElement("strong");
      title.textContent = "选择更改查看源文件差异";
      byId("emptyEditor").append(title);
    }
    return;
  }
  if (draft) {
    await openDraft(draft, true);
    return;
  }
  byId("emptyEditor").hidden = true;
  byId("activeEditor").hidden = false;
  byId("filePath").value = state.active.path;
  byId("discardDraftButton").hidden = true;
  byId("markDeleteButton").hidden = false;
  byId("saveDraftButton").hidden = false;
  showContentEditor(state.active.path, state.active.content);
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
byId("discardDraftButton").addEventListener("click", discardActiveDraft);
byId("markDeleteButton").addEventListener("click", markActiveFileDeleted);
byId("previewButton").addEventListener("click", togglePreview);
byId("editChangeButton").addEventListener("click", async () => {
  await setWorkspaceView("resources");
});
byId("newFileButton").addEventListener("click", () => {
  clearFeedback(byId("fileDialogFeedback"));
  byId("fileDialog").showModal();
});
byId("newTopicButton").addEventListener("click", () => {
  clearFeedback(byId("topicDialogFeedback"));
  byId("topicDialog").showModal();
});
// #region debug-point A:file-dialog-click
byId("fileForm").addEventListener("click",(event)=>{const button=event.target.closest("button");if(button)fetch("http://127.0.0.1:7778/event",{method:"POST",body:JSON.stringify({sessionId:"draft-markdown-churn",runId:"post-fix",hypothesisId:"A",location:"editor.js:fileForm-click",msg:"[DEBUG] File dialog button clicked",data:{value:button.value,type:button.type,formValid:event.currentTarget.matches(":valid")},ts:Date.now()})}).catch(()=>{})});
// #endregion
// #region debug-point B:file-dialog-invalid
byId("fileForm").addEventListener("invalid",(event)=>{fetch("http://127.0.0.1:7778/event",{method:"POST",body:JSON.stringify({sessionId:"draft-markdown-churn",runId:"post-fix",hypothesisId:"B",location:"editor.js:fileForm-invalid",msg:"[DEBUG] Native validation blocked file dialog",data:{field:event.target.name,validationMessage:event.target.validationMessage},ts:Date.now()})}).catch(()=>{})},true);
// #endregion
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
byId("githubBindingButton").addEventListener("click", (event) => {
  const link = event.currentTarget;
  if (!link.href || link.getAttribute("aria-disabled") === "true") return;
  event.preventDefault();
  link.setAttribute("aria-busy", "true");
  link.textContent = "正在前往 GitHub";
  window.location.assign(link.href);
});
document.querySelectorAll("[data-workspace-view]").forEach((button) => {
  button.addEventListener("click", async () => {
    await setWorkspaceView(button.dataset.workspaceView);
  });
});

byId("fileForm").addEventListener("submit", async (event) => {
  // #region debug-point A:file-dialog-submit
  fetch("http://127.0.0.1:7778/event",{method:"POST",body:JSON.stringify({sessionId:"draft-markdown-churn",runId:"post-fix",hypothesisId:"A",location:"editor.js:fileForm-submit",msg:"[DEBUG] File dialog submit handler entered",data:{submitterValue:event.submitter?.value,formValid:event.currentTarget.matches(":valid")},ts:Date.now()})}).catch(()=>{});
  // #endregion
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
    content: `# ${payload.title}\n\n`,
    operation: "upsert"
  };
  byId("fileDialog").close();
  byId("emptyEditor").hidden = true;
  byId("activeEditor").hidden = false;
  byId("filePath").value = state.active.path;
  byId("filePath").readOnly = false;
  byId("discardDraftButton").hidden = true;
  byId("markDeleteButton").hidden = false;
  byId("markDeleteButton").textContent = "删除新增文件";
  byId("saveDraftButton").hidden = false;
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
    await openDraft(result);
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
    byId("diffViewer").hidden = true;
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
