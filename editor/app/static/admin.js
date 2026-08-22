const state = {
  session: null,
  csrf: "",
  smtp: null,
  smtpTemplates: [],
  commentAgent: null,
  commentAgentTemplates: [],
  commentAgentUsers: [],
  commentAgentWhitelist: new Set(),
  starBrightnessRules: [],
  starBrightnessTiers: [],
  autoCloseDays: 7,
  siteUpdateTimer: 0
};

const starFormulaEngine = window.GCK_STAR_FORMULA_ENGINE;

const byId = (id) => document.getElementById(id);
const numberFormatter = new Intl.NumberFormat("zh-CN");

function formatDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

function setupAdminNavigation() {
  const links = Array.from(document.querySelectorAll(".admin-nav a"));
  const targets = links
    .map((link) => {
      const id = link.getAttribute("href")?.slice(1);
      return { link, target: id ? document.getElementById(id) : null };
    })
    .filter((item) => item.target);
  if (!targets.length) return;

  function activate(id, options = {}) {
    const active =
      targets.find((item) => item.target.id === id) || targets[0];
    for (const item of targets) {
      const selected = item === active;
      if (!item.link.id) item.link.id = `adminNav-${item.target.id}`;
      item.target.hidden = !selected;
      item.target.classList.toggle("is-active", selected);
      item.target.setAttribute("role", "tabpanel");
      item.target.setAttribute("aria-labelledby", item.link.id);
      item.link.classList.toggle("is-active", selected);
      item.link.setAttribute("role", "tab");
      item.link.setAttribute("aria-controls", item.target.id);
      item.link.setAttribute("aria-selected", String(selected));
      item.link.tabIndex = selected ? 0 : -1;
      if (selected) item.link.setAttribute("aria-current", "page");
      else item.link.removeAttribute("aria-current");
    }
    if (
      options.updateHistory &&
      window.location.hash !== `#${active.target.id}`
    ) {
      window.history.pushState(null, "", `#${active.target.id}`);
    }
    if (options.scroll) {
      const top = document.querySelector(".admin-layout")?.offsetTop || 0;
      window.scrollTo({ top: Math.max(0, top - 76), behavior: "auto" });
    }
  }

  links.forEach((link, index) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      activate(link.hash.slice(1), {
        updateHistory: true,
        scroll: true
      });
    });
    link.addEventListener("keydown", (event) => {
      if (
        ![
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End"
        ].includes(event.key)
      ) {
        return;
      }
      event.preventDefault();
      let targetIndex = index;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        targetIndex = (index - 1 + links.length) % links.length;
      } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        targetIndex = (index + 1) % links.length;
      } else if (event.key === "Home") {
        targetIndex = 0;
      } else if (event.key === "End") {
        targetIndex = links.length - 1;
      }
      const targetLink = links[targetIndex];
      activate(targetLink.hash.slice(1), { updateHistory: true });
      targetLink.focus();
    });
  });
  window.addEventListener("popstate", () => {
    activate(window.location.hash.slice(1));
  });
  activate(window.location.hash.slice(1));
}

function setupVisualSettingsNavigation() {
  const storageKey = "gck-admin-visual-panel:v1";
  const buttons = Array.from(
    document.querySelectorAll("[data-visual-panel-target]")
  );
  const panels = Array.from(
    document.querySelectorAll("[data-visual-panel]")
  );
  if (!buttons.length || !panels.length) return;

  function activate(id, focus = false) {
    const selectedButton =
      buttons.find((button) => button.dataset.visualPanelTarget === id) ||
      buttons[0];
    const selectedId = selectedButton.dataset.visualPanelTarget;
    for (const button of buttons) {
      const selected = button === selectedButton;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.visualPanel !== selectedId;
    }
    try {
      window.localStorage.setItem(storageKey, selectedId);
    } catch {
      // The first visual panel remains the fallback without local storage.
    }
    if (focus) selectedButton.focus();
  }

  buttons.forEach((button, index) => {
    button.addEventListener("click", () => {
      activate(button.dataset.visualPanelTarget);
    });
    button.addEventListener("keydown", (event) => {
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      let targetIndex = index;
      if (event.key === "ArrowLeft") {
        targetIndex = (index - 1 + buttons.length) % buttons.length;
      } else if (event.key === "ArrowRight") {
        targetIndex = (index + 1) % buttons.length;
      } else if (event.key === "Home") {
        targetIndex = 0;
      } else if (event.key === "End") {
        targetIndex = buttons.length - 1;
      }
      activate(buttons[targetIndex].dataset.visualPanelTarget, true);
    });
  });

  let initial = "";
  try {
    initial = window.localStorage.getItem(storageKey) || "";
  } catch {
    // Use the first visual panel.
  }
  activate(initial);
  let invalidPanelActivated = false;
  byId("visualSettingsForm").addEventListener(
    "invalid",
    (event) => {
      if (invalidPanelActivated) return;
      const panel = event.target.closest("[data-visual-panel]");
      if (!panel) return;
      invalidPanelActivated = true;
      if (panel.hidden) activate(panel.dataset.visualPanel);
      window.setTimeout(() => {
        invalidPanelActivated = false;
      }, 0);
    },
    true
  );
}

function renderStarFormulaReference() {
  const variableTarget = byId("starFormulaVariableReference");
  const functionTarget = byId("starFormulaFunctionReference");
  if (!variableTarget || !functionTarget || !starFormulaEngine) return;
  variableTarget.replaceChildren();
  for (const definition of starFormulaEngine.VARIABLE_DEFINITIONS) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const identifier = document.createElement("code");
    const label = document.createElement("span");
    const description = document.createElement("dd");
    identifier.textContent = definition.id;
    label.textContent = definition.label;
    description.textContent = definition.description;
    term.append(identifier, label);
    row.append(term, description);
    variableTarget.append(row);
  }
  functionTarget.textContent =
    `函数：${starFormulaEngine.FUNCTIONS.join(", ")}；` +
    "运算符：+ - * / % ^ 和括号。";
}

function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0);
}

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
    ["SMTP 邮件", settings.smtp_enabled],
    ["评论 Agent", state.commentAgent?.configured]
  ];
  for (const [label, ready] of values) {
    const chip = document.createElement("span");
    chip.className = `integration-chip${ready ? " ready" : ""}`;
    chip.textContent = `${label}：${ready ? "已配置" : "未配置"}`;
    target.append(chip);
  }
}

function renderAnalytics(analytics) {
  const periodGrid = byId("analyticsPeriodGrid");
  const trend = byId("analyticsTrend");
  const fileRows = byId("analyticsFileRows");
  const contributorRows = byId("analyticsContributorRows");
  periodGrid.replaceChildren();
  trend.replaceChildren();
  fileRows.replaceChildren();
  contributorRows.replaceChildren();

  for (const period of analytics?.periods || []) {
    const card = document.createElement("article");
    card.className = "analytics-period-card";
    card.dataset.period = period.key;
    const title = document.createElement("span");
    title.textContent = period.title;
    const devices = document.createElement("strong");
    devices.textContent = formatNumber(period.devices);
    const deviceLabel = document.createElement("small");
    deviceLabel.textContent = "独立设备";
    const visits = document.createElement("p");
    visits.textContent = `${formatNumber(period.visits)} 次访问`;
    const engagement = document.createElement("small");
    engagement.className = "analytics-period-engagement";
    engagement.textContent =
      `${formatNumber(period.content_views)} 次文件阅览 · ` +
      `${formatDuration(period.reading_seconds)}`;
    const starMap = document.createElement("small");
    starMap.className = "analytics-period-star-map";
    starMap.textContent =
      `星图 ${formatDuration(period.star_map_seconds)}`;
    card.append(
      title,
      devices,
      deviceLabel,
      visits,
      engagement,
      starMap
    );
    periodGrid.append(card);
  }

  const days = (analytics?.daily || []).slice(-14);
  const maximum = Math.max(
    1,
    ...days.map((item) => Number(item.visits) || 0)
  );
  for (const item of days) {
    const row = document.createElement("div");
    row.className = "analytics-trend-row";
    const day = document.createElement("time");
    day.dateTime = item.day;
    day.textContent = item.day.slice(5).replace("-", "/");
    const bar = document.createElement("span");
    bar.className = "analytics-trend-bar";
    const fill = document.createElement("span");
    fill.style.width =
      `${Math.max(0, (Number(item.visits) || 0) / maximum * 100)}%`;
    bar.append(fill);
    const devices = document.createElement("span");
    devices.textContent = `${formatNumber(item.devices)} 设备`;
    const visits = document.createElement("strong");
    visits.textContent = `${formatNumber(item.visits)} 次`;
    row.append(day, bar, devices, visits);
    trend.append(row);
  }

  function emptyRow(target, message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "analytics-table-empty";
    cell.textContent = message;
    row.append(cell);
    target.append(row);
  }

  for (const file of analytics?.files || []) {
    const row = document.createElement("tr");
    const path = document.createElement("th");
    path.scope = "row";
    const code = document.createElement("code");
    code.textContent = file.path;
    code.title = file.path;
    path.append(code);
    const views = document.createElement("td");
    views.textContent = formatNumber(file.views);
    const reading = document.createElement("td");
    reading.textContent = formatDuration(file.reading_seconds);
    const average = document.createElement("td");
    average.textContent = formatDuration(file.average_seconds);
    row.append(path, views, reading, average);
    fileRows.append(row);
  }
  if (!fileRows.children.length) {
    emptyRow(fileRows, "暂无文件阅览数据");
  }

  for (const contributor of analytics?.contributors || []) {
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = contributor.name;
    const files = document.createElement("td");
    files.textContent = formatNumber(contributor.file_count);
    const views = document.createElement("td");
    views.textContent = formatNumber(contributor.views);
    const reading = document.createElement("td");
    reading.textContent = formatDuration(
      contributor.reading_seconds
    );
    row.append(name, files, views, reading);
    contributorRows.append(row);
  }
  if (!contributorRows.children.length) {
    emptyRow(contributorRows, "暂无贡献阅览数据");
  }
}

function shortCommit(value) {
  return value ? value.slice(0, 12) : "未知";
}

function createConfigurationId(prefix) {
  const random = window.crypto?.randomUUID?.().slice(0, 8) ||
    Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}

function moveConfigurationItem(items, index, offset) {
  const target = index + offset;
  if (target < 0 || target >= items.length) return;
  [items[index], items[target]] = [items[target], items[index]];
}

function renderStarBrightnessRules() {
  const target = byId("starBrightnessRuleList");
  target.replaceChildren();
  state.starBrightnessRules.forEach((rule, index) => {
      const row = document.createElement("div");
      row.className = "star-rule-row";
      const header = document.createElement("div");
      header.className = "star-rule-header";
      const enabledLabel = document.createElement("label");
      enabledLabel.className = "check-label";
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = rule.enabled !== false;
      enabled.addEventListener("change", () => {
        rule.enabled = enabled.checked;
      });
      enabledLabel.append(enabled, "启用");

      const actions = document.createElement("span");
      actions.className = "star-rule-actions";
      for (const [offset, icon, title] of [
        [-1, "arrow-up", "上移规则"],
        [1, "arrow-down", "下移规则"]
      ]) {
        const move = document.createElement("button");
        move.type = "button";
        move.className = "icon-button";
        move.title = title;
        move.setAttribute("aria-label", title);
        move.disabled =
          (offset < 0 && index === 0) ||
          (offset > 0 && index === state.starBrightnessRules.length - 1);
        move.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
        move.addEventListener("click", () => {
          moveConfigurationItem(state.starBrightnessRules, index, offset);
          renderStarBrightnessRules();
        });
        actions.append(move);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button";
      remove.title = "移除规则";
      remove.setAttribute("aria-label", `移除${rule.name || "亮度规则"}`);
      remove.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
      remove.addEventListener("click", () => {
        state.starBrightnessRules = state.starBrightnessRules.filter(
          (item) => item !== rule
        );
        renderStarBrightnessRules();
      });
      actions.append(remove);
      header.append(enabledLabel, actions);

      const fields = document.createElement("div");
      fields.className = "star-rule-fields";
      const nameLabel = document.createElement("label");
      nameLabel.textContent = "规则名称";
      const name = document.createElement("input");
      name.type = "text";
      name.maxLength = 80;
      name.required = true;
      name.value = rule.name || "";
      name.addEventListener("input", () => {
        rule.name = name.value;
      });
      nameLabel.append(name);

      const targetLabel = document.createElement("label");
      targetLabel.textContent = "作用对象";
      const ruleTarget = document.createElement("select");
      for (const [value, label] of [
        ["contributor", "静星"],
        ["document", "动星"]
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = rule.target === value;
        ruleTarget.append(option);
      }
      ruleTarget.addEventListener("change", () => {
        rule.target = ruleTarget.value;
      });
      targetLabel.append(ruleTarget);
      fields.append(nameLabel, targetLabel);

      const formulaLabel = document.createElement("label");
      formulaLabel.className = "star-formula-field";
      formulaLabel.textContent = "公式";
      const formula = document.createElement("textarea");
      formula.rows = 3;
      formula.maxLength = 500;
      formula.required = true;
      formula.spellcheck = false;
      formula.value = rule.formula || "";
      const validation = document.createElement("span");
      validation.className = "star-formula-validation";
      const validate = () => {
        rule.formula = formula.value;
        const result = starFormulaEngine.validateFormula(formula.value);
        formula.setCustomValidity(result.valid ? "" : result.message);
        validation.dataset.valid = result.valid ? "true" : "false";
        validation.textContent = result.valid
          ? `有效 · ${result.variables.length} 个变量`
          : result.message;
      };
      formula.addEventListener("input", validate);
      validate();
      formulaLabel.append(formula, validation);
      row.append(header, fields, formulaLabel);
      target.append(row);
    });
  byId("addStarBrightnessRule").disabled =
    state.starBrightnessRules.length >= 50;
  refreshIcons(target);
}

function renderStarBrightnessTiers() {
  const target = byId("starBrightnessTierList");
  target.replaceChildren();
  state.starBrightnessTiers
    .sort((left, right) => left.min_brightness - right.min_brightness)
    .forEach((tier) => {
      const row = document.createElement("div");
      row.className = "star-tier-row";
      const nameLabel = document.createElement("label");
      nameLabel.textContent = "等级名称";
      const name = document.createElement("input");
      name.type = "text";
      name.maxLength = 80;
      name.required = true;
      name.value = tier.name || "";
      name.addEventListener("input", () => {
        tier.name = name.value;
      });
      nameLabel.append(name);
      const thresholdLabel = document.createElement("label");
      thresholdLabel.textContent = "最低计算亮度";
      const threshold = document.createElement("input");
      threshold.type = "number";
      threshold.min = "0";
      threshold.max = "100";
      threshold.step = "0.5";
      threshold.required = true;
      threshold.value = String(tier.min_brightness);
      threshold.addEventListener("change", () => {
        tier.min_brightness = Number(threshold.value);
        renderStarBrightnessTiers();
      });
      thresholdLabel.append(threshold);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button";
      remove.title = "移除等级";
      remove.setAttribute("aria-label", `移除${tier.name || "星体等级"}`);
      remove.disabled = state.starBrightnessTiers.length <= 1;
      remove.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
      remove.addEventListener("click", () => {
        state.starBrightnessTiers = state.starBrightnessTiers.filter(
          (item) => item !== tier
        );
        renderStarBrightnessTiers();
      });
      row.append(nameLabel, thresholdLabel, remove);
      target.append(row);
    });
  byId("addStarBrightnessTier").disabled =
    state.starBrightnessTiers.length >= 20;
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

function commentAgentFeedback(message, kind = "error") {
  const target = byId("commentAgentFeedback");
  target.textContent = message;
  target.className = `feedback${message ? " is-visible" : ""} ${kind}`;
}

function renderCommentAgentTemplates(templates) {
  const select = byId("commentAgentProvider");
  select.replaceChildren();
  templates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.label;
    select.append(option);
  });
}

function syncCommentAgentState() {
  byId("testCommentAgentButton").disabled =
    !state.commentAgent?.configured;
  const form = byId("commentAgentForm");
  byId("commentAgentWhitelistSection").hidden =
    form.access_mode.value !== "whitelist";
}

function renderCommentAgentWhitelist(keyword = "") {
  const target = byId("commentAgentWhitelist");
  const normalized = keyword.trim().toLowerCase();
  target.replaceChildren();
  const users = state.commentAgentUsers.filter((user) => {
    return !normalized || [
      user.username,
      user.email,
      user.github_login || ""
    ].some((value) => value.toLowerCase().includes(normalized));
  });
  users.forEach((user) => {
    const label = document.createElement("label");
    label.className = "agent-whitelist-user";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(user.id);
    input.checked = state.commentAgentWhitelist.has(user.id);
    input.addEventListener("change", () => {
      if (input.checked) state.commentAgentWhitelist.add(user.id);
      else state.commentAgentWhitelist.delete(user.id);
    });
    const identity = document.createElement("span");
    const name = document.createElement("strong");
    const detail = document.createElement("small");
    name.textContent = user.username;
    detail.textContent =
      user.email +
      (user.github_login ? ` · @${user.github_login}` : "");
    identity.append(name, detail);
    label.append(input, identity);
    target.append(label);
  });
  if (!users.length) target.textContent = "没有匹配用户";
}

function renderCommentAgentUsage(items) {
  const target = byId("commentAgentUsage");
  target.replaceChildren();
  items.forEach((item) => {
    target.append(
      makeRow(
        item.username,
        `${formatNumber(item.request_count)} 次请求` +
          ` · 输入 ${formatNumber(item.input_tokens)}` +
          ` · 输出 ${formatNumber(item.output_tokens)}`,
        [
          Object.assign(document.createElement("strong"), {
            textContent: formatNumber(item.total_tokens)
          })
        ]
      )
    );
  });
  if (!items.length) target.textContent = "暂无用户 Token 记录";
}

function renderCommentAgent(configuration, templates, users, usage) {
  state.commentAgent = configuration;
  state.commentAgentTemplates = templates;
  state.commentAgentUsers = users;
  state.commentAgentWhitelist = new Set(
    configuration.whitelist_user_ids || []
  );
  renderCommentAgentTemplates(templates);
  const form = byId("commentAgentForm");
  form.provider.value = configuration.provider;
  form.protocol.value = configuration.protocol;
  form.base_url.value = configuration.base_url;
  form.model.value = configuration.model;
  form.api_key.value = "";
  form.timeout_seconds.value = String(configuration.timeout_seconds);
  form.max_context_chars.value = String(configuration.max_context_chars);
  form.max_output_tokens.value = String(configuration.max_output_tokens);
  form.system_prompt.value = configuration.system_prompt;
  form.enabled.checked = configuration.enabled;
  form.access_mode.value = configuration.access_mode || "all";

  const status = byId("commentAgentStatus");
  status.textContent = configuration.configured
    ? "已启用"
    : configuration.enabled
      ? "配置不完整"
      : "已停用";
  status.dataset.status = configuration.configured ? "ready" : "idle";
  byId("commentAgentKeyStatus").textContent = configuration.api_key_set
    ? "API Key 已加密保存；留空不会覆盖。"
    : "尚未保存 API Key。";
  byId("commentAgentWhitelistSearch").value = "";
  renderCommentAgentWhitelist();
  renderCommentAgentUsage(usage || []);
  syncCommentAgentState();
}

function applyCommentAgentTemplate() {
  const form = byId("commentAgentForm");
  const template = state.commentAgentTemplates.find(
    (item) => item.id === form.provider.value
  );
  if (!template || template.id === "custom") return;
  form.protocol.value = template.protocol;
  form.base_url.value = template.base_url;
  form.model.value = template.model;
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
  byId("settingsForm").session_idle_days.value =
    String(data.settings.session_idle_days);
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
  byId("visualSettingsForm").home_star_render_mode.value =
    data.settings.home_star_render_mode || "2d";
  byId("visualSettingsForm").home_star_experience_mode.value =
    data.settings.home_star_experience_mode || "immersive";
  byId("visualSettingsForm").home_star_portal_collapsed_structure.value =
    data.settings.home_star_portal_collapsed_structure || "octahedron";
  byId("visualSettingsForm").home_star_portal_expanded_structure.value =
    data.settings.home_star_portal_expanded_structure || "3d-drift";
  byId("visualSettingsForm").home_star_portal_rotation_speed.value =
    String(data.settings.home_star_portal_rotation_speed);
  byId("visualSettingsForm").home_star_portal_size_percent.value =
    String(data.settings.home_star_portal_size_percent);
  byId("visualSettingsForm").home_star_portal_brightness_percent.value =
    String(data.settings.home_star_portal_brightness_percent);
  byId("visualSettingsForm").home_star_relation_visibility.value =
    data.settings.home_star_relation_visibility;
  byId("visualSettingsForm").home_star_strong_relation_style.value =
    data.settings.home_star_strong_relation_style;
  byId("visualSettingsForm").home_star_reference_relation_style.value =
    data.settings.home_star_reference_relation_style;
  byId("visualSettingsForm").home_star_contributor_relation_style.value =
    data.settings.home_star_contributor_relation_style;
  byId("visualSettingsForm").home_star_hover_info_enabled.checked =
    data.settings.home_star_hover_info_enabled;
  byId("visualSettingsForm").home_star_hover_relations_enabled.checked =
    data.settings.home_star_hover_relations_enabled;
  byId(
    "visualSettingsForm"
  ).home_star_hover_relation_opacity_percent.value =
    String(data.settings.home_star_hover_relation_opacity_percent);
  byId("visualSettingsForm").home_star_hover_relation_limit.value =
    String(data.settings.home_star_hover_relation_limit);
  byId("visualSettingsForm").home_star_graph_direction.value =
    data.settings.home_star_graph_direction;
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
  byId("visualSettingsForm").home_star_selected_radius_boost.value =
    String(data.settings.home_star_selected_radius_boost);
  byId("visualSettingsForm").home_star_selected_alpha_boost.value =
    String(data.settings.home_star_selected_alpha_boost);
  byId("visualSettingsForm").home_star_selected_halo_alpha_boost.value =
    String(data.settings.home_star_selected_halo_alpha_boost);
  byId("visualSettingsForm").home_star_selected_glow_scale.value =
    String(data.settings.home_star_selected_glow_scale);
  byId(
    "visualSettingsForm"
  ).home_star_selected_contributor_line_width.value =
    String(data.settings.home_star_selected_contributor_line_width);
  byId("visualSettingsForm").home_star_3d_min_depth.value =
    String(data.settings.home_star_3d_min_depth);
  byId("visualSettingsForm").home_star_3d_halo_max_css_size.value =
    String(data.settings.home_star_3d_halo_max_css_size);
  byId("visualSettingsForm").home_star_3d_core_max_css_size.value =
    String(data.settings.home_star_3d_core_max_css_size);
  byId("visualSettingsForm").home_star_3d_spike_max_css_size.value =
    String(data.settings.home_star_3d_spike_max_css_size);
  byId("visualSettingsForm").home_star_3d_pulse_max_css_size.value =
    String(data.settings.home_star_3d_pulse_max_css_size);
  byId("visualSettingsForm").home_star_3d_field_enabled.checked =
    data.settings.home_star_3d_field_enabled;
  byId("visualSettingsForm").home_star_3d_field_star_count.value =
    String(data.settings.home_star_3d_field_star_count);
  byId("visualSettingsForm").home_star_3d_dust_enabled.checked =
    data.settings.home_star_3d_dust_enabled;
  byId("visualSettingsForm").home_star_3d_dust_star_count.value =
    String(data.settings.home_star_3d_dust_star_count);
  byId("visualSettingsForm").home_star_3d_cluster_enabled.checked =
    data.settings.home_star_3d_cluster_enabled;
  byId("visualSettingsForm").home_star_3d_cluster_star_count.value =
    String(data.settings.home_star_3d_cluster_star_count);
  byId("visualSettingsForm").home_star_3d_stream_enabled.checked =
    data.settings.home_star_3d_stream_enabled;
  byId("visualSettingsForm").home_star_3d_stream_star_count.value =
    String(data.settings.home_star_3d_stream_star_count);
  byId("visualSettingsForm").home_star_3d_nebula_enabled.checked =
    data.settings.home_star_3d_nebula_enabled;
  byId("visualSettingsForm").home_star_3d_nebula_star_count.value =
    String(data.settings.home_star_3d_nebula_star_count);
  byId(
    "visualSettingsForm"
  ).home_star_3d_background_brightness_percent.value =
    String(data.settings.home_star_3d_background_brightness_percent);
  byId("visualSettingsForm").home_star_3d_dust_brightness_percent.value =
    String(data.settings.home_star_3d_dust_brightness_percent);
  byId("visualSettingsForm").home_star_3d_background_size_percent.value =
    String(data.settings.home_star_3d_background_size_percent);
  byId("visualSettingsForm").home_star_3d_structure_motion_percent.value =
    String(data.settings.home_star_3d_structure_motion_percent);
  byId("visualSettingsForm").home_star_brightness_variation_enabled.checked =
    data.settings.home_star_brightness_variation_enabled;
  byId("visualSettingsForm").home_star_brightness_min.value =
    String(data.settings.home_star_brightness_min);
  byId("visualSettingsForm").home_star_brightness_initial.value =
    String(data.settings.home_star_brightness_initial);
  byId("visualSettingsForm").home_star_brightness_max.value =
    String(data.settings.home_star_brightness_max);
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
  ).map((rule) => ({ ...rule }));
  state.starBrightnessTiers = (
    data.settings.home_star_brightness_tiers || []
  ).map((tier) => ({ ...tier }));
  renderStarBrightnessRules();
  renderStarBrightnessTiers();
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
  renderAnalytics(data.analytics);
  renderSiteUpdate(data.site_update);
  renderPendingSubmissions(
    data.submissions,
    data.external_pull_requests,
    data.settings.pr_auto_close_days
  );
  renderSmtp(data.smtp, data.smtp_templates);
  renderCommentAgent(
    data.comment_agent,
    data.comment_agent_templates,
    data.users,
    data.comment_agent_usage
  );
  renderIntegrations(data.settings);
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
        session_idle_days: Number(
          event.currentTarget.session_idle_days.value
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
  if (state.starBrightnessRules.length >= 50) return;
  state.starBrightnessRules.push({
    id: createConfigurationId("rule"),
    name: "新亮度规则",
    enabled: true,
    target: "document",
    formula: "current_brightness"
  });
  renderStarBrightnessRules();
});

byId("addStarBrightnessTier").addEventListener("click", () => {
  if (state.starBrightnessTiers.length >= 20) return;
  const highestThreshold = state.starBrightnessTiers.reduce(
    (value, tier) => Math.max(value, Number(tier.min_brightness) || 0),
    0
  );
  const used = new Set(
    state.starBrightnessTiers.map((tier) => Number(tier.min_brightness))
  );
  let threshold = Math.min(100, highestThreshold + 10);
  while (threshold >= 0 && used.has(threshold)) threshold -= 0.5;
  if (threshold < 0) return;
  state.starBrightnessTiers.push({
    id: createConfigurationId("tier"),
    name: "新星体等级",
    min_brightness: threshold
  });
  renderStarBrightnessTiers();
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
        home_star_render_mode: form.home_star_render_mode.value,
        home_star_experience_mode:
          form.home_star_experience_mode.value,
        home_star_portal_collapsed_structure:
          form.home_star_portal_collapsed_structure.value,
        home_star_portal_expanded_structure:
          form.home_star_portal_expanded_structure.value,
        home_star_portal_rotation_speed: Number(
          form.home_star_portal_rotation_speed.value
        ),
        home_star_portal_size_percent: Number(
          form.home_star_portal_size_percent.value
        ),
        home_star_portal_brightness_percent: Number(
          form.home_star_portal_brightness_percent.value
        ),
        home_star_relation_visibility:
          form.home_star_relation_visibility.value,
        home_star_strong_relation_style:
          form.home_star_strong_relation_style.value,
        home_star_reference_relation_style:
          form.home_star_reference_relation_style.value,
        home_star_contributor_relation_style:
          form.home_star_contributor_relation_style.value,
        home_star_hover_info_enabled:
          form.home_star_hover_info_enabled.checked,
        home_star_hover_relations_enabled:
          form.home_star_hover_relations_enabled.checked,
        home_star_hover_relation_opacity_percent: Number(
          form.home_star_hover_relation_opacity_percent.value
        ),
        home_star_hover_relation_limit: Number(
          form.home_star_hover_relation_limit.value
        ),
        home_star_graph_direction:
          form.home_star_graph_direction.value,
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
        home_star_selected_radius_boost: Number(
          form.home_star_selected_radius_boost.value
        ),
        home_star_selected_alpha_boost: Number(
          form.home_star_selected_alpha_boost.value
        ),
        home_star_selected_halo_alpha_boost: Number(
          form.home_star_selected_halo_alpha_boost.value
        ),
        home_star_selected_glow_scale: Number(
          form.home_star_selected_glow_scale.value
        ),
        home_star_selected_contributor_line_width: Number(
          form.home_star_selected_contributor_line_width.value
        ),
        home_star_3d_min_depth: Number(
          form.home_star_3d_min_depth.value
        ),
        home_star_3d_halo_max_css_size: Number(
          form.home_star_3d_halo_max_css_size.value
        ),
        home_star_3d_core_max_css_size: Number(
          form.home_star_3d_core_max_css_size.value
        ),
        home_star_3d_spike_max_css_size: Number(
          form.home_star_3d_spike_max_css_size.value
        ),
        home_star_3d_pulse_max_css_size: Number(
          form.home_star_3d_pulse_max_css_size.value
        ),
        home_star_3d_field_enabled:
          form.home_star_3d_field_enabled.checked,
        home_star_3d_field_star_count: Number(
          form.home_star_3d_field_star_count.value
        ),
        home_star_3d_dust_enabled:
          form.home_star_3d_dust_enabled.checked,
        home_star_3d_dust_star_count: Number(
          form.home_star_3d_dust_star_count.value
        ),
        home_star_3d_cluster_enabled:
          form.home_star_3d_cluster_enabled.checked,
        home_star_3d_cluster_star_count: Number(
          form.home_star_3d_cluster_star_count.value
        ),
        home_star_3d_stream_enabled:
          form.home_star_3d_stream_enabled.checked,
        home_star_3d_stream_star_count: Number(
          form.home_star_3d_stream_star_count.value
        ),
        home_star_3d_nebula_enabled:
          form.home_star_3d_nebula_enabled.checked,
        home_star_3d_nebula_star_count: Number(
          form.home_star_3d_nebula_star_count.value
        ),
        home_star_3d_background_brightness_percent: Number(
          form.home_star_3d_background_brightness_percent.value
        ),
        home_star_3d_dust_brightness_percent: Number(
          form.home_star_3d_dust_brightness_percent.value
        ),
        home_star_3d_background_size_percent: Number(
          form.home_star_3d_background_size_percent.value
        ),
        home_star_3d_structure_motion_percent: Number(
          form.home_star_3d_structure_motion_percent.value
        ),
        home_star_brightness_variation_enabled:
          form.home_star_brightness_variation_enabled.checked,
        home_star_brightness_min: Number(
          form.home_star_brightness_min.value
        ),
        home_star_brightness_initial: Number(
          form.home_star_brightness_initial.value
        ),
        home_star_brightness_max: Number(
          form.home_star_brightness_max.value
        ),
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
        home_star_brightness_rules: state.starBrightnessRules,
        home_star_brightness_tiers: state.starBrightnessTiers,
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
      home_star_render_mode: saved.home_star_render_mode,
      home_star_experience_mode:
        saved.home_star_experience_mode,
      home_star_portal_collapsed_structure:
        saved.home_star_portal_collapsed_structure,
      home_star_portal_expanded_structure:
        saved.home_star_portal_expanded_structure,
      home_star_portal_rotation_speed:
        saved.home_star_portal_rotation_speed,
      home_star_portal_size_percent:
        saved.home_star_portal_size_percent,
      home_star_portal_brightness_percent:
        saved.home_star_portal_brightness_percent,
      home_star_relation_visibility: saved.home_star_relation_visibility,
      home_star_strong_relation_style:
        saved.home_star_strong_relation_style,
      home_star_reference_relation_style:
        saved.home_star_reference_relation_style,
      home_star_contributor_relation_style:
        saved.home_star_contributor_relation_style,
      home_star_hover_info_enabled:
        saved.home_star_hover_info_enabled,
      home_star_hover_relations_enabled:
        saved.home_star_hover_relations_enabled,
      home_star_hover_relation_opacity_percent:
        saved.home_star_hover_relation_opacity_percent,
      home_star_hover_relation_limit:
        saved.home_star_hover_relation_limit,
      home_star_graph_direction:
        saved.home_star_graph_direction,
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
      home_star_selected_radius_boost:
        saved.home_star_selected_radius_boost,
      home_star_selected_alpha_boost:
        saved.home_star_selected_alpha_boost,
      home_star_selected_halo_alpha_boost:
        saved.home_star_selected_halo_alpha_boost,
      home_star_selected_glow_scale:
        saved.home_star_selected_glow_scale,
      home_star_selected_contributor_line_width:
        saved.home_star_selected_contributor_line_width,
      home_star_3d_min_depth:
        saved.home_star_3d_min_depth,
      home_star_3d_halo_max_css_size:
        saved.home_star_3d_halo_max_css_size,
      home_star_3d_core_max_css_size:
        saved.home_star_3d_core_max_css_size,
      home_star_3d_spike_max_css_size:
        saved.home_star_3d_spike_max_css_size,
      home_star_3d_pulse_max_css_size:
        saved.home_star_3d_pulse_max_css_size,
      home_star_3d_field_enabled:
        saved.home_star_3d_field_enabled,
      home_star_3d_field_star_count:
        saved.home_star_3d_field_star_count,
      home_star_3d_dust_enabled:
        saved.home_star_3d_dust_enabled,
      home_star_3d_dust_star_count:
        saved.home_star_3d_dust_star_count,
      home_star_3d_cluster_enabled:
        saved.home_star_3d_cluster_enabled,
      home_star_3d_cluster_star_count:
        saved.home_star_3d_cluster_star_count,
      home_star_3d_stream_enabled:
        saved.home_star_3d_stream_enabled,
      home_star_3d_stream_star_count:
        saved.home_star_3d_stream_star_count,
      home_star_3d_nebula_enabled:
        saved.home_star_3d_nebula_enabled,
      home_star_3d_nebula_star_count:
        saved.home_star_3d_nebula_star_count,
      home_star_3d_background_brightness_percent:
        saved.home_star_3d_background_brightness_percent,
      home_star_3d_dust_brightness_percent:
        saved.home_star_3d_dust_brightness_percent,
      home_star_3d_background_size_percent:
        saved.home_star_3d_background_size_percent,
      home_star_3d_structure_motion_percent:
        saved.home_star_3d_structure_motion_percent,
      home_star_brightness_variation_enabled:
        saved.home_star_brightness_variation_enabled,
      home_star_brightness_min:
        saved.home_star_brightness_min,
      home_star_brightness_initial:
        saved.home_star_brightness_initial,
      home_star_brightness_max:
        saved.home_star_brightness_max,
      home_star_brightness_variation_amount:
        saved.home_star_brightness_variation_amount,
      home_star_brightness_transition_ms:
        saved.home_star_brightness_transition_ms,
      home_star_brightness_interval_ms:
        saved.home_star_brightness_interval_ms,
      home_star_color_random_enabled:
        saved.home_star_color_random_enabled,
      home_star_brightness_rules: saved.home_star_brightness_rules,
      home_star_brightness_tiers: saved.home_star_brightness_tiers
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

byId("commentAgentProvider").addEventListener(
  "change",
  applyCommentAgentTemplate
);

byId("commentAgentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = byId("saveCommentAgentButton");
  button.disabled = true;
  commentAgentFeedback("");
  try {
    const configuration = await api("/admin/comment-agent", {
      method: "PUT",
      body: JSON.stringify({
        enabled: form.enabled.checked,
        provider: form.provider.value,
        protocol: form.protocol.value,
        base_url: form.base_url.value,
        api_key: form.api_key.value,
        model: form.model.value,
        timeout_seconds: Number(form.timeout_seconds.value),
        max_context_chars: Number(form.max_context_chars.value),
        max_output_tokens: Number(form.max_output_tokens.value),
        system_prompt: form.system_prompt.value,
        access_mode: form.access_mode.value,
        whitelist_user_ids: Array.from(state.commentAgentWhitelist)
      })
    });
    renderCommentAgent(
      configuration,
      state.commentAgentTemplates,
      state.commentAgentUsers,
      []
    );
    commentAgentFeedback("评论 Agent 配置已保存。", "success");
    await loadOverview();
  } catch (error) {
    commentAgentFeedback(error.message);
  } finally {
    button.disabled = false;
  }
});

byId("commentAgentForm").access_mode.addEventListener(
  "change",
  syncCommentAgentState
);
byId("commentAgentWhitelistSearch").addEventListener(
  "input",
  (event) => renderCommentAgentWhitelist(event.currentTarget.value)
);

byId("testCommentAgentButton").addEventListener("click", async () => {
  const button = byId("testCommentAgentButton");
  button.disabled = true;
  commentAgentFeedback("");
  try {
    const result = await api("/admin/comment-agent/test", {
      method: "POST"
    });
    commentAgentFeedback(
      `连接成功：${result.provider} / ${result.model}`,
      "success"
    );
  } catch (error) {
    commentAgentFeedback(error.message);
  } finally {
    button.disabled = !state.commentAgent?.configured;
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
  setupAdminNavigation();
  setupVisualSettingsNavigation();
  renderStarFormulaReference();
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
