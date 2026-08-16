const state = {
  session: null,
  csrf: "",
  smtp: null,
  smtpTemplates: [],
  autoCloseDays: 7
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
    const detail = payload?.detail;
    const message = Array.isArray(detail)
      ? detail.map((item) => item.msg || String(item)).join("；")
      : detail;
    throw new Error(message || `请求失败（HTTP ${response.status}）`);
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

function smtpFeedback(message, kind = "error") {
  const target = byId("smtpFeedback");
  target.textContent = message;
  target.className = `feedback${message ? " is-visible" : ""} ${kind}`;
}

function syncSmtpEnabledState() {
  const form = byId("smtpForm");
  const enabled = form.enabled.checked;
  form.host.required = enabled;
  form.from_address.required = enabled;
  byId("testSmtpButton").disabled = !state.smtp?.configured;
}

function renderSmtpTemplates(templates) {
  const select = byId("smtpProvider");
  select.replaceChildren();
  templates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.label;
    select.append(option);
  });
}

function renderSmtp(configuration, templates) {
  state.smtp = configuration;
  state.smtpTemplates = templates;
  renderSmtpTemplates(templates);
  const form = byId("smtpForm");
  form.provider.value = configuration.provider;
  form.host.value = configuration.host;
  form.port.value = String(configuration.port);
  form.username.value = configuration.username;
  form.password.value = "";
  form.from_address.value = configuration.from_address;
  form.enabled.checked = configuration.enabled;
  form.starttls.checked = configuration.starttls;

  const status = byId("smtpConfigStatus");
  status.textContent = configuration.configured
    ? "已启用"
    : configuration.enabled
      ? "配置不完整"
      : "已停用";
  status.dataset.status = configuration.configured ? "ready" : "idle";
  byId("smtpPasswordStatus").textContent = configuration.password_set
    ? "授权码已加密保存；留空不会覆盖。"
    : "尚未保存授权码。";
  syncSmtpEnabledState();
}

function applySmtpTemplate() {
  const form = byId("smtpForm");
  const template = state.smtpTemplates.find(
    (item) => item.id === form.provider.value
  );
  if (!template || template.id === "custom") return;
  form.host.value = template.host;
  form.port.value = String(template.port);
  form.starttls.checked = template.starttls;
  if (!form.from_address.value && form.username.value.includes("@")) {
    form.from_address.value = form.username.value;
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

function renderPendingSubmissions(items, closeDays) {
  const target = byId("pendingSubmissionList");
  target.replaceChildren();
  const pending = items.filter((item) => item.status === "open");
  byId("pendingSubmissionCount").textContent = `${pending.length} 个待处理`;
  for (const item of pending) {
    const actions = [];
    if (item.pr_url) {
      const link = document.createElement("a");
      link.className = "secondary-button";
      link.href = item.pr_url;
      link.rel = "noreferrer";
      link.textContent = `PR #${item.pr_number}`;
      actions.push(link);
    }
    const activity = new Date(
      item.pr_updated_at || item.updated_at || item.created_at
    );
    const elapsedDays = Number.isNaN(activity.getTime())
      ? 0
      : Math.max(
          0,
          Math.floor((Date.now() - activity.getTime()) / 86400000)
        );
    const deadline = closeDays
      ? elapsedDays >= closeDays
        ? "等待自动关闭"
        : `${closeDays - elapsedDays} 天后自动关闭`
      : "自动关闭已停用";
    target.append(
      makeRow(
        `${item.title} · PR #${item.pr_number}`,
        `${item.username} · ${elapsedDays} 天未活动 · ${deadline}`,
        actions
      )
    );
  }
  if (!pending.length) target.textContent = "暂无待处理 PR";
}

function renderNotifications(items) {
  const target = byId("notificationList");
  target.replaceChildren();
  for (const item of items) {
    target.append(
      makeRow(
        `${item.subject} · ${item.status}`,
        `${item.audience || "admin"} · ` +
          (item.error_message || item.created_at)
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
  byId("settingsForm").pr_auto_close_days.value =
    String(data.settings.pr_auto_close_days);
  byId("settingsForm").reader_edit_mode.value =
    data.settings.reader_edit_mode;
  byId("settingsForm").reader_diff_enabled.checked =
    data.settings.reader_diff_enabled;
  state.autoCloseDays = data.settings.pr_auto_close_days;
  renderIntegrations(data.settings);
  renderPendingSubmissions(
    data.submissions,
    data.settings.pr_auto_close_days
  );
  renderSmtp(data.smtp, data.smtp_templates);
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
        registration_enabled: event.currentTarget.registration_enabled.checked,
        pr_auto_close_days: Number(
          event.currentTarget.pr_auto_close_days.value
        ),
        reader_edit_mode: event.currentTarget.reader_edit_mode.value,
        reader_diff_enabled:
          event.currentTarget.reader_diff_enabled.checked
      })
    });
    feedback("编辑策略已保存", "success");
    await loadOverview();
  } catch (error) {
    feedback(error.message);
  }
});

byId("syncPrButton").addEventListener("click", async () => {
  const button = byId("syncPrButton");
  button.disabled = true;
  try {
    const result = await api("/admin/submissions/sync", {
      method: "POST"
    });
    feedback(
      `已检查 ${result.checked} 个 PR：` +
        `${result.merged} 个合并，${result.closed} 个关闭，` +
        `${result.auto_closed} 个自动关闭。`,
      "success"
    );
    await loadOverview();
  } catch (error) {
    feedback(error.message);
  } finally {
    button.disabled = false;
  }
});

byId("smtpProvider").addEventListener("change", applySmtpTemplate);
byId("smtpForm").enabled.addEventListener("change", syncSmtpEnabledState);
byId("smtpForm").username.addEventListener("blur", (event) => {
  const form = event.currentTarget.form;
  if (!form.from_address.value && event.currentTarget.value.includes("@")) {
    form.from_address.value = event.currentTarget.value.trim();
  }
});

byId("smtpForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = byId("saveSmtpButton");
  button.disabled = true;
  smtpFeedback("");
  try {
    const configuration = await api("/admin/smtp", {
      method: "PUT",
      body: JSON.stringify({
        enabled: form.enabled.checked,
        provider: form.provider.value,
        host: form.host.value,
        port: Number(form.port.value),
        username: form.username.value,
        password: form.password.value,
        from_address: form.from_address.value,
        starttls: form.starttls.checked
      })
    });
    renderSmtp(configuration, state.smtpTemplates);
    smtpFeedback("SMTP 配置已保存。", "success");
    await loadOverview();
  } catch (error) {
    smtpFeedback(error.message);
  } finally {
    button.disabled = false;
  }
});

byId("testSmtpButton").addEventListener("click", async () => {
  const button = byId("testSmtpButton");
  button.disabled = true;
  smtpFeedback("");
  try {
    const result = await api("/admin/smtp/test", { method: "POST" });
    smtpFeedback(`测试邮件已发送至 ${result.recipient}。`, "success");
  } catch (error) {
    smtpFeedback(error.message);
  } finally {
    button.disabled = !state.smtp?.configured;
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
