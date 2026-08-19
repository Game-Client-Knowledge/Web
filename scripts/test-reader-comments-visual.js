const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright-core");

const baseUrl = process.env.VISUAL_BASE_URL || "http://127.0.0.1:8080";
const output = process.env.VISUAL_OUTPUT ||
  path.join(os.tmpdir(), "gck-reader-comments");
const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
].filter(Boolean).find(fs.existsSync);

if (!chrome) {
  throw new Error("Chrome or Chromium was not found");
}
fs.mkdirSync(output, { recursive: true });

async function inspect(browser, name, viewport) {
  const context = await browser.newContext({ viewport });
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };
  await context.route("**/api/bootstrap**", (route) => {
    route.fulfill({
      headers: corsHeaders,
      body: JSON.stringify({
        config: {},
        session: { authenticated: false },
        drafts: []
      })
    });
  });
  await context.route("**/api/comments?**", (route) => {
    route.fulfill({
      headers: corsHeaders,
      body: JSON.stringify({
        revision: { commit_sha: "a".repeat(40), line_count: 200 },
        authors: [
          {
            start_line: 1,
            end_line: 200,
            commit: "a".repeat(40),
            author: {
              name: "sourcecode",
              github_login: "sourcecode",
              user_id: 1
            }
          }
        ],
        comments: [
          {
            id: 1,
            path: "program/knowledge/cpp/01-cpp98.md",
            revision_sha: "a".repeat(40),
            start_line: 1,
            end_line: 2,
            start_column: 0,
            end_column: 12,
            quote: "C++ 98 基础",
            render_segments: [],
            body: "@Agent 请解释这段内容。",
            body_html: "<p><strong>@Agent</strong> 请解释这段内容。</p>",
            parent_id: null,
            reply_to_id: null,
            author: {
              id: 2,
              username: "reader",
              github_login: null,
              is_agent: false
            },
            mentions: [],
            agent_status: "completed",
            agent_error: null,
            can_delete: true,
            created_at: "2026-08-19T08:00:00+00:00",
            updated_at: "2026-08-19T08:00:00+00:00"
          },
          {
            id: 2,
            path: "program/knowledge/cpp/01-cpp98.md",
            revision_sha: "a".repeat(40),
            start_line: 1,
            end_line: 2,
            start_column: 0,
            end_column: 12,
            quote: "C++ 98 基础",
            render_segments: [],
            body: "这段内容介绍了 C++ 98 的核心语言基础。",
            body_html: "<p>这段内容介绍了 <code>C++ 98</code> 的核心语言基础。</p>",
            parent_id: 1,
            reply_to_id: 1,
            author: {
              id: -1,
              username: "Agent",
              github_login: null,
              is_agent: true
            },
            mentions: [],
            agent_status: null,
            agent_error: null,
            can_delete: false,
            created_at: "2026-08-19T08:00:01+00:00",
            updated_at: "2026-08-19T08:00:01+00:00"
          }
        ],
        sync_cursor: 2,
        can_comment: false
      })
    });
  });
  await context.route("**/api/comments/updates?**", (route) => {
    route.fulfill({ status: 204, headers: corsHeaders });
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/knowledge/cpp/01-cpp98/`, {
    waitUntil: "networkidle"
  });
  await page.locator("[data-comments-toggle]").click();
  await page.locator("[data-comments-panel]").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "1 条回复" }).click();
  const layout = await page.evaluate(() => {
    const panel = document.querySelector("[data-comments-panel]");
    const rectangle = panel.getBoundingClientRect();
    return {
      panelWidth: rectangle.width,
      panelRight: rectangle.right,
      panelPosition: getComputedStyle(panel).position,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      commentGroups: document.querySelectorAll(".comment-group").length,
      authorLabels: document.querySelectorAll(".reader-author-label").length,
      agentBadges: document.querySelectorAll(".comment-agent-badge").length,
      agentReplies: document.querySelectorAll(
        ".comment-reply.is-agent"
      ).length,
      agentStatuses: document.querySelectorAll(
        ".comment-agent-status"
      ).length,
      markdownStrong: document.querySelectorAll(
        ".comment-body strong"
      ).length,
      deleteButtons: document.querySelectorAll(
        ".comment-delete"
      ).length
    };
  });
  if (layout.panelWidth < 280) {
    throw new Error(`${name}: comment pane is too narrow`);
  }
  if (
    layout.panelRight > layout.viewportWidth + 1 ||
    layout.documentWidth > layout.viewportWidth
  ) {
    throw new Error(`${name}: horizontal overflow ${JSON.stringify(layout)}`);
  }
  if (viewport.width <= 900 && layout.panelPosition !== "fixed") {
    throw new Error(`${name}: mobile pane is not fixed`);
  }
  if (viewport.width > 900 && layout.panelPosition === "fixed") {
    throw new Error(`${name}: desktop pane should participate in layout`);
  }
  if (layout.authorLabels < 1) {
    throw new Error(`${name}: line authors are not visible`);
  }
  if (
    layout.agentBadges !== 1 ||
    layout.agentReplies !== 1 ||
    layout.agentStatuses !== 1 ||
    layout.markdownStrong !== 1 ||
    layout.deleteButtons !== 1
  ) {
    throw new Error(`${name}: Agent thread is incomplete`);
  }
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage: false
  });
  console.log(`${name}: ${JSON.stringify(layout)}`);
  await context.close();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--disable-extensions"]
  });
  await inspect(browser, "comments-desktop", { width: 1440, height: 1000 });
  await inspect(browser, "comments-mobile", { width: 390, height: 844 });
  await browser.close();
  console.log(`Screenshots: ${output}`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
