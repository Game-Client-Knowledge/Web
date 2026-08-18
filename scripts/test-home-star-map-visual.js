const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");

const baseUrl =
  process.env.STAR_MAP_BASE_URL || "http://127.0.0.1:8088";
const outputDirectory =
  process.env.STAR_MAP_VISUAL_OUTPUT ||
  path.join(os.tmpdir(), "gck-home-star-map");
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
    name: "hero-desktop",
    viewport: { width: 1440, height: 1000 },
    scope: "hero"
  },
  {
    name: "full-desktop",
    viewport: { width: 1440, height: 1000 },
    scope: "full"
  },
  {
    name: "full-mobile",
    viewport: { width: 390, height: 844 },
    scope: "full"
  }
];

async function runScenario(browser, scenario) {
  const context = await browser.newContext({
    viewport: scenario.viewport,
    reducedMotion: "reduce"
  });
  const starSettings = {
    home_intro_enabled: false,
    home_intro_mode: "off",
    home_background_style: "contribution_star_map",
    home_star_scope: scenario.scope,
    home_star_relation_visibility: "near",
    home_star_strong_relation_style: "solid",
    home_star_reference_relation_style: "dashed",
    home_star_contributor_relation_style: "glow",
    home_star_brightness_variation_enabled: true,
    home_star_brightness_initial: 25,
    home_star_brightness_max: 100,
    home_star_brightness_variation_amount: 3,
    home_star_brightness_transition_ms: 500,
    home_star_brightness_interval_ms: 800,
    home_star_color_random_enabled: true,
    home_star_graph_direction: "directed",
    home_star_illumination_rule: "depth_contributor_terminal",
    home_star_illumination_depth: 2,
    home_star_active_edge_mode: "single_path",
    home_star_selection_duration_ms: 1000,
    home_star_label_duration_ms: 1800
  };
  await context.addInitScript((settings) => {
    localStorage.setItem(
      "gck-home-intro-settings",
      JSON.stringify(settings)
    );
  }, starSettings);
  await context.route("**/editor/api/bootstrap**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        config: starSettings,
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
      !message.text().includes("/editor/api/bootstrap") &&
      message.text() !== "Failed to load resource: net::ERR_FAILED"
    ) {
      errors.push(message.text());
    }
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(
    '[data-knowledge-field][data-star-map="contribution"]'
  );

  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector("[data-knowledge-field]");
    const context = canvas.getContext("2d");
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    let nonblank = 0;
    const stride = Math.max(4, Math.floor(image.data.length / 20000 / 4) * 4);
    for (let index = 3; index < image.data.length; index += stride) {
      if (image.data[index]) nonblank += 1;
    }
    const rectangle = canvas.getBoundingClientRect();
    return {
      bodyClass: document.body.className,
      map: canvas.dataset.starMap,
      scope: canvas.dataset.starScope,
      stars: Number(canvas.dataset.starCount),
      contributors: Number(canvas.dataset.contributorCount),
      documents: Number(canvas.dataset.documentCount),
      codeSystems: Number(canvas.dataset.codeSystemCount),
      edges: Number(canvas.dataset.edgeCount),
      illuminationRule: canvas.dataset.illuminationRule,
      illuminationDepth: Number(canvas.dataset.illuminationDepth),
      graphDirection: canvas.dataset.graphDirection,
      brightnessInitial: Number(canvas.dataset.brightnessInitial),
      brightnessMax: Number(canvas.dataset.brightnessMax),
      activeEdgeMode: canvas.dataset.activeEdgeMode,
      width: rectangle.width,
      height: rectangle.height,
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      nonblank
    };
  });

  assert.equal(metrics.map, "contribution");
  assert.equal(metrics.scope, scenario.scope);
  assert.ok(metrics.stars > 100, `${scenario.name}: too few stars`);
  assert.ok(
    metrics.contributors > 0 &&
      metrics.documents > metrics.contributors,
    `${scenario.name}: star kinds are invalid`
  );
  assert.ok(metrics.codeSystems > 0, `${scenario.name}: no code systems`);
  assert.ok(metrics.edges > metrics.stars, `${scenario.name}: too few edges`);
  assert.equal(metrics.illuminationRule, "depth_contributor_terminal");
  assert.equal(metrics.illuminationDepth, 2);
  assert.equal(metrics.graphDirection, "directed");
  assert.equal(metrics.brightnessInitial, 25);
  assert.equal(metrics.brightnessMax, 100);
  assert.equal(metrics.activeEdgeMode, "single_path");
  assert.ok(metrics.nonblank > 10, `${scenario.name}: canvas is blank`);
  assert.ok(metrics.overflow <= 1, `${scenario.name}: horizontal overflow`);
  assert.ok(
    scenario.scope === "full"
      ? Math.abs(metrics.height - scenario.viewport.height) <= 1
      : metrics.height < scenario.viewport.height,
    `${scenario.name}: canvas scope is invalid`
  );

  const baselineScreenshotPath = path.join(
    outputDirectory,
    `${scenario.name}-baseline.png`
  );
  await page.screenshot({
    path: baselineScreenshotPath,
    fullPage: false
  });

  const contributorPoint = await page.evaluate(() => {
    const canvas = document.querySelector("[data-knowledge-field]");
    const rectangle = canvas.getBoundingClientRect();
    const candidates = Array.from({ length: 4 }, (_, index) => {
      const angle =
        index * (Math.PI * (3 - Math.sqrt(5))) - Math.PI / 2;
      const radius =
        Math.min(rectangle.width, rectangle.height) *
        (0.2 + (index % 3) * 0.055);
      const x =
        rectangle.left + rectangle.width * 0.5 + Math.cos(angle) * radius;
      const y =
        rectangle.top + rectangle.height * 0.5 + Math.sin(angle) * radius;
      const target = document.elementFromPoint(x, y);
      return {
        x,
        y,
        interactive: Boolean(
          target?.closest(
            "a, button, input, select, textarea, summary, [role='button']"
          )
        )
      };
    });
    return candidates.find((point) => !point.interactive) || candidates[0];
  });
  await page.mouse.click(contributorPoint.x, contributorPoint.y);
  await page.waitForSelector(".star-coverage-panel:not([hidden])");
  const coverage = await page.locator(".star-coverage-panel").innerText();
  assert.match(coverage, /静星/);
  assert.match(coverage, /动星/);
  assert.match(coverage, /关系/);
  assert.match(coverage, /起点亮度/);
  const selectionMetrics = await page.evaluate(() => {
    const canvas = document.querySelector("[data-knowledge-field]");
    return {
      selected: Number(canvas.dataset.selectedCount),
      brightness: Number(canvas.dataset.selectedBrightness),
      coveredRelations: Number(canvas.dataset.selectedRelationCount),
      relationCoverage: Number(
        canvas.dataset.selectedRelationCoverage
      ),
      visualEdges: Number(canvas.dataset.activeVisualEdgeCount),
      totalEdges: Number(canvas.dataset.edgeCount)
    };
  });
  assert.ok(
    selectionMetrics.coveredRelations <= selectionMetrics.totalEdges
  );
  assert.ok(
    selectionMetrics.brightness > 0 &&
      selectionMetrics.brightness <= metrics.brightnessMax
  );
  if (selectionMetrics.selected > 100) {
    assert.ok(
      selectionMetrics.brightness >
        metrics.brightnessInitial + 30,
      `${scenario.name}: brightness curve did not use the configured range`
    );
  }
  assert.match(coverage, /\/ 100/);
  assert.equal(
    selectionMetrics.relationCoverage,
    selectionMetrics.totalEdges
      ? selectionMetrics.coveredRelations / selectionMetrics.totalEdges
      : 0
  );
  assert.ok(
    selectionMetrics.visualEdges <= selectionMetrics.coveredRelations
  );
  assert.ok(
    selectionMetrics.visualEdges <=
      Math.max(0, selectionMetrics.selected - 1)
  );
  if (selectionMetrics.selected > 3) {
    assert.ok(
      selectionMetrics.visualEdges <
        selectionMetrics.selected - 1,
      `${scenario.name}: single path did not prune tree branches`
    );
  }
  assert.ok(
    await page.locator(".star-map-label:not([hidden])").isVisible(),
    `${scenario.name}: contributor label is missing`
  );
  const selectedScreenshotPath = path.join(
    outputDirectory,
    `${scenario.name}-selected.png`
  );
  await page.screenshot({
    path: selectedScreenshotPath,
    fullPage: false
  });
  await page.waitForTimeout(1150);
  assert.equal(
    await page.locator(".star-coverage-panel").isVisible(),
    false,
    `${scenario.name}: relation graph did not expire`
  );
  assert.ok(
    await page.locator(".star-map-label:not([hidden])").isVisible(),
    `${scenario.name}: label expired with relation graph`
  );
  await page.waitForTimeout(800);
  assert.equal(
    await page.locator(".star-map-label").isVisible(),
    false,
    `${scenario.name}: label did not expire independently`
  );
  if (scenario.name === "hero-desktop") {
    const canonical = await page.evaluate(() => {
      const revision = window.GCK_CONFIG.contentVersion;
      window.dispatchEvent(
        new CustomEvent("gck:visual-settings", {
          detail: {
            home_intro_enabled: false,
            home_intro_mode: "off",
            home_background_style: "contribution_star_map",
            home_star_scope: "hero",
            home_star_relation_visibility: "near",
            home_star_graph_direction: "directed",
            home_star_brightness_initial: 25,
            home_star_brightness_max: 100,
            home_star_active_edge_mode: "single_path",
            home_star_illumination_rule:
              "depth_contributor_terminal",
            home_star_illumination_depth: 2,
            contribution_graph: {
              version: 2,
              revision,
              links: [
                {
                  path: "program/README.md",
                  contributor_id: "user:1",
                  contributor_name: "sourcecode",
                  commit_count: 2,
                  last_contributed_at: "2026-08-18T00:00:00Z"
                },
                {
                  path: "planning/README.md",
                  contributor_id: "user:1",
                  contributor_name: "sourcecode",
                  commit_count: 1,
                  last_contributed_at: "2026-08-18T00:00:00Z"
                },
                {
                  path:
                    "program/code/ecs/csharp-extensible-combat-ecs/" +
                    "src/ExtensibleCombatEcs/Game/Components.cs",
                  contributor_id: "external:2",
                  contributor_name: "external",
                  commit_count: 1,
                  last_contributed_at: "2026-08-17T00:00:00Z"
                },
                {
                  path:
                    "program/code/ecs/csharp-extensible-combat-ecs/" +
                    "src/ExtensibleCombatEcs/Systems/CombatSystems.cs",
                  contributor_id: "external:2",
                  contributor_name: "external",
                  commit_count: 2,
                  last_contributed_at: "2026-08-18T00:00:00Z"
                }
              ]
            }
          }
        })
      );
      const canvas = document.querySelector("[data-knowledge-field]");
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          resolve({
            contributors: Number(canvas.dataset.contributorCount),
            documents: Number(canvas.dataset.documentCount),
            codeSystems: Number(canvas.dataset.codeSystemCount),
            contributionEdges: Number(
              canvas.dataset.contributionEdgeCount
            ),
            edges: Number(canvas.dataset.edgeCount)
          });
        });
      });
    });
    assert.equal(canonical.contributors, 2);
    assert.equal(canonical.documents, metrics.documents);
    assert.equal(canonical.codeSystems, 1);
    assert.equal(canonical.contributionEdges, 3);
    assert.ok(canonical.edges >= 3);
  }

  assert.deepEqual(errors, [], `${scenario.name}: browser errors`);
  await context.close();
  console.log(
    `${scenario.name}: ${metrics.stars} stars, ` +
      `${metrics.edges} edges, coverage "${coverage.replace(/\n/g, " | ")}"`
  );
  return [baselineScreenshotPath, selectedScreenshotPath];
}

(async () => {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-extensions"]
  });
  const screenshots = [];
  try {
    for (const scenario of scenarios) {
      screenshots.push(...await runScenario(browser, scenario));
    }
  } finally {
    await browser.close();
  }
  console.log(`Homepage star map screenshots: ${screenshots.join(", ")}`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
