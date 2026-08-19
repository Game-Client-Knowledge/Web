(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.GCKHomeContentControls = api;

  if (root.document) {
    const start = function () {
      api.initialize({
        document: root.document,
        storage: root.localStorage,
        scrollTo: root.scrollTo
          ? root.scrollTo.bind(root)
          : function () {}
      });
    };
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", start, {
        once: true
      });
    } else {
      start();
    }
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const CACHE_KEY = "gck-home-content-hidden:v1";
  const DEFAULT_IDLE_TIMEOUT_SECONDS = 30;

  function readHidden(storage) {
    if (!storage) return false;
    try {
      return storage.getItem(CACHE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function writeHidden(storage, hidden) {
    if (!storage) return;
    try {
      storage.setItem(CACHE_KEY, hidden ? "1" : "0");
    } catch {
      // The current page can still update when storage is unavailable.
    }
  }

  function initialize(options) {
    const settings = options || {};
    const documentRef = settings.document;
    const storage = settings.storage;
    const scrollTo = settings.scrollTo || function () {};
    const view = settings.view || documentRef?.defaultView;
    const now = settings.now || Date.now;
    const setTimer =
      settings.setTimeout ||
      (view && view.setTimeout
        ? view.setTimeout.bind(view)
        : setTimeout);
    const clearTimer =
      settings.clearTimeout ||
      (view && view.clearTimeout
        ? view.clearTimeout.bind(view)
        : clearTimeout);
    if (
      !documentRef ||
      !documentRef.body ||
      !documentRef.body.classList.contains("page-home")
    ) {
      return null;
    }
    const button = documentRef.querySelector("[data-home-content-toggle]");
    if (!button) return null;

    let portalMode =
      documentRef.body.dataset.homeStarExperience ===
      "contribution_portal";
    try {
      const cached = JSON.parse(
        storage?.getItem("gck-home-intro-settings") || "null"
      );
      portalMode =
        portalMode ||
        cached?.home_star_experience_mode ===
          "contribution_portal";
    } catch {
      // The server setting will reconcile the mode after bootstrap.
    }
    let hidden = portalMode ? false : readHidden(storage);
    let hiddenReason = hidden ? "manual" : "";
    let idleTimeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS;
    let idleTimer = 0;
    let lastTimerResetAt = 0;
    let ignoreActivityUntil = 0;
    let portalPhase = "collapsed";
    let idlePortalActive = false;
    let destroyed = false;

    function normalizeIdleTimeout(value) {
      const timeout = Number(value);
      if (!Number.isFinite(timeout)) {
        return DEFAULT_IDLE_TIMEOUT_SECONDS;
      }
      return Math.max(0, Math.min(3600, timeout));
    }

    function clearIdleTimer() {
      if (!idleTimer) return;
      clearTimer(idleTimer);
      idleTimer = 0;
    }

    function requestPortal(action, reason) {
      if (
        !portalMode ||
        !view ||
        typeof view.CustomEvent !== "function" ||
        typeof view.dispatchEvent !== "function"
      ) {
        return false;
      }
      view.dispatchEvent(
        new view.CustomEvent("gck:contribution-space-request", {
          detail: {
            action,
            reason: reason || "idle"
          }
        })
      );
      return true;
    }

    function closeIdlePortal(reason) {
      if (!portalMode || !idlePortalActive) return false;
      idlePortalActive = false;
      requestPortal("close", reason || "activity");
      return true;
    }

    function scheduleIdleTimer() {
      clearIdleTimer();
      if (
        destroyed ||
        hidden ||
        idleTimeoutSeconds <= 0 ||
        documentRef.hidden ||
        (portalMode && portalPhase !== "collapsed")
      ) {
        return;
      }
      idleTimer = setTimer(function () {
        idleTimer = 0;
        if (
          documentRef.body.classList.contains("has-entry-sequence")
        ) {
          scheduleIdleTimer();
          return;
        }
        if (portalMode) {
          idlePortalActive = requestPortal("open", "idle");
          return;
        }
        apply(true, false, "idle");
      }, idleTimeoutSeconds * 1000);
      lastTimerResetAt = now();
    }

    function apply(nextHidden, persist, reason) {
      hidden = Boolean(nextHidden);
      hiddenReason = hidden ? reason || "manual" : "";
      documentRef.body.classList.toggle("home-content-hidden", hidden);
      documentRef.body.classList.toggle(
        "home-content-idle-hidden",
        hiddenReason === "idle"
      );
      documentRef.body.dataset.homeContent =
        hidden ? "hidden" : "visible";
      documentRef.body.dataset.homeContentReason =
        hiddenReason || "visible";
      button.setAttribute("aria-pressed", hidden ? "true" : "false");
      button.setAttribute(
        "aria-label",
        hidden ? "显示主页内容" : "隐藏主页内容"
      );
      button.title = hidden ? "显示主页内容" : "隐藏主页内容";
      if (persist) writeHidden(storage, hidden);
      if (hidden) {
        ignoreActivityUntil = now() + 250;
        scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      if (
        view &&
        typeof view.CustomEvent === "function" &&
        typeof view.dispatchEvent === "function"
      ) {
        view.dispatchEvent(
          new view.CustomEvent("gck:home-content-visibility", {
            detail: { hidden, reason: hiddenReason }
          })
        );
      }
      if (hidden) clearIdleTimer();
      else scheduleIdleTimer();
      return hidden;
    }

    function onClick() {
      if (portalMode) return;
      apply(!hidden, true, "manual");
    }

    function onActivity(event) {
      if (now() < ignoreActivityUntil) return;
      if (
        event &&
        event.target &&
        typeof event.target.closest === "function" &&
        event.target.closest("[data-home-content-toggle]")
      ) {
        return;
      }
      if (portalMode) {
        if (closeIdlePortal("activity")) return;
        if (
          portalPhase === "collapsed" &&
          now() - lastTimerResetAt >= 250
        ) {
          scheduleIdleTimer();
        }
        return;
      }
      if (hiddenReason === "idle") {
        apply(false, false, "");
        return;
      }
      if (!hidden && now() - lastTimerResetAt >= 250) {
        scheduleIdleTimer();
      }
    }

    function onPortalActivityCapture(event) {
      if (!closeIdlePortal("activity")) return;
      if (event?.cancelable) event.preventDefault();
      event?.stopPropagation?.();
    }

    function onVisibilityChange() {
      if (documentRef.hidden) {
        clearIdleTimer();
      } else if (portalMode) {
        if (!closeIdlePortal("visibility")) {
          scheduleIdleTimer();
        }
      } else if (hiddenReason === "idle") {
        apply(false, false, "");
      } else if (!hidden) {
        scheduleIdleTimer();
      } else {
        clearIdleTimer();
      }
    }

    function updateIdleTimeout(value) {
      idleTimeoutSeconds = normalizeIdleTimeout(value);
      if (idleTimeoutSeconds <= 0) {
        if (portalMode) closeIdlePortal("disabled");
        if (hiddenReason === "idle") {
          apply(false, false, "");
        } else {
          clearIdleTimer();
        }
      } else if (
        !hidden &&
        (!portalMode || portalPhase === "collapsed")
      ) {
        scheduleIdleTimer();
      }
      documentRef.body.dataset.homeContentIdleTimeout =
        String(idleTimeoutSeconds);
      return idleTimeoutSeconds;
    }

    function onVisualSettings(event) {
      if (!event.detail) return;
      if (
        Object.hasOwn(
          event.detail,
          "home_star_experience_mode"
        )
      ) {
        const nextPortalMode =
          event.detail.home_star_experience_mode ===
          "contribution_portal";
        if (!nextPortalMode && portalMode) {
          closeIdlePortal("mode-change");
        }
        portalMode = nextPortalMode;
        if (portalMode && hidden) {
          apply(false, false, "");
        } else if (
          !hidden &&
          (!portalMode || portalPhase === "collapsed")
        ) {
          scheduleIdleTimer();
        }
        documentRef.body.dataset.homeContentControls =
          portalMode ? "portal" : "immersive";
      }
      if (
        Object.hasOwn(
          event.detail,
          "home_content_idle_timeout_seconds"
        )
      ) {
        updateIdleTimeout(
          event.detail.home_content_idle_timeout_seconds
        );
      }
    }

    function onPortalState(event) {
      const phase = event.detail?.phase;
      if (
        !["collapsed", "opening", "expanded", "closing"].includes(
          phase
        )
      ) {
        return;
      }
      portalPhase = phase;
      if (phase === "collapsed") {
        idlePortalActive = false;
        scheduleIdleTimer();
      } else {
        clearIdleTimer();
      }
    }

    button.addEventListener("click", onClick);
    const activityEvents = [
      "pointermove",
      "pointerdown",
      "touchstart",
      "keydown",
      "wheel",
      "scroll"
    ];
    activityEvents.forEach(function (eventName) {
      view?.addEventListener(eventName, onActivity, { passive: true });
      view?.addEventListener(eventName, onPortalActivityCapture, {
        capture: true,
        passive: false
      });
    });
    documentRef.addEventListener(
      "visibilitychange",
      onVisibilityChange
    );
    view?.addEventListener("gck:visual-settings", onVisualSettings);
    view?.addEventListener(
      "gck:contribution-space-state",
      onPortalState
    );
    apply(hidden, false, hiddenReason);

    if (view?.GCK_VISUAL_SETTINGS?.then) {
      view.GCK_VISUAL_SETTINGS.then(function (visualSettings) {
        onVisualSettings({ detail: visualSettings || {} });
      });
    }

    return {
      destroy: function () {
        destroyed = true;
        clearIdleTimer();
        button.removeEventListener("click", onClick);
        activityEvents.forEach(function (eventName) {
          view?.removeEventListener(eventName, onActivity);
          view?.removeEventListener(
            eventName,
            onPortalActivityCapture,
            { capture: true }
          );
        });
        documentRef.removeEventListener(
          "visibilitychange",
          onVisibilityChange
        );
        view?.removeEventListener(
          "gck:visual-settings",
          onVisualSettings
        );
        view?.removeEventListener(
          "gck:contribution-space-state",
          onPortalState
        );
      },
      isHidden: function () {
        return hidden;
      },
      hiddenReason: function () {
        return hiddenReason;
      },
      idleTimeout: function () {
        return idleTimeoutSeconds;
      },
      portalPhase: function () {
        return portalPhase;
      },
      idlePortalActive: function () {
        return idlePortalActive;
      },
      setHidden: function (nextHidden) {
        return apply(nextHidden, true, "manual");
      },
      updateIdleTimeout
    };
  }

  return {
    CACHE_KEY,
    DEFAULT_IDLE_TIMEOUT_SECONDS,
    initialize,
    readHidden,
    writeHidden
  };
});
