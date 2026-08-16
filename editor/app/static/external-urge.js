(async function () {
  "use strict";

  const title = document.getElementById("urgeTitle");
  const message = document.getElementById("urgeMessage");
  const token = new URLSearchParams(window.location.search).get("token");

  if (!token) {
    title.textContent = "催办链接无效";
    message.textContent = "邮件链接缺少必要令牌，请使用最新邮件中的按钮。";
    return;
  }

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("token");
  window.history.replaceState({}, "", cleanUrl.pathname);

  try {
    const response = await fetch("../api/external-pr/urge", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const payload = await response.json().catch(function () {
      return {};
    });
    if (!response.ok) {
      throw new Error(payload.detail || `请求失败（HTTP ${response.status}）`);
    }
    title.textContent = `PR #${payload.pr_number} 已催办`;
    message.textContent = payload.message;
  } catch (error) {
    title.textContent = "暂时无法催办";
    message.textContent = error.message;
  }
})();
