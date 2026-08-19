const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeMode,
  pruneTabs,
  shouldPlay
} = require("../src/assets/js/home-intro-policy.js");

const root = path.resolve(__dirname, "..");
const baseTemplate = fs.readFileSync(
  path.join(root, "src/_includes/layouts/base.njk"),
  "utf8"
);
const siteCss = fs.readFileSync(
  path.join(root, "src/assets/css/site.css"),
  "utf8"
);

assert.match(
  baseTemplate,
  /html\s*\{\s*background:\s*#07110f;[\s\S]*body\.page-home\s*\{[\s\S]*background:\s*#07110f;/
);
assert.match(
  siteCss,
  /\.page-home\s*\{[\s\S]*background:\s*#07110f;/
);

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
