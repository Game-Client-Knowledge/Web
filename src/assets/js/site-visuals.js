(function () {
  "use strict";

  const defaults = {
    catalog_background_style: "circuit",
    reader_background_style: "blueprint",
    pointer_effect_enabled: true,
    home_intro_enabled: true
  };
  const HOME_INTRO_SESSION_COOKIE = "gck_home_intro_session";
  let releaseHomeIntro;
  let homeIntroReleased = false;
  let cancelHomeIntro = null;
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

  function hasHomeIntroSessionCookie() {
    try {
      return document.cookie
        .split(";")
        .some((item) => {
          return item.trim() === `${HOME_INTRO_SESSION_COOKIE}=1`;
        });
    } catch {
      return false;
    }
  }

  function markHomeIntroSession() {
    try {
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie =
        `${HOME_INTRO_SESSION_COOKIE}=1; Path=/; SameSite=Lax${secure}`;
    } catch {
      // Cookie access may be denied; the animation can still run.
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
    const stage = document.querySelector("[data-entry-sequence]");
    if (
      !document.body.classList.contains("page-home") ||
      !settings.home_intro_enabled ||
      reducedMotion
    ) {
      if (stage) stage.remove();
      markHomeIntroReady("skipped");
      return;
    }
    const config = window.GCK_CONFIG || {};
    if (hasHomeIntroSessionCookie()) {
      document.documentElement.classList.add("home-intro-seen");
      if (stage) stage.remove();
      markHomeIntroReady("seen");
      return;
    }
    markHomeIntroSession();

    if (!stage) {
      markHomeIntroReady("skipped");
      return;
    }
    document.documentElement.classList.remove("home-intro-seen");
    const canvas = stage.querySelector("[data-entry-canvas]");
    const progress = stage.querySelector("[data-entry-progress]");
    const context = canvas && canvas.getContext("2d");
    if (!canvas || !context) {
      stage.remove();
      markHomeIntroReady("skipped");
      return;
    }
    const contributors = (config.contributors || []).slice(0, 8);
    document.body.classList.add("has-entry-sequence");
    document.body.dataset.homeIntro = "playing";
    stage.dataset.contributorCount = String(contributors.length);

    let width = 1;
    let height = 1;
    let ratio = 1;
    let artwork = null;
    let particles = [];
    let started = performance.now();
    let frame = 0;
    let finished = false;
    let scrollStarted = 0;
    let scrollDuration = 620;
    let scrollFrom = 0;
    let previousScrollBehavior = "";
    const assembleDuration = 1080;
    const holdDuration = 360;

    function clamp(value, minimum = 0, maximum = 1) {
      return Math.max(minimum, Math.min(maximum, value));
    }

    function easeOutQuart(value) {
      return 1 - Math.pow(1 - clamp(value), 4);
    }

    function easeInOutCubic(value) {
      const progress = clamp(value);
      return progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
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

    function drawArtwork(target, targetWidth, targetHeight) {
      const mobile = targetWidth < 620;
      const centerX = targetWidth / 2;
      const centerY = targetHeight / 2;
      const span = Math.min(targetWidth * 0.86, 980);
      const titleSize = mobile ? 34 : 52;
      target.clearRect(0, 0, targetWidth, targetHeight);
      target.save();
      target.translate(centerX, centerY);
      target.lineWidth = mobile ? 1.6 : 2;
      target.strokeStyle = "rgba(137, 214, 192, 0.78)";
      target.rotate(Math.PI / 10);
      target.strokeRect(
        mobile ? -62 : -88,
        mobile ? -62 : -88,
        mobile ? 124 : 176,
        mobile ? 124 : 176
      );
      target.rotate(-Math.PI / 4.2);
      target.strokeStyle = "rgba(218, 170, 68, 0.68)";
      target.strokeRect(
        mobile ? -40 : -56,
        mobile ? -40 : -56,
        mobile ? 80 : 112,
        mobile ? 80 : 112
      );
      target.restore();

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
      fitFont(
        target,
        titleText,
        targetWidth - (mobile ? 28 : 80),
        titleSize,
        27,
        760
      );
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
      const contributorText = contributors.join("  /  ");
      if (contributorText) {
        fitFont(
          target,
          contributorText,
          targetWidth - (mobile ? 26 : 120),
          mobile ? 9 : 11,
          7,
          650
        );
        target.fillStyle = "#d5ad50";
        target.fillText(contributorText, centerX, centerY + 68);
      }
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
      const maximum = mobile ? 2600 : 4400;
      const candidates = [];
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const offset = (y * width + x) * 4;
          if (pixels[offset + 3] < 42) continue;
          candidates.push({
            x,
            y,
            color:
              `rgba(${pixels[offset]},${pixels[offset + 1]},` +
              `${pixels[offset + 2]},${pixels[offset + 3] / 255})`
          });
        }
      }
      const random = seededRandom(0x1a2b3c4d);
      for (let index = candidates.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [candidates[index], candidates[swap]] = [
          candidates[swap],
          candidates[index]
        ];
      }
      particles = candidates.slice(0, maximum).map((targetPoint, index) => {
        const edge = index % 4;
        const margin = 30 + random() * Math.min(width, height) * 0.3;
        let startX = random() * width;
        let startY = random() * height;
        if (edge === 0) startX = -margin;
        if (edge === 1) startX = width + margin;
        if (edge === 2) startY = -margin;
        if (edge === 3) startY = height + margin;
        return {
          ...targetPoint,
          startX,
          startY,
          delay: random() * 210,
          orbit: (random() - 0.5) * (mobile ? 46 : 76),
          phase: random() * Math.PI * 2,
          size: index % 17 === 0 ? 2.2 : 1.1 + random() * 0.9
        };
      });
      stage.dataset.particleCount = String(particles.length);
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
      createParticleTargets();
    }

    function drawGrid(progressValue) {
      context.fillStyle = "#0b1512";
      context.fillRect(0, 0, width, height);
      const centerX = width / 2;
      const centerY = height / 2;
      const opacity = 0.055 + progressValue * 0.055;
      context.strokeStyle = `rgba(95, 180, 153, ${opacity})`;
      context.lineWidth = 0.7;
      const grid = width < 620 ? 42 : 54;
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
    }

    function drawAssembly(elapsed) {
      const progressValue = clamp(elapsed / assembleDuration);
      drawGrid(progressValue);
      particles.forEach((particle) => {
        const local = clamp(
          (elapsed - particle.delay) /
            Math.max(1, assembleDuration - particle.delay)
        );
        const eased = easeOutQuart(local);
        const orbit = particle.orbit * (1 - eased);
        const x =
          particle.startX +
          (particle.x - particle.startX) * eased +
          Math.cos(particle.phase + local * Math.PI * 2.4) * orbit;
        const y =
          particle.startY +
          (particle.y - particle.startY) * eased +
          Math.sin(particle.phase + local * Math.PI * 2.4) * orbit;
        context.fillStyle = particle.color;
        const size = particle.size * (0.58 + eased * 0.42);
        context.fillRect(x - size / 2, y - size / 2, size, size);
      });
      const imageOpacity = clamp((progressValue - 0.84) / 0.16);
      if (artwork && imageOpacity > 0) {
        context.save();
        context.globalAlpha = imageOpacity * 0.92;
        context.drawImage(artwork, 0, 0);
        context.restore();
      }
      progress.style.transform =
        `scaleX(${Math.min(1, elapsed / (assembleDuration + holdDuration))})`;
      stage.dataset.entryPhase =
        progressValue < 1 ? "assembling" : "holding";
      stage.classList.toggle("is-holding", progressValue >= 1);
    }

    function beginScroll(now, accelerated) {
      if (scrollStarted || finished) return;
      scrollStarted = now;
      scrollDuration = accelerated ? 360 : 620;
      scrollFrom = window.scrollY;
      previousScrollBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";
      stage.dataset.entryPhase = "scrolling";
      stage.classList.remove("is-holding");
    }

    function finish() {
      if (finished) return;
      finished = true;
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", skip);
      stage.removeEventListener("click", skip);
      document.documentElement.style.scrollBehavior = previousScrollBehavior;
      stage.classList.add("is-complete");
      stage.dataset.entryPhase = "complete";
      document.body.classList.remove("has-entry-sequence");
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
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", skip);
      stage.removeEventListener("click", skip);
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

    function render(now) {
      const elapsed = now - started;
      context.clearRect(0, 0, width, height);
      drawAssembly(Math.min(elapsed, assembleDuration));
      if (
        !scrollStarted &&
        elapsed >= assembleDuration + holdDuration
      ) {
        beginScroll(now, false);
      }
      if (scrollStarted) {
        const scrollProgress = clamp(
          (now - scrollStarted) / scrollDuration
        );
        const target = stage.offsetTop + stage.offsetHeight;
        window.scrollTo(
          0,
          scrollFrom +
            (target - scrollFrom) * easeInOutCubic(scrollProgress)
        );
        progress.style.transform =
          `scaleX(${0.75 + scrollProgress * 0.25})`;
        if (scrollProgress >= 1) {
          finish();
          return;
        }
      }
      frame = window.requestAnimationFrame(render);
    }

    window.addEventListener("resize", resize);
    window.addEventListener("keydown", skip);
    resize();
    window.scrollTo(0, 0);
    started = performance.now();
    cancelHomeIntro = cancel;
    frame = window.requestAnimationFrame(render);
    stage.addEventListener("click", skip);
  }

  async function initialize() {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const type = pageVisualType();
    document.body.dataset.visualType = type || "none";
    let introStarted = false;
    if (type === "home") {
      let cachedIntro = null;
      try {
        cachedIntro = window.localStorage.getItem(
          "gck-home-intro-enabled"
        );
      } catch {
        // The default remains enabled when storage is unavailable.
      }
      if (cachedIntro !== "0") {
        createEntrySequence(defaults, reducedMotion);
        introStarted = true;
      }
    } else {
      markHomeIntroReady("skipped");
    }

    const resolved = await (
      window.GCK_VISUAL_SETTINGS || Promise.resolve({})
    );
    const settings = { ...defaults, ...resolved };
    try {
      window.localStorage.setItem(
        "gck-home-intro-enabled",
        settings.home_intro_enabled ? "1" : "0"
      );
    } catch {
      // Visual settings still apply to the current page.
    }
    document.body.dataset.pointerEffect =
      settings.pointer_effect_enabled ? "on" : "off";

    if (type === "home") {
      if (!settings.home_intro_enabled) {
        if (cancelHomeIntro) {
          cancelHomeIntro();
        } else {
          document.querySelector("[data-entry-sequence]")?.remove();
          markHomeIntroReady("skipped");
        }
      } else if (!introStarted && !homeIntroReleased) {
        createEntrySequence(settings, reducedMotion);
      }
    }

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
  }

  initialize().catch(() => {
    document.body.dataset.visualType = "fallback";
    markHomeIntroReady("fallback");
  });
})();
