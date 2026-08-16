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
  const page = await context.newPage();
  await page.goto(`${baseUrl}/knowledge/cpp/01-cpp98/`, {
    waitUntil: "networkidle"
  });
  await page.locator("[data-comments-toggle]").click();
  await page.locator("[data-comments-panel]").waitFor({ state: "visible" });
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
      authorLabels: document.querySelectorAll(".reader-author-label").length
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
