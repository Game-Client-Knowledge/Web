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
const defaultVisualSettings = {
  catalog_background_style: "circuit",
  reader_background_style: "blueprint",
  pointer_effect_enabled: true,
  home_intro_enabled: false,
  home_intro_mode: "off",
  home_intro_duration_ms: 3000,
  home_intro_assembly_duration_ms: 1680,
  home_intro_hold_duration_ms: 630,
  home_intro_lock_scroll: true,
  home_intro_contributor_limit: 8,
  home_content_idle_timeout_seconds: 300
};

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

function escapePreviewHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function previewBlockAttributes(start, kind) {
  return (
    ' data-md-block=""' +
    ` data-source-start="${start}"` +
    ` data-source-end="${start + 1}"` +
    ` data-source-kind="${kind}"`
  );
}

function mockedMarkdownPreview(content) {
  const lines = String(content || "").split(/\r?\n/);
  const h1 = lines.findIndex((line) => /^#\s+/.test(line));
  const h2 = lines.findIndex((line) => /^##\s+/.test(line));
  const linkLine = lines.findIndex((line) => {
    return line.includes("./06-component-query-implementation.md");
  });
  const fragments = [];
  if (h1 >= 0) {
    fragments.push(
      `<h1${previewBlockAttributes(h1, "heading")}>` +
        escapePreviewHtml(lines[h1].replace(/^#\s+/, "")) +
        "</h1>"
    );
  }
  if (h2 >= 0) {
    fragments.push(
      `<h2${previewBlockAttributes(h2, "heading")}>` +
        escapePreviewHtml(lines[h2].replace(/^##\s+/, "")) +
        "</h2>"
    );
  }
  fragments.push("<p>Preview content</p>");
  if (linkLine >= 0) {
    fragments.push(
      `<p${previewBlockAttributes(linkLine, "paragraph")}>` +
        '<a href="./06-component-query-implementation.md">' +
        "组件存储与查询实现</a></p>"
    );
  }
  return fragments.join("");
}

async function canvasMetrics(page, selector) {
  return page.locator(selector).evaluate((canvas) => {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const pixels = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    ).data;
    let painted = 0;
    let checksum = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      const alpha = pixels[index + 3] || 0;
      if (alpha > 0) painted += 1;
      checksum =
        (
          checksum +
          pixels[index] * 3 +
          pixels[index + 1] * 5 +
          pixels[index + 2] * 7 +
          alpha * 11
        ) %
        1000000007;
    }
    return {
      painted,
      checksum,
      width: canvas.width,
      height: canvas.height,
      viewport: {
        top: Math.round(canvas.getBoundingClientRect().top),
        right: Math.round(canvas.getBoundingClientRect().right),
        bottom: Math.round(canvas.getBoundingClientRect().bottom),
        left: Math.round(canvas.getBoundingClientRect().left)
      }
    };
  });
}

async function inspectPage(browser, scenario) {
  let allowDraftWrites = true;
  let draftAttempts = 0;
  let draftDeletes = 0;
  let previewAttempts = 0;
  const draftWrites = [];
  const visualSettings = {
    ...defaultVisualSettings,
    ...(scenario.visualSettings || {})
  };
  const introMode =
    visualSettings.home_intro_mode ||
    (visualSettings.home_intro_enabled ? "revisit" : "off");
  const session = scenario.readerEditor || scenario.authenticated
    ? {
        authenticated: true,
        csrf_token: "visual-check-csrf",
        auth_provider: "local",
        can_edit: true,
        edit_policy: "local_authenticated",
        user: {
          id: 100,
          email: "visual@example.test",
          username: "visual-reader",
          github_login: null,
          github_email: null,
          github_verified: false,
          email_verified: true,
          role: "user",
          status: "active",
          must_change_password: false,
          email_notifications_enabled: true,
          needs_onboarding: false
        }
      }
    : { authenticated: false };
  const context = await browser.newContext({
    viewport: scenario.viewport,
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: scenario.reducedMotion ? "reduce" : "no-preference"
  });
  await context.route("**/editor/api/bootstrap**", (route) => {
    const fulfill = () => {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          config: {
            edit_policy: "local_authenticated",
            registration_enabled: true,
            pr_auto_close_days: 7,
            reader_edit_mode: "new",
            reader_diff_enabled: true,
            workspace_sync_interval_seconds: 60,
            smtp_enabled: false,
            github_oauth_enabled: true,
            github_submission_enabled: true,
            ...visualSettings
          },
          session,
          drafts: scenario.drafts || [],
          draft_revision: scenario.draftRevision || "visual-drafts",
          active_draft_html: null
        })
      });
    };
    if (scenario.bootstrapDelay) {
      return new Promise((resolve) => {
        setTimeout(resolve, scenario.bootstrapDelay);
      }).then(fulfill);
    }
    return fulfill();
  });
  await context.route("**/editor/api/comments**", (route) => {
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        revision: null,
        authors: [],
        comments: []
      })
    });
  });
  await context.route("**/editor/api/repository/tree**", (route) => {
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({})
    });
  });
  await context.route("**/editor/api/repository/delete-tree**", (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            path,
            sha: "visual-delete-sha",
            size: 120
          }
        ]
      })
    });
  });
  await context.route("**/editor/api/drafts**", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          changed: false,
          revision: scenario.draftRevision || "visual-drafts",
          items: []
        })
      });
    }
    if (route.request().method() === "DELETE") {
      draftDeletes += 1;
      return route.fulfill({ status: 204, body: "" });
    }
    if (route.request().method() !== "PUT") {
      return route.fallback();
    }
    draftAttempts += 1;
    if (!allowDraftWrites) {
      throw new Error("Unexpected draft sync while test is offline");
    }
    const payload = route.request().postDataJSON();
    draftWrites.push(payload);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: 1000,
        path: payload.path,
        operation: payload.operation || "upsert",
        content: payload.content,
        base_sha: payload.base_sha,
        revision: draftWrites.length,
        created_at: "2026-08-17T00:00:00Z",
        updated_at: "2026-08-17T00:00:00Z"
      })
    });
  });
  await context.route("**/editor/api/analytics/visit", (route) => {
    return route.fulfill({ status: 204, body: "" });
  });
  await context.route("**/editor/api/preview", (route) => {
    previewAttempts += 1;
    const content = JSON.parse(route.request().postData() || "{}").content || "";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        html: mockedMarkdownPreview(content)
      })
    });
  });
  let page = await context.newPage();
  const runtimeErrors = [];
  function observeRuntimeErrors(target) {
    target.on("console", (message) => {
      if (message.type() === "error") {
        runtimeErrors.push(message.text());
      }
    });
    target.on("pageerror", (error) => runtimeErrors.push(error.message));
  }
  observeRuntimeErrors(page);

  const navigationStarted = Date.now();
  await page.goto(`${baseUrl}${scenario.route}`, {
    waitUntil: scenario.bootstrapDelay ? "domcontentloaded" : "networkidle"
  });
  await page.waitForFunction(() => document.body.dataset.visualType);
  if (scenario.ambient || scenario.pointerEffect !== undefined) {
    await page.waitForFunction(
      ({ ambient, pointer }) => {
        const background = ambient
          ? ambient.type === "catalog"
            ? document.body.dataset.catalogBackground
            : document.body.dataset.readerBackground
          : null;
        return (
          (!ambient || background === ambient.style) &&
          (
            pointer === undefined ||
            document.body.dataset.pointerEffect ===
              (pointer ? "on" : "off")
          )
        );
      },
      {
        ambient: scenario.ambient || null,
        pointer: Object.hasOwn(
          scenario.visualSettings || {},
          "pointer_effect_enabled"
        )
          ? scenario.pointerEffect
          : undefined
      }
    );
  }

  if (scenario.homeIntro === "play") {
    await page.locator("[data-entry-sequence]").waitFor({
      state: "visible"
    });
    await page.waitForTimeout(260);
    const intro = await page.evaluate(() => {
      const stage = document.querySelector("[data-entry-sequence]");
      return {
        contributors: Number(stage?.dataset.contributorCount || 0),
        contributorParticles: Number(
          stage?.dataset.contributorParticleCount || 0
        ),
        particles: Number(stage?.dataset.particleCount || 0),
        phase: stage?.dataset.entryPhase,
        duration: Number(stage?.dataset.entryDuration || 0),
        assemblyDuration: Number(
          stage?.dataset.assemblyDuration || 0
        ),
        holdDuration: Number(stage?.dataset.holdDuration || 0),
        scrollDuration: Number(stage?.dataset.scrollDuration || 0),
        rotation: Number(stage?.dataset.frameRotation || 0),
        coreOverlap: stage?.dataset.contributorCoreOverlap,
        layout: stage?.dataset.contributorLayout,
        trajectory: stage?.dataset.contributorTrajectory,
        energyTrails: Number(stage?.dataset.energyTrailCount || 0),
        hudPings: Number(stage?.dataset.hudPingCount || 0),
        backgroundPalette: stage?.dataset.backgroundPalette,
        typographyMotion: stage?.dataset.typographyMotion,
        gameHud: stage?.dataset.gameHud,
        typographyOffset: stage?.dataset.typographyOffset,
        hudSweep: Number(stage?.dataset.hudSweep || 0),
        progress: document.querySelector(".site-entry-progress")?.style
          .transform,
        scrollY: Math.round(window.scrollY)
      };
    });
    const introCanvas = await canvasMetrics(
      page,
      "[data-entry-sequence] canvas"
    );
    assert(
      intro.phase === "assembling" && intro.scrollY === 0,
      `${scenario.name}: entry did not start in the document first screen`
    );
    assert(
      intro.contributors >= 2 &&
        intro.contributors <= visualSettings.home_intro_contributor_limit,
      `${scenario.name}: entry contributors ${intro.contributors}`
    );
    assert(
      intro.contributorParticles > 40 &&
        intro.layout === "orbital" &&
        intro.trajectory === "moving-targets" &&
        intro.coreOverlap === "false",
      `${scenario.name}: contributor motion targets are invalid`
    );
    assert(
      intro.particles >= 1000,
      `${scenario.name}: entry particle count ${intro.particles}`
    );
    assert(
      intro.energyTrails >= 3 &&
        intro.hudPings >= 5 &&
        intro.backgroundPalette === "tactical-multi" &&
        intro.typographyMotion === "active" &&
        intro.gameHud === "active",
      `${scenario.name}: game visual layers are invalid`
    );
    assert(
      intro.duration === visualSettings.home_intro_duration_ms,
      `${scenario.name}: entry duration is ${intro.duration}`
    );
    assert(
      intro.assemblyDuration ===
        visualSettings.home_intro_assembly_duration_ms &&
        intro.holdDuration ===
          visualSettings.home_intro_hold_duration_ms &&
        intro.assemblyDuration +
          intro.holdDuration +
          intro.scrollDuration === intro.duration,
      `${scenario.name}: entry phase durations are invalid`
    );
    assert(
      intro.progress?.startsWith("scaleX("),
      `${scenario.name}: entry progress is not running`
    );
    assert(
      introCanvas.painted > 100,
      `${scenario.name}: entry canvas is blank`
    );
    await page.screenshot({
      path: path.join(outputDirectory, `${scenario.name}.png`),
      fullPage: false
    });
    await page.waitForFunction(() => {
      return document.querySelector("[data-entry-sequence]")
        ?.dataset.entryPhase === "holding";
    });
    const holdingStartedAfter = Date.now() - navigationStarted;
    const assembled = await page.evaluate(() => {
      const stage = document.querySelector("[data-entry-sequence]");
      return {
        rotation: Number(stage?.dataset.frameRotation || 0),
        coreOverlap: stage?.dataset.contributorCoreOverlap,
        typographyOffset: stage?.dataset.typographyOffset,
        hudSweep: Number(stage?.dataset.hudSweep || 0)
      };
    });
    assert(
      assembled.rotation > intro.rotation &&
        assembled.coreOverlap === "false" &&
        assembled.typographyOffset !== intro.typographyOffset &&
        assembled.hudSweep > intro.hudSweep,
      `${scenario.name}: animated intro layers did not move safely`
    );
    await page.screenshot({
      path: path.join(
        outputDirectory,
        `${scenario.name}-assembled.png`
      ),
      fullPage: false
    });
    await page.waitForFunction(() => {
      return document.body.dataset.homeIntro === "complete";
    });
    const completedAfter = Date.now() - navigationStarted;
    const completed = await page.evaluate(() => {
      const stage = document.querySelector("[data-entry-sequence]");
      const header = document.querySelector(".site-header");
      return {
        phase: stage?.dataset.entryPhase,
        stageHeight: Math.round(stage?.offsetHeight || 0),
        scrollY: Math.round(window.scrollY),
        headerTop: Math.round(header?.getBoundingClientRect().top || 0),
        stageConnected: Boolean(stage),
        locked: document.body.dataset.homeIntroLocked
      };
    });
    assert(
      holdingStartedAfter >=
        visualSettings.home_intro_assembly_duration_ms - 150,
      `${scenario.name}: assembly ended after ${holdingStartedAfter}ms`
    );
    assert(
      completedAfter - holdingStartedAfter >=
        visualSettings.home_intro_hold_duration_ms - 150,
      `${scenario.name}: hold phase was shorter than configured`
    );
    assert(
      completedAfter >=
        visualSettings.home_intro_duration_ms - 250 &&
        completedAfter <= visualSettings.home_intro_duration_ms + 900,
      `${scenario.name}: entry completed after ${completedAfter}ms`
    );
    if (visualSettings.home_intro_lock_scroll) {
      assert(
        !completed.stageConnected &&
          completed.locked === "true" &&
          completed.headerTop === 0 &&
          completed.scrollY === 0,
        `${scenario.name}: locked entry remains reachable`
      );
    } else {
      assert(
        completed.stageConnected &&
          completed.phase === "complete" &&
          completed.locked === "false" &&
          completed.headerTop === 0 &&
          Math.abs(completed.scrollY - completed.stageHeight) <= 2,
        `${scenario.name}: entry did not scroll to the main page`
      );
    }
    const policyState = await page.evaluate(() => {
      return {
        first: localStorage.getItem("gck-home-intro-first:v1"),
        device: JSON.parse(
          localStorage.getItem("gck-home-intro-device:v1") || "{}"
        ),
        obsoleteCookie: document.cookie.includes(
          "gck_home_intro_session="
        )
      };
    });
    assert(
      policyState.first === "1" &&
        Object.keys(policyState.device.tabs || {}).length === 1 &&
        !policyState.obsoleteCookie,
      `${scenario.name}: device policy state is invalid`
    );

    await page.reload({ waitUntil: "networkidle" });
    if (introMode === "always") {
      await page.locator("[data-entry-sequence]").waitFor({
        state: "visible"
      });
      await page.locator("[data-entry-sequence]").click({
        position: { x: 8, y: 8 }
      });
      await page.waitForFunction(() => {
        return document.body.dataset.homeIntro === "complete";
      });
    } else {
      await page.waitForFunction(() => document.body.dataset.homeIntro);
      const replay = await page.evaluate(() => {
        return {
          status: document.body.dataset.homeIntro,
          stage: Boolean(document.querySelector("[data-entry-sequence]"))
        };
      });
      assert(
        replay.status === "seen" && !replay.stage,
        `${scenario.name}: entry replayed without leaving the device visit`
      );
    }

    if (scenario.deviceReentry) {
      await page.goto("about:blank");
      await page.close();
      page = await context.newPage();
      observeRuntimeErrors(page);
      await page.goto(`${baseUrl}${scenario.route}`, {
        waitUntil: scenario.bootstrapDelay ? "domcontentloaded" : "networkidle"
      });
      if (scenario.deviceReentry === "play") {
        await page.locator("[data-entry-sequence]").waitFor({
          state: "visible"
        });
        await page.locator("[data-entry-sequence]").click({
          position: { x: 8, y: 8 }
        });
        await page.waitForFunction(() => {
          return document.body.dataset.homeIntro === "complete";
        });
      } else {
        await page.waitForFunction(() => document.body.dataset.homeIntro);
        const reentry = await page.evaluate(() => {
          return {
            status: document.body.dataset.homeIntro,
            stage: Boolean(document.querySelector("[data-entry-sequence]"))
          };
        });
        assert(
          reentry.status === "seen" && !reentry.stage,
          `${scenario.name}: first-only mode replayed on device reentry`
        );
      }
    }
  } else {
    if (scenario.homeIntro === "skip") {
      await page.locator("[data-entry-sequence]").waitFor({
        state: "visible"
      });
      const skipStarted = Date.now();
      await page.locator("[data-entry-sequence]").click({
        position: { x: 8, y: 8 }
      });
      await page.waitForFunction(() => {
        return document.body.dataset.homeIntro === "complete";
      });
      const skippedAfter = Date.now() - skipStarted;
      assert(
        skippedAfter < 800,
        `${scenario.name}: entry skip took ${skippedAfter}ms`
      );
      const skipped = await page.evaluate(() => {
        const stage = document.querySelector("[data-entry-sequence]");
        return {
          phase: stage?.dataset.entryPhase,
          stageHeight: Math.round(stage?.offsetHeight || 0),
          scrollY: Math.round(window.scrollY),
          stageConnected: Boolean(stage),
          locked: document.body.dataset.homeIntroLocked
        };
      });
      if (visualSettings.home_intro_lock_scroll) {
        assert(
          !skipped.stageConnected &&
            skipped.locked === "true" &&
            skipped.scrollY === 0,
          `${scenario.name}: skipped locked entry remains reachable`
        );
      } else {
        assert(
          skipped.phase === "complete" &&
            skipped.locked === "false" &&
            Math.abs(skipped.scrollY - skipped.stageHeight) <= 2,
          `${scenario.name}: skipped entry did not reach the main page`
        );
      }
    }
    if (scenario.homeIntro === "disabled") {
      await page.waitForFunction(() => {
        return ["skipped", "seen"].includes(
          document.body.dataset.homeIntro
        );
      });
      const intro = await page.evaluate(() => {
        return {
          status: document.body.dataset.homeIntro,
          stage: Boolean(document.querySelector("[data-entry-sequence]"))
        };
      });
      assert(
        intro.status === "skipped" && !intro.stage,
        `${scenario.name}: disabled entry is still visible`
      );
    }
    await page.screenshot({
      path: path.join(outputDirectory, `${scenario.name}.png`),
      fullPage: false
    });
  }

  await page.waitForFunction(() => document.body.dataset.pointerEffect);
  if (scenario.knowledgeField) {
    await page.waitForTimeout(260);
  }

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
  assert(
    layout.h1 || scenario.allowNoH1,
    `${scenario.name}: missing H1`
  );
  assert(
    runtimeErrors.length === 0,
    `${scenario.name}: browser errors: ${runtimeErrors.join(" | ")}`
  );

  if (scenario.homeHierarchy) {
    const hierarchy = await page.evaluate(() => {
      return {
        tracks: Array.from(
          document.querySelectorAll(".track-overview-card strong")
        ).map((item) => item.textContent.trim()),
        moduleBands: document.querySelectorAll(".module-band").length,
        unitCards: document.querySelectorAll(".unit-card").length
      };
    });
    assert(
      hierarchy.tracks.some((title) => title.includes("程序")) &&
        hierarchy.tracks.some((title) => title.includes("策划")) &&
        hierarchy.moduleBands === 0 &&
        hierarchy.unitCards === 0,
      `${scenario.name}: homepage hierarchy is ${JSON.stringify(hierarchy)}`
    );
  }

  if (scenario.homeStatistics) {
    const identityFixture = await page.evaluate((activeVisualSettings) => {
      const contributors =
        window.GCK_CONTRIBUTION_STATS?.scopes?.find(
          (scope) => scope.key === "all"
        )?.contributors || [];
      const aliases = contributors.slice(0, 2).map((item) => item.id);
      const revision = window.GCK_CONFIG?.contentVersion || "";
      window.dispatchEvent(
        new CustomEvent("gck:visual-settings", {
          detail: {
            ...activeVisualSettings,
            contribution_graph: {
              version: 2,
              revision,
              identity_aliases: {
                "user:visual-merged": aliases
              },
              links: [
                {
                  contributor_id: "user:visual-merged",
                  contributor_name: "Visual Merged User",
                  last_contributed_at: "2026-08-21T00:00:00Z"
                }
              ]
            }
          }
        })
      );
      return {
        aliases,
        expectedCount: Math.max(0, contributors.length - 1)
      };
    }, visualSettings);
    await page.waitForFunction((expectedCount) => {
      return (
        Number(
          document.querySelector(
            '.intro-stats [data-contribution-count="all"]'
          )?.textContent.replace(/[^\d]/g, "")
        ) === expectedCount
      );
    }, identityFixture.expectedCount);
    const initial = await page.evaluate(() => {
      const stats = Array.from(
        document.querySelectorAll(".intro-stats dd")
      ).map((item) => item.textContent.trim());
      const rows = Array.from(
        document.querySelectorAll("[data-contribution-rows] tr")
      ).map((row) => row.textContent.replace(/\s+/g, " ").trim());
      return {
        stats,
        rows,
        rowIds: Array.from(
          document.querySelectorAll("[data-contribution-rows] tr")
        ).map((row) => row.dataset.contributorId || ""),
        contributorCount: Number(
          document.querySelector(
            '.intro-stats [data-contribution-count="all"]'
          )?.textContent.replace(/[^\d]/g, "")
        ),
        pageStatus: document
          .querySelector("[data-contribution-page-status]")
          ?.textContent.trim(),
        pageSize: document.querySelector(
          "[data-contribution-page-size]"
        )?.value,
        scope: document.querySelector("[data-contribution-scope-title]")
          ?.textContent.trim(),
        horizontalOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      };
    });
    assert(
      initial.stats.length === 4 &&
        initial.stats.every(Boolean) &&
        initial.rows.length === Math.min(3, identityFixture.expectedCount) &&
        initial.rowIds[0] === "user:visual-merged" &&
        new Set(initial.rowIds).size === initial.rowIds.length &&
        initial.contributorCount === identityFixture.expectedCount &&
        initial.pageStatus?.includes(
          `1-${Math.min(3, identityFixture.expectedCount)} / ` +
            identityFixture.expectedCount
        ) &&
        initial.pageSize === "3" &&
        initial.scope === "全部赛道" &&
        initial.horizontalOverflow === 0,
      `${scenario.name}: initial contribution statistics are invalid ` +
        JSON.stringify(initial)
    );
    if (identityFixture.expectedCount > 3) {
      const firstPageIds = initial.rowIds;
      await page.locator("[data-contribution-page-next]").click();
      await page.waitForFunction(() => {
        return document
          .querySelector("[data-contribution-page-status]")
          ?.textContent.includes("第 2 /");
      });
      const nextPage = await page.evaluate(() => {
        return {
          ids: Array.from(
            document.querySelectorAll("[data-contribution-rows] tr")
          ).map((row) => row.dataset.contributorId || ""),
          status: document
            .querySelector("[data-contribution-page-status]")
            ?.textContent.trim()
        };
      });
      assert(
        nextPage.ids.length > 0 &&
          nextPage.ids.every((id) => !firstPageIds.includes(id)) &&
          nextPage.status?.includes("第 2 /"),
        `${scenario.name}: contribution pagination failed ` +
          JSON.stringify(nextPage)
      );
    }
    await page
      .locator("[data-contribution-page-size]")
      .selectOption("10");
    await page
      .locator("[data-contribution-total-limit]")
      .selectOption("all");
    await page.locator("[data-contribution-sort]").selectOption("name");
    await page.waitForFunction((expectedCount) => {
      return (
        document.querySelectorAll("[data-contribution-rows] tr").length ===
        expectedCount
      );
    }, identityFixture.expectedCount);
    const ascendingNames = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll("[data-contribution-rows] th span:last-child")
      ).map((item) => item.textContent.trim());
    });
    const expectedAscending = ascendingNames.slice().sort((left, right) => {
      return left.localeCompare(right, "zh-CN", {
        numeric: true,
        sensitivity: "base"
      });
    });
    assert(
      JSON.stringify(ascendingNames) === JSON.stringify(expectedAscending),
      `${scenario.name}: ascending contributor sort failed`
    );
    await page.locator("[data-contribution-sort-direction]").click();
    const descendingNames = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll("[data-contribution-rows] th span:last-child")
      ).map((item) => item.textContent.trim());
    });
    assert(
      JSON.stringify(descendingNames) ===
        JSON.stringify(expectedAscending.slice().reverse()),
      `${scenario.name}: descending contributor sort failed`
    );
    await page.locator(".contribution-ledger").screenshot({
      path: path.join(
        outputDirectory,
        `${scenario.name}-contribution-controls.png`
      )
    });
    await page.locator('[data-contribution-scope="planning"]').click();
    await page.waitForFunction(() => {
      return document
        .querySelector("[data-contribution-scope-title]")
        ?.textContent.includes("策划赛道");
    });
    const planning = await page.evaluate(() => {
      return {
        rows: document.querySelectorAll(
          "[data-contribution-rows] tr"
        ).length,
        added: document.querySelector(
          '[data-contribution-total="added"]'
        )?.textContent.trim(),
        pressed: document.querySelector(
          '[data-contribution-scope="planning"]'
        )?.getAttribute("aria-pressed")
      };
    });
    assert(
      planning.rows > 0 &&
        planning.added?.startsWith("+") &&
        planning.pressed === "true",
      `${scenario.name}: planning contribution filter failed ` +
        JSON.stringify(planning)
    );
    await page.locator('[data-contribution-period="week"]').click();
    await page.waitForFunction(() => {
      return document
        .querySelector("[data-contribution-scope-summary]")
        ?.textContent.includes("最近 7 天");
    });
    const recent = await page.evaluate(() => {
      return {
        summary: document
          .querySelector("[data-contribution-scope-summary]")
          ?.textContent.trim(),
        pressed: document.querySelector(
          '[data-contribution-period="week"]'
        )?.getAttribute("aria-pressed"),
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      };
    });
    assert(
      recent.summary?.includes("最近 7 天") &&
        recent.pressed === "true" &&
        recent.overflow === 0,
      `${scenario.name}: recent contribution filter failed ` +
        JSON.stringify(recent)
    );
    await page.locator(".contribution-ledger").screenshot({
      path: path.join(
        outputDirectory,
        `${scenario.name}-contributions.png`
      )
    });
  }

  if (scenario.topicOrdering) {
    const ordering = await page.evaluate(() => {
      const heading = Array.from(
        document.querySelectorAll(".module-unit-summary h3")
      ).find((item) =>
        item.textContent.includes("游戏客户端面试复习路线")
      );
      const branch = heading?.closest(".module-unit-branch");
      const groups = Array.from(
        branch?.querySelectorAll(
          ":scope > .module-unit > .module-unit-content > " +
            ".module-unit-content-group"
        ) || []
      );
      return {
        labels: groups.map((group) => {
          return group.querySelector(".module-subunit-list")
            ? "子专题"
            : group.querySelector(".module-unit-content-label")
              ?.textContent.trim() ||
                "文件";
        }),
        subtopicsOpen: groups[0]
          ?.querySelector(".module-subunit-details")
          ?.hasAttribute("open") ?? null,
        child:
          groups[0]?.querySelector(".module-subunit-summary strong")
            ?.textContent.trim() || "",
        file:
          groups[1]?.querySelector(".module-unit-documents a span")
            ?.textContent.trim() || ""
      };
    });
    assert(
      ordering.labels.join(",") === "子专题,文件" &&
        ordering.subtopicsOpen === false &&
        Boolean(ordering.child) &&
        ordering.file.includes("游戏客户端面试知识地图"),
      `${scenario.name}: topic/file ordering is ${JSON.stringify(ordering)}`
    );
  }

  if (scenario.ambient) {
    const ambientCount = await page.locator("[data-site-ambient]").count();
    const visualState = await page.evaluate(() => {
      return {
        catalog: document.body.dataset.catalogBackground,
        reader: document.body.dataset.readerBackground,
        pointer: document.body.dataset.pointerEffect,
        classes: document.body.className,
        readerSurface: document.querySelector(".reading-main")
          ? getComputedStyle(document.querySelector(".reading-main"))
              .backgroundColor
          : ""
      };
    });
    const value =
      scenario.ambient.type === "catalog"
        ? visualState.catalog
        : visualState.reader;
    const expectedClass =
      `visual-${scenario.ambient.type}-${scenario.ambient.style}`;
    assert(
      value === scenario.ambient.style,
      `${scenario.name}: ambient style is ${value}`
    );
    assert(
      visualState.classes.includes(expectedClass),
      `${scenario.name}: missing ${expectedClass}`
    );
    if (
      scenario.ambient.style === "clean" &&
      !visualSettings.pointer_effect_enabled
    ) {
      assert(
        ambientCount === 0,
        `${scenario.name}: clean mode created an ambient canvas`
      );
    } else {
      assert(
        ambientCount === 1,
        `${scenario.name}: ambient canvas count ${ambientCount}`
      );
      if (ambientCount) {
        const firstFrame = await canvasMetrics(
          page,
          "[data-site-ambient]"
        );
        assert(
          firstFrame.painted > 100,
          `${scenario.name}: ambient canvas is blank`
        );
        assert(
          firstFrame.viewport.top === 0 &&
            firstFrame.viewport.right === scenario.viewport.width &&
            firstFrame.viewport.bottom === scenario.viewport.height &&
            firstFrame.viewport.left === 0,
          `${scenario.name}: ambient canvas is not viewport-aligned`
        );
        if (
          scenario.ambient.type === "reader" &&
          scenario.ambient.style !== "clean"
        ) {
          assert(
            visualState.readerSurface.includes("0.58"),
            `${scenario.name}: reader surface hides the ambient canvas`
          );
        }
        if (scenario.reducedMotion) {
          await page.waitForTimeout(180);
          const secondFrame = await canvasMetrics(
            page,
            "[data-site-ambient]"
          );
          assert(
            firstFrame.checksum === secondFrame.checksum,
            `${scenario.name}: reduced-motion canvas is animated`
          );
        }
      }
    }
  }

  if (scenario.pointerEffect !== undefined) {
    const reticleCount = await page.locator(".site-pointer-reticle").count();
    assert(
      reticleCount === (scenario.pointerEffect ? 1 : 0),
      `${scenario.name}: pointer reticle count ${reticleCount}`
    );
    if (scenario.pointerEffect && reticleCount) {
      await page.mouse.move(360, 240);
      await page.waitForTimeout(140);
      const reticle = await page
        .locator(".site-pointer-reticle")
        .evaluate((element) => {
          const match = element.style.transform.match(
            /translate3d\(([-\d.]+)px, ([-\d.]+)px/
          );
          return {
            visible: element.classList.contains("is-visible"),
            x: match ? Number(match[1]) : -1,
            y: match ? Number(match[2]) : -1
          };
        });
      assert(
        reticle.visible && reticle.x > 300 && reticle.y > 190,
        `${scenario.name}: pointer reticle did not follow the cursor`
      );
    }
  }

  if (scenario.readerEditor) {
    const preview = await page.evaluate(() => {
      const rendered = document.querySelector("[data-editable-rendered]");
      const prose = document.querySelector("[data-editable-rendered] .prose");
      const heading = prose && prose.querySelector("h2");
      if (!rendered || !prose || !heading) return null;
      return {
        html: rendered.innerHTML,
        draftOverlay: rendered.hasAttribute("data-draft-overlay"),
        fontSize: getComputedStyle(prose).fontSize,
        lineHeight: getComputedStyle(prose).lineHeight,
        headingSize: getComputedStyle(heading).fontSize,
        headingOffset:
          heading.getBoundingClientRect().top -
          prose.getBoundingClientRect().top,
        borderLeftWidth: getComputedStyle(prose).borderLeftWidth,
        tables: prose.querySelectorAll(".table-scroll > table").length
      };
    });
    await page.locator("[data-edit-mode-trigger]").click();
    await page
      .locator(".inline-editor.is-modern [data-md-live-preview]")
      .waitFor({ state: "visible" });
    const editing = await page.evaluate(() => {
      const panel = document.querySelector(".inline-editor.is-modern");
      const source = panel?.querySelector("[data-inline-input]");
      if (!panel || !source) return null;
      return {
        markdown: source.value,
        sourceMode: panel.dataset.editorMode || "source",
        sourceVisible: !source.hidden,
        liveBlocks: panel.querySelectorAll("[data-md-block]").length,
        inlineToolbar: panel.querySelectorAll(".inline-editor-toolbar").length,
        saveButtons: panel.querySelectorAll("[data-inline-save]").length,
        previewToolbar: document.querySelectorAll(".reader-preview-controls")
          .length,
        localEditButtons: document.querySelectorAll("[data-edit-current]")
          .length,
        modeButtons: panel.querySelectorAll("[data-inline-mode]").length,
        toastEditors: panel.querySelectorAll(".toastui-editor-defaultUI").length,
        visibleButtons: Array.from(panel.querySelectorAll("button")).filter(
          (button) => button.offsetWidth || button.offsetHeight
        ).length,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      };
    });
    assert(preview && editing, `${scenario.name}: reader editor did not mount`);
    if (preview && editing) {
      assert(
        /^##\s+/m.test(editing.markdown) &&
          editing.sourceMode === "preview" &&
          editing.sourceVisible === false &&
          editing.liveBlocks > 0,
        `${scenario.name}: editable Markdown preview is incomplete`
      );
      assert(
        editing.inlineToolbar === 0 &&
          editing.saveButtons === 0 &&
          editing.previewToolbar === 0 &&
          editing.localEditButtons === 0 &&
          editing.modeButtons === 2 &&
          editing.visibleButtons === 2 &&
          editing.toastEditors === 0,
        `${scenario.name}: Markdown mode controls are invalid`
      );
      assert(
        editing.overflow === 0,
        `${scenario.name}: editor caused horizontal overflow`
      );
    }
    await page.locator('[data-inline-mode="source"]').click();
    await page
      .locator(".inline-editor.is-modern [data-inline-input]")
      .waitFor({ state: "visible" });
    const sourceLayout = await page
      .locator(".inline-editor.is-modern [data-inline-input]")
      .evaluate((source) => ({
        height: source.getBoundingClientRect().height,
        scrollHeight: source.scrollHeight
      }));
    assert(
      sourceLayout.height >= 420 &&
        sourceLayout.height + 2 >= sourceLayout.scrollHeight,
      `${scenario.name}: full Markdown source mode is incomplete`
    );
    await page.locator('[data-inline-mode="preview"]').click();
    await page
      .locator(".inline-editor.is-modern [data-md-live-preview]")
      .waitFor({ state: "visible" });
    await page.screenshot({
      path: path.join(outputDirectory, `${scenario.name}-editing.png`),
      fullPage: false
    });
    if (scenario.readerRoundTrip) {
      await page.locator("[data-edit-mode-trigger]").click();
      await page.locator("[data-inline-editor]").waitFor({
        state: "detached"
      });
      const roundTrip = await page.evaluate(() => {
        const rendered = document.querySelector("[data-editable-rendered]");
        return {
          html: rendered?.innerHTML,
          draftOverlay: rendered?.hasAttribute("data-draft-overlay"),
          localBuffers: Object.keys(localStorage).filter((key) => {
            return key.startsWith("gck-reader-buffer:v1:");
          }).length
        };
      });
      assert(
        roundTrip.html === preview.html &&
          roundTrip.draftOverlay === preview.draftOverlay &&
          roundTrip.localBuffers === 0 &&
          previewAttempts === 2 &&
          draftAttempts === 0,
        `${scenario.name}: unchanged edit round trip mutated the document`
      );
    }
    if (scenario.readerLinkNavigation) {
      await page.locator("[data-edit-mode-trigger]").click();
      await page
        .locator(".inline-editor.is-modern [data-md-live-preview]")
        .waitFor({ state: "visible" });
      const editorLink = page
        .locator("[data-visual-editor] .inline-editor-source-preview a")
        .filter({ hasText: "组件存储与查询实现" })
        .first();
      await editorLink.waitFor({ state: "attached" });
      const sourceHref = await editorLink.getAttribute("href");
      await Promise.all([
        page.waitForURL(
          "**/program/knowledge/ecs/06-component-query-implementation/"
        ),
        editorLink.click()
      ]);
      assert(
        sourceHref === "./06-component-query-implementation.md" &&
          page.url().endsWith(
            "/program/knowledge/ecs/06-component-query-implementation/"
          ),
        `${scenario.name}: editor link did not resolve to the reader route`
      );
    }
    if (scenario.readerAutosave) {
      const editableHeading = page
        .locator(
          '[data-visual-editor] [data-md-block]' +
            '[data-source-kind="heading"]'
        )
        .first();
      await editableHeading.dblclick();
      const blockEditor = page.locator(
        ".md-live-preview-editor textarea"
      );
      await blockEditor.waitFor({ state: "visible" });
      await blockEditor.fill("## 1.autosave-check");
      const liveLayout = await blockEditor.evaluate((textarea) => {
        return {
          height: textarea.getBoundingClientRect().height,
          overflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        };
      });
      assert(
        liveLayout.height >= 72 &&
          liveLayout.height <= 180 &&
          liveLayout.overflow === 0,
        `${scenario.name}: live preview block layout is invalid ` +
          JSON.stringify(liveLayout)
      );
      await page.screenshot({
        path: path.join(
          outputDirectory,
          `${scenario.name}-live-preview.png`
        ),
        fullPage: false
      });
      await blockEditor.press("Control+Enter");
      await page
        .locator(
          '[data-visual-editor] [data-md-block]' +
            '[data-source-kind="heading"]'
        )
        .filter({ hasText: "1.autosave-check" })
        .waitFor({ state: "visible" });
      await page.waitForTimeout(250);
      const local = await page.evaluate(() => {
        const item = Object.entries(localStorage).find(([key]) => {
          return key.startsWith("gck-workspace-current:v1:");
        });
        const current = item ? JSON.parse(item[1]) : null;
        const entry = current?.entries.find((candidate) => {
          return candidate.path ===
            document.querySelector("[data-inline-editor]")?.dataset.path;
        });
        const tree = Object.entries(localStorage).find(([key]) => {
          return key.startsWith("gck-workspace-tree:v1:");
        });
        return {
          sync: document.body.dataset.editorSyncState,
          content: entry?.content || "",
          version: current?.version || 0,
          lineDiff: entry?.lineDiff || [],
          diffSummary: entry?.diffSummary || {},
          workspaceRevision: document.body.dataset.workspaceRevision,
          cachedTree: tree ? JSON.parse(tree[1]) : null
        };
      });
      assert(
        local.sync === "local" &&
          local.content.includes("## 1.autosave-check") &&
          !local.content.includes("## 1\\.autosave-check") &&
          local.version === 1 &&
          local.lineDiff.length > 0 &&
          Number(local.diffSummary.modified) > 0 &&
          Boolean(local.workspaceRevision) &&
          Number(local.cachedTree?.updatedAt) > 0,
        `${scenario.name}: edit was not cached without heading escapes ` +
          JSON.stringify(local)
      );
      assert(
        draftAttempts === 0,
        `${scenario.name}: editor wrote a server draft`
      );

      allowDraftWrites = false;
      await page.reload({ waitUntil: "networkidle" });
      await page
        .locator(".inline-editor.is-modern [data-md-live-preview]")
        .waitFor({ state: "visible" });
      const restored = await page.evaluate(() => {
        return {
          content: document.querySelector("[data-inline-input]")?.value,
          sync: document.body.dataset.editorSyncState
        };
      });
      assert(
        restored.content.includes("## 1.autosave-check") &&
          restored.sync === "local",
        `${scenario.name}: Current Tree edit was not restored`
      );
      assert(
        draftWrites.length === 0,
        `${scenario.name}: local editing leaked to server drafts`
      );
    }
    assert(
      runtimeErrors.length === 0,
      `${scenario.name}: editor browser errors: ${runtimeErrors.join(" | ")}`
    );
  }

  if (scenario.workspaceTree) {
    page.on("dialog", (dialog) => dialog.accept());
    const workspace = await page.evaluate((workspaceTitle) => {
      const units = Array.from(
        document.querySelectorAll(".workspace-unit-branch")
      );
      const target = units.find((unit) => {
        return unit
          .querySelector("h3")
          ?.textContent.includes(workspaceTitle);
      });
      return {
        targetStatus: target?.dataset.status || "",
        targetTitle: target?.querySelector("h3")?.textContent || "",
        documents: target
          ? Array.from(
              target.querySelectorAll(
                ":scope > .module-unit > .module-unit-content " +
                  ".module-unit-documents a"
              )
            ).map((link) => ({
              title: link.textContent.trim(),
              status: link.dataset.status || ""
            }))
          : [],
        flatDraftLists: document.querySelectorAll(".draft-content-list").length
      };
    }, scenario.workspaceTitle || "腾讯 2026");
    assert(
      workspace.targetStatus === "A" &&
        workspace.targetTitle.includes(
          scenario.workspaceTitle || "腾讯 2026"
        ) &&
        workspace.documents.length === 1 &&
        workspace.documents.every((item) => item.status === "A") &&
        workspace.flatDraftLists === 0,
      `${scenario.name}: draft topic was not parsed into the module tree ` +
        JSON.stringify(workspace)
    );
    await page.locator("[data-edit-mode-trigger]").click();
    await page.locator(".inline-editor.is-modern").waitFor({
      state: "attached"
    });
    const createControls = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll("[data-create-context]")
      ).filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && element.getClientRects().length;
      }).length;
    });
    assert(
      createControls >= 4,
      `${scenario.name}: create controls are hidden in seamless edit mode`
    );
    const deleteControls = await page.evaluate(() => {
      const visible = Array.from(
        document.querySelectorAll("[data-delete-path]")
      ).filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && element.getClientRects().length;
      });
      return {
        total: visible.length,
        files: visible.filter(
          (element) => element.dataset.deleteKind === "file"
        ).length,
        modules: visible.filter(
          (element) => element.dataset.deleteKind === "directory"
        ).length,
        bigModules: visible.filter(
          (element) =>
            element.dataset.deleteKind === "directory" &&
            element.dataset.deletePath.split("/").filter(Boolean).length === 2
        ).length
      };
    });
    assert(
      deleteControls.files > 0 &&
        deleteControls.modules > 0 &&
        deleteControls.bigModules === 1,
      `${scenario.name}: file, submodule, or big-module delete controls missing ` +
        JSON.stringify(deleteControls)
    );

    if (scenario.workspaceDeleteInteraction === false) {
      await context.close();
      return;
    }
    const fileDelete = page.locator(
      ".workspace-delete-action[data-delete-kind='file']" +
        ":not([data-delete-path*='visual-company'])"
    ).first();
    const deletedPath = await fileDelete.getAttribute("data-delete-path");
    await fileDelete.click();
    await page.waitForFunction(() => {
      return document.querySelector(
        "[data-delete-kind='file'][data-restore-delete='true']"
      );
    });
    const deleted = await page.evaluate((path) => {
      const snapshot = Object.entries(localStorage).find(([key]) => {
        return key.startsWith("gck-workspace-current:v1:");
      });
      const current = snapshot ? JSON.parse(snapshot[1]) : null;
      return current?.entries.find((entry) => entry.path === path);
    }, deletedPath);
    assert(
      deleted?.operation === "delete" && draftWrites.length === 0,
      `${scenario.name}: file delete was not stored as a local D change`
    );
    await page
      .locator(
        `[data-delete-path="${deletedPath}"]` +
          "[data-restore-delete='true']"
      )
      .first()
      .click();
    await page.waitForFunction(
      (path) => {
        return !document.querySelector(
          `[data-delete-path="${path}"][data-restore-delete="true"]`
        );
      },
      deletedPath
    );
    assert(
      draftWrites.length === 0,
      `${scenario.name}: delete undo wrote a server draft`
    );
  }

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
        const nextSectionTop = document
          .querySelector(".contribution-ledger, .catalog-overview")
          .getBoundingClientRect().top;
        return { painted, nextSectionTop, viewportHeight: innerHeight };
      }
    );
    assert(
      field.painted > 100,
      `${scenario.name}: knowledge field is blank`
    );
    assert(
      field.nextSectionTop < field.viewportHeight,
      `${scenario.name}: next homepage section is not visible below the hero`
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
    await page.waitForFunction(() => {
      return document.body.dataset.mermaidState === "ready";
    });
    const mermaid = await page.evaluate(() => {
      const resources = performance
        .getEntriesByType("resource")
        .filter((entry) => {
          return entry.name.includes("/assets/vendor/mermaid/");
        });
      const bootstrap = resources.find((resource) => {
        return resource.name.includes("/mermaid-client.js");
      });
      return {
        diagrams: document.querySelectorAll(".mermaid svg").length,
        prerendered: document.querySelectorAll(
          '.mermaid[data-mermaid-rendered="true"]'
        ).length,
        unrendered: document.querySelectorAll(
          ".mermaid:not([data-mermaid-rendered])"
        ).length,
        renderMs: Number(document.body.dataset.mermaidRenderMs || 0),
        readyMs: Number(document.body.dataset.mermaidReadyMs || 0),
        runtime: document.body.dataset.mermaidRuntime || "",
        bootstrapBytes: bootstrap?.decodedBodySize || 0,
        resourceCount: resources.length,
        commonLoaded: resources.some((resource) => {
          return resource.name.includes("/mermaid-common.js");
        }),
        fallbackLoaded: resources.some((resource) => {
          return resource.name.includes("/mermaid/fallback/");
        }),
        legacyLoaded: performance
          .getEntriesByType("resource")
          .some((resource) => resource.name.includes("/mermaid.min.js"))
      };
    });
    assert(mermaid.diagrams > 0, `${scenario.name}: Mermaid did not render`);
    assert(
      mermaid.readyMs > 0 && mermaid.readyMs < 2500,
      `${scenario.name}: Mermaid SVG was ready after ${mermaid.readyMs}ms`
    );
    assert(
      mermaid.runtime === "prerendered" &&
        mermaid.prerendered === mermaid.diagrams &&
        mermaid.unrendered === 0 &&
        mermaid.renderMs === 0 &&
        mermaid.bootstrapBytes < 10000 &&
        mermaid.resourceCount === 1 &&
        !mermaid.commonLoaded &&
        !mermaid.fallbackLoaded &&
        !mermaid.legacyLoaded,
      `${scenario.name}: Mermaid did not use build-time SVG rendering`
    );
  }

  if (scenario.source) {
    const sourceLength = await page.locator("[data-source-code]").textContent();
    assert(
      sourceLength && sourceLength.length > 100,
      `${scenario.name}: source viewer is empty`
    );
  }

  if (scenario.codeWorkspace) {
    await page.waitForFunction(() => {
      return document
        .querySelector("[data-code-index-status]")
        ?.textContent.includes("索引完成");
    });
    const workspace = await page.evaluate(() => {
      return {
        files: document.querySelectorAll(
          "[data-code-file-tree] [data-code-file]"
        ).length,
        lines: document.querySelectorAll(".code-line").length,
        symbols: document.querySelectorAll(".code-symbol").length,
        generated: Array.from(
          document.querySelectorAll("[data-code-file]")
        ).filter((item) => /(^|\/)(bin|obj)\//.test(item.dataset.codeFile))
          .length
      };
    });
    assert(
      workspace.files > 0 && workspace.lines > 0,
      `${scenario.name}: code workspace is empty`
    );
    assert(
      workspace.symbols > 0,
      `${scenario.name}: symbol navigation is unavailable`
    );
    assert(
      workspace.generated === 0,
      `${scenario.name}: generated files leaked into the workspace`
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
      knowledgeField: true,
      homeHierarchy: true,
      homeStatistics: true,
      homeIntro: "play",
      bootstrapDelay: 3000,
      pointerEffect: true,
      deviceReentry: "play",
      visualSettings: {
        home_intro_enabled: true,
        home_intro_mode: "revisit"
      }
    },
    {
      name: "home-mobile",
      route: "/",
      viewport: { width: 390, height: 844 },
      knowledgeField: true,
      homeStatistics: true,
      homeIntro: "disabled",
      pointerEffect: false,
      visualSettings: { pointer_effect_enabled: false }
    },
    {
      name: "home-intro-unlocked-mobile",
      route: "/",
      viewport: { width: 390, height: 844 },
      homeIntro: "skip",
      visualSettings: {
        home_intro_enabled: true,
        home_intro_mode: "revisit",
        home_intro_lock_scroll: false,
        home_intro_contributor_limit: 4
      }
    },
    {
      name: "home-intro-always-mobile",
      route: "/",
      viewport: { width: 390, height: 844 },
      homeIntro: "play",
      visualSettings: {
        home_intro_enabled: true,
        home_intro_mode: "always",
        home_intro_assembly_duration_ms: 900,
        home_intro_hold_duration_ms: 1200,
        pointer_effect_enabled: false
      }
    },
    {
      name: "home-intro-first-device-mobile",
      route: "/",
      viewport: { width: 390, height: 844 },
      homeIntro: "play",
      deviceReentry: "seen",
      visualSettings: {
        home_intro_enabled: true,
        home_intro_mode: "first",
        pointer_effect_enabled: false
      }
    },
    {
      name: "home-reduced-motion",
      route: "/",
      viewport: { width: 1440, height: 1000 },
      homeIntro: "disabled",
      pointerEffect: false,
      reducedMotion: true,
      visualSettings: {
        home_intro_enabled: true,
        home_intro_mode: "revisit"
      }
    },
    {
      name: "catalog-circuit-desktop",
      route: "/program/knowledge/",
      viewport: { width: 1440, height: 1000 },
      ambient: { type: "catalog", style: "circuit" },
      pointerEffect: true,
      topicOrdering: true
    },
    {
      name: "catalog-constellation-desktop",
      route: "/program/knowledge/",
      viewport: { width: 1440, height: 1000 },
      ambient: { type: "catalog", style: "constellation" },
      pointerEffect: false,
      visualSettings: {
        catalog_background_style: "constellation",
        pointer_effect_enabled: false
      }
    },
    {
      name: "catalog-clean-mobile",
      route: "/program/knowledge/",
      viewport: { width: 390, height: 844 },
      ambient: { type: "catalog", style: "clean" },
      pointerEffect: false,
      visualSettings: {
        catalog_background_style: "clean",
        pointer_effect_enabled: false
      }
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
      route: "/program/interviews/mihoyo/2026-autumn-early-game-client-source-code/04-third-round-answers/",
      viewport: { width: 1024, height: 900 },
      ambient: { type: "reader", style: "blueprint" },
      pointerEffect: true
    },
    {
      name: "article-mobile",
      route: "/program/knowledge/ecs/01-fundamentals/",
      viewport: { width: 390, height: 844 },
      mobileSidebar: true,
      ambient: { type: "reader", style: "clean" },
      pointerEffect: false,
      visualSettings: {
        reader_background_style: "clean",
        pointer_effect_enabled: false
      }
    },
    {
      name: "article-constellation-desktop",
      route: "/program/knowledge/ecs/01-fundamentals/",
      viewport: { width: 1440, height: 1000 },
      ambient: { type: "reader", style: "constellation" },
      pointerEffect: false,
      visualSettings: {
        reader_background_style: "constellation",
        pointer_effect_enabled: false
      }
    },
    {
      name: "article-reduced-motion",
      route: "/program/knowledge/ecs/01-fundamentals/",
      viewport: { width: 1440, height: 1000 },
      ambient: { type: "reader", style: "blueprint" },
      pointerEffect: false,
      reducedMotion: true
    },
    {
      name: "reader-editor-desktop",
      route: "/program/knowledge/engine/",
      viewport: { width: 1440, height: 1000 },
      readerEditor: true,
      readerAutosave: true,
      visualSettings: { pointer_effect_enabled: false }
    },
    {
      name: "reader-editor-roundtrip-desktop",
      route: "/program/knowledge/ecs/01-fundamentals/",
      viewport: { width: 1440, height: 1000 },
      readerEditor: true,
      readerRoundTrip: true,
      readerLinkNavigation: true,
      visualSettings: { pointer_effect_enabled: false }
    },
    {
      name: "reader-editor-mobile",
      route: "/program/knowledge/ecs/01-fundamentals/",
      viewport: { width: 390, height: 844 },
      readerEditor: true,
      readerAutosave: true,
      visualSettings: { pointer_effect_enabled: false }
    },
    {
      name: "module-draft-tree-desktop",
      route: "/program/interviews/",
      viewport: { width: 1440, height: 1000 },
      authenticated: true,
      workspaceTree: true,
      workspaceTitle: "视觉测试公司 2027",
      drafts: [
        {
          id: 9101,
          path:
            "program/interviews/visual-company/" +
            "2027-game-client/README.md",
          operation: "upsert",
          content:
            "# 视觉测试公司 2027\n\n" +
            "用于验证未提交专题树与删除入口。\n",
          base_sha: null,
          revision: 1,
          created_at: "2026-08-17T00:00:00Z",
          updated_at: "2026-08-17T00:00:00Z"
        },
        {
          id: 9102,
          path:
            "program/interviews/visual-company/" +
            "2027-game-client/01-first-round.md",
          operation: "upsert",
          content: "# 视觉测试一面\n\n第一轮面试内容。\n",
          base_sha: null,
          revision: 1,
          created_at: "2026-08-17T00:00:00Z",
          updated_at: "2026-08-17T00:00:00Z"
        }
      ],
      visualSettings: { pointer_effect_enabled: false }
    },
    {
      name: "module-delete-controls-mobile",
      route: "/program/interviews/",
      viewport: { width: 390, height: 844 },
      authenticated: true,
      workspaceTree: true,
      workspaceTitle: "视觉测试公司 2027",
      workspaceDeleteInteraction: false,
      drafts: [
        {
          id: 9201,
          path:
            "program/interviews/visual-company/" +
            "2027-game-client/README.md",
          operation: "upsert",
          content:
            "# 视觉测试公司 2027\n\n用于验证移动端删除入口。\n",
          base_sha: null,
          revision: 1,
          created_at: "2026-08-17T00:00:00Z",
          updated_at: "2026-08-17T00:00:00Z"
        },
        {
          id: 9202,
          path:
            "program/interviews/visual-company/" +
            "2027-game-client/01-first-round.md",
          operation: "upsert",
          content: "# 视觉测试一面\n\n第一轮面试内容。\n",
          base_sha: null,
          revision: 1,
          created_at: "2026-08-17T00:00:00Z",
          updated_at: "2026-08-17T00:00:00Z"
        }
      ],
      visualSettings: { pointer_effect_enabled: false }
    },
    {
      name: "mermaid-desktop",
      route: "/program/knowledge/ecs/",
      viewport: { width: 1440, height: 1000 },
      mermaid: true
    },
    {
      name: "source-desktop",
      route: "/program/examples/algorithms/mihoyo-third-round/files/main.cpp/",
      viewport: { width: 1440, height: 1000 },
      source: true
    },
    {
      name: "code-workspace-desktop",
      route:
        "/code/workspace/?project=csharp-extensible-combat-ecs",
      viewport: { width: 1440, height: 1000 },
      allowNoH1: true,
      codeWorkspace: true
    },
    {
      name: "code-workspace-mobile",
      route:
        "/code/workspace/?project=csharp-extensible-combat-ecs",
      viewport: { width: 390, height: 844 },
      allowNoH1: true,
      codeWorkspace: true
    }
  ];

  const selectedScenarios = process.env.VISUAL_SCENARIO
    ? scenarios.filter((scenario) => {
        return scenario.name === process.env.VISUAL_SCENARIO;
      })
    : scenarios;
  if (!selectedScenarios.length) {
    throw new Error(
      `Unknown visual scenario: ${process.env.VISUAL_SCENARIO}`
    );
  }
  for (const scenario of selectedScenarios) {
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
