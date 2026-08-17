(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root && root.document) {
    root.GCK_HOME_INTRO_POLICY = api.bootstrap(root);
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const SETTINGS_KEY = "gck-home-intro-settings";
  const DEVICE_STATE_KEY = "gck-home-intro-device:v1";
  const DEVICE_FIRST_KEY = "gck-home-intro-first:v1";
  const TAB_ID_KEY = "gck-home-intro-tab-id:v1";
  const FORCE_KEY = "gck-home-intro-force:v1";
  const MODES = new Set(["off", "always", "revisit", "first"]);
  const STALE_AFTER_MS = 20000;
  const HEARTBEAT_MS = 5000;

  function normalizeMode(value, enabled) {
    if (MODES.has(value)) {
      return value;
    }
    return enabled === false ? "off" : "revisit";
  }

  function pruneTabs(tabs, now) {
    return Object.fromEntries(
      Object.entries(tabs || {}).filter((entry) => {
        return now - Number(entry[1]) <= STALE_AFTER_MS;
      })
    );
  }

  function shouldPlay(mode, context) {
    if (mode === "off") return false;
    if (mode === "always") return true;
    if (mode === "first") return !context.everPlayed;
    return Boolean(
      context.force ||
      (
        !context.wasDeviceActive &&
        context.navigationType !== "reload"
      )
    );
  }

  function safeJson(storage, key, fallback) {
    try {
      const value = JSON.parse(storage.getItem(key) || "null");
      return value && typeof value === "object" ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function randomId(win) {
    try {
      return win.crypto.randomUUID();
    } catch {
      return (
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2)
      );
    }
  }

  function bootstrap(win) {
    const local = win.localStorage;
    const session = win.sessionStorage;
    const now = Date.now();
    const pageKind = win.GCK_PAGE_KIND || "";
    const isHome = pageKind === "home";
    const cached = safeJson(local, SETTINGS_KEY, {});
    let mode = normalizeMode(
      cached.home_intro_mode,
      cached.home_intro_enabled
    );
    let tabId;
    try {
      tabId = session.getItem(TAB_ID_KEY) || randomId(win);
      session.setItem(TAB_ID_KEY, tabId);
    } catch {
      tabId = randomId(win);
    }

    let state = safeJson(local, DEVICE_STATE_KEY, { tabs: {} });
    state.tabs = pruneTabs(state.tabs, now);
    const wasDeviceActive = Object.keys(state.tabs).length > 0;
    let force = false;
    try {
      force = session.getItem(FORCE_KEY) === "1";
      session.removeItem(FORCE_KEY);
    } catch {
      force = false;
    }
    let everPlayed = false;
    try {
      everPlayed = local.getItem(DEVICE_FIRST_KEY) === "1";
    } catch {
      everPlayed = false;
    }
    const navigation = win.performance
      ?.getEntriesByType("navigation")
      ?.[0]?.type || "navigate";
    const entryContext = {
      everPlayed,
      force,
      navigationType: navigation,
      wasDeviceActive
    };

    function saveState(nextState) {
      state = nextState;
      try {
        local.setItem(DEVICE_STATE_KEY, JSON.stringify(state));
      } catch {
        // Device tracking degrades to the current page when storage is denied.
      }
    }

    function register() {
      const timestamp = Date.now();
      const latest = safeJson(local, DEVICE_STATE_KEY, { tabs: {} });
      latest.tabs = pruneTabs(latest.tabs, timestamp);
      latest.tabs[tabId] = timestamp;
      saveState(latest);
    }

    function unregister() {
      const timestamp = Date.now();
      const latest = safeJson(local, DEVICE_STATE_KEY, { tabs: {} });
      latest.tabs = pruneTabs(latest.tabs, timestamp);
      delete latest.tabs[tabId];
      if (!Object.keys(latest.tabs).length) {
        latest.lastExitAt = timestamp;
      }
      saveState(latest);
    }

    function applyDocumentClass(value) {
      if (!isHome) return;
      win.document.documentElement.classList.toggle(
        "home-intro-seen",
        !value
      );
    }

    const policy = {
      mode,
      shouldPlay: shouldPlay(mode, entryContext),
      markPlayed: function () {
        everPlayed = true;
        try {
          local.setItem(DEVICE_FIRST_KEY, "1");
        } catch {
          // First-visit mode can only persist when local storage is available.
        }
      },
      updateMode: function (nextMode, enabled) {
        mode = normalizeMode(nextMode, enabled);
        policy.mode = mode;
        policy.shouldPlay = shouldPlay(mode, entryContext);
        applyDocumentClass(policy.shouldPlay);
        return policy.shouldPlay;
      }
    };

    try {
      const secure = win.location.protocol === "https:" ? "; Secure" : "";
      win.document.cookie =
        "gck_home_intro_session=; Path=/; Max-Age=0; SameSite=Lax" +
        secure;
    } catch {
      // The obsolete session cookie is harmless when cookie access is denied.
    }

    applyDocumentClass(policy.shouldPlay);
    register();
    const heartbeat = win.setInterval(register, HEARTBEAT_MS);
    let internalNavigation = false;
    let internalReset = 0;

    function markInternalNavigation() {
      internalNavigation = true;
      win.clearTimeout(internalReset);
      internalReset = win.setTimeout(function () {
        internalNavigation = false;
      }, 1500);
    }

    win.document.addEventListener(
      "click",
      function (event) {
        const anchor = event.target.closest("a[href]");
        if (
          !anchor ||
          anchor.target === "_blank" ||
          anchor.hasAttribute("download")
        ) {
          return;
        }
        try {
          const target = new URL(anchor.href, win.location.href);
          const current = new URL(win.location.href);
          if (
            target.origin === current.origin &&
            (
              target.pathname !== current.pathname ||
              target.search !== current.search
            )
          ) {
            markInternalNavigation();
          }
        } catch {
          // Invalid links are handled by the browser.
        }
      },
      true
    );
    win.document.addEventListener(
      "submit",
      function (event) {
        try {
          const target = new URL(
            event.target.action || win.location.href,
            win.location.href
          );
          if (target.origin === win.location.origin) {
            markInternalNavigation();
          }
        } catch {
          // Invalid form actions are handled by the browser.
        }
      },
      true
    );
    win.addEventListener("pagehide", function () {
      win.clearInterval(heartbeat);
      if (internalNavigation) register();
      else unregister();
    });
    win.addEventListener("pageshow", function (event) {
      if (!event.persisted) return;
      const latest = safeJson(local, DEVICE_STATE_KEY, { tabs: {} });
      latest.tabs = pruneTabs(latest.tabs, Date.now());
      const otherTabActive = Object.keys(latest.tabs).some(function (id) {
        return id !== tabId;
      });
      const replay = shouldPlay(mode, {
        everPlayed,
        force: false,
        navigationType: "back_forward",
        wasDeviceActive: otherTabActive
      });
      if (isHome && replay) {
        try {
          session.setItem(FORCE_KEY, "1");
        } catch {
          // Reload still applies the configured mode.
        }
        win.location.reload();
        return;
      }
      register();
    });

    return policy;
  }

  return {
    bootstrap,
    normalizeMode,
    pruneTabs,
    shouldPlay
  };
});
