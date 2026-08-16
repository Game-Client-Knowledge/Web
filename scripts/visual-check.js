const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright-core");

const baseUrl = process.env.VISUAL_BASE_URL || "http://127.0.0.1:8080";
const outputDirectory =
  process.env.VISUAL_OUTPUT || path.join(os.tmpdir(), "gck-visual-check");
const executableCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
].filter(Boolean);
const executablePath = executableCandidates.find(fs.existsSync);
const errors = [];

if (!executablePath) {
  console.error("Chrome or Chromium was not found. Set CHROME_PATH.");
  process.exit(1);
}

fs.mkdirSync(outputDirectory, { recursive: true });

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

async function inspectPage(browser, scenario) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    deviceScaleFactor: 1,
    colorScheme: "light"
  });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto(`${baseUrl}${scenario.route}`, { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(outputDirectory, `${scenario.name}.png`),
    fullPage: false
  });

  const layout = await page.evaluate(() => {
    const offenders = Array.from(document.querySelectorAll("body *"))
      .filter((element) => {
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.position === "fixed" ||
          element.closest("dialog:not([open])")
        ) {
          return false;
        }
        const rectangle = element.getBoundingClientRect();
        return rectangle.right > innerWidth + 1 || rectangle.left < -1;
      })
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName.toLocaleLowerCase(),
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
        left: Math.round(element.getBoundingClientRect().left)
      }));

    return {
      viewportWidth: innerWidth,
      bodyWidth: document.body.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      h1: document.querySelector("h1")?.textContent.trim(),
      offenders
    };
  });

  assert(
    layout.bodyWidth <= layout.viewportWidth &&
      layout.documentWidth <= layout.viewportWidth,
    `${scenario.name}: horizontal overflow ${JSON.stringify(layout)}`
  );
  assert(layout.h1, `${scenario.name}: missing H1`);
  assert(
    runtimeErrors.length === 0,
    `${scenario.name}: browser errors: ${runtimeErrors.join(" | ")}`
  );

  if (scenario.knowledgeField) {
    const field = await page.locator("[data-knowledge-field]").evaluate(
      (canvas) => {
        const context = canvas.getContext("2d");
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        ).data;
        let painted = 0;
        for (let index = 3; index < pixels.length; index += 16) {
          if (pixels[index] > 0) painted += 1;
        }
        const catalogTop = document
          .querySelector(".catalog-overview")
          .getBoundingClientRect().top;
        return { painted, catalogTop, viewportHeight: innerHeight };
      }
    );
    assert(
      field.painted > 100,
      `${scenario.name}: knowledge field is blank`
    );
    assert(
      field.catalogTop < field.viewportHeight,
      `${scenario.name}: catalog is not visible below the hero`
    );
  }

  if (scenario.search) {
    await page.locator("[data-open-search]").first().click();
    await page.locator("[data-search-input]").fill("移动构造");
    await page.waitForFunction(() => {
      return document.querySelectorAll(".search-result").length > 0;
    });
    const resultCount = await page.locator(".search-result").count();
    assert(resultCount >= 2, `${scenario.name}: search returned ${resultCount} results`);
  }

  if (scenario.mobileSidebar) {
    await page.locator("[data-open-docs]").click();
    assert(
      await page.locator(".docs-sidebar").evaluate((element) => {
        return element.classList.contains("is-open");
      }),
      `${scenario.name}: mobile document sidebar did not open`
    );
  }

  if (scenario.mermaid) {
    await page.locator(".mermaid svg").waitFor({ state: "visible" });
    const diagramCount = await page.locator(".mermaid svg").count();
    assert(diagramCount > 0, `${scenario.name}: Mermaid did not render`);
  }

  if (scenario.source) {
    const sourceLength = await page.locator("[data-source-code]").textContent();
    assert(
      sourceLength && sourceLength.length > 100,
      `${scenario.name}: source viewer is empty`
    );
  }

  console.log(
    `${scenario.name}: ${scenario.viewport.width}x${scenario.viewport.height}, ` +
      `body ${layout.bodyWidth}px, H1 "${layout.h1}"`
  );
  await context.close();
}

(async () => {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-extensions"]
  });

  const scenarios = [
    {
      name: "home-desktop",
      route: "/",
      viewport: { width: 1440, height: 1000 },
      search: true,
      knowledgeField: true
    },
    {
      name: "home-mobile",
      route: "/",
      viewport: { width: 390, height: 844 },
      knowledgeField: true
    },
    {
      name: "contribute-desktop",
      route: "/contribute/",
      viewport: { width: 1440, height: 1000 }
    },
    {
      name: "contribute-mobile",
      route: "/contribute/",
      viewport: { width: 390, height: 844 }
    },
    {
      name: "article-tablet",
      route: "/interviews/mihoyo/2026-autumn-early-game-client-source-code/04-third-round-answers/",
      viewport: { width: 1024, height: 900 }
    },
    {
      name: "article-mobile",
      route: "/knowledge/ecs/01-fundamentals/",
      viewport: { width: 390, height: 844 },
      mobileSidebar: true
    },
    {
      name: "mermaid-desktop",
      route: "/knowledge/ecs/",
      viewport: { width: 1440, height: 1000 },
      mermaid: true
    },
    {
      name: "source-desktop",
      route: "/examples/algorithms/mihoyo-third-round/files/main.cpp/",
      viewport: { width: 1440, height: 1000 },
      source: true
    }
  ];

  for (const scenario of scenarios) {
    await inspectPage(browser, scenario);
  }

  await browser.close();

  console.log(`Screenshots: ${outputDirectory}`);
  console.log(`Errors: ${errors.length}`);
  for (const error of errors) {
    console.error(`ERROR ${error}`);
  }
  if (errors.length > 0) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
