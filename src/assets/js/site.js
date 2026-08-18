(function () {
  "use strict";

  function refreshIcons(root) {
    const lucide = window.lucide;
    if (!lucide || !lucide.icons || !lucide.createElement) {
      return;
    }
    // The vendored lucide createIcons() ignores its root option and always
    // re-renders every [data-lucide] element in the whole document, which
    // repaints already-rendered SVGs and causes visible jank. Only convert
    // <i data-lucide> placeholders inside the requested scope instead.
    const scope = root || document;
    const pending = [];
    if (
      scope.nodeType === Node.ELEMENT_NODE &&
      typeof scope.matches === "function" &&
      scope.matches("i[data-lucide]")
    ) {
      pending.push(scope);
    }
    if (typeof scope.querySelectorAll === "function") {
      scope.querySelectorAll("i[data-lucide]").forEach(function (placeholder) {
        pending.push(placeholder);
      });
    }
    pending.forEach(function (placeholder) {
      const name = placeholder.getAttribute("data-lucide");
      if (!name) return;
      const componentName = name.replace(
        /(\w)(\w*)(_|-|\s*)/g,
        function (match, first, rest) {
          return first.toUpperCase() + rest.toLowerCase();
        }
      );
      const iconNode = lucide.icons[componentName];
      if (!iconNode) return;
      const iconAttrs = Object.assign({}, iconNode[1], {
        "data-lucide": name,
        "stroke-width": 1.8
      });
      Array.from(placeholder.attributes).forEach(function (attr) {
        if (attr.name === "data-lucide" || attr.name === "class") return;
        iconAttrs[attr.name] = attr.value;
      });
      const className = (
        "lucide lucide-" +
        name +
        " " +
        (placeholder.getAttribute("class") || "")
      ).trim();
      if (className) {
        iconAttrs.class = className;
      }
      const svg = lucide.createElement([iconNode[0], iconAttrs, iconNode[2] || []]);
      placeholder.replaceWith(svg);
    });
  }

  // Shared with search.js and editor-integration.js so every script converts
  // only new icon placeholders instead of re-rendering the whole document.
  window.GCKRefreshIcons = refreshIcons;

  function setCopied(button, label) {
    const original = button.innerHTML;
    button.innerHTML = '<i data-lucide="check" aria-hidden="true"></i>' + (label || "");
    button.classList.add("is-copied");
    refreshIcons(button);
    window.setTimeout(function () {
      button.innerHTML = original;
      button.classList.remove("is-copied");
      refreshIcons(button);
    }, 1600);
  }

  async function copyText(value, button, label) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(button, label);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      setCopied(button, label);
    }
  }

  function setupHeaderNavigation() {
    const trigger = document.querySelector("[data-toggle-menu]");
    const navigation = document.querySelector("[data-mobile-nav]");
    if (!trigger || !navigation) {
      return;
    }

    trigger.addEventListener("click", function () {
      const open = navigation.classList.toggle("is-open");
      trigger.setAttribute("aria-expanded", String(open));
      trigger.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    });
  }

  function setupDocumentSidebar() {
    const sidebar = document.querySelector("[data-docs-sidebar]");
    const backdrop = document.querySelector("[data-sidebar-backdrop]");
    if (!sidebar) {
      return;
    }
    const navigation = sidebar.querySelector(".docs-navigation");
    const config = window.GCK_CONFIG || {};
    const moduleRoot =
      config.editorContext && config.editorContext.root
        ? config.editorContext.root
        : window.location.pathname.split("/").slice(1, 3).join("/") || "site";
    const storageKey =
      "gck-docs-sidebar-scroll:v1:" + encodeURIComponent(moduleRoot);
    let restoring = true;

    function close() {
      sidebar.classList.remove("is-open");
      if (backdrop) backdrop.classList.remove("is-visible");
      document.body.classList.remove("has-sidebar-open");
    }

    function saveScroll() {
      try {
        window.sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            top: sidebar.scrollTop,
            path: window.location.pathname,
            time: Date.now()
          })
        );
      } catch {
        // Sidebar restoration is a convenience; navigation must never depend on it.
      }
    }

    function activeLink() {
      return (
        sidebar.querySelector('.docs-nav-unit li a[aria-current="page"]') ||
        sidebar.querySelector('.docs-nav-unit-title[aria-current="true"]')
      );
    }

    function linkIsVisible(link) {
      const linkBox = link.getBoundingClientRect();
      const sidebarBox = sidebar.getBoundingClientRect();
      return (
        linkBox.top >= sidebarBox.top + 24 &&
        linkBox.bottom <= sidebarBox.bottom - 24
      );
    }

    function restoreScroll() {
      let restored = false;
      try {
        const saved = JSON.parse(
          window.sessionStorage.getItem(storageKey) || "null"
        );
        if (saved && Date.now() - Number(saved.time || 0) < 30 * 60 * 1000) {
          sidebar.scrollTop = Math.max(0, Number(saved.top) || 0);
          restored = true;
        }
      } catch {
        // Fall back to active-link positioning below.
      }
      const current = activeLink();
      if (current && (!restored || !linkIsVisible(current))) {
        current.scrollIntoView({ block: "center" });
      }
      window.setTimeout(function () {
        restoring = false;
      }, 80);
    }

    sidebar.addEventListener("scroll", function () {
      if (!restoring) saveScroll();
    }, { passive: true });
    if (navigation) {
      navigation.addEventListener("click", function (event) {
        if (event.target.closest("a, summary")) {
          saveScroll();
        }
      });
    }
    window.addEventListener("pagehide", saveScroll);

    document.querySelectorAll("[data-open-docs]").forEach(function (button) {
      button.addEventListener("click", function () {
        sidebar.classList.add("is-open");
        if (backdrop) backdrop.classList.add("is-visible");
        document.body.classList.add("has-sidebar-open");
      });
    });
    document.querySelectorAll("[data-close-docs]").forEach(function (button) {
      button.addEventListener("click", close);
    });
    if (backdrop) backdrop.addEventListener("click", close);
    window.requestAnimationFrame(restoreScroll);
  }

  function setupCopyActions() {
    document.querySelectorAll("[data-copy-link]").forEach(function (button) {
      button.addEventListener("click", function () {
        copyText(window.location.href, button, "已复制");
      });
    });

    document.querySelectorAll("[data-copy-source]").forEach(function (button) {
      button.addEventListener("click", function () {
        const code = document.querySelector("[data-source-code]");
        if (code) {
          copyText(code.textContent, button, "已复制");
        }
      });
    });

    document.querySelectorAll(".prose pre").forEach(function (pre) {
      if (pre.closest(".mermaid") || pre.querySelector(".code-copy")) {
        return;
      }
      const button = document.createElement("button");
      button.className = "code-copy icon-button";
      button.type = "button";
      button.title = "复制代码";
      button.setAttribute("aria-label", "复制代码");
      button.innerHTML = '<i data-lucide="copy" aria-hidden="true"></i>';
      button.addEventListener("click", function () {
        const code = pre.querySelector("code");
        if (code) {
          copyText(code.textContent, button);
        }
      });
      pre.appendChild(button);
    });
  }

  function setupTableOfContents() {
    const links = Array.from(
      document.querySelectorAll(".article-toc a, .guide-aside ol a")
    );
    if (!links.length || !("IntersectionObserver" in window)) {
      return;
    }

    const targets = links
      .map(function (link) {
        return document.getElementById(decodeURIComponent(link.hash.slice(1)));
      })
      .filter(Boolean);

    const observer = new IntersectionObserver(
      function (entries) {
        const visible = entries
          .filter(function (entry) {
            return entry.isIntersecting;
          })
          .sort(function (left, right) {
            return left.boundingClientRect.top - right.boundingClientRect.top;
          });
        if (!visible.length) {
          return;
        }
        links.forEach(function (link) {
          link.removeAttribute("aria-current");
        });
        const active = links.find(function (link) {
          return decodeURIComponent(link.hash.slice(1)) === visible[0].target.id;
        });
        if (active) {
          active.setAttribute("aria-current", "location");
        }
      },
      { rootMargin: "-15% 0px -72% 0px" }
    );

    targets.forEach(function (target) {
      observer.observe(target);
    });
  }

  async function setupKnowledgeField() {
    if (window.GCK_HOME_STAR_MAP_ENGINE) {
      return;
    }
    const canvas = document.querySelector("[data-knowledge-field]");
    const context = canvas && canvas.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const visualSettings = await (
      window.GCK_VISUAL_SETTINGS || Promise.resolve({})
    );
    await (
      window.GCK_HOME_INTRO_READY || Promise.resolve("skipped")
    );
    const pointerEnabled =
      visualSettings.pointer_effect_enabled !== false;

    const host = canvas.closest(".library-intro");
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const pointColors = [
      "rgba(156, 224, 205, 0.88)",
      "rgba(238, 168, 104, 0.78)",
      "rgba(229, 201, 112, 0.72)",
      "rgba(255, 255, 255, 0.68)"
    ];
    const pointer = { x: 0, y: 0, active: false };
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let nodes = [];
    let frame = 0;
    let visible = true;

    function createNodes() {
      const density = Math.round((width * height) / 15000);
      const maximum = width < 700 ? 36 : 68;
      const count = Math.max(24, Math.min(maximum, density));
      nodes = Array.from({ length: count }, function (_, index) {
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.22,
          vy: (Math.random() - 0.5) * 0.22,
          radius: 0.8 + Math.random() * 1.4,
          depth: 0.25 + Math.random() * 0.75,
          color: pointColors[index % pointColors.length]
        };
      });
    }

    function resize() {
      const rectangle = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rectangle.width));
      height = Math.max(1, Math.round(rectangle.height));
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      createNodes();
      draw();
    }

    function draw() {
      context.clearRect(0, 0, width, height);
      const linkDistance = width < 700 ? 92 : 132;

      for (let left = 0; left < nodes.length; left += 1) {
        for (let right = left + 1; right < nodes.length; right += 1) {
          const deltaX = nodes[left].x - nodes[right].x;
          const deltaY = nodes[left].y - nodes[right].y;
          const distance = Math.hypot(deltaX, deltaY);
          if (distance >= linkDistance) {
            continue;
          }
          context.beginPath();
          context.strokeStyle =
            `rgba(132, 197, 179, ${0.2 * (1 - distance / linkDistance)})`;
          context.lineWidth = 0.7;
          context.moveTo(nodes[left].x, nodes[left].y);
          context.lineTo(nodes[right].x, nodes[right].y);
          context.stroke();
        }
      }

      nodes.forEach(function (node) {
        const offsetX = pointerEnabled && pointer.active
          ? (pointer.x - width / 2) * node.depth * 0.012
          : 0;
        const offsetY = pointerEnabled && pointer.active
          ? (pointer.y - height / 2) * node.depth * 0.012
          : 0;
        context.beginPath();
        context.fillStyle = node.color;
        context.arc(
          node.x + offsetX,
          node.y + offsetY,
          node.radius,
          0,
          Math.PI * 2
        );
        context.fill();

        if (reducedMotion) {
          return;
        }
        if (pointerEnabled && pointer.active) {
          const deltaX = pointer.x - node.x;
          const deltaY = pointer.y - node.y;
          const distance = Math.max(1, Math.hypot(deltaX, deltaY));
          if (distance < 180) {
            node.vx += (deltaX / distance) * 0.0012;
            node.vy += (deltaY / distance) * 0.0012;
          }
        }
        node.vx = Math.max(-0.34, Math.min(0.34, node.vx));
        node.vy = Math.max(-0.34, Math.min(0.34, node.vy));
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < -4) node.x = width + 4;
        if (node.x > width + 4) node.x = -4;
        if (node.y < -4) node.y = height + 4;
        if (node.y > height + 4) node.y = -4;
      });
    }

    function animate() {
      frame = 0;
      if (!visible || document.hidden) {
        return;
      }
      draw();
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

    if (pointerEnabled) {
      host.addEventListener("pointermove", function (event) {
        const rectangle = host.getBoundingClientRect();
        pointer.x = event.clientX - rectangle.left;
        pointer.y = event.clientY - rectangle.top;
        pointer.active = true;
      });
      host.addEventListener("pointerleave", function () {
        pointer.active = false;
      });
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else start();
    });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) start();
        else stop();
      }).observe(host);
    }
    if ("ResizeObserver" in window) {
      new ResizeObserver(resize).observe(host);
    } else {
      window.addEventListener("resize", resize);
    }

    resize();
    start();
  }

  function setupReaderComments() {
    if (!document.querySelector("[data-comments-panel]")) {
      return;
    }
    const script = document.createElement("script");
    const base = (window.GCK_CONFIG && window.GCK_CONFIG.basePath) || "";
    const version =
      (window.GCK_CONFIG && window.GCK_CONFIG.contentVersion) || "local";
    script.src =
      base + "/assets/js/reader-comments.js?v=" + encodeURIComponent(version);
    document.body.appendChild(script);
  }

  document.addEventListener("DOMContentLoaded", function () {
    refreshIcons();
    setupHeaderNavigation();
    setupDocumentSidebar();
    setupCopyActions();
    setupTableOfContents();
    setupKnowledgeField();
    setupReaderComments();
    refreshIcons();
  });
})();
