(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.GCKSiteAnalytics = api;

  if (root.document) {
    api.initialize({
      config: root.GCK_CONFIG || {},
      document: root.document,
      window: root,
      fetch: root.fetch ? root.fetch.bind(root) : null,
      initialPath: root.GCK_ACTIVE_CODE_SOURCE,
      now: function () {
        return root.performance?.now?.() || Date.now();
      }
    });
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const MAX_READING_SECONDS = 6 * 60 * 60;

  function analyticsEndpoint(config) {
    const editorApi = String(
      config?.editorApi || "/editor/api"
    ).replace(/\/+$/, "");
    return editorApi + "/analytics/visit";
  }

  function normalizePath(value) {
    const path = String(value || "").trim().replace(/\\/g, "/");
    if (
      !path ||
      path.length > 240 ||
      path.startsWith("/") ||
      path.split("/").some(function (part) {
        return !part || part === ".." || part.startsWith(".");
      })
    ) {
      return "";
    }
    return path;
  }

  function initialize(options) {
    const settings = options || {};
    const config = settings.config || {};
    const documentRef = settings.document;
    const windowRef = settings.window;
    const fetchImpl = settings.fetch;
    const now =
      typeof settings.now === "function" ? settings.now : Date.now;
    const endpoint = analyticsEndpoint(config);
    const entries = new Map();
    let activePath = "";
    let segmentStartedAt = null;
    let starMapExpanded = false;
    let starMapStartedAt = null;
    let starMapMilliseconds = 0;
    let started = false;
    let sent = false;

    function visible() {
      return documentRef?.visibilityState !== "hidden";
    }

    function entryFor(path) {
      if (!entries.has(path)) {
        entries.set(path, { views: 0, milliseconds: 0 });
      }
      return entries.get(path);
    }

    function settle(timestamp) {
      if (!activePath || segmentStartedAt === null) return;
      const elapsed = Math.max(0, timestamp - segmentStartedAt);
      const entry = entryFor(activePath);
      entry.milliseconds = Math.min(
        MAX_READING_SECONDS * 1000,
        entry.milliseconds + elapsed
      );
      segmentStartedAt = null;
    }

    function resume(timestamp) {
      if (activePath && visible()) {
        segmentStartedAt = timestamp;
      }
    }

    function settleStarMap(timestamp) {
      if (!starMapExpanded || starMapStartedAt === null) return;
      starMapMilliseconds = Math.min(
        MAX_READING_SECONDS * 1000,
        starMapMilliseconds +
          Math.max(0, timestamp - starMapStartedAt)
      );
      starMapStartedAt = null;
    }

    function resumeStarMap(timestamp) {
      if (starMapExpanded && visible()) {
        starMapStartedAt = timestamp;
      }
    }

    function activateContent(value) {
      const path = normalizePath(value);
      if (!started || !path || path === activePath) return false;
      const timestamp = now();
      settle(timestamp);
      activePath = path;
      entryFor(path).views += 1;
      resume(timestamp);
      return true;
    }

    function start() {
      if (started) return false;
      started = true;
      const initialPath = normalizePath(
        settings.initialPath ||
        config.analyticsPath ||
        config.editorContext?.sourcePath
      );
      if (initialPath) {
        activePath = initialPath;
        entryFor(initialPath).views = 1;
        resume(now());
      }
      starMapExpanded =
        documentRef?.body?.dataset?.contributionSpaceState ===
        "expanded";
      resumeStarMap(now());
      return true;
    }

    function visibilityChanged() {
      if (!started || sent) return;
      const timestamp = now();
      settle(timestamp);
      settleStarMap(timestamp);
      resume(timestamp);
      resumeStarMap(timestamp);
    }

    function compactEntries() {
      return Array.from(entries, function ([path, entry]) {
        return [
          path,
          Math.min(32, entry.views),
          Math.min(
            MAX_READING_SECONDS,
            Math.round(entry.milliseconds / 1000)
          )
        ];
      })
        .filter(function (entry) {
          return entry[1] > 0;
        })
        .slice(0, 64);
    }

    function starMapSeconds() {
      return Math.min(
        MAX_READING_SECONDS,
        Math.round(starMapMilliseconds / 1000)
      );
    }

    function flush() {
      if (sent || !started || typeof fetchImpl !== "function") {
        return false;
      }
      const timestamp = now();
      settle(timestamp);
      settleStarMap(timestamp);
      sent = true;
      const contentEntries = compactEntries();
      const starSeconds = starMapSeconds();
      const payload = {};
      if (contentEntries.length) payload.f = contentEntries;
      if (starSeconds) payload.s = starSeconds;
      const body = Object.keys(payload).length
        ? JSON.stringify(payload)
        : undefined;
      const request = {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: {
          Accept: "application/json"
        }
      };
      if (body) {
        request.body = body;
        request.headers["Content-Type"] =
          "text/plain;charset=UTF-8";
      }
      try {
        Promise.resolve(fetchImpl(endpoint, request)).catch(function () {
          // Analytics must never affect navigation or reading.
        });
      } catch (error) {
        // Analytics must never affect navigation or reading.
      }
      return true;
    }

    function codeFileViewed(event) {
      activateContent(event?.detail?.path);
    }

    function contributionSpaceChanged(event) {
      if (!started || sent) return;
      const expanded = event?.detail?.phase === "expanded";
      if (expanded === starMapExpanded) return;
      const timestamp = now();
      settleStarMap(timestamp);
      starMapExpanded = expanded;
      resumeStarMap(timestamp);
    }

    documentRef?.addEventListener?.(
      "visibilitychange",
      visibilityChanged
    );
    documentRef?.addEventListener?.("freeze", flush, { once: true });
    windowRef?.addEventListener?.("pagehide", flush, { once: true });
    windowRef?.addEventListener?.("beforeunload", flush, {
      once: true
    });
    windowRef?.addEventListener?.(
      "gck:code-file-view",
      codeFileViewed
    );
    windowRef?.addEventListener?.(
      "gck:contribution-space-state",
      contributionSpaceChanged
    );

    if (documentRef?.prerendering) {
      documentRef.addEventListener("prerenderingchange", start, {
        once: true
      });
    } else {
      start();
    }

    return {
      endpoint,
      activateContent,
      flush,
      track: flush,
      wasSent: function () {
        return sent;
      },
      contentEntries: compactEntries,
      starMapSeconds
    };
  }

  return {
    analyticsEndpoint,
    initialize,
    normalizePath
  };
});
