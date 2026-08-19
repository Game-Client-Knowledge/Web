const assert = require("node:assert/strict");
const controls = require("../src/assets/js/home-content-controls.js");

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(value) {
      values.add(value);
    },
    contains(value) {
      return values.has(value);
    },
    remove(value) {
      values.delete(value);
    },
    toggle(value, force) {
      if (force === true) values.add(value);
      else if (force === false) values.delete(value);
      else if (values.has(value)) values.delete(value);
      else values.add(value);
      return values.has(value);
    }
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

function button() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    title: "",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    attribute(name) {
      return attributes.get(name);
    },
    click() {
      listeners.get("click")?.();
    }
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || new Set();
      handlers.add(listener);
      listeners.set(type, handlers);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.forEach((listener) => listener(event));
    },
    dispatchEvent(event) {
      this.dispatch(event.type, event);
    }
  };
}

function fakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    delay() {
      return timers.values().next().value?.delay;
    },
    count() {
      return timers.size;
    },
    runNext() {
      const [id, timer] = timers.entries().next().value || [];
      if (!timer) return false;
      timers.delete(id);
      timer.callback();
      return true;
    }
  };
}

function homeDocument(toggle, view) {
  const events = eventTarget();
  return {
    ...events,
    defaultView: view,
    hidden: false,
    body: {
      classList: classList(["page-home"]),
      dataset: {}
    },
    querySelector(selector) {
      return selector === "[data-home-content-toggle]" ? toggle : null;
    }
  };
}

const storage = memoryStorage();
const toggle = button();
const view = {
  ...eventTarget(),
  CustomEvent: class {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  }
};
const timers = fakeTimers();
let clock = 1000;
const documentRef = homeDocument(toggle, view);
const scrollCalls = [];
const controller = controls.initialize({
  document: documentRef,
  storage,
  view,
  setTimeout: timers.setTimeout,
  clearTimeout: timers.clearTimeout,
  now: () => clock,
  scrollTo(options) {
    scrollCalls.push(options);
  }
});

assert(controller);
assert.equal(controller.isHidden(), false);
assert.equal(documentRef.body.dataset.homeContent, "visible");
assert.equal(toggle.attribute("aria-pressed"), "false");
assert.equal(toggle.attribute("aria-label"), "隐藏主页内容");
assert.equal(controller.idleTimeout(), 30);
assert.equal(timers.delay(), 30000);

timers.runNext();
assert.equal(controller.isHidden(), true);
assert.equal(controller.hiddenReason(), "idle");
assert.equal(storage.getItem(controls.CACHE_KEY), null);
assert.equal(documentRef.body.dataset.homeContentReason, "idle");

view.dispatch("scroll");
assert.equal(
  controller.isHidden(),
  true,
  "the internal scroll-to-top event must not wake idle content"
);
clock += 300;
view.dispatch("pointermove");
assert.equal(controller.isHidden(), false);
assert.equal(controller.hiddenReason(), "");
assert.equal(timers.delay(), 30000);

toggle.click();
assert.equal(controller.isHidden(), true);
assert.equal(controller.hiddenReason(), "manual");
assert(documentRef.body.classList.contains("home-content-hidden"));
assert.equal(storage.getItem(controls.CACHE_KEY), "1");
assert.equal(toggle.attribute("aria-pressed"), "true");
assert.equal(toggle.attribute("aria-label"), "显示主页内容");
view.dispatch("pointermove");
assert.equal(
  controller.isHidden(),
  true,
  "activity must not override a manual hide"
);
assert.deepEqual(scrollCalls, [
  { top: 0, left: 0, behavior: "auto" },
  { top: 0, left: 0, behavior: "auto" }
]);

controller.destroy();
const restoredToggle = button();
const restoredView = {
  ...eventTarget(),
  CustomEvent: view.CustomEvent
};
const restoredTimers = fakeTimers();
const restoredDocument = homeDocument(restoredToggle, restoredView);
const restored = controls.initialize({
  document: restoredDocument,
  storage,
  view: restoredView,
  setTimeout: restoredTimers.setTimeout,
  clearTimeout: restoredTimers.clearTimeout
});
assert.equal(restored.isHidden(), true);
restoredToggle.click();
assert.equal(restored.isHidden(), false);
assert.equal(storage.getItem(controls.CACHE_KEY), "0");
assert(!restoredDocument.body.classList.contains("home-content-hidden"));
restored.updateIdleTimeout(1);
assert.equal(restoredTimers.delay(), 1000);
restoredTimers.runNext();
assert.equal(restored.hiddenReason(), "idle");
restored.updateIdleTimeout(0);
assert.equal(restored.isHidden(), false);
assert.equal(restored.idleTimeout(), 0);
restored.updateIdleTimeout(2);
restoredDocument.hidden = true;
restoredDocument.dispatch("visibilitychange");
assert.equal(restoredTimers.count(), 0);
restoredDocument.hidden = false;
restoredDocument.dispatch("visibilitychange");
assert.equal(restoredTimers.delay(), 2000);

const portalStorage = memoryStorage();
portalStorage.setItem(controls.CACHE_KEY, "1");
portalStorage.setItem(
  "gck-home-intro-settings",
  JSON.stringify({
    home_star_experience_mode: "contribution_portal"
  })
);
const portalToggle = button();
const portalView = {
  ...eventTarget(),
  CustomEvent: view.CustomEvent
};
const portalRequests = [];
portalView.addEventListener(
  "gck:contribution-space-request",
  (event) => portalRequests.push(event.detail)
);
const portalTimers = fakeTimers();
const portalDocument = homeDocument(portalToggle, portalView);
const portalController = controls.initialize({
  document: portalDocument,
  storage: portalStorage,
  view: portalView,
  setTimeout: portalTimers.setTimeout,
  clearTimeout: portalTimers.clearTimeout
});
assert.equal(portalController.isHidden(), false);
assert.equal(portalTimers.delay(), 30000);
portalTimers.runNext();
assert.deepEqual(portalRequests.at(-1), {
  action: "open",
  reason: "idle"
});
assert.equal(portalController.idlePortalActive(), true);
portalView.dispatch("gck:contribution-space-state", {
  detail: { phase: "opening", reason: "idle" }
});
assert.equal(portalController.portalPhase(), "opening");
assert.equal(portalTimers.count(), 0);
portalView.dispatch("pointermove");
assert.deepEqual(portalRequests.at(-1), {
  action: "close",
  reason: "activity"
});
assert.equal(portalController.idlePortalActive(), false);
portalView.dispatch("gck:contribution-space-state", {
  detail: { phase: "closing", reason: "activity" }
});
portalView.dispatch("gck:contribution-space-state", {
  detail: { phase: "collapsed", reason: "activity" }
});
assert.equal(portalTimers.delay(), 30000);
portalToggle.click();
assert.equal(
  portalController.isHidden(),
  false,
  "the contribution portal owns immersive state"
);
portalView.dispatch("gck:contribution-space-state", {
  detail: { phase: "opening", reason: "manual" }
});
const manualRequestCount = portalRequests.length;
portalView.dispatch("pointermove");
assert.equal(
  portalRequests.length,
  manualRequestCount,
  "activity must not close a manually opened contribution space"
);
portalView.dispatch("gck:contribution-space-state", {
  detail: { phase: "expanded", reason: "manual" }
});
assert.equal(portalTimers.count(), 0);
portalView.dispatch("gck:contribution-space-state", {
  detail: { phase: "collapsed", reason: "manual" }
});
portalView.dispatch("gck:visual-settings", {
  detail: {
    home_star_experience_mode: "immersive",
    home_content_idle_timeout_seconds: 2
  }
});
assert.equal(portalTimers.delay(), 2000);
portalController.destroy();

const nonHome = homeDocument(button(), restoredView);
nonHome.body.classList = classList(["page-document"]);
assert.equal(
  controls.initialize({
    document: nonHome,
    storage
  }),
  null
);

process.stdout.write("Homepage content visibility checks passed\n");
