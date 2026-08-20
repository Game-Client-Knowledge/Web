const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(
  path.join(root, "editor/app/static/admin.html"),
  "utf8"
);
const css = fs.readFileSync(
  path.join(root, "editor/app/static/editor.css"),
  "utf8"
);
const javascript = fs.readFileSync(
  path.join(root, "editor/app/static/admin.js"),
  "utf8"
);
const commentAgentConfig = fs.readFileSync(
  path.join(root, "editor/app/comment_agent_config.py"),
  "utf8"
);

for (const target of [
  "overview",
  "editing",
  "publishing",
  "visuals",
  "contributions",
  "email",
  "access",
  "users"
]) {
  assert.match(html, new RegExp(`href="#${target}"`));
  assert.match(html, new RegExp(`id="${target}"`));
}
assert.equal(
  (html.match(/class="[^"]*\badmin-panel\b[^"]*"/g) || []).length,
  8
);
assert.equal(
  (html.match(/data-visual-panel-target=/g) || []).length,
  4
);
assert.equal(
  (html.match(/data-visual-panel=/g) || []).length,
  4
);

assert.match(html, /class="admin-layout"/);
assert.match(html, /class="admin-sidebar"/);
assert.match(html, /class="admin-content"/);
assert.match(html, /class="analytics-details"/);
assert.doesNotMatch(
  html,
  /<details class="analytics-details"\s+open/,
  "the long analytics trend must be collapsed by default"
);

for (const legend of [
  "基础外观",
  "关系与点亮",
  "星体亮度",
  "入场动画"
]) {
  assert.match(html, new RegExp(`<legend>${legend}</legend>`));
}
assert.equal(
  (html.match(/class="visual-group"/g) || []).length,
  4
);
assert.match(html, /class="visual-form-actions"/);
assert.match(html, /name="session_idle_days"/);
assert.match(html, /name="home_star_brightness_min"/);
assert.match(html, /name="home_star_experience_mode"/);
assert.match(html, /贡献空间（试点）/);
for (const field of [
  "home_star_selected_radius_boost",
  "home_star_selected_alpha_boost",
  "home_star_selected_halo_alpha_boost",
  "home_star_selected_glow_scale",
  "home_star_selected_contributor_line_width",
  "home_star_portal_collapsed_structure",
  "home_star_portal_expanded_structure",
  "home_star_portal_rotation_speed",
  "home_star_portal_size_percent",
  "home_star_portal_brightness_percent",
  "home_star_3d_min_depth",
  "home_star_3d_halo_max_css_size",
  "home_star_3d_core_max_css_size",
  "home_star_3d_spike_max_css_size",
  "home_star_3d_pulse_max_css_size"
]) {
  assert.match(html, new RegExp(`name="${field}"`));
}
assert.match(html, /主动点亮星体效果/);
assert.match(html, /<h3 id="contributionPortalTitle">贡献空间<\/h3>/);
assert.match(html, /自动旋转速率（°\/秒）/);
assert.match(html, /微缩结构/);
assert.match(html, /展开结构/);
assert.match(html, /3D 螺旋星系/);
assert.match(html, /3D 星云带/);
assert.match(html, /3D 星团/);
assert.match(html, /3D 分层星壳/);
assert.match(
  html,
  /3D 结构使用独立确定性快照，可与展开结构不同/
);
assert.match(html, /收拢尺寸（%）/);
assert.match(html, /收拢亮度（%）/);
assert.match(html, /主页空闲触发（秒，0 为关闭）/);
assert.match(html, /贡献空间模式自动展开/);
assert.match(html, /不修改逻辑亮度、等级或覆盖统计/);
assert.match(html, /3D 星体尺寸保护/);
assert.match(html, /高分辨率和近景透视/);
assert.ok(
  (html.match(/class="field-help"/g) || []).length >= 10,
  "star effect controls need inline descriptions"
);
assert.match(html, /id="starBrightnessRuleList"/);
assert.match(html, /id="starBrightnessTierList"/);
assert.match(html, /id="addStarBrightnessRule"/);
assert.match(html, /id="addStarBrightnessTier"/);
assert.match(html, /id="starFormulaVariableReference"/);
assert.match(html, /id="starFormulaFunctionReference"/);
assert.match(html, /star-formula-engine\.js/);
assert.match(
  html,
  /star-formula-engine\.js\?v=total-relations-v1/,
  "the admin formula engine URL must invalidate the pre-variable bundle"
);
assert.doesNotMatch(html, /star-formula-engine\.js\?v=2/);
assert.match(html, /id="commentAgentForm"/);
assert.match(html, /id="commentAgentProvider"/);
for (const field of [
  "protocol",
  "base_url",
  "api_key",
  "model",
  "timeout_seconds",
  "max_context_chars",
  "max_output_tokens",
  "system_prompt",
  "access_mode",
  "enabled"
]) {
  assert.match(
    html,
    new RegExp(
      `id="commentAgentForm"[\\s\\S]*name="${field}"`
    )
  );
}
assert.match(html, /id="commentAgentWhitelist"/);
assert.match(html, /id="commentAgentUsage"/);
for (const provider of [
  "ChatGPT",
  "DeepSeek",
  "Claude",
  "Kimi",
  "千问"
]) {
  assert.match(commentAgentConfig, new RegExp(provider));
}

assert.match(css, /\.admin-layout\s*\{[\s\S]*grid-template-columns:/);
assert.match(css, /\.admin-sidebar\s*\{[\s\S]*position:\s*sticky/);
assert.match(css, /\.admin-section-grid\s*\{/);
assert.match(css, /\.visual-group-grid\s*\{/);
assert.match(css, /\.admin-panel\[hidden\][\s\S]*display:\s*none/);
assert.match(css, /\.visual-settings-tabs\s*\{/);
assert.match(css, /\.star-variable-reference\s*\{/);
assert.match(css, /\.agent-grid\s*\{/);
assert.match(css, /\.agent-whitelist-list\s*\{/);
assert.match(
  css,
  /@media \(max-width: 900px\)[\s\S]*\.admin-layout\s*\{[\s\S]*display:\s*block/
);
assert.match(
  css,
  /@media \(max-width: 760px\)[\s\S]*\.visual-group-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/
);
assert.match(javascript, /function setupAdminNavigation\(\)/);
assert.match(javascript, /function setupVisualSettingsNavigation\(\)/);
assert.match(javascript, /function renderStarFormulaReference\(\)/);
assert.match(javascript, /starFormulaEngine\.validateFormula/);
assert.match(javascript, /home_star_brightness_tiers/);
assert.match(javascript, /home_star_3d_halo_max_css_size/);
assert.match(javascript, /home_star_experience_mode/);
assert.match(javascript, /home_star_portal_collapsed_structure/);
assert.match(javascript, /home_star_portal_expanded_structure/);
assert.match(javascript, /home_star_portal_rotation_speed/);
assert.match(javascript, /home_star_portal_size_percent/);
assert.match(javascript, /home_star_portal_brightness_percent/);
assert.match(javascript, /whitelist_user_ids/);
assert.match(javascript, /comment_agent_usage/);
assert.match(javascript, /aria-current.*page/);

console.log("Admin layout checks passed");
