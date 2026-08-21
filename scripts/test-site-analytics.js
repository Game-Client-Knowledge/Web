const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const analytics = require("../src/assets/js/site-analytics.js");
const codeReaderSource = fs.readFileSync(
  path.join(__dirname, "../src/assets/js/code-reader.js"),
  "utf8"
);
const layoutSource = fs.readFileSync(
  path.join(__dirname, "../src/_includes/layouts/base.njk"),
  "utf8"
);

assert.equal(
  analytics.analyticsEndpoint({
    editorApi: "https://example.test/editor/api/"
  }),
  "https://example.test/editor/api/analytics/visit"
);
assert.equal(
  analytics.analyticsEndpoint({}),
  "/editor/api/analytics/visit"
);
assert.equal(
  analytics.normalizePath("program/knowledge/topic.md"),
  "program/knowledge/topic.md"
);
assert.equal(analytics.normalizePath("../private.md"), "");

function eventTarget(initial = {}) {
  const listeners = new Map();
  return {
    ...initial,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type, detail) {
      listeners.get(type)?.({ type, detail });
    }
  };
}

let clock = 1000;
const calls = [];
const documentRef = eventTarget({
  prerendering: false,
  visibilityState: "visible"
});
const windowRef = eventTarget();
const controller = analytics.initialize({
  config: {
    editorApi: "/editor/api/",
    analyticsPath: "program/knowledge/topic.md"
  },
  document: documentRef,
  window: windowRef,
  now: () => clock,
  fetch(url, options) {
    calls.push({ url, options });
    return Promise.resolve({ ok: true });
  }
});

assert.equal(controller.wasSent(), false);
assert.equal(calls.length, 0, "tracking must wait and batch one request");

clock = 4100;
documentRef.visibilityState = "hidden";
documentRef.dispatch("visibilitychange");
clock = 6100;
documentRef.visibilityState = "visible";
documentRef.dispatch("visibilitychange");
clock = 7000;
windowRef.dispatch("gck:contribution-space-state", {
  phase: "expanded"
});
clock = 8000;
documentRef.visibilityState = "hidden";
documentRef.dispatch("visibilitychange");
clock = 10000;
documentRef.visibilityState = "visible";
documentRef.dispatch("visibilitychange");
clock = 12000;
windowRef.dispatch("gck:contribution-space-state", {
  phase: "closing"
});
clock = 13000;
windowRef.dispatch("gck:code-file-view", {
  path: "program/code/demo/main.cpp"
});
clock = 16000;
assert.equal(controller.flush(), true);
assert.equal(controller.flush(), false);
assert.equal(calls.length, 1);
assert.equal(calls[0].url, "/editor/api/analytics/visit");
assert.deepEqual(calls[0].options, {
  method: "POST",
  credentials: "include",
  keepalive: true,
  headers: {
    Accept: "application/json",
    "Content-Type": "text/plain;charset=UTF-8"
  },
  body: JSON.stringify({
    f: [
      ["program/knowledge/topic.md", 1, 8],
      ["program/code/demo/main.cpp", 1, 3]
    ],
    s: 3
  })
});
assert.equal(controller.starMapSeconds(), 3);

const prerenderCalls = [];
let prerenderClock = 500;
const prerenderedDocument = eventTarget({
  prerendering: true,
  visibilityState: "visible"
});
const prerendered = analytics.initialize({
  config: {
    editorApi: "/editor/api",
    editorContext: { sourcePath: "program/knowledge/preview.md" }
  },
  document: prerenderedDocument,
  window: eventTarget(),
  now: () => prerenderClock,
  fetch(url, options) {
    prerenderCalls.push({ url, options });
    return Promise.resolve({ ok: true });
  }
});

assert.equal(prerendered.flush(), false);
prerenderedDocument.dispatch("prerenderingchange");
prerenderClock = 2500;
assert.equal(prerendered.flush(), true);
assert.equal(prerenderCalls.length, 1);
assert.deepEqual(
  JSON.parse(prerenderCalls[0].options.body),
  { f: [["program/knowledge/preview.md", 1, 2]] }
);

const genericCalls = [];
const generic = analytics.initialize({
  config: {},
  document: eventTarget({
    prerendering: false,
    visibilityState: "visible"
  }),
  window: eventTarget(),
  fetch(url, options) {
    genericCalls.push({ url, options });
    return Promise.resolve({ ok: true });
  }
});
assert.equal(generic.flush(), true);
assert.equal(genericCalls.length, 1);
assert.equal(genericCalls[0].options.body, undefined);
assert.match(codeReaderSource, /gck:code-file-view/);
assert.match(codeReaderSource, /GCK_ACTIVE_CODE_SOURCE = file\.sourcePath/);
assert.match(codeReaderSource, /detail: \{ path: file\.sourcePath \}/);
assert.match(layoutSource, /analyticsPath:/);

process.stdout.write(
  "Anonymous content analytics client checks passed\n"
);
