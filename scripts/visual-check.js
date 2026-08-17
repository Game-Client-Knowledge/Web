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
  home_intro_contributor_limit: 8
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
  await context.route("**/editor/api/preview", (route) => {
    previewAttempts += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        html: "<h1>Preview</h1><p>Preview content</p>"
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
        coreOverlap: stage?.dataset.contributorCoreOverlap
      };
    });
    assert(
      assembled.rotation > intro.rotation &&
        assembled.coreOverlap === "false",
      `${scenario.name}: central frames or contributors did not move safely`
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
      const knowledge = document.querySelector(
        '[aria-labelledby="module-knowledge"]'
      );
      return {
        rootCards: knowledge?.querySelectorAll(":scope .unit-card").length,
        cppChildren: Array.from(
          knowledge?.querySelectorAll(".unit-card-children span") || []
        ).map((item) => item.textContent.trim())
      };
    });
    assert(
      hierarchy.rootCards === 5 &&
        hierarchy.cppChildren.some((title) => title.includes("C++ 多态")),
      `${scenario.name}: homepage hierarchy is ${JSON.stringify(hierarchy)}`
    );
  }

  if (scenario.topicOrdering) {
    const ordering = await page.evaluate(() => {
      const heading = Array.from(
        document.querySelectorAll(".module-unit-summary h3")
      ).find((item) => item.textContent.includes("C++ 基础知识"));
      const branch = heading?.closest(".module-unit-branch");
      const groups = Array.from(
        branch?.querySelectorAll(
          ":scope > .module-unit > .module-unit-content > " +
            ".module-unit-content-group"
        ) || []
      );
      return {
        labels: groups.map((group) => {
          return group.querySelector(".module-unit-content-label")
            ?.textContent.trim() || "文件";
        }),
        child:
          groups[0]?.querySelector(".module-unit-branch.is-subunit h3")
            ?.textContent.trim() || "",
        file:
          groups[1]?.querySelector(".module-unit-documents a span")
            ?.textContent.trim() || ""
      };
    });
    assert(
      ordering.labels.join(",") === "子专题,文件" &&
        ordering.child.includes("C++ 多态") &&
        ordering.file.includes("C++ 基础知识"),
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
        headingTop: heading.getBoundingClientRect().top
      };
    });
    await page.locator("[data-edit-mode-trigger]").click();
    await page
      .locator(".toastui-editor-ww-container .ProseMirror h2")
      .first()
      .waitFor({ state: "attached" });
    const editing = await page.evaluate(() => {
      const panel = document.querySelector(".inline-editor.is-modern");
      const prose = panel?.querySelector(
        ".toastui-editor-ww-container .ProseMirror"
      );
      const heading = prose?.querySelector("h2");
      const toolbar = panel?.querySelector(".toastui-editor-toolbar");
      if (!panel || !prose || !heading) return null;
      return {
        fontSize: getComputedStyle(prose).fontSize,
        lineHeight: getComputedStyle(prose).lineHeight,
        headingSize: getComputedStyle(heading).fontSize,
        headingTop: heading.getBoundingClientRect().top,
        inlineToolbar: panel.querySelectorAll(".inline-editor-toolbar").length,
        saveButtons: panel.querySelectorAll("[data-inline-save]").length,
        previewToolbar: document.querySelectorAll(".reader-preview-controls")
          .length,
        localEditButtons: document.querySelectorAll("[data-edit-current]")
          .length,
        toastToolbar: toolbar ? getComputedStyle(toolbar).display : "absent",
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
        preview.fontSize === editing.fontSize &&
          preview.lineHeight === editing.lineHeight &&
          preview.headingSize === editing.headingSize,
        `${scenario.name}: reader typography changed`
      );
      assert(
        Math.abs(preview.headingTop - editing.headingTop) <= 24,
        `${scenario.name}: reader content shifted vertically`
      );
      assert(
        editing.inlineToolbar === 0 &&
          editing.saveButtons === 0 &&
          editing.previewToolbar === 0 &&
          editing.localEditButtons === 0 &&
          editing.visibleButtons === 0 &&
          ["none", "absent"].includes(editing.toastToolbar),
        `${scenario.name}: editor controls are visible`
      );
      assert(
        editing.overflow === 0,
        `${scenario.name}: editor caused horizontal overflow`
      );
    }
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
          previewAttempts === 0 &&
          draftAttempts === 0,
        `${scenario.name}: unchanged edit round trip mutated the document`
      );
    }
    if (scenario.readerLinkNavigation) {
      await page.locator("[data-edit-mode-trigger]").click();
      const editorLink = page
        .locator(".toastui-editor-ww-container .ProseMirror a")
        .filter({ hasText: "组件存储与查询实现" })
        .first();
      await editorLink.waitFor({ state: "attached" });
      const sourceHref = await editorLink.getAttribute("href");
      await Promise.all([
        page.waitForURL(
          "**/knowledge/ecs/06-component-query-implementation/"
        ),
        editorLink.click()
      ]);
      assert(
        sourceHref === "./06-component-query-implementation.md" &&
          page.url().endsWith(
            "/knowledge/ecs/06-component-query-implementation/"
          ),
        `${scenario.name}: editor link did not resolve to the reader route`
      );
    }
    if (scenario.readerAutosave) {
      const heading = page
        .locator(".toastui-editor-ww-container .ProseMirror h2")
        .first();
      await heading.click({ clickCount: 3 });
      await page.keyboard.type("1.autosave-check");
      await page.waitForTimeout(250);
      const local = await page.evaluate(() => {
        const item = Object.entries(localStorage).find(([key]) => {
          return key.startsWith("gck-reader-buffer:v1:");
        });
        return {
          sync: document.body.dataset.editorSyncState,
          content: item ? JSON.parse(item[1]).content : ""
        };
      });
      assert(
        local.sync === "local" &&
          local.content.includes("## 1.autosave-check") &&
          !local.content.includes("## 1\\.autosave-check"),
        `${scenario.name}: edit was not cached without heading escapes`
      );
      assert(
        draftAttempts === 0,
        `${scenario.name}: draft synced before the configured interval`
      );

      allowDraftWrites = false;
      await page.reload({ waitUntil: "networkidle" });
      await page
        .locator(".toastui-editor-ww-container .ProseMirror h2")
        .first()
        .waitFor({ state: "attached" });
      const restored = await page.evaluate(() => {
        return {
          heading: document.querySelector(
            ".toastui-editor-ww-container .ProseMirror h2"
          )?.textContent,
          sync: document.body.dataset.editorSyncState
        };
      });
      assert(
        restored.heading === "1.autosave-check" &&
          restored.sync === "local",
        `${scenario.name}: local edit was not restored after failed sync`
      );

      allowDraftWrites = true;
      await page.waitForTimeout(61000);
      const synchronized = await page.evaluate(() => {
        return {
          sync: document.body.dataset.editorSyncState,
          buffers: Object.keys(localStorage).filter((key) => {
            return key.startsWith("gck-reader-buffer:v1:");
          }).length
        };
      });
      assert(
        draftWrites.length === 1 &&
          draftWrites[0].content.includes("## 1.autosave-check") &&
          !draftWrites[0].content.includes("## 1\\.autosave-check"),
        `${scenario.name}: configured draft sync is invalid`
      );
      assert(
        synchronized.sync === "synced" && synchronized.buffers === 0,
        `${scenario.name}: synchronized local buffer was not cleared`
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
        workspace.documents.length === 2 &&
        workspace.documents.every((item) => item.status === "A") &&
        workspace.flatDraftLists === 0,
      `${scenario.name}: draft topic was not parsed into the module tree`
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
            !element.dataset.deletePath.includes("/")
        ).length
      };
    });
    assert(
      deleteControls.files > 0 &&
        deleteControls.modules > 0 &&
        deleteControls.bigModules === 1,
      `${scenario.name}: file, submodule, or big-module delete controls missing`
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
    const deleteRequest = page.waitForRequest((request) => {
      if (
        request.method() !== "PUT" ||
        !request.url().includes("/editor/api/drafts")
      ) {
        return false;
      }
      try {
        const payload = request.postDataJSON();
        return (
          payload.path === deletedPath &&
          payload.operation === "delete"
        );
      } catch {
        return false;
      }
    });
    await fileDelete.click();
    await deleteRequest;
    await page.waitForFunction(() => {
      return document.querySelector(
        "[data-delete-kind='file'][data-restore-delete='true']"
      );
    });
    assert(
      draftWrites.some(
        (write) =>
          write.path === deletedPath && write.operation === "delete"
      ),
      `${scenario.name}: file delete was not synchronized as a D change`
    );
    const undoRequest = page.waitForRequest((request) => {
      return (
        request.method() === "DELETE" &&
        request.url().includes("/editor/api/drafts/")
      );
    });
    await page
      .locator(
        `[data-delete-path="${deletedPath}"]` +
          "[data-restore-delete='true']"
      )
      .first()
      .click();
    await undoRequest;
    await page.waitForFunction(
      (path) => {
        return !document.querySelector(
          `[data-delete-path="${path}"][data-restore-delete="true"]`
        );
      },
      deletedPath
    );
    assert(
      draftDeletes === 1,
      `${scenario.name}: delete undo did not discard the server draft`
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
      route: "/knowledge/",
      viewport: { width: 1440, height: 1000 },
      ambient: { type: "catalog", style: "circuit" },
      pointerEffect: true,
      topicOrdering: true
    },
    {
      name: "catalog-constellation-desktop",
      route: "/knowledge/",
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
      route: "/knowledge/",
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
      route: "/interviews/mihoyo/2026-autumn-early-game-client-source-code/04-third-round-answers/",
      viewport: { width: 1024, height: 900 },
      ambient: { type: "reader", style: "blueprint" },
      pointerEffect: true
    },
    {
      name: "article-mobile",
      route: "/knowledge/ecs/01-fundamentals/",
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
      route: "/knowledge/ecs/01-fundamentals/",
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
      route: "/knowledge/ecs/01-fundamentals/",
      viewport: { width: 1440, height: 1000 },
      ambient: { type: "reader", style: "blueprint" },
      pointerEffect: false,
      reducedMotion: true
    },
    {
      name: "reader-editor-desktop",
      route: "/knowledge/ecs/01-fundamentals/",
      viewport: { width: 1440, height: 1000 },
      readerEditor: true,
      readerAutosave: true,
      visualSettings: { pointer_effect_enabled: false }
    },
    {
      name: "reader-editor-roundtrip-desktop",
      route: "/knowledge/ecs/01-fundamentals/",
      viewport: { width: 1440, height: 1000 },
      readerEditor: true,
      readerRoundTrip: true,
      readerLinkNavigation: true,
      visualSettings: { pointer_effect_enabled: false }
    },
    {
      name: "reader-editor-mobile",
      route: "/knowledge/ecs/01-fundamentals/",
      viewport: { width: 390, height: 844 },
      readerEditor: true,
      visualSettings: { pointer_effect_enabled: false }
    },
    {
      name: "module-draft-tree-desktop",
      route: "/interviews/",
      viewport: { width: 1440, height: 1000 },
      authenticated: true,
      workspaceTree: true,
      workspaceTitle: "视觉测试公司 2027",
      drafts: [
        {
          id: 9101,
          path:
            "interviews/visual-company/" +
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
            "interviews/visual-company/" +
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
      route: "/interviews/",
      viewport: { width: 390, height: 844 },
      authenticated: true,
      workspaceTree: true,
      workspaceTitle: "视觉测试公司 2027",
      workspaceDeleteInteraction: false,
      drafts: [
        {
          id: 9201,
          path:
            "interviews/visual-company/" +
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
            "interviews/visual-company/" +
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
      route: "/knowledge/ecs/",
      viewport: { width: 1440, height: 1000 },
      mermaid: true
    },
    {
      name: "source-desktop",
      route: "/examples/algorithms/mihoyo-third-round/files/main.cpp/",
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
