const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright-core");

const baseUrl =
  process.env.STAR_3D_BASE_URL || "http://127.0.0.1:8087";
const outputDirectory =
  process.env.STAR_3D_VISUAL_OUTPUT ||
  path.join(os.tmpdir(), "gck-home-star-3d");
const executablePath = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
].filter(Boolean).find(fs.existsSync);

if (!executablePath) {
  throw new Error("Chrome or Chromium was not found. Set CHROME_PATH.");
}

fs.mkdirSync(outputDirectory, { recursive: true });

const baseSettings = {
  home_intro_enabled: false,
  home_intro_mode: "off",
  home_background_style: "contribution_star_map",
  home_star_scope: "full",
  home_star_render_mode: "3d-spiral",
  home_star_experience_mode: "immersive",
  home_star_portal_collapsed_structure: "3d-galaxy",
  home_star_portal_expanded_structure: "3d-spiral",
  home_star_portal_rotation_speed: 3,
  home_star_portal_size_percent: 44,
  home_star_portal_brightness_percent: 58,
  home_star_relation_visibility: "always",
  home_star_strong_relation_style: "solid",
  home_star_reference_relation_style: "dashed",
  home_star_contributor_relation_style: "glow",
  home_star_brightness_variation_enabled: false,
  home_star_brightness_min: 5,
  home_star_brightness_initial: 25,
  home_star_brightness_max: 100,
  home_star_brightness_variation_amount: 0,
  home_star_brightness_transition_ms: 500,
  home_star_brightness_interval_ms: 800,
  home_star_color_random_enabled: true,
  home_star_graph_direction: "undirected",
  home_star_illumination_rule: "bfs",
  home_star_illumination_depth: 20,
  home_star_active_edge_mode: "full",
  home_star_selection_duration_ms: 10000,
  home_star_label_duration_ms: 10000,
  home_star_selected_radius_boost: 1.25,
  home_star_selected_alpha_boost: 0.2,
  home_star_selected_halo_alpha_boost: 0.24,
  home_star_selected_glow_scale: 1.4,
  home_star_selected_contributor_line_width: 1.8,
  home_star_3d_min_depth: 280,
  home_star_3d_halo_max_css_size: 200,
  home_star_3d_core_max_css_size: 36,
  home_star_3d_spike_max_css_size: 240,
  home_star_3d_pulse_max_css_size: 36
};

async function openPage(browser, options) {
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: options.deviceScaleFactor || 1,
    reducedMotion: options.reducedMotion || "reduce"
  });
  const settings = {
    ...baseSettings,
    ...options.settings
  };
  await context.addInitScript((value) => {
    localStorage.setItem(
      "gck-home-intro-settings",
      JSON.stringify(value)
    );
  }, settings);
  await context.route("**/editor/api/bootstrap**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        config: settings,
        session: { authenticated: false },
        drafts: []
      })
    });
  });
  await context.route("**/editor/api/analytics/visit", (route) => {
    route.fulfill({ status: 204 });
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
  await page.waitForFunction(() => {
    const canvas = document.querySelector(
      "[data-knowledge-field][data-relation-renderer='canvas-2d']"
    );
    return Boolean(
      canvas &&
      window.__GCK_STAR3D_DEBUG &&
      Number(canvas.dataset.starCount) > 100
    );
  });
  return { context, page, errors };
}

async function inspectStructure(browser, structure) {
  const { context, page, errors } = await openPage(browser, {
    viewport: { width: 1440, height: 1000 },
    settings: {
      home_star_render_mode: structure,
      home_star_experience_mode: "immersive",
      home_star_relation_visibility: "hidden"
    }
  });
  const metrics = await page.evaluate(() => {
    const debug = window.__GCK_STAR3D_DEBUG;
    const canvas = debug.renderer.domElement;
    const axes = ["x", "y", "z"].map((axis) => {
      const values = debug.stars.map((star) => star[axis]);
      return Math.max(...values) - Math.min(...values);
    });
    const finite = debug.stars.every((star) => {
      return [star.x, star.y, star.z].every(Number.isFinite);
    });
    return {
      finite,
      axes,
      calls: debug.renderer.info.render.calls,
      structures: debug.availableStructures,
      map: canvas.dataset.starMap,
      width: canvas.width,
      height: canvas.height
    };
  });
  assert.equal(metrics.finite, true, `${structure}: non-finite position`);
  assert.ok(
    Math.max(...metrics.axes) > 300 &&
      Math.min(...metrics.axes) > 20,
    `${structure}: invalid axis range ${metrics.axes.join(", ")}`
  );
  assert.equal(metrics.calls, 4, `${structure}: WebGL draw calls changed`);
  assert.ok(metrics.structures.includes(structure));
  assert.equal(metrics.map, `contribution-${structure}`);
  assert.ok(metrics.width > 0 && metrics.height > 0);
  assert.deepEqual(errors, [], `${structure}: browser errors`);

  const screenshot = path.join(outputDirectory, `${structure}.png`);
  await page.screenshot({ path: screenshot, fullPage: false });
  await context.close();
  console.log(
    `${structure}: ranges=${metrics.axes.map((value) => value.toFixed(1))}, ` +
      `drawCalls=${metrics.calls}`
  );
  return screenshot;
}

async function inspectPortal(
  browser,
  name,
  viewport,
  deviceScaleFactor,
  settingOverrides = {}
) {
  const { context, page, errors } = await openPage(browser, {
    viewport,
    deviceScaleFactor,
    settings: {
      home_star_scope: "hero",
      home_star_experience_mode: "contribution_portal",
      home_star_portal_collapsed_structure: "3d-galaxy",
      home_star_portal_expanded_structure: "3d-spiral",
      ...settingOverrides
    }
  });
  const collapsed = await page.evaluate(() => {
    const debug = window.__GCK_STAR3D_DEBUG;
    return {
      phase: debug.portalState.phase,
      settings: debug.portalSettings,
      calls: debug.renderer.info.render.calls,
      pageBackground: getComputedStyle(document.body).backgroundColor,
      catalogBackground: getComputedStyle(
        document.querySelector(".catalog-overview")
      ).backgroundColor,
      catalogColor: getComputedStyle(
        document.querySelector(".catalog-overview")
      ).color
    };
  });
  assert.equal(collapsed.phase, "collapsed");
  assert.equal(collapsed.settings.collapsedStructure, "3d-galaxy");
  assert.equal(collapsed.settings.expandedStructure, "3d-spiral");
  assert.equal(collapsed.calls, 4);
  assert.equal(collapsed.pageBackground, "rgb(255, 255, 255)");
  assert.equal(collapsed.catalogBackground, "rgb(255, 255, 255)");
  assert.equal(collapsed.catalogColor, "rgb(31, 41, 38)");

  const collapsedScreenshot = path.join(
    outputDirectory,
    `${name}-collapsed.png`
  );
  await page.screenshot({ path: collapsedScreenshot, fullPage: false });

  const expanded = await page.evaluate(() => {
    const debug = window.__GCK_STAR3D_DEBUG;
    debug.openContributionSpace("visual-test");
    const relationCanvas = debug.relationCanvas;
    let bestStar = null;
    let bestCount = -1;
    for (const star of debug.stars) {
      if (star.kind !== "contributor") continue;
      debug.selectStar(star, performance.now());
      const count = Number(relationCanvas.dataset.activeRelationCount);
      if (count > bestCount) {
        bestCount = count;
        bestStar = star;
      }
    }
    debug.selectStar(bestStar, performance.now());

    const context = relationCanvas.getContext("2d");
    const pixels = context.getImageData(
      0,
      0,
      relationCanvas.width,
      relationCanvas.height
    ).data;
    const colors = {
      cyan: [132, 220, 196],
      gold: [238, 190, 111],
      coral: [239, 142, 120]
    };
    const counts = {
      painted: 0,
      cyan: 0,
      gold: 0,
      coral: 0
    };
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 8) continue;
      counts.painted += 1;
      let nearest = "";
      let nearestDistance = Infinity;
      for (const [key, color] of Object.entries(colors)) {
        const distance =
          Math.pow(pixels[index] - color[0], 2) +
          Math.pow(pixels[index + 1] - color[1], 2) +
          Math.pow(pixels[index + 2] - color[2], 2);
        if (distance < nearestDistance) {
          nearest = key;
          nearestDistance = distance;
        }
      }
      if (nearestDistance <= 55 * 55) counts[nearest] += 1;
    }

    const relationRect = relationCanvas.getBoundingClientRect();
    const webglRect = debug.renderer.domElement.getBoundingClientRect();
    const legendRect = document
      .querySelector(".star-relation-legend")
      ?.getBoundingClientRect();
    return {
      phase: debug.portalState.phase,
      progress: debug.portalState.progress,
      calls: debug.renderer.info.render.calls,
      activeRelations: Number(relationCanvas.dataset.activeRelationCount),
      visibleRelations: Number(relationCanvas.dataset.visibleRelationCount),
      relationsVisible: relationCanvas.dataset.relationsVisible,
      relationScale: relationCanvas.width / relationRect.width,
      aligned:
        Math.abs(relationRect.left - webglRect.left) <= 0.5 &&
        Math.abs(relationRect.top - webglRect.top) <= 0.5 &&
        Math.abs(relationRect.width - webglRect.width) <= 0.5 &&
        Math.abs(relationRect.height - webglRect.height) <= 0.5,
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      legendInside:
        !legendRect ||
        (
          legendRect.left >= 0 &&
          legendRect.right <= window.innerWidth + 1
        ),
      counts
    };
  });

  assert.equal(expanded.phase, "expanded");
  assert.equal(expanded.progress, 1);
  assert.equal(expanded.calls, 4);
  assert.ok(expanded.activeRelations > 0);
  assert.ok(expanded.visibleRelations >= expanded.activeRelations);
  assert.equal(expanded.relationsVisible, "true");
  assert.ok(
    Math.abs(expanded.relationScale - deviceScaleFactor) <= 0.02,
    `${name}: relation canvas DPR mismatch`
  );
  assert.equal(expanded.aligned, true, `${name}: canvas layers diverged`);
  assert.ok(expanded.overflow <= 1, `${name}: horizontal overflow`);
  assert.equal(expanded.legendInside, true, `${name}: legend overflow`);
  assert.ok(expanded.counts.painted > 500, `${name}: relations are blank`);
  assert.ok(expanded.counts.cyan > 20, `${name}: strong color missing`);
  assert.ok(expanded.counts.gold > 20, `${name}: reference color missing`);
  assert.ok(expanded.counts.coral > 20, `${name}: contribution color missing`);
  assert.deepEqual(errors, [], `${name}: browser errors`);

  const selectedScreenshot = path.join(
    outputDirectory,
    `${name}-expanded-selected.png`
  );
  await page.screenshot({ path: selectedScreenshot, fullPage: false });
  await context.close();
  console.log(
    `${name}: active=${expanded.activeRelations}, ` +
      `colors=${JSON.stringify(expanded.counts)}, ` +
      `drawCalls=${expanded.calls}`
  );
  return [collapsedScreenshot, selectedScreenshot];
}

async function inspectRelationFlow(browser) {
  const { context, page, errors } = await openPage(browser, {
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "no-preference",
    settings: {
      home_star_scope: "full",
      home_star_render_mode: "3d",
      home_star_experience_mode: "immersive",
      home_star_relation_visibility: "near",
      home_star_graph_direction: "directed",
      home_star_illumination_rule: "depth",
      home_star_illumination_depth: 3,
      home_star_active_edge_mode: "minimal_tree"
    }
  });
  const flow = await page.evaluate(async () => {
    const debug = window.__GCK_STAR3D_DEBUG;
    const relationCanvas = debug.relationCanvas;
    const outgoingCounts = new Map();
    for (const edge of debug.edges) {
      outgoingCounts.set(
        edge.source,
        (outgoingCounts.get(edge.source) || 0) + 1
      );
    }
    const bestStar = debug.stars
      .slice()
      .sort((left, right) => {
        return (
          (outgoingCounts.get(right.id) || 0) -
          (outgoingCounts.get(left.id) || 0)
        );
      })[0];
    debug.selectStar(bestStar, performance.now());
    const drawingContext = relationCanvas.getContext("2d");
    const startTime = performance.now();
    debug.draw(startTime);
    const before = drawingContext.getImageData(
      0,
      0,
      relationCanvas.width,
      relationCanvas.height
    ).data;
    debug.draw(startTime + 220);
    const after = drawingContext.getImageData(
      0,
      0,
      relationCanvas.width,
      relationCanvas.height
    ).data;
    let movingPixels = 0;
    for (let index = 0; index < before.length; index += 4) {
      const difference =
        Math.abs(before[index] - after[index]) +
        Math.abs(before[index + 1] - after[index + 1]) +
        Math.abs(before[index + 2] - after[index + 2]) +
        Math.abs(before[index + 3] - after[index + 3]);
      if (difference > 28) movingPixels += 1;
    }
    return {
      activeRelations: Number(relationCanvas.dataset.activeRelationCount),
      calls: debug.renderer.info.render.calls,
      movingPixels
    };
  });
  assert.ok(flow.activeRelations > 0);
  assert.equal(flow.calls, 4);
  assert.ok(
    flow.movingPixels > 100,
    `relation flow is static: ${flow.movingPixels} changed pixels`
  );
  assert.deepEqual(errors, [], "relation flow: browser errors");
  const screenshot = path.join(
    outputDirectory,
    "portal-relation-flow.png"
  );
  await page.screenshot({ path: screenshot, fullPage: false });
  await context.close();
  console.log(
    `relation-flow: active=${flow.activeRelations}, ` +
      `movingPixels=${flow.movingPixels}, drawCalls=${flow.calls}`
  );
  return screenshot;
}

(async () => {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-extensions"]
  });
  const screenshots = [];
  try {
    for (const structure of [
      "3d-spiral",
      "3d-nebula",
      "3d-clusters",
      "3d-shell"
    ]) {
      screenshots.push(await inspectStructure(browser, structure));
    }
    screenshots.push(
      ...await inspectPortal(
        browser,
        "portal-desktop",
        { width: 1440, height: 1000 },
        1
      )
    );
    screenshots.push(
      ...await inspectPortal(
        browser,
        "portal-mobile-dpr2",
        { width: 390, height: 844 },
        2
      )
    );
    screenshots.push(
      ...await inspectPortal(
        browser,
        "portal-production-path",
        { width: 1440, height: 1000 },
        1,
        {
          home_star_relation_visibility: "near",
          home_star_graph_direction: "directed",
          home_star_illumination_rule: "depth",
          home_star_illumination_depth: 3,
          home_star_active_edge_mode: "minimal_tree"
        }
      )
    );
    screenshots.push(await inspectRelationFlow(browser));
  } finally {
    await browser.close();
  }
  console.log(`3D star screenshots: ${screenshots.join(", ")}`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
