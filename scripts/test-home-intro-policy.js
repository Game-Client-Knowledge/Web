const assert = require("node:assert/strict");
const {
  normalizeMode,
  pruneTabs,
  shouldPlay
} = require("../src/assets/js/home-intro-policy.js");

assert.equal(normalizeMode("always", false), "always");
assert.equal(normalizeMode("revisit", true), "revisit");
assert.equal(normalizeMode("first", true), "first");
assert.equal(normalizeMode("off", true), "off");
assert.equal(normalizeMode("", false), "off");
assert.equal(normalizeMode("", true), "revisit");

assert.equal(
  shouldPlay("always", {
    everPlayed: true,
    force: false,
    navigationType: "reload",
    wasDeviceActive: true
  }),
  true
);
assert.equal(
  shouldPlay("first", {
    everPlayed: false,
    force: false,
    navigationType: "navigate",
    wasDeviceActive: false
  }),
  true
);
assert.equal(
  shouldPlay("first", {
    everPlayed: true,
    force: false,
    navigationType: "navigate",
    wasDeviceActive: false
  }),
  false
);
assert.equal(
  shouldPlay("revisit", {
    everPlayed: true,
    force: false,
    navigationType: "navigate",
    wasDeviceActive: false
  }),
  true
);
assert.equal(
  shouldPlay("revisit", {
    everPlayed: true,
    force: false,
    navigationType: "navigate",
    wasDeviceActive: true
  }),
  false
);
assert.equal(
  shouldPlay("revisit", {
    everPlayed: true,
    force: false,
    navigationType: "reload",
    wasDeviceActive: false
  }),
  false
);
assert.equal(
  shouldPlay("off", {
    everPlayed: false,
    force: true,
    navigationType: "navigate",
    wasDeviceActive: false
  }),
  false
);

assert.deepEqual(
  pruneTabs(
    {
      active: 99000,
      stale: 1000
    },
    100000
  ),
  { active: 99000 }
);

process.stdout.write("Homepage intro policy checks passed\n");
