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
    if (
      !documentRef ||
      !documentRef.body ||
      !documentRef.body.classList.contains("page-home")
    ) {
      return null;
    }
    const button = documentRef.querySelector("[data-home-content-toggle]");
    if (!button) return null;

    let hidden = readHidden(storage);

    function apply(nextHidden, persist) {
      hidden = Boolean(nextHidden);
      documentRef.body.classList.toggle("home-content-hidden", hidden);
      documentRef.body.dataset.homeContent =
        hidden ? "hidden" : "visible";
      button.setAttribute("aria-pressed", hidden ? "true" : "false");
      button.setAttribute(
        "aria-label",
        hidden ? "显示主页内容" : "隐藏主页内容"
      );
      button.title = hidden ? "显示主页内容" : "隐藏主页内容";
      if (persist) writeHidden(storage, hidden);
      if (hidden) {
        scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      const view = documentRef.defaultView;
      if (view && typeof view.CustomEvent === "function") {
        view.dispatchEvent(
          new view.CustomEvent("gck:home-content-visibility", {
            detail: { hidden }
          })
        );
      }
      return hidden;
    }

    function onClick() {
      apply(!hidden, true);
    }

    button.addEventListener("click", onClick);
    apply(hidden, false);

    return {
      destroy: function () {
        button.removeEventListener("click", onClick);
      },
      isHidden: function () {
        return hidden;
      },
      setHidden: function (nextHidden) {
        return apply(nextHidden, true);
      }
    };
  }

  return {
    CACHE_KEY,
    initialize,
    readHidden,
    writeHidden
  };
});
