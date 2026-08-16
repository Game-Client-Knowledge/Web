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
  home_intro_enabled: false
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
  const draftWrites = [];
  const visualSettings = {
    ...defaultVisualSettings,
    ...(scenario.visualSettings || {})
  };
  const context = await browser.newContext({
    viewport: scenario.viewport,
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: scenario.reducedMotion ? "reduce" : "no-preference"
  });
  await context.route("**/editor/api/bootstrap**", (route) => {
    const session = scenario.readerEditor
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
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        config: {
          edit_policy: "local_authenticated",
          registration_enabled: true,
          pr_auto_close_days: 7,
          reader_edit_mode: "new",
          reader_diff_enabled: true,
          smtp_enabled: false,
          github_oauth_enabled: true,
          github_submission_enabled: true,
          ...visualSettings
        },
        session,
        drafts: [],
        active_draft_html: null
      })
    });
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
  await context.route("**/editor/api/drafts", async (route) => {
    if (route.request().method() !== "PUT") {
      return route.fallback();
    }
    draftAttempts += 1;
    if (!allowDraftWrites) {
      return route.abort("internetdisconnected");
    }
    const payload = route.request().postDataJSON();
    draftWrites.push(payload);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: 1000,
        path: payload.path,
        operation: "upsert",
        content: payload.content,
        base_sha: payload.base_sha,
        revision: draftWrites.length,
        created_at: "2026-08-17T00:00:00Z",
        updated_at: "2026-08-17T00:00:00Z"
      })
    });
  });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  const navigationStarted = Date.now();
  await page.goto(`${baseUrl}${scenario.route}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.dataset.visualType);

  if (scenario.homeIntro === "play") {
    await page.locator("[data-entry-sequence]").waitFor({
      state: "visible"
    });
    await page.waitForTimeout(260);
    const intro = await page.evaluate(() => {
      return {
        title: document
          .querySelector(".site-entry-copy")
          ?.textContent.replace(/\s+/g, " ")
          .trim(),
        contributors: document.querySelectorAll(".site-entry-copy b").length,
        progress: document.querySelector(".site-entry-progress")?.style
          .transform
      };
    });
    const introCanvas = await canvasMetrics(
      page,
      "[data-entry-sequence] canvas"
    );
    assert(
      intro.title?.includes("Game Client Knowledge"),
      `${scenario.name}: entry title is missing`
    );
    assert(
      intro.contributors >= 2,
      `${scenario.name}: entry contributors ${intro.contributors}`
    );
    assert(
      intro.progress?.startsWith("scaleX("),
      `${scenario.name}: entry progress is not running`
    );
    assert(
      introCanvas.painted > 1000,
      `${scenario.name}: entry canvas is blank`
    );
    await page.screenshot({
      path: path.join(outputDirectory, `${scenario.name}.png`),
      fullPage: false
    });
    await page.waitForFunction(() => {
      return document.body.dataset.homeIntro === "complete";
    });
    const completedAfter = Date.now() - navigationStarted;
    await page.locator("[data-entry-sequence]").waitFor({
      state: "detached"
    });
    const detachedAfter = Date.now() - navigationStarted;
    assert(
      completedAfter >= 1200 && completedAfter <= 2300,
      `${scenario.name}: entry completed after ${completedAfter}ms`
    );
    assert(
      detachedAfter >= 1450 && detachedAfter <= 2600,
      `${scenario.name}: entry detached after ${detachedAfter}ms`
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.body.dataset.homeIntro);
    const replay = await page.evaluate(() => {
      return {
        status: document.body.dataset.homeIntro,
        overlay: Boolean(document.querySelector("[data-entry-sequence]"))
      };
    });
    assert(
      replay.status === "seen" && !replay.overlay,
      `${scenario.name}: entry replayed in the same session`
    );
  } else {
    if (scenario.homeIntro === "skip") {
      await page.locator("[data-entry-sequence]").waitFor({
        state: "visible"
      });
      const skipStarted = Date.now();
      await page.locator("[data-entry-sequence]").click({
        position: { x: 8, y: 8 }
      });
      await page.locator("[data-entry-sequence]").waitFor({
        state: "detached"
      });
      const skippedAfter = Date.now() - skipStarted;
      assert(
        skippedAfter < 600,
        `${scenario.name}: entry skip took ${skippedAfter}ms`
      );
    }
    if (scenario.homeIntro === "disabled") {
      await page.waitForFunction(() => document.body.dataset.homeIntro);
      const intro = await page.evaluate(() => {
        return {
          status: document.body.dataset.homeIntro,
          overlay: Boolean(document.querySelector("[data-entry-sequence]"))
        };
      });
      assert(
        intro.status === "skipped" && !intro.overlay,
        `${scenario.name}: disabled entry is still visible`
      );
    }
    await page.screenshot({
      path: path.join(outputDirectory, `${scenario.name}.png`),
      fullPage: false
    });
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

  if (scenario.ambient) {
    const ambientCount = await page.locator("[data-site-ambient]").count();
    const visualState = await page.evaluate(() => {
      return {
        catalog: document.body.dataset.catalogBackground,
        reader: document.body.dataset.readerBackground,
        pointer: document.body.dataset.pointerEffect,
        classes: document.body.className
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
      const prose = document.querySelector("[data-editable-rendered] .prose");
      const heading = prose && prose.querySelector("h2");
      if (!prose || !heading) return null;
      return {
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
        Math.abs(preview.headingTop - editing.headingTop) <= 2,
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
        `${scenario.name}: draft synced before the 30s interval`
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
      await page.waitForTimeout(31000);
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
        `${scenario.name}: 30s draft sync is invalid`
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
      homeIntro: "play",
      pointerEffect: true,
      visualSettings: { home_intro_enabled: true }
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
      name: "home-intro-skip-mobile",
      route: "/",
      viewport: { width: 390, height: 844 },
      homeIntro: "skip",
      visualSettings: { home_intro_enabled: true }
    },
    {
      name: "home-reduced-motion",
      route: "/",
      viewport: { width: 1440, height: 1000 },
      homeIntro: "disabled",
      pointerEffect: false,
      reducedMotion: true,
      visualSettings: { home_intro_enabled: true }
    },
    {
      name: "catalog-circuit-desktop",
      route: "/knowledge/",
      viewport: { width: 1440, height: 1000 },
      ambient: { type: "catalog", style: "circuit" },
      pointerEffect: true
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
      name: "reader-editor-mobile",
      route: "/knowledge/ecs/01-fundamentals/",
      viewport: { width: 390, height: 844 },
      readerEditor: true,
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
