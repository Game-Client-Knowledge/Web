const assert = require("node:assert/strict");
const analytics = require("../src/assets/js/site-analytics.js");

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

const calls = [];
const controller = analytics.initialize({
  config: { editorApi: "/editor/api/" },
  document: { prerendering: false },
  fetch(url, options) {
    calls.push({ url, options });
    return Promise.resolve({ ok: true });
  }
});

assert.equal(controller.wasSent(), true);
assert.equal(controller.track(), false);
assert.equal(calls.length, 1);
assert.equal(calls[0].url, "/editor/api/analytics/visit");
assert.deepEqual(calls[0].options, {
  method: "POST",
  credentials: "include",
  keepalive: true,
  headers: {
    Accept: "application/json"
  }
});

let prerenderListener;
const prerenderCalls = [];
const prerendered = analytics.initialize({
  config: { editorApi: "/editor/api" },
  document: {
    prerendering: true,
    addEventListener(type, listener, options) {
      assert.equal(type, "prerenderingchange");
      assert.deepEqual(options, { once: true });
      prerenderListener = listener;
    }
  },
  fetch(url) {
    prerenderCalls.push(url);
    return Promise.resolve({ ok: true });
  }
});

assert.equal(prerendered.wasSent(), false);
prerenderListener();
assert.equal(prerendered.wasSent(), true);
assert.deepEqual(prerenderCalls, ["/editor/api/analytics/visit"]);

process.stdout.write("Anonymous site analytics client checks passed\n");
