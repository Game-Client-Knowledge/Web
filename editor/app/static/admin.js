const state = {
  session: null,
  csrf: ""
};

const byId = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("Content-Type", "application/json");
  if (state.csrf && !["GET", "HEAD"].includes((options.method || "GET").toUpperCase())) {
    headers.set("X-CSRF-Token", state.csrf);
  }
  const response = await fetch(`api${path}`, {
    credentials: "same-origin",
    ...options,
    headers
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.detail || `请求失败（HTTP ${response.status}）`);
  }
  return payload;
}

function feedback(message, kind = "error") {
  const target = byId("adminFeedback");
  target.textContent = message;
  target.className = `feedback is-visible ${kind}`;
}

function makeRow(primary, secondary, actions = []) {
  const row = document.createElement("div");
  row.className = "data-row";
  const first = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = primary;
  first.append(title);
  const second = document.createElement("div");
  const detail = document.createElement("span");
  detail.textContent = secondary;
  second.append(detail);
  const actionBox = document.createElement("div");
  actionBox.className = "row-actions";
  actions.forEach((action) => actionBox.append(action));
  row.append(first, second, actionBox);
  return row;
}

function actionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function renderIntegrations(settings) {
  const target = byId("integrationStatus");
  target.replaceChildren();
  const values = [
    ["GitHub OAuth", settings.github_oauth_enabled],
    ["GitHub 提交 Bot", settings.github_submission_enabled],
    ["SMTP 邮件", settings.smtp_enabled]
  ];
  for (const [label, ready] of values) {
    const chip = document.createElement("span");
    chip.className = `integration-chip${ready ? " ready" : ""}`;
    chip.textContent = `${label}：${ready ? "已配置" : "未配置"}`;
    target.append(chip);
  }
}

function renderApplications(items) {
  const target = byId("applicationList");
  target.replaceChildren();
  const pending = items.filter((item) => item.status === "pending");
  byId("applicationCount").textContent = `${pending.length} 个待处理`;
  for (const item of items) {
    const actions = [];
    if (item.status === "pending") {
      actions.push(
        actionButton("批准", "primary-button", () => decideApplication(item.id, "approved")),
        actionButton("拒绝", "secondary-button", () => decideApplication(item.id, "rejected"))
      );
    }
    target.append(
      makeRow(
        `${item.username} · ${item.status}`,
        `${item.email} · ${item.message}`,
        actions
      )
    );
  }
  if (!items.length) target.textContent = "暂无管理员申请";
}

function renderSubmissions(items) {
  const target = byId("adminSubmissionList");
  target.replaceChildren();
  for (const item of items) {
    const actions = [];
    if (item.pr_url) {
      const link = document.createElement("a");
      link.className = "secondary-button";
      link.href = item.pr_url;
      link.rel = "noreferrer";
      link.textContent = `PR #${item.pr_number}`;
      actions.push(link);
    }
    target.append(
      makeRow(
        `${item.title} · ${item.status}`,
        `${item.username} · ${item.branch_name}` +
          (item.error_message ? ` · ${item.error_message}` : ""),
        actions
      )
    );
  }
  if (!items.length) target.textContent = "暂无提交请求";
}

function renderNotifications(items) {
  const target = byId("notificationList");
  target.replaceChildren();
  for (const item of items) {
    target.append(
      makeRow(
        `${item.subject} · ${item.status}`,
        item.error_message || item.created_at
      )
    );
  }
  if (!items.length) target.textContent = "暂无通知记录";
}

function renderUsers(items) {
  const target = byId("userList");
  target.replaceChildren();
  byId("userCount").textContent = `${items.length} 人`;
  for (const item of items) {
    const actions = [];
    if (!item.email_verified) {
      actions.push(
        actionButton(
          "确认邮箱",
          "secondary-button",
          () => verifyEmail(item.id)
        )
      );
    }
    target.append(
      makeRow(
        `${item.username} · ${item.role}`,
        `${item.email}` +
          ` · ${item.email_verified ? "邮箱已验证" : "邮箱未验证"}` +
          (item.github_login ? ` · GitHub @${item.github_login}` : "") +
          ` · ${item.status}`,
        actions
      )
    );
  }
}

async function verifyEmail(id) {
  try {
    await api(`/admin/users/${id}/verify-email`, {
      method: "POST"
    });
    feedback("用户邮箱已标记为验证", "success");
    await loadOverview();
  } catch (error) {
    feedback(error.message);
  }
}

async function decideApplication(id, decision) {
  try {
    await api(`/admin/applications/${id}`, {
      method: "POST",
      body: JSON.stringify({ decision })
    });
    feedback("管理员申请已处理", "success");
    await loadOverview();
  } catch (error) {
    feedback(error.message);
  }
}

async function loadOverview() {
  const data = await api("/admin/overview");
  byId("adminSummary").textContent = `${state.session.user.username} · ${state.session.user.email}`;
  byId("settingsForm").edit_policy.value = data.settings.edit_policy;
  byId("settingsForm").registration_enabled.checked =
    data.settings.registration_enabled;
  renderIntegrations(data.settings);
  renderApplications(data.applications);
  renderSubmissions(data.submissions);
  renderNotifications(data.notifications);
  renderUsers(data.users);
}

byId("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        edit_policy: event.currentTarget.edit_policy.value,
        registration_enabled: event.currentTarget.registration_enabled.checked
      })
    });
    feedback("编辑策略已保存", "success");
    await loadOverview();
  } catch (error) {
    feedback(error.message);
  }
});

byId("refreshButton").addEventListener("click", () => {
  loadOverview().catch((error) => feedback(error.message));
});

byId("logoutButton").addEventListener("click", async () => {
  await api("/auth/logout", { method: "POST" }).catch(() => {});
  location.href = "./";
});

(async () => {
  const session = await api("/session");
  if (!session.authenticated || session.user.role !== "admin") {
    location.href = "./";
    return;
  }
  if (session.user.must_change_password) {
    location.href = "./";
    return;
  }
  state.session = session;
  state.csrf = session.csrf_token;
  await loadOverview();
})().catch((error) => feedback(error.message));
