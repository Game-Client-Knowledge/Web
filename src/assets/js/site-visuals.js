(function () {
  "use strict";

  const defaults = {
    catalog_background_style: "circuit",
    reader_background_style: "blueprint",
    pointer_effect_enabled: true,
    home_intro_enabled: true,
    home_intro_mode: "revisit",
    home_intro_duration_ms: 3000,
    home_intro_assembly_duration_ms: 1680,
    home_intro_hold_duration_ms: 630,
    home_intro_lock_scroll: true,
    home_intro_contributor_limit: 8,
    home_content_mask_enabled: false,
    home_content_idle_timeout_seconds: 30
  };
  const HOME_INTRO_SETTINGS_CACHE = "gck-home-intro-settings";
  let releaseHomeIntro;
  let homeIntroReleased = false;
  let cancelHomeIntro = null;
  let updateHomeIntroSettings = null;
  window.GCK_HOME_INTRO_READY = new Promise((resolve) => {
    releaseHomeIntro = resolve;
  });

  function markHomeIntroReady(status) {
    document.body.dataset.homeIntro = status;
    if (!homeIntroReleased) {
      homeIntroReleased = true;
      releaseHomeIntro(status);
    }
  }

  function normalizeHomeIntroSettings(settings) {
    const durationInput = Number(settings.home_intro_duration_ms);
    const duration = Math.max(
      1500,
      Math.min(
        20320,
        Number.isFinite(durationInput) ? durationInput : 3000
      )
    );
    const assemblyInput =
      settings.home_intro_assembly_duration_ms == null
        ? Number.NaN
        : Number(settings.home_intro_assembly_duration_ms);
    const holdInput =
      settings.home_intro_hold_duration_ms == null
        ? Number.NaN
        : Number(settings.home_intro_hold_duration_ms);
    const assemblyDuration = Math.max(
      500,
      Math.min(
        10000,
        Number.isFinite(assemblyInput)
          ? assemblyInput
          : Math.round(duration * 0.56)
      )
    );
    const holdDuration = Math.max(
      0,
      Math.min(
        10000,
        Number.isFinite(holdInput)
          ? holdInput
          : Math.round(duration * 0.21)
      )
    );
    const scrollDuration = Math.max(
      320,
      duration - assemblyDuration - holdDuration
    );
    const contributorLimit = Number(settings.home_intro_contributor_limit);
    const mode = ["off", "always", "revisit", "first"].includes(
      settings.home_intro_mode
    )
      ? settings.home_intro_mode
      : settings.home_intro_enabled === false
        ? "off"
        : "revisit";
    return {
      ...settings,
      home_intro_enabled: mode !== "off",
      home_intro_mode: mode,
      home_intro_duration_ms:
        assemblyDuration + holdDuration + scrollDuration,
      home_intro_assembly_duration_ms: assemblyDuration,
      home_intro_hold_duration_ms: holdDuration,
      home_intro_lock_scroll: settings.home_intro_lock_scroll !== false,
      home_intro_contributor_limit: Math.max(
        1,
        Math.min(
          10,
          Number.isFinite(contributorLimit) ? contributorLimit : 8
        )
      )
    };
  }

  function readCachedHomeIntroSettings() {
    try {
      const cached = JSON.parse(
        window.localStorage.getItem(HOME_INTRO_SETTINGS_CACHE) || "null"
      );
      if (cached && typeof cached === "object") {
        const merged = { ...defaults, ...cached };
        if (!Object.hasOwn(cached, "home_intro_mode")) {
          merged.home_intro_mode =
            cached.home_intro_enabled === false ? "off" : "revisit";
        }
        if (!Object.hasOwn(cached, "home_intro_assembly_duration_ms")) {
          merged.home_intro_assembly_duration_ms = undefined;
        }
        if (!Object.hasOwn(cached, "home_intro_hold_duration_ms")) {
          merged.home_intro_hold_duration_ms = undefined;
        }
        return normalizeHomeIntroSettings(merged);
      }
      if (window.localStorage.getItem("gck-home-intro-enabled") === "0") {
        return { ...defaults, home_intro_enabled: false };
      }
    } catch {
      // The enabled defaults remain available without local storage.
    }
    return { ...defaults };
  }

  function cacheHomeIntroSettings(settings) {
    try {
      window.localStorage.setItem(
        HOME_INTRO_SETTINGS_CACHE,
        JSON.stringify({
          home_intro_enabled: settings.home_intro_enabled,
          home_intro_mode: settings.home_intro_mode,
          home_intro_duration_ms: settings.home_intro_duration_ms,
          home_intro_assembly_duration_ms:
            settings.home_intro_assembly_duration_ms,
          home_intro_hold_duration_ms:
            settings.home_intro_hold_duration_ms,
          home_intro_lock_scroll: settings.home_intro_lock_scroll,
          home_intro_contributor_limit:
            settings.home_intro_contributor_limit,
          home_content_mask_enabled:
            settings.home_content_mask_enabled,
          home_content_idle_timeout_seconds:
            settings.home_content_idle_timeout_seconds,
          home_background_style: settings.home_background_style,
          home_star_scope: settings.home_star_scope,
          home_star_relation_visibility:
            settings.home_star_relation_visibility,
          home_star_strong_relation_style:
            settings.home_star_strong_relation_style,
          home_star_reference_relation_style:
            settings.home_star_reference_relation_style,
          home_star_contributor_relation_style:
            settings.home_star_contributor_relation_style,
          home_star_brightness_variation_enabled:
            settings.home_star_brightness_variation_enabled,
          home_star_brightness_variation_amount:
            settings.home_star_brightness_variation_amount,
          home_star_brightness_transition_ms:
            settings.home_star_brightness_transition_ms,
          home_star_brightness_interval_ms:
            settings.home_star_brightness_interval_ms,
          home_star_color_random_enabled:
            settings.home_star_color_random_enabled,
          home_star_illumination_rule:
            settings.home_star_illumination_rule,
          home_star_active_edge_mode:
            settings.home_star_active_edge_mode,
          home_star_illumination_depth:
            settings.home_star_illumination_depth,
          home_star_selection_duration_ms:
            settings.home_star_selection_duration_ms,
          home_star_label_duration_ms:
            settings.home_star_label_duration_ms,
          home_star_brightness_rules:
            settings.home_star_brightness_rules
        })
      );
      window.localStorage.setItem(
        "gck-home-intro-enabled",
        settings.home_intro_enabled ? "1" : "0"
      );
    } catch {
      // Visual settings still apply to the current page.
    }
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return function () {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pageVisualType() {
    if (document.body.classList.contains("page-module")) return "catalog";
    if (document.body.classList.contains("page-document")) return "reader";
    if (document.body.classList.contains("page-home")) return "home";
    return "";
  }

  function createCanvas(className, attribute) {
    const canvas = document.createElement("canvas");
    canvas.className = className;
    canvas.setAttribute(attribute, "");
    canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(canvas);
    return canvas;
  }

  function createAmbientField(style, pointerEnabled, reducedMotion) {
    if (style === "clean" && !pointerEnabled) {
      return function () {};
    }
    const canvas = createCanvas(
      "site-ambient-canvas",
      "data-site-ambient"
    );
    const context = canvas.getContext("2d");
    const random = seededRandom(0x47434b);
    const pointer = { x: 0, y: 0, active: false };
    let width = 1;
    let height = 1;
    let ratio = 1;
    let frame = 0;
    let visible = true;
    let particles = [];
    let circuits = [];

    function createGeometry() {
      const count = Math.max(
        24,
        Math.min(width < 700 ? 34 : 72, Math.round(width * height / 18000))
      );
      particles = Array.from({ length: count }, (_, index) => ({
        x: random() * width,
        y: random() * height,
        vx: (random() - 0.5) * 0.17,
        vy: (random() - 0.5) * 0.17,
        size: 0.7 + random() * 1.5,
        phase: random() * Math.PI * 2,
        tone: index % 5
      }));
      circuits = Array.from({ length: width < 700 ? 10 : 20 }, () => ({
        x: random() * width,
        y: random() * height,
        length: 50 + random() * 170,
        vertical: random() > 0.56,
        phase: random() * Math.PI * 2
      }));
    }

    function resize() {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      createGeometry();
      draw(0);
    }

    function drawGrid(time, blueprint) {
      const step = blueprint ? 32 : 48;
      const offset = reducedMotion ? 0 : (time * 0.004) % step;
      context.lineWidth = 0.6;
      for (let x = -step + offset; x < width + step; x += step) {
        context.strokeStyle = blueprint
          ? "rgba(38, 112, 126, 0.16)"
          : "rgba(24, 112, 93, 0.11)";
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      for (let y = -step + offset; y < height + step; y += step) {
        context.strokeStyle = blueprint
          ? "rgba(38, 112, 126, 0.16)"
          : "rgba(24, 112, 93, 0.11)";
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
    }

    function drawCircuit(time) {
      drawGrid(time, false);
      circuits.forEach((item) => {
        const pulse = 0.5 + Math.sin(time * 0.001 + item.phase) * 0.5;
        context.strokeStyle = `rgba(20, 116, 95, ${0.09 + pulse * 0.09})`;
        context.fillStyle = `rgba(180, 128, 34, ${0.16 + pulse * 0.12})`;
        context.lineWidth = 0.8;
        context.beginPath();
        context.moveTo(item.x, item.y);
        if (item.vertical) {
          context.lineTo(item.x, item.y + item.length * 0.45);
          context.lineTo(
            item.x + (item.phase > Math.PI ? -24 : 24),
            item.y + item.length * 0.45
          );
          context.lineTo(
            item.x + (item.phase > Math.PI ? -24 : 24),
            item.y + item.length
          );
        } else {
          context.lineTo(item.x + item.length * 0.45, item.y);
          context.lineTo(
            item.x + item.length * 0.45,
            item.y + (item.phase > Math.PI ? -24 : 24)
          );
          context.lineTo(
            item.x + item.length,
            item.y + (item.phase > Math.PI ? -24 : 24)
          );
        }
        context.stroke();
        context.fillRect(item.x - 2, item.y - 2, 4, 4);
      });
    }

    function drawConstellation(time) {
      const distanceLimit = width < 700 ? 84 : 124;
      particles.forEach((particle, left) => {
        for (let right = left + 1; right < particles.length; right += 1) {
          const other = particles[right];
          const dx = particle.x - other.x;
          const dy = particle.y - other.y;
          const distance = Math.hypot(dx, dy);
          if (distance > distanceLimit) continue;
          context.strokeStyle =
            `rgba(25, 113, 94, ${0.22 * (1 - distance / distanceLimit)})`;
          context.lineWidth = 0.65;
          context.beginPath();
          context.moveTo(particle.x, particle.y);
          context.lineTo(other.x, other.y);
          context.stroke();
        }
        const pulse =
          0.65 + Math.sin(time * 0.0014 + particle.phase) * 0.35;
        context.fillStyle =
          particle.tone === 0
            ? `rgba(178, 125, 30, ${0.55 * pulse})`
            : `rgba(23, 121, 101, ${0.62 * pulse})`;
        context.beginPath();
        context.arc(
          particle.x,
          particle.y,
          particle.size,
          0,
          Math.PI * 2
        );
        context.fill();
      });
    }

    function drawBlueprint(time) {
      drawGrid(time, true);
      const baseline = height * 0.54;
      context.strokeStyle = "rgba(31, 107, 121, 0.28)";
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x <= width; x += 6) {
        const y =
          baseline +
          Math.sin(x * 0.012 + time * 0.00035) * 34 +
          Math.cos(x * 0.004 - time * 0.0002) * 19;
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      context.strokeStyle = "rgba(181, 126, 28, 0.24)";
      context.beginPath();
      context.moveTo(width * 0.1, height * 0.72);
      context.bezierCurveTo(
        width * 0.34,
        height * 0.28,
        width * 0.66,
        height * 0.84,
        width * 0.9,
        height * 0.34
      );
      context.stroke();
    }

    function drawPointer() {
      if (!pointerEnabled || !pointer.active || reducedMotion) return;
      context.strokeStyle = "rgba(20, 119, 99, 0.24)";
      context.fillStyle = "rgba(185, 129, 30, 0.34)";
      context.lineWidth = 0.8;
      context.beginPath();
      context.arc(pointer.x, pointer.y, 18, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(pointer.x - 28, pointer.y);
      context.lineTo(pointer.x + 28, pointer.y);
      context.moveTo(pointer.x, pointer.y - 28);
      context.lineTo(pointer.x, pointer.y + 28);
      context.stroke();
      context.fillRect(pointer.x - 2, pointer.y - 2, 4, 4);
    }

    function updateParticles() {
      if (reducedMotion || style !== "constellation") return;
      particles.forEach((particle) => {
        if (pointerEnabled && pointer.active) {
          const dx = pointer.x - particle.x;
          const dy = pointer.y - particle.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          if (distance < 170) {
            particle.vx += dx / distance * 0.001;
            particle.vy += dy / distance * 0.001;
          }
        }
        particle.vx = Math.max(-0.26, Math.min(0.26, particle.vx));
        particle.vy = Math.max(-0.26, Math.min(0.26, particle.vy));
        particle.x += particle.vx;
        particle.y += particle.vy;
        if (particle.x < -5) particle.x = width + 5;
        if (particle.x > width + 5) particle.x = -5;
        if (particle.y < -5) particle.y = height + 5;
        if (particle.y > height + 5) particle.y = -5;
      });
    }

    function draw(time) {
      context.clearRect(0, 0, width, height);
      if (style === "circuit") drawCircuit(time);
      else if (style === "constellation") drawConstellation(time);
      else if (style === "blueprint") drawBlueprint(time);
      updateParticles();
      drawPointer();
    }

    function animate(time) {
      frame = 0;
      if (!visible || document.hidden) return;
      draw(time);
      frame = window.requestAnimationFrame(animate);
    }

    function start() {
      if (!reducedMotion && !frame && visible && !document.hidden) {
        frame = window.requestAnimationFrame(animate);
      }
    }

    function stop() {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    }

    function onPointerMove(event) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
    }
    function onMouseLeave() {
      pointer.active = false;
    }
    function onVisibilityChange() {
      if (document.hidden) stop();
      else start();
    }
    const trackPointer =
      pointerEnabled && window.matchMedia("(pointer: fine)").matches;
    if (trackPointer) {
      window.addEventListener("pointermove", onPointerMove);
      document.documentElement.addEventListener(
        "mouseleave",
        onMouseLeave
      );
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("resize", resize);
    resize();
    start();
    return function () {
      stop();
      visible = false;
      if (trackPointer) {
        window.removeEventListener("pointermove", onPointerMove);
        document.documentElement.removeEventListener(
          "mouseleave",
          onMouseLeave
        );
      }
      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );
      window.removeEventListener("resize", resize);
      canvas.remove();
    };
  }

  function createPointerReticle(reducedMotion) {
    if (
      reducedMotion ||
      !window.matchMedia("(pointer: fine)").matches
    ) {
      return function () {};
    }
    const reticle = document.createElement("span");
    reticle.className = "site-pointer-reticle";
    reticle.setAttribute("aria-hidden", "true");
    document.body.append(reticle);
    let targetX = -40;
    let targetY = -40;
    let x = -40;
    let y = -40;
    let frame = 0;
    let visible = false;

    function draw() {
      frame = 0;
      x += (targetX - x) * 0.22;
      y += (targetY - y) * 0.22;
      reticle.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      reticle.classList.toggle("is-visible", visible);
      if (
        Math.abs(targetX - x) > 0.2 ||
        Math.abs(targetY - y) > 0.2
      ) {
        frame = window.requestAnimationFrame(draw);
      }
    }
    function onPointerMove(event) {
      targetX = event.clientX;
      targetY = event.clientY;
      visible = true;
      if (!frame) frame = window.requestAnimationFrame(draw);
    }
    function onMouseLeave() {
      visible = false;
      reticle.classList.remove("is-visible");
    }
    window.addEventListener("pointermove", onPointerMove);
    document.documentElement.addEventListener("mouseleave", onMouseLeave);
    return function () {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener(
        "mouseleave",
        onMouseLeave
      );
      reticle.remove();
    };
  }

  function createEntrySequence(settings, reducedMotion) {
    const stage = document.querySelector("[data-entry-sequence]");
    let runtimeSettings = normalizeHomeIntroSettings(settings);
    const policy = window.GCK_HOME_INTRO_POLICY || {
      shouldPlay: true,
      markPlayed: function () {}
    };
    if (
      !document.body.classList.contains("page-home") ||
      !runtimeSettings.home_intro_enabled ||
      !policy.shouldPlay ||
      reducedMotion
    ) {
      if (stage) stage.remove();
      markHomeIntroReady("skipped");
      return;
    }
    const config = window.GCK_CONFIG || {};
    if (!stage) {
      markHomeIntroReady("skipped");
      return;
    }
    policy.markPlayed();
    document.documentElement.classList.remove("home-intro-seen");
    const canvas = stage.querySelector("[data-entry-canvas]");
    const progress = stage.querySelector("[data-entry-progress]");
    const context = canvas && canvas.getContext("2d");
    if (!canvas || !context) {
      stage.remove();
      markHomeIntroReady("skipped");
      return;
    }

    let randomSeed = (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
    try {
      const entropy = new Uint32Array(1);
      window.crypto.getRandomValues(entropy);
      randomSeed ^= entropy[0];
    } catch {
      // Time-based entropy is sufficient for decorative placement.
    }
    const random = seededRandom(randomSeed);
    const contributorPool = [...new Set(config.contributors || [])];
    let contributors = [];
    let contributorMotions = [];
    let width = 1;
    let height = 1;
    let ratio = 1;
    let artwork = null;
    let particles = [];
    let energyTrails = [];
    let hudPings = [];
    let started = performance.now();
    let frame = 0;
    let finished = false;
    let scrollStarted = 0;
    let scrollDuration = 690;
    let naturalScrollDuration = 690;
    let scrollFrom = 0;
    let previousScrollBehavior = "";
    let assembleDuration = 1680;
    let holdDuration = 630;

    document.body.classList.add("has-entry-sequence");
    document.body.dataset.homeIntro = "playing";
    stage.dataset.contributorLayout = "orbital";
    stage.dataset.contributorTrajectory = "moving-targets";
    stage.dataset.backgroundPalette = "tactical-multi";
    stage.dataset.typographyMotion = "active";
    stage.dataset.gameHud = "active";
    stage.dataset.typographyOffset = "0.00,0.00";
    stage.dataset.hudSweep = "0.0000";

    function clamp(value, minimum = 0, maximum = 1) {
      return Math.max(minimum, Math.min(maximum, value));
    }

    function easeOutQuart(value) {
      return 1 - Math.pow(1 - clamp(value), 4);
    }

    function easeInOutCubic(value) {
      const valueProgress = clamp(value);
      return valueProgress < 0.5
        ? 4 * valueProgress * valueProgress * valueProgress
        : 1 - Math.pow(-2 * valueProgress + 2, 3) / 2;
    }

    function shuffle(values) {
      for (let index = values.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [values[index], values[swap]] = [values[swap], values[index]];
      }
      return values;
    }

    function fitFont(target, text, maximum, preferred, minimum, weight) {
      let size = preferred;
      do {
        target.font =
          `${weight} ${size}px Inter, system-ui, -apple-system, sans-serif`;
        if (target.measureText(text).width <= maximum) return size;
        size -= 1;
      } while (size > minimum);
      return minimum;
    }

    function setDurations() {
      const total = runtimeSettings.home_intro_duration_ms;
      assembleDuration =
        runtimeSettings.home_intro_assembly_duration_ms;
      holdDuration = runtimeSettings.home_intro_hold_duration_ms;
      naturalScrollDuration = Math.max(
        320,
        total - assembleDuration - holdDuration
      );
      if (!scrollStarted) {
        scrollDuration = naturalScrollDuration;
      }
      stage.dataset.entryDuration = String(total);
      stage.dataset.assemblyDuration = String(assembleDuration);
      stage.dataset.holdDuration = String(holdDuration);
      stage.dataset.scrollDuration = String(naturalScrollDuration);
      stage.dataset.scrollLocked =
        runtimeSettings.home_intro_lock_scroll ? "true" : "false";
    }

    function selectContributors() {
      const mobile = width < 620;
      const maximum = Math.min(
        contributorPool.length,
        runtimeSettings.home_intro_contributor_limit,
        mobile ? 6 : 10
      );
      if (!maximum) {
        contributors = [];
        stage.dataset.contributorCount = "0";
        stage.dataset.contributors = "[]";
        return;
      }
      const minimum = Math.min(maximum, Math.max(2, Math.ceil(maximum * 0.65)));
      const count =
        minimum + Math.floor(random() * (maximum - minimum + 1));
      contributors = shuffle(contributorPool.slice()).slice(0, count);
      stage.dataset.contributorCount = String(contributors.length);
      stage.dataset.contributors = JSON.stringify(contributors);
    }

    function drawArtwork(target, targetWidth, targetHeight) {
      const mobile = targetWidth < 620;
      const centerX = targetWidth / 2;
      const centerY = targetHeight / 2;
      const span = Math.min(targetWidth * 0.86, 980);
      const titleSize = mobile ? 34 : 52;
      target.clearRect(0, 0, targetWidth, targetHeight);
      target.lineWidth = mobile ? 2.4 : 3;
      target.strokeStyle = "rgba(132, 210, 188, 0.9)";
      target.beginPath();
      target.moveTo(centerX - span / 2, centerY + (mobile ? 112 : 126));
      target.bezierCurveTo(
        centerX - span * 0.28,
        centerY - (mobile ? 170 : 210),
        centerX + span * 0.22,
        centerY + (mobile ? 190 : 220),
        centerX + span / 2,
        centerY - (mobile ? 105 : 128)
      );
      target.stroke();
      target.strokeStyle = "rgba(218, 170, 68, 0.78)";
      target.beginPath();
      target.moveTo(centerX - span * 0.45, centerY - (mobile ? 125 : 142));
      target.bezierCurveTo(
        centerX - span * 0.16,
        centerY + (mobile ? 170 : 196),
        centerX + span * 0.18,
        centerY - (mobile ? 165 : 184),
        centerX + span * 0.44,
        centerY + (mobile ? 120 : 142)
      );
      target.stroke();

      target.textAlign = "center";
      target.textBaseline = "middle";
      target.fillStyle = "#8bd3bd";
      target.font =
        `700 ${mobile ? 9 : 11}px "SFMono-Regular", Consolas, monospace`;
      target.fillText(
        "OPEN KNOWLEDGE GRAPH / CLIENT SYSTEMS",
        centerX,
        centerY - (mobile ? 104 : 120)
      );
      const titleText = "Game Client Knowledge";
      const fittedTitle = fitFont(
        target,
        titleText,
        targetWidth - (mobile ? 28 : 80),
        titleSize,
        27,
        760
      );
      target.font =
        `760 ${fittedTitle}px Inter, system-ui, -apple-system, sans-serif`;
      target.fillStyle = "#edf7f3";
      target.fillText(titleText, centerX, centerY - 36);
      target.fillStyle = "#bdcbc6";
      target.font =
        `500 ${mobile ? 13 : 15}px Inter, system-ui, sans-serif`;
      target.fillText(
        "游戏客户端开发与面试知识库",
        centerX,
        centerY + 22
      );
      target.fillStyle = "#8bd3bd";
      [
        [-span * 0.44, -86],
        [-span * 0.32, 102],
        [span * 0.34, -98],
        [span * 0.43, 88]
      ].forEach(([offsetX, offsetY], index) => {
        const size = index % 2 ? 4 : 3;
        target.fillRect(
          centerX + offsetX - size / 2,
          centerY + offsetY - size / 2,
          size,
          size
        );
      });
    }

    function createContributorMotions() {
      const mobile = width < 620;
      const centerX = width / 2;
      const centerY = height / 2;
      const offset = random() * Math.PI * 2;
      contributorMotions = contributors.map((name, index) => {
        const fontSize = fitFont(
          context,
          name,
          mobile ? width * 0.44 : 230,
          mobile ? 10 : 12,
          7,
          650
        );
        context.font =
          `650 ${fontSize}px "SFMono-Regular", Consolas, monospace`;
        const textWidth = context.measureText(name).width;
        const direction = random() > 0.5 ? 1 : -1;
        return {
          name,
          fontSize,
          textWidth,
          angle:
            offset +
            index * (Math.PI * 2 / Math.max(1, contributors.length)) +
            (random() - 0.5) * 0.34,
          radiusX: mobile
            ? width * (0.3 + random() * 0.08)
            : width * (0.34 + random() * 0.08),
          radiusY: height * (mobile ? 0.34 + random() * 0.05 : 0.3 + random() * 0.08),
          speed: direction * (0.000045 + random() * 0.000055),
          centerX,
          centerY
        };
      });
    }

    function contributorPosition(item, elapsed) {
      const angle = item.angle + elapsed * item.speed;
      const centerX = width / 2;
      const centerY = height / 2;
      const coreHalfWidth = Math.min(width * 0.39, 370);
      const coreHalfHeight = width < 620 ? 96 : 110;
      const labelHalfWidth = item.textWidth / 2;
      const labelHalfHeight = item.fontSize * 0.75;
      let x = centerX + Math.cos(angle) * item.radiusX;
      let y = centerY + Math.sin(angle) * item.radiusY;
      const safeX = coreHalfWidth + labelHalfWidth + 14;
      const safeY = coreHalfHeight + labelHalfHeight + 14;
      if (Math.abs(x - centerX) < safeX && Math.abs(y - centerY) < safeY) {
        if (Math.abs(Math.sin(angle)) >= 0.35) {
          y = centerY + (Math.sin(angle) >= 0 ? safeY : -safeY);
        } else {
          x = centerX + (Math.cos(angle) >= 0 ? safeX : -safeX);
        }
      }
      x = clamp(x, labelHalfWidth + 10, width - labelHalfWidth - 10);
      y = clamp(y, item.fontSize + 10, height - item.fontSize - 10);
      const overlapsCore =
        Math.abs(x - centerX) < safeX &&
        Math.abs(y - centerY) < safeY;
      if (overlapsCore) {
        y = clamp(
          centerY + (Math.sin(angle) >= 0 ? safeY : -safeY),
          item.fontSize + 10,
          height - item.fontSize - 10
        );
      }
      return { x, y };
    }

    function sampleContributor(item, contributorIndex) {
      const sample = document.createElement("canvas");
      sample.width = Math.max(1, Math.ceil(item.textWidth + 18));
      sample.height = Math.max(1, Math.ceil(item.fontSize * 2.4));
      const sampleContext = sample.getContext("2d", {
        willReadFrequently: true
      });
      sampleContext.textAlign = "center";
      sampleContext.textBaseline = "middle";
      sampleContext.font =
        `650 ${item.fontSize}px "SFMono-Regular", Consolas, monospace`;
      sampleContext.fillStyle = "#d5ad50";
      sampleContext.fillText(
        item.name,
        sample.width / 2,
        sample.height / 2
      );
      const pixels = sampleContext.getImageData(
        0,
        0,
        sample.width,
        sample.height
      ).data;
      const candidates = [];
      for (let y = 0; y < sample.height; y += 2) {
        for (let x = 0; x < sample.width; x += 2) {
          const offset = (y * sample.width + x) * 4;
          if (pixels[offset + 3] < 42) continue;
          candidates.push({
            contributor: contributorIndex,
            localX: x - sample.width / 2,
            localY: y - sample.height / 2,
            color:
              `rgba(${pixels[offset]},${pixels[offset + 1]},` +
              `${pixels[offset + 2]},${pixels[offset + 3] / 255})`
          });
        }
      }
      return shuffle(candidates).slice(0, width < 620 ? 180 : 280);
    }

    function createGameGeometry() {
      const mobile = width < 620;
      const colors = [
        "rgba(91, 224, 202, 0.72)",
        "rgba(238, 184, 76, 0.72)",
        "rgba(92, 176, 230, 0.62)",
        "rgba(218, 102, 151, 0.48)"
      ];
      energyTrails = Array.from(
        { length: mobile ? 3 : 5 },
        (_, index) => {
          const fromLeft = index % 2 === 0;
          const band = (index + 1) / (mobile ? 4 : 6);
          return {
            startX: fromLeft ? -width * 0.08 : width * 1.08,
            startY: height * (0.16 + band * 0.62),
            control1X: width * (fromLeft ? 0.22 : 0.78),
            control1Y: height * (0.08 + random() * 0.76),
            control2X: width * (fromLeft ? 0.68 : 0.32),
            control2Y: height * (0.12 + random() * 0.72),
            endX: fromLeft ? width * 1.08 : -width * 0.08,
            endY: height * (0.18 + random() * 0.64),
            color: colors[index % colors.length],
            speed: 0.00011 + random() * 0.00008,
            phase: random(),
            dash: mobile ? 12 + index * 2 : 18 + index * 3
          };
        }
      );
      hudPings = Array.from(
        { length: mobile ? 5 : 9 },
        (_, index) => ({
          angle: random() * Math.PI * 2,
          radius: 18 + random() * (mobile ? 48 : 74),
          phase: random() * Math.PI * 2,
          size: index % 3 === 0 ? 3 : 2,
          color: colors[index % colors.length]
        })
      );
      stage.dataset.energyTrailCount = String(energyTrails.length);
      stage.dataset.hudPingCount = String(hudPings.length);
    }

    function cubicPoint(item, progressValue) {
      const inverse = 1 - progressValue;
      return {
        x:
          inverse * inverse * inverse * item.startX +
          3 * inverse * inverse * progressValue * item.control1X +
          3 * inverse * progressValue * progressValue * item.control2X +
          progressValue * progressValue * progressValue * item.endX,
        y:
          inverse * inverse * inverse * item.startY +
          3 * inverse * inverse * progressValue * item.control1Y +
          3 * inverse * progressValue * progressValue * item.control2Y +
          progressValue * progressValue * progressValue * item.endY
      };
    }

    function createParticleTargets() {
      artwork = document.createElement("canvas");
      artwork.width = Math.max(1, Math.round(width));
      artwork.height = Math.max(1, Math.round(height));
      const target = artwork.getContext("2d", {
        willReadFrequently: true
      });
      drawArtwork(target, width, height);
      const pixels = target.getImageData(0, 0, width, height).data;
      const mobile = width < 620;
      const step = mobile ? 3 : 4;
      const coreMaximum = mobile ? 1900 : 3200;
      const coreCandidates = [];
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const offset = (y * width + x) * 4;
          if (pixels[offset + 3] < 42) continue;
          coreCandidates.push({
            x,
            y,
            color:
              `rgba(${pixels[offset]},${pixels[offset + 1]},` +
              `${pixels[offset + 2]},${pixels[offset + 3] / 255})`
          });
        }
      }
      shuffle(coreCandidates);
      const contributorCandidates = contributorMotions.flatMap(
        sampleContributor
      );
      const targets = coreCandidates
        .slice(0, coreMaximum)
        .concat(contributorCandidates);
      let contributorParticles = 0;
      particles = targets.map((targetPoint, index) => {
        const dynamic = targetPoint.contributor !== undefined;
        let startX;
        let startY;
        if (dynamic) {
          contributorParticles += 1;
          const item = contributorMotions[targetPoint.contributor];
          const initial = contributorPosition(item, 0);
          const dx = initial.x - width / 2;
          const dy = initial.y - height / 2;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const travel =
            Math.max(width, height) * (0.55 + random() * 0.28);
          const tangent = (random() - 0.5) * Math.min(width, height) * 0.2;
          startX = initial.x + dx / distance * travel - dy / distance * tangent;
          startY = initial.y + dy / distance * travel + dx / distance * tangent;
        } else {
          const edge = index % 4;
          const margin = 30 + random() * Math.min(width, height) * 0.3;
          startX = random() * width;
          startY = random() * height;
          if (edge === 0) startX = -margin;
          if (edge === 1) startX = width + margin;
          if (edge === 2) startY = -margin;
          if (edge === 3) startY = height + margin;
        }
        return {
          ...targetPoint,
          startX,
          startY,
          delay: random() * assembleDuration * 0.18,
          orbit: (random() - 0.5) * (mobile ? 46 : 76),
          phase: random() * Math.PI * 2,
          size: index % 17 === 0 ? 2.2 : 1.1 + random() * 0.9
        };
      });
      stage.dataset.particleCount = String(particles.length);
      stage.dataset.contributorParticleCount = String(contributorParticles);
    }

    function rebuildTargets(reselect) {
      if (reselect || !contributors.length) {
        selectContributors();
      }
      createContributorMotions();
      createGameGeometry();
      createParticleTargets();
    }

    function resize() {
      const bounds = stage.getBoundingClientRect();
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      rebuildTargets(false);
    }

    function drawArenaBackground(elapsed, progressValue) {
      context.fillStyle = "#10252a";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "rgba(27, 35, 61, 0.72)";
      context.fillRect(0, 0, width, height * 0.34);
      context.fillStyle = "rgba(15, 54, 47, 0.68)";
      context.fillRect(0, height * 0.67, width, height * 0.33);
      context.fillStyle = "rgba(35, 43, 52, 0.44)";
      context.fillRect(0, height * 0.34, width, height * 0.33);

      const centerX = width / 2;
      const centerY = height / 2;
      const opacity = 0.055 + progressValue * 0.055;
      context.strokeStyle = `rgba(95, 180, 153, ${opacity})`;
      context.lineWidth = 0.7;
      const grid = width < 620 ? 42 : 54;
      const gridOffset = (elapsed * 0.006) % grid;
      for (let x = centerX % grid - grid + gridOffset; x < width; x += grid) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      for (let y = centerY % grid - grid + gridOffset; y < height; y += grid) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }

      const horizon = height * 0.64;
      context.strokeStyle =
        `rgba(89, 178, 203, ${0.06 + progressValue * 0.08})`;
      for (let index = -8; index <= 8; index += 1) {
        context.beginPath();
        context.moveTo(centerX, horizon);
        context.lineTo(centerX + index * width * 0.14, height);
        context.stroke();
      }
      for (let index = 0; index <= 8; index += 1) {
        const distance = Math.pow(index / 8, 1.7);
        const y = horizon + distance * (height - horizon);
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }

      const scanY = (elapsed * 0.08) % (height + 80) - 40;
      context.fillStyle =
        `rgba(102, 228, 205, ${0.025 + progressValue * 0.035})`;
      context.fillRect(0, scanY, width, width < 620 ? 16 : 24);
      context.strokeStyle = "rgba(235, 179, 76, 0.1)";
      context.setLineDash([4, 14]);
      context.lineDashOffset = -elapsed * 0.025;
      context.beginPath();
      context.moveTo(0, height * 0.18);
      context.lineTo(width, height * 0.78);
      context.moveTo(width * 0.2, 0);
      context.lineTo(width * 0.86, height);
      context.stroke();
      context.setLineDash([]);
    }

    function drawEnergyTrails(elapsed, opacity) {
      context.save();
      context.globalAlpha = opacity;
      energyTrails.forEach((item, index) => {
        context.strokeStyle = item.color;
        context.lineWidth = index % 2 === 0 ? 1.25 : 0.8;
        context.setLineDash([item.dash, item.dash * 0.72]);
        context.lineDashOffset =
          -(elapsed * (0.04 + index * 0.006) + item.phase * 100);
        context.beginPath();
        context.moveTo(item.startX, item.startY);
        context.bezierCurveTo(
          item.control1X,
          item.control1Y,
          item.control2X,
          item.control2Y,
          item.endX,
          item.endY
        );
        context.stroke();

        const runner = (elapsed * item.speed + item.phase) % 1;
        const point = cubicPoint(item, runner);
        context.save();
        context.translate(point.x, point.y);
        context.rotate(Math.PI / 4 + elapsed * 0.001);
        context.fillStyle = item.color;
        const size = width < 620 ? 4 : 5;
        context.fillRect(-size / 2, -size / 2, size, size);
        context.restore();
      });
      context.setLineDash([]);
      context.restore();
    }

    function drawGameHud(elapsed, opacity) {
      const mobile = width < 620;
      const margin = mobile ? 16 : 28;
      const bracket = mobile ? 34 : 50;
      const sweep = elapsed * 0.00115;
      context.save();
      context.globalAlpha = opacity;
      context.lineWidth = 1;
      context.strokeStyle = "rgba(108, 220, 198, 0.58)";

      [
        [margin, margin, 1, 1],
        [width - margin, margin, -1, 1],
        [margin, height - margin, 1, -1],
        [width - margin, height - margin, -1, -1]
      ].forEach(([x, y, directionX, directionY]) => {
        context.beginPath();
        context.moveTo(x + directionX * bracket, y);
        context.lineTo(x, y);
        context.lineTo(x, y + directionY * bracket);
        context.stroke();
      });

      const radarX = width - (mobile ? 72 : 118);
      const radarY = mobile ? 84 : 112;
      const radarRadius = mobile ? 42 : 68;
      context.strokeStyle = "rgba(91, 176, 230, 0.42)";
      [0.36, 0.68, 1].forEach((scale) => {
        context.beginPath();
        context.arc(radarX, radarY, radarRadius * scale, 0, Math.PI * 2);
        context.stroke();
      });
      context.beginPath();
      context.moveTo(radarX - radarRadius, radarY);
      context.lineTo(radarX + radarRadius, radarY);
      context.moveTo(radarX, radarY - radarRadius);
      context.lineTo(radarX, radarY + radarRadius);
      context.stroke();
      context.strokeStyle = "rgba(238, 184, 76, 0.7)";
      context.beginPath();
      context.moveTo(radarX, radarY);
      context.lineTo(
        radarX + Math.cos(sweep) * radarRadius,
        radarY + Math.sin(sweep) * radarRadius
      );
      context.stroke();
      hudPings.forEach((ping) => {
        const pulse = 0.45 + Math.sin(elapsed * 0.004 + ping.phase) * 0.35;
        context.globalAlpha = opacity * pulse;
        context.fillStyle = ping.color;
        context.fillRect(
          radarX + Math.cos(ping.angle) * ping.radius - ping.size / 2,
          radarY + Math.sin(ping.angle) * ping.radius - ping.size / 2,
          ping.size,
          ping.size
        );
      });

      context.globalAlpha = opacity;
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.font =
        `700 ${mobile ? 8 : 10}px "SFMono-Regular", Consolas, monospace`;
      context.fillStyle = "rgba(151, 226, 207, 0.82)";
      context.fillText(
        "MISSION // KNOWLEDGE BUILD",
        margin,
        height - (mobile ? 72 : 92)
      );
      context.fillStyle = "rgba(238, 184, 76, 0.86)";
      context.fillText(
        "READY",
        margin,
        height - (mobile ? 54 : 72)
      );
      const barWidth = mobile ? 88 : 142;
      context.strokeStyle = "rgba(151, 226, 207, 0.35)";
      context.strokeRect(
        margin,
        height - (mobile ? 40 : 56),
        barWidth,
        5
      );
      context.fillStyle = "rgba(91, 224, 202, 0.74)";
      context.fillRect(
        margin + 1,
        height - (mobile ? 39 : 55),
        barWidth * (0.62 + Math.sin(elapsed * 0.0018) * 0.08),
        3
      );
      stage.dataset.hudSweep = sweep.toFixed(4);
      context.restore();
    }

    function drawDynamicTypography(elapsed, opacity) {
      if (opacity <= 0) return;
      const mobile = width < 620;
      const centerX = width / 2;
      const centerY = height / 2;
      const titleText = "Game Client Knowledge";
      const titleSize = fitFont(
        context,
        titleText,
        width - (mobile ? 28 : 80),
        mobile ? 34 : 52,
        27,
        760
      );
      const driftX = Math.sin(elapsed * 0.0011) * (mobile ? 3 : 8);
      const driftY = Math.cos(elapsed * 0.0015) * 2;
      const glitchPulse = clamp(
        (Math.sin(elapsed * 0.024) - 0.86) / 0.14
      );

      context.save();
      context.globalAlpha = opacity;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font =
        `700 ${mobile ? 9 : 11}px "SFMono-Regular", Consolas, monospace`;
      context.fillStyle = "rgba(112, 228, 205, 0.9)";
      context.fillText(
        "OPEN KNOWLEDGE GRAPH / CLIENT SYSTEMS",
        centerX - driftX * 1.5,
        centerY - (mobile ? 104 : 120) + driftY
      );

      context.font =
        `760 ${titleSize}px Inter, system-ui, -apple-system, sans-serif`;
      if (glitchPulse > 0) {
        context.globalAlpha = opacity * glitchPulse * 0.5;
        context.fillStyle = "#5cb0e6";
        context.fillText(
          titleText,
          centerX + driftX - 3,
          centerY - 36 + driftY
        );
        context.fillStyle = "#da6697";
        context.fillText(
          titleText,
          centerX + driftX + 3,
          centerY - 35 + driftY
        );
      }
      context.globalAlpha = opacity;
      context.fillStyle = "#f2f8f5";
      context.fillText(
        titleText,
        centerX + driftX,
        centerY - 36 + driftY
      );
      context.font =
        `500 ${mobile ? 13 : 15}px Inter, system-ui, sans-serif`;
      context.fillStyle = "rgba(206, 221, 216, 0.92)";
      context.fillText(
        "游戏客户端开发与面试知识库",
        centerX - driftX * 0.55,
        centerY + 22 - driftY
      );
      context.font =
        `700 ${mobile ? 8 : 9}px "SFMono-Regular", Consolas, monospace`;
      context.fillStyle = "rgba(238, 184, 76, 0.84)";
      context.fillText(
        `SYNC ${String(Math.floor(elapsed / 80) % 100).padStart(2, "0")} / PLAYER READY`,
        centerX + driftX * 0.8,
        centerY + (mobile ? 58 : 64)
      );
      context.restore();
      stage.dataset.typographyOffset =
        `${driftX.toFixed(2)},${driftY.toFixed(2)}`;
    }

    function drawRotatingFrames(elapsed, opacity) {
      const mobile = width < 620;
      const centerX = width / 2;
      const centerY = height / 2;
      const rotation = elapsed * 0.00042;
      context.save();
      context.globalAlpha = opacity;
      context.translate(centerX, centerY);
      context.lineWidth = mobile ? 1.6 : 2;
      context.strokeStyle = "rgba(137, 214, 192, 0.78)";
      context.rotate(Math.PI / 10 + rotation);
      context.strokeRect(
        mobile ? -62 : -88,
        mobile ? -62 : -88,
        mobile ? 124 : 176,
        mobile ? 124 : 176
      );
      context.rotate(-Math.PI / 4.2 - rotation * 1.8);
      context.strokeStyle = "rgba(218, 170, 68, 0.68)";
      context.strokeRect(
        mobile ? -40 : -56,
        mobile ? -40 : -56,
        mobile ? 80 : 112,
        mobile ? 80 : 112
      );
      context.restore();
      stage.dataset.frameRotation = rotation.toFixed(4);
    }

    function drawContributorLabels(elapsed, opacity) {
      let overlapsCore = false;
      const centerX = width / 2;
      const centerY = height / 2;
      const coreHalfWidth = Math.min(width * 0.39, 370);
      const coreHalfHeight = width < 620 ? 96 : 110;
      context.save();
      context.globalAlpha = opacity;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#d5ad50";
      contributorMotions.forEach((item) => {
        const position = contributorPosition(item, elapsed);
        context.font =
          `650 ${item.fontSize}px "SFMono-Regular", Consolas, monospace`;
        context.fillText(item.name, position.x, position.y);
        context.fillRect(
          position.x - item.textWidth / 2 - 8,
          position.y - 1,
          3,
          3
        );
        if (
          Math.abs(position.x - centerX) <
            coreHalfWidth + item.textWidth / 2 &&
          Math.abs(position.y - centerY) <
            coreHalfHeight + item.fontSize
        ) {
          overlapsCore = true;
        }
      });
      context.restore();
      stage.dataset.contributorCoreOverlap = overlapsCore ? "true" : "false";
    }

    function particleTarget(particle, elapsed) {
      if (particle.contributor === undefined) {
        return { x: particle.x, y: particle.y };
      }
      const item = contributorMotions[particle.contributor];
      const position = contributorPosition(item, elapsed);
      return {
        x: position.x + particle.localX,
        y: position.y + particle.localY
      };
    }

    function drawAssembly(elapsed) {
      const assemblyElapsed = Math.min(elapsed, assembleDuration);
      const progressValue = clamp(assemblyElapsed / assembleDuration);
      drawArenaBackground(elapsed, progressValue);
      drawEnergyTrails(elapsed, 0.24 + progressValue * 0.5);
      particles.forEach((particle) => {
        const local = clamp(
          (assemblyElapsed - particle.delay) /
            Math.max(1, assembleDuration - particle.delay)
        );
        const eased = easeOutQuart(local);
        const orbit = particle.orbit * (1 - eased);
        const target = particleTarget(particle, elapsed);
        const x =
          particle.startX +
          (target.x - particle.startX) * eased +
          Math.cos(particle.phase + local * Math.PI * 2.4) * orbit;
        const y =
          particle.startY +
          (target.y - particle.startY) * eased +
          Math.sin(particle.phase + local * Math.PI * 2.4) * orbit;
        context.fillStyle = particle.color;
        const size = particle.size * (0.58 + eased * 0.42);
        context.fillRect(x - size / 2, y - size / 2, size, size);
      });
      const imageOpacity = clamp((progressValue - 0.82) / 0.18);
      if (artwork && imageOpacity > 0) {
        context.save();
        context.globalAlpha = imageOpacity * 0.2;
        context.drawImage(artwork, 0, 0);
        context.restore();
      }
      const dynamicOpacity = clamp((progressValue - 0.58) / 0.42);
      drawRotatingFrames(elapsed, 0.25 + dynamicOpacity * 0.75);
      drawDynamicTypography(elapsed, dynamicOpacity);
      drawGameHud(elapsed, 0.38 + dynamicOpacity * 0.62);
      drawContributorLabels(elapsed, dynamicOpacity);
      progress.style.transform =
        `scaleX(${Math.min(
          1,
          elapsed / runtimeSettings.home_intro_duration_ms
        )})`;
      stage.dataset.entryPhase =
        progressValue < 1 ? "assembling" : "holding";
      stage.classList.toggle("is-holding", progressValue >= 1);
    }

    function beginScroll(now, accelerated) {
      if (scrollStarted || finished) return;
      scrollStarted = now;
      scrollDuration = accelerated
        ? Math.min(420, naturalScrollDuration)
        : naturalScrollDuration;
      scrollFrom = window.scrollY;
      previousScrollBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";
      stage.dataset.entryPhase = "scrolling";
      stage.classList.remove("is-holding");
    }

    function releaseListeners() {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", skip);
      stage.removeEventListener("click", skip);
      updateHomeIntroSettings = null;
    }

    function finish() {
      if (finished) return;
      finished = true;
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      releaseListeners();
      document.documentElement.style.scrollBehavior = previousScrollBehavior;
      stage.classList.add("is-complete");
      stage.dataset.entryPhase = "complete";
      document.body.classList.remove("has-entry-sequence");
      document.body.dataset.homeIntroLocked =
        runtimeSettings.home_intro_lock_scroll ? "true" : "false";
      if (runtimeSettings.home_intro_lock_scroll) {
        stage.remove();
        window.scrollTo(0, 0);
      }
      cancelHomeIntro = null;
      markHomeIntroReady("complete");
    }

    function cancel() {
      if (finished) return;
      finished = true;
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      releaseListeners();
      document.documentElement.style.scrollBehavior = previousScrollBehavior;
      stage.remove();
      document.body.classList.remove("has-entry-sequence");
      cancelHomeIntro = null;
      markHomeIntroReady("skipped");
    }

    function skip(event) {
      if (event.type === "keydown" && event.key !== "Escape") return;
      beginScroll(performance.now(), true);
    }

    function applyRuntimeSettings(nextSettings) {
      const previousLimit = runtimeSettings.home_intro_contributor_limit;
      const previousAssembly =
        runtimeSettings.home_intro_assembly_duration_ms;
      runtimeSettings = normalizeHomeIntroSettings({
        ...runtimeSettings,
        ...nextSettings
      });
      setDurations();
      if (
        !finished &&
        (
          previousLimit !== runtimeSettings.home_intro_contributor_limit ||
          previousAssembly !==
            runtimeSettings.home_intro_assembly_duration_ms
        )
      ) {
        rebuildTargets(
          previousLimit !== runtimeSettings.home_intro_contributor_limit
        );
      }
    }

    function render(now) {
      const elapsed = now - started;
      context.clearRect(0, 0, width, height);
      drawAssembly(elapsed);
      if (
        !scrollStarted &&
        elapsed >= assembleDuration + holdDuration
      ) {
        beginScroll(now, false);
      }
      if (scrollStarted) {
        stage.dataset.entryPhase = "scrolling";
        const scrollProgress = clamp(
          (now - scrollStarted) / scrollDuration
        );
        const target = stage.offsetTop + stage.offsetHeight;
        window.scrollTo(
          0,
          scrollFrom +
            (target - scrollFrom) * easeInOutCubic(scrollProgress)
        );
        const scrollStartProgress =
          (assembleDuration + holdDuration) /
          runtimeSettings.home_intro_duration_ms;
        progress.style.transform =
          `scaleX(${scrollStartProgress + scrollProgress * (
            1 - scrollStartProgress
          )})`;
        if (scrollProgress >= 1) {
          finish();
          return;
        }
      }
      frame = window.requestAnimationFrame(render);
    }

    setDurations();
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", skip);
    resize();
    window.scrollTo(0, 0);
    started = performance.now();
    cancelHomeIntro = cancel;
    updateHomeIntroSettings = applyRuntimeSettings;
    frame = window.requestAnimationFrame(render);
    stage.addEventListener("click", skip);
  }

  async function initialize() {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const type = pageVisualType();
    const policy = window.GCK_HOME_INTRO_POLICY || {
      shouldPlay: true,
      updateMode: function (mode) {
        this.shouldPlay = mode !== "off";
        return this.shouldPlay;
      }
    };
    document.body.dataset.visualType = type || "none";
    let introStarted = false;
    const cachedIntroSettings = readCachedHomeIntroSettings();
    if (type === "home") {
      if (
        cachedIntroSettings.home_intro_enabled &&
        policy.shouldPlay
      ) {
        createEntrySequence(cachedIntroSettings, reducedMotion);
        introStarted = true;
      }
    } else {
      markHomeIntroReady("skipped");
    }

    const resolved = await (
      window.GCK_VISUAL_SETTINGS || Promise.resolve({})
    );
    const resolvedSettings = {
      ...defaults,
      ...resolved
    };
    if (!Object.hasOwn(resolved, "home_intro_mode")) {
      resolvedSettings.home_intro_mode =
        resolved.home_intro_enabled === false ? "off" : "revisit";
    }
    if (!Object.hasOwn(resolved, "home_intro_assembly_duration_ms")) {
      resolvedSettings.home_intro_assembly_duration_ms = undefined;
    }
    if (!Object.hasOwn(resolved, "home_intro_hold_duration_ms")) {
      resolvedSettings.home_intro_hold_duration_ms = undefined;
    }
    const settings = normalizeHomeIntroSettings(resolvedSettings);
    cacheHomeIntroSettings(settings);
    let ambientCleanup = function () {};
    let pointerCleanup = function () {};

    function applyVisualSurface(nextSettings) {
      ambientCleanup();
      pointerCleanup();
      Array.from(document.body.classList)
        .filter((name) => {
          return (
            name.startsWith("visual-catalog-") ||
            name.startsWith("visual-reader-")
          );
        })
        .forEach((name) => document.body.classList.remove(name));
      document.body.dataset.pointerEffect =
        nextSettings.pointer_effect_enabled ? "on" : "off";
      if (type === "home") {
        const maskEnabled =
          nextSettings.home_content_mask_enabled === true;
        document.body.dataset.homeContentMask =
          maskEnabled ? "on" : "off";
        document.body.classList.toggle(
          "home-content-masked",
          maskEnabled
        );
        document.body.classList.toggle(
          "home-content-unmasked",
          !maskEnabled
        );
      }
      if (type === "catalog") {
        document.body.dataset.catalogBackground =
          nextSettings.catalog_background_style;
        document.body.classList.add(
          `visual-catalog-${nextSettings.catalog_background_style}`
        );
        ambientCleanup = createAmbientField(
          nextSettings.catalog_background_style,
          nextSettings.pointer_effect_enabled,
          reducedMotion
        );
      } else if (type === "reader") {
        document.body.dataset.readerBackground =
          nextSettings.reader_background_style;
        document.body.classList.add(
          `visual-reader-${nextSettings.reader_background_style}`
        );
        ambientCleanup = createAmbientField(
          nextSettings.reader_background_style,
          nextSettings.pointer_effect_enabled,
          reducedMotion
        );
      }
      if (
        nextSettings.pointer_effect_enabled &&
        !document.body.classList.contains("page-code-workspace")
      ) {
        pointerCleanup = createPointerReticle(reducedMotion);
      } else {
        pointerCleanup = function () {};
      }
    }

    applyVisualSurface(settings);

    if (type === "home") {
      const shouldPlay = policy.updateMode(
        settings.home_intro_mode,
        settings.home_intro_enabled
      );
      if (!settings.home_intro_enabled || !shouldPlay) {
        if (cancelHomeIntro) {
          cancelHomeIntro();
        } else {
          document.querySelector("[data-entry-sequence]")?.remove();
          markHomeIntroReady(
            settings.home_intro_enabled ? "seen" : "skipped"
          );
        }
      } else if (updateHomeIntroSettings) {
        updateHomeIntroSettings(settings);
      } else if (!introStarted && !homeIntroReleased) {
        createEntrySequence(settings, reducedMotion);
      }
    }

    window.addEventListener("gck:visual-settings", (event) => {
      const liveSettings = normalizeHomeIntroSettings({
        ...defaults,
        ...(event.detail || {})
      });
      cacheHomeIntroSettings(liveSettings);
      applyVisualSurface(liveSettings);
      if (type !== "home") return;
      const shouldPlay = policy.updateMode(
        liveSettings.home_intro_mode,
        liveSettings.home_intro_enabled
      );
      if (!liveSettings.home_intro_enabled || !shouldPlay) {
        if (cancelHomeIntro) cancelHomeIntro();
        return;
      }
      if (updateHomeIntroSettings) {
        updateHomeIntroSettings(liveSettings);
      } else if (!introStarted && !homeIntroReleased) {
        createEntrySequence(liveSettings, reducedMotion);
        introStarted = true;
      }
    });

    window.addEventListener("gck:home-content-visibility", (event) => {
      if (
        type === "home" &&
        event.detail &&
        event.detail.hidden &&
        cancelHomeIntro
      ) {
        cancelHomeIntro();
      }
    });

  }

  initialize().catch(() => {
    document.body.dataset.visualType = "fallback";
    markHomeIntroReady("fallback");
  });
})();
