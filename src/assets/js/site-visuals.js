(function () {
  "use strict";

  const defaults = {
    catalog_background_style: "circuit",
    reader_background_style: "blueprint",
    pointer_effect_enabled: true,
    home_intro_enabled: true
  };

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
      return;
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
          ? "rgba(38, 112, 126, 0.075)"
          : "rgba(24, 112, 93, 0.065)";
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      for (let y = -step + offset; y < height + step; y += step) {
        context.strokeStyle = blueprint
          ? "rgba(38, 112, 126, 0.075)"
          : "rgba(24, 112, 93, 0.065)";
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
            `rgba(25, 113, 94, ${0.12 * (1 - distance / distanceLimit)})`;
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
            ? `rgba(178, 125, 30, ${0.35 * pulse})`
            : `rgba(23, 121, 101, ${0.42 * pulse})`;
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
      context.strokeStyle = "rgba(31, 107, 121, 0.13)";
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
      context.strokeStyle = "rgba(181, 126, 28, 0.11)";
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

    if (pointerEnabled && window.matchMedia("(pointer: fine)").matches) {
      window.addEventListener("pointermove", (event) => {
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        pointer.active = true;
      });
      document.documentElement.addEventListener("mouseleave", () => {
        pointer.active = false;
      });
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });
    window.addEventListener("resize", resize);
    resize();
    start();
  }

  function createPointerReticle(reducedMotion) {
    if (
      reducedMotion ||
      !window.matchMedia("(pointer: fine)").matches
    ) {
      return;
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
    window.addEventListener("pointermove", (event) => {
      targetX = event.clientX;
      targetY = event.clientY;
      visible = true;
      if (!frame) frame = window.requestAnimationFrame(draw);
    });
    document.documentElement.addEventListener("mouseleave", () => {
      visible = false;
      reticle.classList.remove("is-visible");
    });
  }

  function createEntrySequence(settings, reducedMotion) {
    if (
      !document.body.classList.contains("page-home") ||
      !settings.home_intro_enabled ||
      reducedMotion
    ) {
      document.body.dataset.homeIntro = "skipped";
      return;
    }
    const config = window.GCK_CONFIG || {};
    const key = `gck-home-intro:${config.assetVersion || "v1"}`;
    try {
      if (window.sessionStorage.getItem(key) === "1") {
        document.body.dataset.homeIntro = "seen";
        return;
      }
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Private browsing may deny storage; the animation can still run.
    }

    const overlay = document.createElement("div");
    overlay.className = "site-entry-sequence";
    overlay.dataset.entrySequence = "";
    overlay.setAttribute("aria-hidden", "true");
    const canvas = document.createElement("canvas");
    const copy = document.createElement("div");
    copy.className = "site-entry-copy";
    const contributors = (config.contributors || []).slice(0, 8);
    const eyebrow = document.createElement("span");
    eyebrow.textContent = "OPEN KNOWLEDGE GRAPH / CLIENT SYSTEMS";
    const title = document.createElement("strong");
    title.textContent = "Game Client Knowledge";
    const description = document.createElement("p");
    description.textContent = "游戏客户端开发与面试知识库";
    const contributorList = document.createElement("div");
    contributors.forEach((name, index) => {
      if (index) {
        const separator = document.createElement("i");
        separator.textContent = "/";
        contributorList.append(separator);
      }
      const contributor = document.createElement("b");
      contributor.textContent = String(name);
      contributorList.append(contributor);
    });
    copy.append(eyebrow, title, description, contributorList);
    const progress = document.createElement("span");
    progress.className = "site-entry-progress";
    overlay.append(canvas, copy, progress);
    document.body.append(overlay);
    document.body.classList.add("has-entry-sequence");
    document.body.dataset.homeIntro = "playing";

    const context = canvas.getContext("2d");
    const random = seededRandom(0x1a2b3c4d);
    const particles = Array.from({ length: 80 }, (_, index) => ({
      angle: random() * Math.PI * 2,
      radius: 50 + random() * 420,
      speed: 0.2 + random() * 0.65,
      size: index % 7 === 0 ? 3 : 1 + random() * 1.3,
      square: index % 5 === 0,
      phase: random() * Math.PI * 2
    }));
    let width = 1;
    let height = 1;
    let ratio = 1;
    let started = performance.now();
    let frame = 0;
    let finished = false;
    const duration = 1450;

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function finish(delay) {
      if (finished) return;
      finished = true;
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", skip);
      overlay.classList.add("is-leaving");
      document.body.dataset.homeIntro = "complete";
      window.setTimeout(() => {
        overlay.remove();
        document.body.classList.remove("has-entry-sequence");
      }, delay);
    }

    function skip(event) {
      if (event.type === "keydown" && event.key !== "Escape") return;
      finish(event.type === "click" ? 180 : 120);
    }

    function render(now) {
      const elapsed = now - started;
      const phase = Math.min(1, elapsed / duration);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#0b1512";
      context.fillRect(0, 0, width, height);
      const centerX = width / 2;
      const centerY = height / 2;

      context.strokeStyle = `rgba(95, 180, 153, ${0.08 + phase * 0.08})`;
      context.lineWidth = 0.7;
      const grid = 54;
      for (let x = centerX % grid; x < width; x += grid) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      for (let y = centerY % grid; y < height; y += grid) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }

      context.strokeStyle = "rgba(150, 221, 200, 0.22)";
      context.beginPath();
      context.moveTo(width * 0.08, height * 0.68);
      context.bezierCurveTo(
        width * 0.28,
        height * 0.18,
        width * 0.7,
        height * 0.86,
        width * 0.92,
        height * 0.3
      );
      context.stroke();
      context.strokeStyle = "rgba(219, 169, 65, 0.18)";
      context.beginPath();
      context.moveTo(width * 0.12, height * 0.28);
      context.bezierCurveTo(
        width * 0.36,
        height * 0.78,
        width * 0.62,
        height * 0.16,
        width * 0.88,
        height * 0.7
      );
      context.stroke();

      particles.forEach((particle, index) => {
        const angle =
          particle.angle +
          elapsed * 0.00035 * particle.speed +
          phase * 0.22;
        const radius = particle.radius * (1.12 - phase * 0.28);
        const x = centerX + Math.cos(angle) * radius;
        const y =
          centerY +
          Math.sin(angle * 1.17 + particle.phase) * radius * 0.52;
        context.save();
        context.translate(x, y);
        context.rotate(angle + phase * Math.PI);
        context.fillStyle =
          index % 6 === 0
            ? "rgba(222, 173, 72, 0.72)"
            : "rgba(143, 219, 197, 0.7)";
        if (particle.square) {
          context.fillRect(
            -particle.size,
            -particle.size,
            particle.size * 2,
            particle.size * 2
          );
        } else {
          context.beginPath();
          context.arc(0, 0, particle.size, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
      });

      context.save();
      context.translate(centerX, centerY);
      context.rotate(elapsed * 0.00045);
      context.strokeStyle = "rgba(143, 219, 197, 0.42)";
      context.strokeRect(-74, -74, 148, 148);
      context.rotate(-elapsed * 0.00085);
      context.strokeStyle = "rgba(222, 173, 72, 0.34)";
      context.strokeRect(-48, -48, 96, 96);
      context.restore();
      progress.style.transform = `scaleX(${phase})`;

      if (elapsed < duration) {
        frame = window.requestAnimationFrame(render);
      } else {
        finish(260);
      }
    }

    window.addEventListener("resize", resize);
    window.addEventListener("keydown", skip);
    resize();
    frame = window.requestAnimationFrame(render);
    overlay.addEventListener("click", skip);
  }

  async function initialize() {
    const resolved = await (
      window.GCK_VISUAL_SETTINGS || Promise.resolve({})
    );
    const settings = { ...defaults, ...resolved };
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const type = pageVisualType();
    document.body.dataset.visualType = type || "none";
    document.body.dataset.pointerEffect =
      settings.pointer_effect_enabled ? "on" : "off";

    if (type === "catalog") {
      document.body.dataset.catalogBackground =
        settings.catalog_background_style;
      document.body.classList.add(
        `visual-catalog-${settings.catalog_background_style}`
      );
      createAmbientField(
        settings.catalog_background_style,
        settings.pointer_effect_enabled,
        reducedMotion
      );
    } else if (type === "reader") {
      document.body.dataset.readerBackground =
        settings.reader_background_style;
      document.body.classList.add(
        `visual-reader-${settings.reader_background_style}`
      );
      createAmbientField(
        settings.reader_background_style,
        settings.pointer_effect_enabled,
        reducedMotion
      );
    }
    if (
      settings.pointer_effect_enabled &&
      !document.body.classList.contains("page-code-workspace")
    ) {
      createPointerReticle(reducedMotion);
    }
    createEntrySequence(settings, reducedMotion);
  }

  document.addEventListener("DOMContentLoaded", () => {
    initialize().catch(() => {
      document.body.dataset.visualType = "fallback";
    });
  });
})();
