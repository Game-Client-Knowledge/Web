const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");

const baseUrl =
  process.env.HOME_CONTENT_BASE_URL || "http://127.0.0.1:8088";
const outputDirectory =
  process.env.HOME_CONTENT_VISUAL_OUTPUT ||
  path.join(os.tmpdir(), "gck-home-content");
const executablePath = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
].filter(Boolean).find(fs.existsSync);

if (!executablePath) {
  throw new Error("Chrome or Chromium was not found. Set CHROME_PATH.");
}
fs.mkdirSync(outputDirectory, { recursive: true });

const scenarios = [
  {
    name: "desktop",
    viewport: { width: 1440, height: 1000 }
  },
  {
    name: "mobile",
    viewport: { width: 390, height: 844 }
  }
];

async function runScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    reducedMotion: "reduce"
  });
  const visualSettings = {
    home_intro_enabled: false,
    home_intro_mode: "off",
    home_background_style: "contribution_star_map",
    home_star_scope: "full",
    home_content_mask_enabled: false,
    home_content_idle_timeout_seconds: 1
  };
  await context.addInitScript((settings) => {
    localStorage.setItem(
      "gck-home-intro-settings",
      JSON.stringify(settings)
    );
    if (!sessionStorage.getItem("gck-home-content-test-ready")) {
      localStorage.removeItem("gck-home-content-hidden:v1");
      sessionStorage.setItem("gck-home-content-test-ready", "1");
    }
  }, visualSettings);
  await context.route("**/editor/api/bootstrap**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        config: visualSettings,
        session: { authenticated: false },
        drafts: []
      })
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text() !== "Failed to load resource: net::ERR_FAILED"
    ) {
      errors.push(message.text());
    }
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body.home-content-unmasked");
  const toggle = page.locator("[data-home-content-toggle]");
  await toggle.waitFor({ state: "visible" });

  const unmasked = await page.evaluate(() => {
    const background = (selector) =>
      getComputedStyle(document.querySelector(selector)).backgroundColor;
    return {
      mask: document.body.dataset.homeContentMask,
      hero: background(".library-intro"),
      ledger: background(".contribution-ledger"),
      card: background(".track-overview-card"),
      footer: background(".site-footer"),
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    };
  });
  assert.equal(unmasked.mask, "off");
  assert.deepEqual(
    [unmasked.hero, unmasked.ledger, unmasked.card, unmasked.footer],
    Array(4).fill("rgba(0, 0, 0, 0)")
  );
  assert.equal(unmasked.overflow, 0);

  await page.waitForSelector("body.home-content-idle-hidden", {
    timeout: 3000
  });
  const idleState = await page.evaluate(() => ({
    reason: document.body.dataset.homeContentReason,
    persisted: localStorage.getItem("gck-home-content-hidden:v1")
  }));
  assert.equal(idleState.reason, "idle");
  assert.notEqual(idleState.persisted, "1");
  await page.mouse.move(80, 80);
  await page.waitForSelector("body:not(.home-content-hidden)");

  await toggle.click();
  await page.waitForSelector("body.home-content-hidden");
  await page.mouse.move(120, 120);
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator("body.home-content-hidden").count(),
    1,
    "pointer movement must not override a manual hide"
  );
  const hidden = await page.evaluate(() => ({
    label: document
      .querySelector("[data-home-content-toggle]")
      .getAttribute("aria-label"),
    pressed: document
      .querySelector("[data-home-content-toggle]")
      .getAttribute("aria-pressed"),
    header: getComputedStyle(document.querySelector(".site-header")).display,
    catalog: getComputedStyle(
      document.querySelector(".catalog-overview")
    ).display,
    footer: getComputedStyle(document.querySelector(".site-footer")).display,
    height: document.body.getBoundingClientRect().height,
    viewport: window.innerHeight,
    overflow:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  }));
  assert.equal(hidden.label, "显示主页内容");
  assert.equal(hidden.pressed, "true");
  assert.deepEqual(
    [hidden.header, hidden.catalog, hidden.footer],
    ["none", "none", "none"]
  );
  assert.equal(hidden.height, hidden.viewport);
  assert.equal(hidden.overflow, 0);
  await page.screenshot({
    path: path.join(outputDirectory, `${scenario.name}-hidden.png`)
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("body.home-content-hidden");
  await page
    .locator("[data-home-content-toggle]")
    .waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".site-entry-sequence").count(),
    0,
    "hidden content must not leave the entry sequence active"
  );
  await page.locator("[data-home-content-toggle]").click();
  await page.waitForSelector("body:not(.home-content-hidden)");

  await page.evaluate((settings) => {
    window.dispatchEvent(
      new CustomEvent("gck:visual-settings", {
        detail: {
          ...settings,
          home_content_mask_enabled: true,
          home_content_idle_timeout_seconds: 0
        }
      })
    );
  }, visualSettings);
  await page.waitForSelector("body.home-content-masked");
  await page.waitForTimeout(250);
  const masked = await page.evaluate(() => ({
    mask: document.body.dataset.homeContentMask,
    bodyClass: document.body.className,
    card: getComputedStyle(
      document.querySelector(".track-overview-card")
    ).backgroundColor
  }));
  assert.equal(masked.mask, "on");
  assert.notEqual(
    masked.card,
    "rgba(0, 0, 0, 0)",
    JSON.stringify(masked)
  );
  assert.deepEqual(errors, []);
  await context.close();
}

(async () => {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-gpu"]
  });
  try {
    for (const scenario of scenarios) {
      await runScenario(browser, scenario);
    }
  } finally {
    await browser.close();
  }
  process.stdout.write("Homepage content visual checks passed\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
