const state = {
  session: null,
  csrf: "",
  smtp: null,
  smtpTemplates: [],
  starBrightnessRules: [],
  autoCloseDays: 7,
  siteUpdateTimer: 0
};

const STAR_BRIGHTNESS_RULES = [
  {
    id: "contributor_contribution_count",
    label: "静星贡献数",
    description: "贡献行数越多，基础亮度越高。"
  },
  {
    id: "contributor_recent_activity",
    label: "静星近期活跃度",
    description: "近期贡献会放大亮度，长期不活跃会衰减。"
  },
  {
    id: "document_reference_degree",
    label: "动星引用度",
    description: "被引用或引用其他内容越多，亮度越高。"
  },
  {
    id: "document_contributor_count",
    label: "动星贡献者数",
    description: "参与该文档的贡献者越多，亮度越高。"
  },
  {
    id: "document_recent_activity",
    label: "动星近期活跃度",
    description: "近期更新文档更亮，长期未更新会衰减。"
  }
];

const byId = (id) => document.getElementById(id);

function refreshIcons(root = document) {
  if (window.lucide) {
    window.lucide.createIcons({
      attrs: { "stroke-width": 1.8 },
      root
    });
  }
}

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
      : typeof detail === "object"
        ? detail.message
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

function shortCommit(value) {
  return value ? value.slice(0, 12) : "未知";
}

function renderStarBrightnessRules() {
  const target = byId("starBrightnessRuleList");
  const catalog = byId("starBrightnessRuleCatalog");
  target.replaceChildren();
  state.starBrightnessRules
    .sort((left, right) => right.priority - left.priority)
    .forEach((rule) => {
      const definition = STAR_BRIGHTNESS_RULES.find(
        (item) => item.id === rule.id
      );
      if (!definition) return;
      const row = document.createElement("div");
      row.className = "star-rule-row";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      const description = document.createElement("span");
      title.textContent = definition.label;
      description.textContent = definition.description;
      copy.append(title, description);
      const priorityLabel = document.createElement("label");
      priorityLabel.textContent = "优先级";
      const priority = document.createElement("input");
      priority.type = "number";
      priority.min = "-10000";
      priority.max = "10000";
      priority.step = "10";
      priority.value = String(rule.priority);
      priority.addEventListener("change", () => {
        rule.priority = Number(priority.value) || 0;
        renderStarBrightnessRules();
      });
      priorityLabel.append(priority);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button";
      remove.title = "移除规则";
      remove.setAttribute("aria-label", `移除${definition.label}`);
      remove.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
      remove.addEventListener("click", () => {
        state.starBrightnessRules = state.starBrightnessRules.filter(
          (item) => item.id !== rule.id
        );
        renderStarBrightnessRules();
      });
      row.append(copy, priorityLabel, remove);
      target.append(row);
    });

  const enabled = new Set(
    state.starBrightnessRules.map((rule) => rule.id)
  );
  catalog.replaceChildren();
  STAR_BRIGHTNESS_RULES.filter((rule) => !enabled.has(rule.id)).forEach(
    (rule) => {
      const option = document.createElement("option");
      option.value = rule.id;
      option.textContent = rule.label;
      catalog.append(option);
    }
  );
  byId("addStarBrightnessRule").disabled = !catalog.options.length;
  refreshIcons(target);
}

function formatUpdateTime(value) {
  if (!value) return "无";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN");
}

function renderSiteUpdate(update) {
  const labels = {
    idle: "空闲",
    queued: "已排队",
    checking: "检查中",
    building: "构建中",
    success: "已完成",
    failed: "失败"
  };
  const badge = byId("siteUpdateState");
  badge.textContent = labels[update.state] || update.state;
  badge.dataset.status =
    update.state === "success"
      ? "ready"
      : update.state === "failed"
        ? "error"
        : "idle";

  const values = [
    [
      "当前部署",
      `Web ${shortCommit(update.deployed_web_commit)} / ` +
        `Content ${shortCommit(update.deployed_content_commit)}`
    ],
    [
      "最近运行",
      `${update.message || "无记录"} · ` +
        formatUpdateTime(update.finished_at || update.started_at)
    ],
    [
      "目标版本",
      `Web ${shortCommit(update.web_commit)} / ` +
        `Content ${shortCommit(update.content_commit)}`
    ]
  ];
  const summary = byId("siteUpdateSummary");
  summary.replaceChildren();
  for (const [term, description] of values) {
    const item = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = description;
    item.append(dt, dd);
    summary.append(item);
  }

  const running = ["queued", "checking", "building"].includes(update.state);
  byId("updateContentButton").disabled = running;
  byId("updateSiteButton").disabled = running;
  window.clearTimeout(state.siteUpdateTimer);
  if (running) {
    state.siteUpdateTimer = window.setTimeout(() => {
      refreshSiteUpdate().catch((error) => siteUpdateFeedback(error.message));
    }, 2500);
  }
}

function siteUpdateFeedback(message, kind = "error") {
  const target = byId("siteUpdateFeedback");
  target.textContent = message || "";
  target.className =
    `feedback${message ? " is-visible" : ""} ${kind}`;
}

async function refreshSiteUpdate() {
  const update = await api("/admin/site-update");
  renderSiteUpdate(update);
  return update;
}

async function requestSiteUpdate(mode) {
  siteUpdateFeedback("");
  byId("updateContentButton").disabled = true;
  byId("updateSiteButton").disabled = true;
  try {
    await api("/admin/site-update", {
      method: "POST",
      body: JSON.stringify({ mode })
    });
    siteUpdateFeedback(
      mode === "content"
        ? "内容更新已排队。"
        : "服务器版本更新已排队。",
      "success"
    );
    await refreshSiteUpdate();
  } catch (error) {
    siteUpdateFeedback(error.message);
    byId("updateContentButton").disabled = false;
    byId("updateSiteButton").disabled = false;
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

function renderPendingSubmissions(items, externalItems, closeDays) {
  const target = byId("pendingSubmissionList");
  target.replaceChildren();
  const pending = [
    ...items
      .filter((item) => item.status === "open")
      .map((item) => ({ ...item, source: "web", actor: item.username })),
    ...externalItems
      .filter((item) => item.status === "open")
      .map((item) => ({
        ...item,
        source: "github",
        actor: `GitHub @${item.github_login}`
      }))
  ];
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
        `${item.actor} · ${item.source === "github" ? "外部 PR · " : ""}` +
          `${elapsedDays} 天未活动 · ${deadline}`,
        actions
      )
    );
  }
  if (!pending.length) target.textContent = "暂无待处理 PR";
}

function renderExternalPullRequests(items) {
  const target = byId("externalPullList");
  target.replaceChildren();
  byId("externalPullCount").textContent = `${items.length} 个`;
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
    const email = item.contributor_email
      ? `${item.contributor_email} · ${item.email_source}`
      : "未找到可投递邮箱";
    target.append(
      makeRow(
        `${item.title} · ${item.status}`,
        `GitHub @${item.github_login} · ${email}` +
          (item.auto_closed ? " · 系统自动关闭" : ""),
        actions
      )
    );
  }
  if (!items.length) target.textContent = "暂无外部 PR";
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
  byId("settingsForm").workspace_sync_interval_seconds.value =
    String(data.settings.workspace_sync_interval_seconds);
  byId("settingsForm").site_auto_update_interval_minutes.value =
    String(data.settings.site_auto_update_interval_minutes);
  byId("visualSettingsForm").catalog_background_style.value =
    data.settings.catalog_background_style;
  byId("visualSettingsForm").reader_background_style.value =
    data.settings.reader_background_style;
  byId("visualSettingsForm").home_background_style.value =
    data.settings.home_background_style;
  byId("visualSettingsForm").home_content_mask_enabled.checked =
    data.settings.home_content_mask_enabled;
  byId("visualSettingsForm").home_content_idle_timeout_seconds.value =
    String(data.settings.home_content_idle_timeout_seconds);
  byId("visualSettingsForm").home_star_scope.value =
    data.settings.home_star_scope;
  byId("visualSettingsForm").home_star_relation_visibility.value =
    data.settings.home_star_relation_visibility;
  byId("visualSettingsForm").home_star_strong_relation_style.value =
    data.settings.home_star_strong_relation_style;
  byId("visualSettingsForm").home_star_reference_relation_style.value =
    data.settings.home_star_reference_relation_style;
  byId("visualSettingsForm").home_star_contributor_relation_style.value =
    data.settings.home_star_contributor_relation_style;
  byId("visualSettingsForm").home_star_illumination_rule.value =
    data.settings.home_star_illumination_rule;
  byId("visualSettingsForm").home_star_active_edge_mode.value =
    data.settings.home_star_active_edge_mode;
  byId("visualSettingsForm").home_star_illumination_depth.value =
    String(data.settings.home_star_illumination_depth);
  byId("visualSettingsForm").home_star_selection_duration_seconds.value =
    String(data.settings.home_star_selection_duration_ms / 1000);
  byId("visualSettingsForm").home_star_label_duration_seconds.value =
    String(data.settings.home_star_label_duration_ms / 1000);
  byId("visualSettingsForm").home_star_brightness_variation_enabled.checked =
    data.settings.home_star_brightness_variation_enabled;
  byId("visualSettingsForm").home_star_brightness_variation_amount.value =
    String(data.settings.home_star_brightness_variation_amount);
  byId("visualSettingsForm").home_star_brightness_transition_seconds.value =
    String(data.settings.home_star_brightness_transition_ms / 1000);
  byId("visualSettingsForm").home_star_brightness_interval_seconds.value =
    String(data.settings.home_star_brightness_interval_ms / 1000);
  byId("visualSettingsForm").home_star_color_random_enabled.checked =
    data.settings.home_star_color_random_enabled;
  state.starBrightnessRules = (
    data.settings.home_star_brightness_rules || []
  ).map((rule) => ({ id: rule.id, priority: Number(rule.priority) || 0 }));
  renderStarBrightnessRules();
  byId("visualSettingsForm").pointer_effect_enabled.checked =
    data.settings.pointer_effect_enabled;
  byId("visualSettingsForm").home_intro_mode.value =
    data.settings.home_intro_mode;
  byId("visualSettingsForm").home_intro_assembly_duration_seconds.value =
    String(data.settings.home_intro_assembly_duration_ms / 1000);
  byId("visualSettingsForm").home_intro_hold_duration_seconds.value =
    String(data.settings.home_intro_hold_duration_ms / 1000);
  byId("visualSettingsForm").home_intro_lock_scroll.checked =
    data.settings.home_intro_lock_scroll;
  byId("visualSettingsForm").home_intro_contributor_limit.value =
    String(data.settings.home_intro_contributor_limit);
  state.autoCloseDays = data.settings.pr_auto_close_days;
  renderIntegrations(data.settings);
  renderSiteUpdate(data.site_update);
  renderPendingSubmissions(
    data.submissions,
    data.external_pull_requests,
    data.settings.pr_auto_close_days
  );
  renderSmtp(data.smtp, data.smtp_templates);
  renderApplications(data.applications);
  renderSubmissions(data.submissions);
  renderExternalPullRequests(data.external_pull_requests);
  renderNotifications(data.notifications);
  renderUsers(data.users);
  refreshIcons();
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
          event.currentTarget.reader_diff_enabled.checked,
        workspace_sync_interval_seconds: Number(
          event.currentTarget.workspace_sync_interval_seconds.value
        ),
        site_auto_update_interval_minutes: Number(
          event.currentTarget.site_auto_update_interval_minutes.value
        )
      })
    });
    feedback("编辑策略已保存", "success");
    await loadOverview();
  } catch (error) {
    feedback(error.message);
  }
});

byId("addStarBrightnessRule").addEventListener("click", () => {
  const catalog = byId("starBrightnessRuleCatalog");
  if (!catalog.value) return;
  const lowest = state.starBrightnessRules.reduce(
    (value, rule) => Math.min(value, rule.priority),
    100
  );
  state.starBrightnessRules.push({
    id: catalog.value,
    priority: lowest - 100
  });
  renderStarBrightnessRules();
});

byId("visualSettingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const saved = await api("/admin/visual-settings", {
      method: "PUT",
      body: JSON.stringify({
        catalog_background_style: form.catalog_background_style.value,
        reader_background_style: form.reader_background_style.value,
        home_background_style: form.home_background_style.value,
        home_content_mask_enabled:
          form.home_content_mask_enabled.checked,
        home_content_idle_timeout_seconds: Number(
          form.home_content_idle_timeout_seconds.value
        ),
        home_star_scope: form.home_star_scope.value,
        home_star_relation_visibility:
          form.home_star_relation_visibility.value,
        home_star_strong_relation_style:
          form.home_star_strong_relation_style.value,
        home_star_reference_relation_style:
          form.home_star_reference_relation_style.value,
        home_star_contributor_relation_style:
          form.home_star_contributor_relation_style.value,
        home_star_illumination_rule:
          form.home_star_illumination_rule.value,
        home_star_active_edge_mode:
          form.home_star_active_edge_mode.value,
        home_star_illumination_depth: Number(
          form.home_star_illumination_depth.value
        ),
        home_star_selection_duration_ms: Math.round(
          Number(form.home_star_selection_duration_seconds.value) * 1000
        ),
        home_star_label_duration_ms: Math.round(
          Number(form.home_star_label_duration_seconds.value) * 1000
        ),
        home_star_brightness_variation_enabled:
          form.home_star_brightness_variation_enabled.checked,
        home_star_brightness_variation_amount: Number(
          form.home_star_brightness_variation_amount.value
        ),
        home_star_brightness_transition_ms: Math.round(
          Number(form.home_star_brightness_transition_seconds.value) * 1000
        ),
        home_star_brightness_interval_ms: Math.round(
          Number(form.home_star_brightness_interval_seconds.value) * 1000
        ),
        home_star_color_random_enabled:
          form.home_star_color_random_enabled.checked,
        home_star_brightness_rules: state.starBrightnessRules.map(
          (rule) => ({ id: rule.id, priority: rule.priority })
        ),
        pointer_effect_enabled: form.pointer_effect_enabled.checked,
        home_intro_enabled: form.home_intro_mode.value !== "off",
        home_intro_mode: form.home_intro_mode.value,
        home_intro_assembly_duration_ms: Math.round(
          Number(form.home_intro_assembly_duration_seconds.value) * 1000
        ),
        home_intro_hold_duration_ms: Math.round(
          Number(form.home_intro_hold_duration_seconds.value) * 1000
        ),
        home_intro_lock_scroll: form.home_intro_lock_scroll.checked,
        home_intro_contributor_limit: Number(
          form.home_intro_contributor_limit.value
        )
      })
    });
    const savedSettings = {
      home_intro_enabled: saved.home_intro_enabled,
      home_intro_mode: saved.home_intro_mode,
      home_intro_duration_ms: saved.home_intro_duration_ms,
      home_intro_assembly_duration_ms:
        saved.home_intro_assembly_duration_ms,
      home_intro_hold_duration_ms: saved.home_intro_hold_duration_ms,
      home_intro_lock_scroll: saved.home_intro_lock_scroll,
      home_intro_contributor_limit:
        saved.home_intro_contributor_limit,
      home_background_style: saved.home_background_style,
      home_content_mask_enabled: saved.home_content_mask_enabled,
      home_content_idle_timeout_seconds:
        saved.home_content_idle_timeout_seconds,
      home_star_scope: saved.home_star_scope,
      home_star_relation_visibility: saved.home_star_relation_visibility,
      home_star_strong_relation_style:
        saved.home_star_strong_relation_style,
      home_star_reference_relation_style:
        saved.home_star_reference_relation_style,
      home_star_contributor_relation_style:
        saved.home_star_contributor_relation_style,
      home_star_illumination_rule:
        saved.home_star_illumination_rule,
      home_star_active_edge_mode:
        saved.home_star_active_edge_mode,
      home_star_illumination_depth:
        saved.home_star_illumination_depth,
      home_star_selection_duration_ms:
        saved.home_star_selection_duration_ms,
      home_star_label_duration_ms:
        saved.home_star_label_duration_ms,
      home_star_brightness_variation_enabled:
        saved.home_star_brightness_variation_enabled,
      home_star_brightness_variation_amount:
        saved.home_star_brightness_variation_amount,
      home_star_brightness_transition_ms:
        saved.home_star_brightness_transition_ms,
      home_star_brightness_interval_ms:
        saved.home_star_brightness_interval_ms,
      home_star_color_random_enabled:
        saved.home_star_color_random_enabled,
      home_star_brightness_rules: saved.home_star_brightness_rules
    };
    try {
      window.localStorage.setItem(
        "gck-home-intro-settings",
        JSON.stringify(savedSettings)
      );
    } catch {
      // The server setting remains authoritative when storage is unavailable.
    }
    feedback("网站视觉设置已保存", "success");
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
        `${result.auto_closed} 个自动关闭；` +
        `发现 ${result.external_discovered || 0} 个外部 PR，` +
        `检查 ${result.external_checked || 0} 个外部 PR。`,
      "success"
    );
    await loadOverview();
  } catch (error) {
    feedback(error.message);
  } finally {
    button.disabled = false;
  }
});

byId("updateContentButton").addEventListener("click", () => {
  requestSiteUpdate("content");
});
byId("updateSiteButton").addEventListener("click", () => {
  requestSiteUpdate("site");
});
byId("refreshSiteUpdateButton").addEventListener("click", () => {
  refreshSiteUpdate().catch((error) => siteUpdateFeedback(error.message));
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
