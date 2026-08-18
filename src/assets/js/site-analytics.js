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
      fetch: root.fetch ? root.fetch.bind(root) : null
    });
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function analyticsEndpoint(config) {
    const editorApi = String(
      config?.editorApi || "/editor/api"
    ).replace(/\/+$/, "");
    return editorApi + "/analytics/visit";
  }

  function initialize(options) {
    const settings = options || {};
    const documentRef = settings.document;
    const fetchImpl = settings.fetch;
    const endpoint = analyticsEndpoint(settings.config || {});
    let sent = false;

    function track() {
      if (sent || typeof fetchImpl !== "function") return false;
      sent = true;
      Promise.resolve(
        fetchImpl(endpoint, {
          method: "POST",
          credentials: "include",
          keepalive: true,
          headers: {
            Accept: "application/json"
          }
        })
      ).catch(function () {
        // Analytics must never affect navigation or reading.
      });
      return true;
    }

    if (documentRef?.prerendering) {
      documentRef.addEventListener("prerenderingchange", track, {
        once: true
      });
    } else {
      track();
    }

    return {
      endpoint,
      track,
      wasSent: function () {
        return sent;
      }
    };
  }

  return {
    analyticsEndpoint,
    initialize
  };
});
