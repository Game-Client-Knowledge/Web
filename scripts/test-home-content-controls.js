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

function homeDocument(toggle) {
  return {
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
const documentRef = homeDocument(toggle);
const scrollCalls = [];
const controller = controls.initialize({
  document: documentRef,
  storage,
  scrollTo(options) {
    scrollCalls.push(options);
  }
});

assert(controller);
assert.equal(controller.isHidden(), false);
assert.equal(documentRef.body.dataset.homeContent, "visible");
assert.equal(toggle.attribute("aria-pressed"), "false");
assert.equal(toggle.attribute("aria-label"), "隐藏主页内容");

toggle.click();
assert.equal(controller.isHidden(), true);
assert(documentRef.body.classList.contains("home-content-hidden"));
assert.equal(storage.getItem(controls.CACHE_KEY), "1");
assert.equal(toggle.attribute("aria-pressed"), "true");
assert.equal(toggle.attribute("aria-label"), "显示主页内容");
assert.deepEqual(scrollCalls, [{ top: 0, left: 0, behavior: "auto" }]);

controller.destroy();
const restoredToggle = button();
const restoredDocument = homeDocument(restoredToggle);
const restored = controls.initialize({
  document: restoredDocument,
  storage
});
assert.equal(restored.isHidden(), true);
restoredToggle.click();
assert.equal(restored.isHidden(), false);
assert.equal(storage.getItem(controls.CACHE_KEY), "0");
assert(!restoredDocument.body.classList.contains("home-content-hidden"));

const nonHome = homeDocument(button());
nonHome.body.classList = classList(["page-document"]);
assert.equal(
  controls.initialize({
    document: nonHome,
    storage
  }),
  null
);

process.stdout.write("Homepage content visibility checks passed\n");
