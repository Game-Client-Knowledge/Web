(function () {
  "use strict";

  function refreshIcons(root) {
    if (window.lucide) {
      window.lucide.createIcons({
        attrs: {
          "stroke-width": 1.8
        },
        root: root || document
      });
    }
  }

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
    if (!sidebar || !backdrop) {
      return;
    }

    function close() {
      sidebar.classList.remove("is-open");
      backdrop.classList.remove("is-visible");
      document.body.classList.remove("has-sidebar-open");
    }

    document.querySelectorAll("[data-open-docs]").forEach(function (button) {
      button.addEventListener("click", function () {
        sidebar.classList.add("is-open");
        backdrop.classList.add("is-visible");
        document.body.classList.add("has-sidebar-open");
      });
    });
    document.querySelectorAll("[data-close-docs]").forEach(function (button) {
      button.addEventListener("click", close);
    });
    backdrop.addEventListener("click", close);
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
    const links = Array.from(document.querySelectorAll(".article-toc a"));
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

  function setupMermaid() {
    if (!window.mermaid || !document.querySelector(".mermaid")) {
      return;
    }
    window.mermaid.initialize({
      startOnLoad: true,
      securityLevel: "strict",
      theme: "base",
      themeVariables: {
        primaryColor: "#e6f3ef",
        primaryTextColor: "#1f2926",
        primaryBorderColor: "#178071",
        lineColor: "#66736e",
        secondaryColor: "#fff3e8",
        tertiaryColor: "#f3f1e8",
        fontFamily: "Inter, system-ui, sans-serif"
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    refreshIcons();
    setupHeaderNavigation();
    setupDocumentSidebar();
    setupCopyActions();
    setupTableOfContents();
    setupMermaid();
    refreshIcons();
  });
})();
