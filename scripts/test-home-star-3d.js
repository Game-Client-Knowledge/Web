const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/assets/js/home-star-3d.js"),
  "utf8"
);
const mapSource = fs.readFileSync(
  path.join(root, "src/assets/js/home-star-map.js"),
  "utf8"
);
const visualSource = fs.readFileSync(
  path.join(root, "src/assets/js/site-visuals.js"),
  "utf8"
);
const indexSource = fs.readFileSync(
  path.join(root, "src/index.njk"),
  "utf8"
);
const cssSource = fs.readFileSync(
  path.join(root, "src/assets/css/site.css"),
  "utf8"
);

assert.match(source, /const DEFAULT_ORBIT_POINT_MIN_DEPTH = 280;/);
assert.match(source, /halo:\s*200,/);
assert.match(source, /core:\s*36,/);
assert.match(source, /spike:\s*240,/);
assert.match(source, /pulse:\s*36/);
for (const setting of [
  "home_star_3d_min_depth",
  "home_star_3d_halo_max_css_size",
  "home_star_3d_core_max_css_size",
  "home_star_3d_spike_max_css_size",
  "home_star_3d_pulse_max_css_size"
]) {
  assert.match(source, new RegExp(`"${setting}"`));
  assert.match(mapSource, new RegExp(setting));
  assert.match(visualSource, new RegExp(setting));
}
assert.match(
  source,
  /float safeDepth = max\(-mvPosition\.z, uMinDepth\);/
);
assert.match(
  source,
  /compressedSize = sizeKnee \+ softRange \* \(1\.0 - exp\(-excess\)\);/
);
assert.match(
  source,
  /strategy\.camera === "flat"[\s\S]*DEFAULT_ORBIT_POINT_MIN_DEPTH/
);
assert.match(source, /const SECONDARY_SPIKE_FRACTION = 0\.06;/);
assert.match(source, /const BACKGROUND_STAR_COUNT = 240;/);
assert.match(source, /const SPIKE_ART_SCALE = 2\.1;/);
assert.match(source, /const CONTENT_EXPOSURE = 0\.28;/);
assert.match(source, /initializeSmoothDrift/);
assert.match(source, /background-stars-3d/);
assert.match(source, /attribute vec3 aColor;/);
assert.match(source, /uniform vec4 uContentRect0;/);
assert.match(source, /home-content-hidden/);
assert.match(
  source,
  /star\.baseBrightness \+ variation\(star, time\) \* 0\.35/
);
assert.match(
  source,
  /glCanvas\.dataset\.backgroundStarCount/
);
assert.match(source, /glCanvas\.dataset\.spikeCount/);
assert.match(source, /const CONTRIBUTION_SPACE_DURATION = 1300;/);
assert.match(source, /const CONTRIBUTION_SPACE_RADIUS = 165;/);
assert.match(source, /home_star_portal_rotation_speed/);
assert.match(source, /home_star_portal_size_percent/);
assert.match(source, /home_star_portal_brightness_percent/);
assert.match(source, /home_star_portal_collapsed_structure/);
assert.match(source, /home_star_portal_expanded_structure/);
assert.match(source, /function updatePortalTargets\(\)/);
assert.doesNotMatch(source, /contribution-space`\s*\)/);
assert.match(source, /uniform float uPortalBrightness;/);
assert.match(source, /alpha \*= uPortalBrightness;/);
assert.match(source, /portalDisplayPosition/);
assert.match(source, /function updatePortalRotation\(time\)/);
assert.match(
  source,
  /portalState\.yaw \+=\s*elapsed \* portalRotationRadiansPerMs/
);
assert.doesNotMatch(
  source,
  /time \* portalRotationRadiansPerMs/
);
assert.match(source, /updateHeroContentCover/);
assert.match(source, /heroContent\.style\.clipPath/);
assert.match(source, /polygon\(evenodd,/);
assert.match(source, /openContributionSpace/);
assert.match(source, /closeContributionSpace/);
assert.match(source, /gck:contribution-space-request/);
assert.match(source, /gck:contribution-space-state/);
assert.match(source, /blockPortalTransitionInteraction/);
assert.match(
  source,
  /now - portalState\.progress \* CONTRIBUTION_SPACE_DURATION/
);
assert.match(
  source,
  /\(1 - portalState\.progress\) \* CONTRIBUTION_SPACE_DURATION/
);
assert.match(source, /data-contribution-space/);
assert.match(mapSource, /home_star_experience_mode/);
assert.match(mapSource, /home_star_portal_collapsed_structure/);
assert.match(mapSource, /home_star_portal_expanded_structure/);
assert.match(mapSource, /data-star-coverage-name/);
assert.match(mapSource, /data-star-coverage-kind/);
assert.match(visualSource, /home-star-experience-portal/);
assert.match(visualSource, /home_star_portal_collapsed_structure/);
assert.match(visualSource, /home_star_portal_expanded_structure/);
assert.match(indexSource, /data-contribution-space-portal/);
assert.match(indexSource, /data-contribution-space-return/);
assert.match(cssSource, /\.contribution-space-portal/);
assert.match(cssSource, /\.contribution-space-interaction-lock/);
assert.match(cssSource, /\.home-contribution-space-expanded/);
assert.match(
  cssSource,
  /\.site-header\s*\{[\s\S]*?z-index:\s*300;/
);
assert.match(
  cssSource,
  /\.home-star-experience-portal \.library-intro-overlay\s*\{[\s\S]*?z-index:\s*130;/
);
for (const layer of [10000, 10001, 10002, 10003, 10004]) {
  assert.match(cssSource, new RegExp(`z-index:\\s*${layer}`));
}
assert.doesNotMatch(
  cssSource,
  /\.home-contribution-space-opening \.intro-stats/
);
assert.doesNotMatch(
  cssSource,
  /\.home-contribution-space-closing \.intro-stats/
);
assert.doesNotMatch(source, /star\.vx \*= -1/);

function projectedCssSize({
  aSize,
  viewportHeight,
  depth,
  pixelRatio,
  minDepth,
  maxCssSize,
  softKneeRatio = 0.62,
  fov = 50
}) {
  const scale =
    (viewportHeight * pixelRatio) /
    (2 * Math.tan((fov * Math.PI) / 360));
  const physicalSize =
    aSize * scale / Math.max(depth, minDepth);
  const cssSize = physicalSize / pixelRatio;
  const knee = maxCssSize * softKneeRatio;
  if (cssSize <= knee) return cssSize;
  const range = Math.max(1 / pixelRatio, maxCssSize - knee);
  return Math.min(
    maxCssSize,
    knee + range * (1 - Math.exp(-(cssSize - knee) / range))
  );
}

const spikeSizes = [];
for (const pixelRatio of [1, 1.25, 1.5, 2]) {
  spikeSizes.push(
    projectedCssSize({
      aSize: 313,
      viewportHeight: 1440,
      depth: 620,
      pixelRatio,
      minDepth: 280,
      maxCssSize: 240
    })
  );
}
assert.ok(spikeSizes.every((size) => size > 235 && size < 240));
assert.ok(
  spikeSizes.every((size) => Math.abs(size - spikeSizes[0]) < 1e-9),
  "soft CSS caps must remain DPR-independent"
);

const customSize = projectedCssSize({
  aSize: 313,
  viewportHeight: 1440,
  depth: 620,
  pixelRatio: 1,
  minDepth: 360,
  maxCssSize: 180
});
assert.ok(
  customSize > 175 && customSize < 180,
  "custom CSS cap must replace the default without a hard plateau"
);

const guardedNearSize = projectedCssSize({
  aSize: 20,
  viewportHeight: 960,
  depth: 50,
  pixelRatio: 1,
  minDepth: 280,
  maxCssSize: 1000
});
const guardedBoundarySize = projectedCssSize({
  aSize: 20,
  viewportHeight: 960,
  depth: 280,
  pixelRatio: 1,
  minDepth: 280,
  maxCssSize: 1000
});
assert.equal(guardedNearSize, guardedBoundarySize);

const flatDistance =
  960 / 2 / Math.tan((50 * Math.PI) / 360);
assert.ok(
  Math.abs(
    projectedCssSize({
      aSize: 26,
      viewportHeight: 960,
      depth: flatDistance,
      pixelRatio: 2,
      minDepth: 1,
      maxCssSize: 36,
      softKneeRatio: 1
    }) - 26
  ) < 1e-9,
  "flat WebGL mode must retain its 1:1 CSS pixel mapping"
);

console.log("Home star 3D point-size limits passed.");
