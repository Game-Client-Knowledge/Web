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
  home_star_3d_pulse_max_css_size: 36,
  home_star_3d_background_star_count: 3200,
  home_star_3d_dust_fraction_percent: 60,
  home_star_3d_background_brightness_percent: 220,
  home_star_3d_dust_brightness_percent: 260,
  home_star_3d_background_size_percent: 160,
  home_star_brightness_tiers: [
    { id: "brown-dwarf", name: "褐矮星", min_brightness: 5 },
    { id: "red-dwarf", name: "红矮星", min_brightness: 25 },
    { id: "yellow-dwarf", name: "黄矮星", min_brightness: 50 },
    { id: "blue-giant", name: "蓝巨星", min_brightness: 80 }
  ]
};
const luminousTierSettings = {
  home_star_brightness_rules: [
    {
      id: "visual-supergiant-documents",
      name: "Visual supergiant documents",
      enabled: true,
      target: "document",
      formula: "95"
    },
    {
      id: "visual-hypergiant-contributors",
      name: "Visual hypergiant contributors",
      enabled: true,
      target: "contributor",
      formula: "100"
    }
  ],
  home_star_brightness_tiers: [
    { id: "brown-dwarf", name: "褐矮星", min_brightness: 5 },
    { id: "red-dwarf", name: "红矮星", min_brightness: 25 },
    { id: "yellow-dwarf", name: "黄矮星", min_brightness: 50 },
    { id: "blue-giant", name: "蓝巨星", min_brightness: 80 },
    {
      id: "blue-supergiant",
      name: "蓝超巨星",
      min_brightness: 92
    },
    { id: "hypergiant", name: "特超巨星", min_brightness: 98 }
  ]
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
      home_star_relation_visibility: "hidden",
      ...luminousTierSettings
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
    const tierCounts = debug.stars.reduce((counts, star) => {
      const id = star.brightnessTier?.id || "none";
      counts[id] = (counts[id] || 0) + 1;
      return counts;
    }, {});
    const effects = Array.from(
      debug.layers.haloLayer.geometry.attributes.aEffect.array
    );
    return {
      finite,
      axes,
      calls: debug.renderer.info.render.calls,
      structures: debug.availableStructures,
      map: canvas.dataset.starMap,
      backgroundStars: Number(canvas.dataset.backgroundStarCount),
      backgroundDust: Number(canvas.dataset.backgroundDustCount),
      backgroundBrightness: Number(canvas.dataset.backgroundBrightness),
      dustBrightness: Number(canvas.dataset.dustBrightness),
      backgroundSizeScale: Number(canvas.dataset.backgroundSizeScale),
      visualProfile: canvas.dataset.visualProfile,
      backgroundTime: debug.backgroundLayer.material.uniforms.uTime.value,
      animatedStars: Number(canvas.dataset.animatedStarCount),
      blueSupergiants: Number(canvas.dataset.blueSupergiantCount),
      hypergiants: Number(canvas.dataset.hypergiantCount),
      tierCounts,
      maximumVariability: Math.max(
        ...effects.filter((_, index) => index % 4 === 0)
      ),
      maximumCorona: Math.max(
        ...effects.filter((_, index) => index % 4 === 2)
      ),
      layerKinds: [
        debug.layers.haloLayer.material.uniforms.uLayerKind.value,
        debug.layers.coreLayer.material.uniforms.uLayerKind.value,
        debug.layers.spikeLayer.material.uniforms.uLayerKind.value
      ],
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
  assert.equal(metrics.backgroundStars, 3200);
  assert.equal(metrics.backgroundDust, 1920);
  assert.equal(metrics.backgroundBrightness, 2.2);
  assert.equal(metrics.dustBrightness, 2.6);
  assert.equal(metrics.backgroundSizeScale, 1.6);
  assert.equal(metrics.visualProfile, "deep-field");
  assert.equal(metrics.backgroundTime, 0);
  assert.equal(
    metrics.animatedStars,
    metrics.tierCounts["blue-supergiant"] +
      metrics.tierCounts.hypergiant
  );
  assert.ok(metrics.blueSupergiants > 100);
  assert.ok(metrics.hypergiants > 0);
  assert.equal(metrics.blueSupergiants, metrics.tierCounts["blue-supergiant"]);
  assert.equal(metrics.hypergiants, metrics.tierCounts.hypergiant);
  assert.ok(Math.abs(metrics.maximumVariability - 0.052) < 0.0001);
  assert.ok(Math.abs(metrics.maximumCorona - 0.56) < 0.0001);
  assert.deepEqual(metrics.layerKinds, [0, 1, 2]);
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

async function inspectContributorIdentityMerge(browser) {
  const { context, page, errors } = await openPage(browser, {
    viewport: { width: 1440, height: 1000 },
    settings: {
      home_star_render_mode: "3d",
      home_star_experience_mode: "immersive",
      home_star_relation_visibility: "hidden"
    }
  });
  const metrics = await page.evaluate(() => {
    const contributorIdsWithEdges = new Set(
      window.GCK_HOME_STAR_GRAPH.edges
        .filter((edge) => edge.type === "contribution")
        .map((edge) => edge.source)
    );
    const staticContributors = window.GCK_HOME_STAR_GRAPH.stars
      .filter((star) => {
        return (
          star.kind === "contributor" &&
          contributorIdsWithEdges.has(star.id)
        );
      })
      .sort((left, right) => {
        return (
          Number(right.metrics?.contributionCount || 0) -
          Number(left.metrics?.contributionCount || 0)
        );
      })
      .slice(0, 2);
    const staticStars = new Map(
      window.GCK_HOME_STAR_GRAPH.stars.map((star) => [star.id, star])
    );
    const registeredId = "user:visual-fixture";
    const links = staticContributors.map((contributor, index) => {
      const edge = window.GCK_HOME_STAR_GRAPH.edges.find((item) => {
        return (
          item.type === "contribution" &&
          item.source === contributor.id
        );
      });
      const documentStar = staticStars.get(edge.target);
      return {
        path:
          documentStar.sourcePaths?.[0] ||
          documentStar.sourcePath,
        contributor_id:
          index === 0 ? registeredId : contributor.contributorId,
        contributor_name:
          index === 0 ? "Registered Alias" : "External Alias",
        commit_count: 1,
        last_contributed_at: "2026-08-20T00:00:00Z"
      };
    });
    window.dispatchEvent(
      new CustomEvent("gck:visual-settings", {
        detail: {
          contribution_graph: {
            version: 2,
            revision: window.GCK_CONFIG.contentVersion,
            identity_aliases: {
              [registeredId]: [staticContributors[0].contributorId]
            },
            links
          }
        }
      })
    );
    const runtimeContributors = window.__GCK_STAR3D_DEBUG.stars.filter(
      (star) => star.kind === "contributor"
    );
    return {
      source: staticContributors.map((star) => ({
        id:
          star === staticContributors[0]
            ? registeredId
            : star.contributorId,
        metrics: star.metrics
      })),
      runtime: runtimeContributors.map((star) => ({
        id: star.contributorId,
        name: star.name,
        metrics: star.metrics
      }))
    };
  });
  assert.equal(metrics.runtime.length, 2);
  for (let index = 0; index < 2; index += 1) {
    const source = metrics.source[index];
    const runtime = metrics.runtime.find((item) => item.id === source.id);
    assert.ok(runtime, `contributor identity ${source.id} was lost`);
    assert.equal(
      runtime.metrics.contributionCount,
      source.metrics.contributionCount
    );
    assert.equal(
      runtime.metrics.activity7Count,
      source.metrics.activity7Count
    );
    assert.equal(
      runtime.metrics.activity30Count,
      source.metrics.activity30Count
    );
    assert.equal(
      runtime.metrics.commitCount,
      source.metrics.commitCount
    );
  }
  assert.ok(
    metrics.runtime.some((item) => item.name === "Registered Alias")
  );
  assert.ok(
    metrics.runtime.some((item) => item.name === "External Alias")
  );
  assert.deepEqual(errors, [], "contributor identity merge: browser errors");
  await context.close();
  console.log(
    "contributor-identity: registered alias and external Git author preserved"
  );
}

async function inspectLuminousTierAnimation(browser) {
  const { context, page, errors } = await openPage(browser, {
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "no-preference",
    settings: {
      home_star_render_mode: "3d-spiral",
      home_star_experience_mode: "immersive",
      home_star_relation_visibility: "hidden",
      ...luminousTierSettings
    }
  });
  const firstTime = await page.evaluate(() => {
    return window.__GCK_STAR3D_DEBUG.layers.haloLayer.material.uniforms.uTime
      .value;
  });
  await page.waitForTimeout(180);
  const metrics = await page.evaluate(() => {
    const debug = window.__GCK_STAR3D_DEBUG;
    const effects = Array.from(
      debug.layers.haloLayer.geometry.attributes.aEffect.array
    );
    return {
      time: debug.layers.haloLayer.material.uniforms.uTime.value,
      calls: debug.renderer.info.render.calls,
      animated: Number(debug.renderer.domElement.dataset.animatedStarCount),
      nonzeroEffects: effects.filter((value) => value !== 0).length
    };
  });
  assert.ok(metrics.time > firstTime, "luminous tier animation time stalled");
  assert.equal(metrics.calls, 4, "luminous tier animation changed draw calls");
  assert.ok(metrics.animated > 100, "luminous tiers were not animated");
  assert.ok(metrics.nonzeroEffects > 100, "tier effect attributes are empty");
  assert.deepEqual(errors, [], "luminous tier animation: browser errors");
  await context.close();
  console.log(
    `luminous-tier-animation: animated=${metrics.animated}, ` +
      `drawCalls=${metrics.calls}`
  );
}

async function inspectDeepSpaceSettings(browser) {
  const { context, page, errors } = await openPage(browser, {
    viewport: { width: 1440, height: 1000 },
    settings: {
      home_star_render_mode: "3d-nebula",
      home_star_experience_mode: "immersive",
      home_star_relation_visibility: "hidden",
      home_star_3d_background_star_count: 1800,
      home_star_3d_dust_fraction_percent: 75,
      home_star_3d_background_brightness_percent: 185,
      home_star_3d_dust_brightness_percent: 310,
      home_star_3d_background_size_percent: 135
    }
  });
  const metrics = await page.evaluate(() => {
    const debug = window.__GCK_STAR3D_DEBUG;
    const canvas = debug.renderer.domElement;
    return {
      calls: debug.renderer.info.render.calls,
      stars: Number(canvas.dataset.backgroundStarCount),
      dust: Number(canvas.dataset.backgroundDustCount),
      brightness: debug.backgroundLayer.material.uniforms.uBrightness.value,
      dustBrightness:
        debug.backgroundLayer.material.uniforms.uDustBrightness.value,
      sizeScale: debug.backgroundLayer.material.uniforms.uSizeScale.value
    };
  });
  assert.equal(metrics.calls, 4, "deep-space settings changed draw calls");
  assert.equal(metrics.stars, 1800);
  assert.equal(metrics.dust, 1350);
  assert.equal(metrics.brightness, 1.85);
  assert.equal(metrics.dustBrightness, 3.1);
  assert.equal(metrics.sizeScale, 1.35);
  assert.deepEqual(errors, [], "deep-space settings: browser errors");
  await context.close();
  console.log(
    `deep-space-settings: stars=${metrics.stars}, dust=${metrics.dust}, ` +
      `drawCalls=${metrics.calls}`
  );
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

  const cleanExpanded = await page.evaluate(() => {
    const debug = window.__GCK_STAR3D_DEBUG;
    debug.openContributionSpace("visual-test");
    return {
      phase: debug.portalState.phase,
      progress: debug.portalState.progress,
      selected: Number(debug.renderer.domElement.dataset.selectedCount),
      calls: debug.renderer.info.render.calls
    };
  });
  assert.equal(cleanExpanded.phase, "expanded");
  assert.equal(cleanExpanded.progress, 1);
  assert.equal(cleanExpanded.selected, 0);
  assert.equal(cleanExpanded.calls, 4);
  const cleanExpandedScreenshot = path.join(
    outputDirectory,
    `${name}-expanded-clean.png`
  );
  await page.screenshot({
    path: cleanExpandedScreenshot,
    fullPage: false
  });

  const expanded = await page.evaluate(() => {
    const debug = window.__GCK_STAR3D_DEBUG;
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
  const expandedScrollY = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 640);
  await page.waitForTimeout(60);
  assert.equal(
    await page.evaluate(() => scrollY),
    expandedScrollY,
    `${name}: expanded contribution space did not lock page scrolling`
  );

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

async function inspectStructureTransition(
  browser,
  name,
  viewport,
  deviceScaleFactor
) {
  const { context, page, errors } = await openPage(browser, {
    viewport,
    deviceScaleFactor,
    reducedMotion: "no-preference",
    settings: {
      home_star_scope: "hero",
      home_star_experience_mode: "contribution_portal",
      home_star_portal_expanded_structure: "3d-spiral",
      home_star_relation_visibility: "always"
    }
  });
  await page.waitForTimeout(300);
  const targetStructure =
    viewport.width <= 600 ? "3d-nebula" : "3d-orbit";
  const metrics = await page.evaluate((target) => {
    const debug = window.__GCK_STAR3D_DEBUG;
    const now = performance.now();
    debug.openContributionSpace("structure-transition-test");
    debug.portalState.startedAt = now - 1400;
    debug.draw(now);
    const selected = debug.stars.find(
      (star) => star.kind === "contributor"
    );
    debug.selectStar(selected, now);
    debug.draw(now);
    const select = document.querySelector(
      "[data-contribution-space-structure]"
    );
    const start = debug.stars.map((star) => [
      star.x,
      star.y,
      star.z
    ]);
    const test = {
      renderer: debug.renderer,
      canvas: debug.renderer.domElement,
      camera: debug.camera.position.toArray(),
      selectedCount:
        debug.renderer.domElement.dataset.selectedCount,
      start,
      mid: null
    };
    select.value = target;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const unchanged = debug.stars.reduce((sum, star, index) => {
      const origin = start[index];
      return sum + Math.hypot(
        star.x - origin[0],
        star.y - origin[1],
        star.z - origin[2]
      );
    }, 0) / Math.max(1, debug.stars.length);
    const started = {
      phase: debug.portalState.phase,
      structure: debug.activeStructure,
      transition: debug.renderer.domElement.dataset.structureTransition,
      disabled: select.disabled,
      unchanged
    };
    const transitionStart = debug.structureTransition.startedAt;
    debug.draw(transitionStart + 450);
    test.mid = debug.stars.map((star) => [
      star.x,
      star.y,
      star.z
    ]);
    const midpointDistance = test.mid.reduce((sum, point, index) => {
      const origin = test.start[index];
      return sum + Math.hypot(
        point[0] - origin[0],
        point[1] - origin[1],
        point[2] - origin[2]
      );
    }, 0) / Math.max(1, test.mid.length);
    const middle = {
      active: debug.structureTransition.active,
      progress: debug.structureTransition.progress,
      averageDistance: midpointDistance
    };
    debug.draw(transitionStart + 901);
    const final = debug.stars.map((star) => [
      star.x,
      star.y,
      star.z
    ]);
    function averageDistance(left, right) {
      return left.reduce((sum, point, index) => {
        const target = right[index];
        return sum + Math.hypot(
          point[0] - target[0],
          point[1] - target[1],
          point[2] - target[2]
        );
      }, 0) / Math.max(1, left.length);
    }
    const relationCanvas = debug.relationCanvas;
    const pixels = relationCanvas
      .getContext("2d")
      .getImageData(
        0,
        0,
        relationCanvas.width,
        relationCanvas.height
      ).data;
    let paintedSamples = 0;
    for (let index = 3; index < pixels.length; index += 32) {
      if (pixels[index] > 8) paintedSamples += 1;
    }
    const controlRectangle = select
      .closest("[data-contribution-space-structure-control]")
      .getBoundingClientRect();
    const selectStyle = getComputedStyle(select);
    const optionStyle = getComputedStyle(
      select.options[select.selectedIndex]
    );
    const finished = {
      active: debug.structureTransition.active,
      progress: debug.structureTransition.progress,
      structure: debug.activeStructure,
      map: debug.renderer.domElement.dataset.starMap,
      selectValue: select.value,
      disabled: select.disabled,
      rendererStable: test.renderer === debug.renderer,
      canvasStable: test.canvas === debug.renderer.domElement,
      cameraDistance: Math.hypot(
        ...debug.camera.position
          .toArray()
          .map((value, index) => value - test.camera[index])
      ),
      selectedStable:
        debug.renderer.domElement.dataset.selectedCount ===
        test.selectedCount,
      startToFinal: averageDistance(test.start, final),
      middleToFinal: averageDistance(test.mid, final),
      activeRelations: Number(
        relationCanvas.dataset.activeRelationCount
      ),
      paintedSamples,
      calls: debug.renderer.info.render.calls,
      controlInside:
        controlRectangle.left >= 0 &&
        controlRectangle.top >= 0 &&
        controlRectangle.right <= window.innerWidth + 1,
      controlHeight: controlRectangle.height,
      selectColor: selectStyle.color,
      selectBackground: selectStyle.backgroundColor,
      optionColor: optionStyle.color,
      optionBackground: optionStyle.backgroundColor,
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    };
    return { started, middle, finished };
  }, targetStructure);
  const { started, middle, finished } = metrics;
  const screenshot = path.join(
    outputDirectory,
    `${name}-${targetStructure}.png`
  );
  await page.screenshot({ path: screenshot, fullPage: false });
  assert.equal(started.phase, "expanded");
  assert.equal(started.structure, targetStructure);
  assert.equal(started.transition, "active");
  assert.equal(started.disabled, true);
  assert.ok(started.unchanged < 0.001, `${name}: transition jumped`);
  assert.equal(middle.active, true, `${name}: transition ended early`);
  assert.ok(
    middle.progress > 0.2 && middle.progress < 0.8,
    `${name}: invalid midpoint ${middle.progress}`
  );
  assert.ok(
    middle.averageDistance > 20,
    `${name}: stars did not move at midpoint`
  );
  assert.equal(finished.active, false);
  assert.equal(finished.progress, 1);
  assert.equal(finished.structure, targetStructure);
  assert.equal(finished.map, `contribution-${targetStructure}`);
  assert.equal(finished.selectValue, targetStructure);
  assert.equal(finished.disabled, false);
  assert.equal(finished.rendererStable, true);
  assert.equal(finished.canvasStable, true);
  assert.ok(finished.cameraDistance < 0.001, `${name}: camera reset`);
  assert.equal(finished.selectedStable, true, `${name}: selection reset`);
  assert.ok(finished.startToFinal > 40, `${name}: final layout unchanged`);
  assert.ok(
    finished.middleToFinal > 20,
    `${name}: midpoint already matched target`
  );
  assert.ok(finished.activeRelations > 0, `${name}: relations cleared`);
  assert.ok(
    finished.paintedSamples > 20,
    `${name}: relations are blank (${finished.paintedSamples} samples)`
  );
  assert.equal(finished.calls, 4, `${name}: WebGL draw calls changed`);
  assert.equal(finished.controlInside, true, `${name}: control overflow`);
  assert.ok(
    finished.controlHeight >= 42 && finished.controlHeight <= 48,
    `${name}: invalid control height ${finished.controlHeight}`
  );
  assert.equal(finished.selectColor, "rgb(18, 35, 30)");
  assert.equal(finished.selectBackground, "rgb(232, 246, 241)");
  assert.equal(finished.optionColor, "rgb(18, 35, 30)");
  assert.equal(finished.optionBackground, "rgb(244, 251, 248)");
  assert.ok(finished.overflow <= 1, `${name}: horizontal overflow`);
  assert.deepEqual(errors, [], `${name}: browser errors`);

  await context.close();
  console.log(
    `${name}: moved=${finished.startToFinal.toFixed(1)}, ` +
      `relations=${finished.activeRelations}, drawCalls=${finished.calls}`
  );
  return screenshot;
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

async function inspectScrolledPortalOpening(browser, name, viewport) {
  const { context, page, errors } = await openPage(browser, {
    viewport,
    reducedMotion: "no-preference",
    settings: {
      home_star_scope: "hero",
      home_star_experience_mode: "contribution_portal",
      home_star_portal_collapsed_structure: "3d-galaxy",
      home_star_portal_expanded_structure: "3d-spiral"
    }
  });
  await page.locator(".catalog-overview").scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const metrics = await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true
    });
    const debug = window.__GCK_STAR3D_DEBUG;
    const before = {
      scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      bodyHeight: document.body.getBoundingClientRect().height
    };
    debug.openContributionSpace("scrolled-visual-test");
    debug.portalState.startedAt = performance.now() - 26;
    debug.draw(performance.now());
    const catalog = document
      .querySelector(".catalog-overview")
      .getBoundingClientRect();
    return {
      before,
      phase: debug.portalState.phase,
      progress: debug.portalState.progress,
      scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      bodyHeight: document.body.getBoundingClientRect().height,
      portalClip: document.querySelector(
        ".contribution-space-backdrop"
      ).style.clipPath,
      catalogBackground: getComputedStyle(
        document.querySelector(".catalog-overview")
      ).backgroundColor,
      pageBackground: getComputedStyle(document.body).backgroundColor,
      catalogTop: catalog.top
    };
  });
  assert.equal(metrics.phase, "opening");
  assert.ok(metrics.progress > 0 && metrics.progress < 0.1);
  assert.ok(Math.abs(metrics.scrollY - metrics.before.scrollY) <= 1);
  assert.equal(metrics.scrollHeight, metrics.before.scrollHeight);
  assert.ok(
    metrics.bodyHeight >= metrics.scrollY + viewport.height - 1,
    `${name}: opening truncated the page under the fixed overlay`
  );
  assert.ok(
    metrics.bodyHeight >= metrics.before.bodyHeight - 1,
    `${name}: opening reduced the body height`
  );
  assert.equal(metrics.catalogBackground, "rgb(255, 255, 255)");
  assert.equal(metrics.pageBackground, "rgb(255, 255, 255)");
  assert.equal(metrics.portalClip, "inset(100%)");
  assert.deepEqual(errors, [], `${name}: browser errors`);
  const screenshot = path.join(outputDirectory, `${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: false });
  await context.close();
  console.log(
    `${name}: progress=${metrics.progress.toFixed(3)}, ` +
      `bodyHeight=${metrics.bodyHeight.toFixed(1)}, ` +
      `scrollY=${metrics.scrollY.toFixed(1)}`
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
    await inspectContributorIdentityMerge(browser);
    await inspectLuminousTierAnimation(browser);
    await inspectDeepSpaceSettings(browser);
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
    screenshots.push(
      await inspectStructureTransition(
        browser,
        "portal-structure-transition-desktop",
        { width: 1440, height: 1000 },
        1
      )
    );
    screenshots.push(
      await inspectStructureTransition(
        browser,
        "portal-structure-transition-mobile",
        { width: 390, height: 844 },
        2
      )
    );
    screenshots.push(await inspectRelationFlow(browser));
    screenshots.push(
      await inspectScrolledPortalOpening(
        browser,
        "portal-scrolled-opening-desktop",
        { width: 1440, height: 1000 }
      )
    );
    screenshots.push(
      await inspectScrolledPortalOpening(
        browser,
        "portal-scrolled-opening-mobile",
        { width: 390, height: 844 }
      )
    );
  } finally {
    await browser.close();
  }
  console.log(`3D star screenshots: ${screenshots.join(", ")}`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
