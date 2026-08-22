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
  "home_star_3d_pulse_max_css_size",
  "home_star_3d_field_enabled",
  "home_star_3d_field_star_count",
  "home_star_3d_dust_enabled",
  "home_star_3d_dust_star_count",
  "home_star_3d_cluster_enabled",
  "home_star_3d_cluster_star_count",
  "home_star_3d_stream_enabled",
  "home_star_3d_stream_star_count",
  "home_star_3d_nebula_enabled",
  "home_star_3d_nebula_star_count",
  "home_star_hover_info_enabled",
  "home_star_hover_relations_enabled",
  "home_star_hover_relation_opacity_percent",
  "home_star_hover_relation_limit",
  "home_star_3d_background_brightness_percent",
  "home_star_3d_dust_brightness_percent",
  "home_star_3d_background_size_percent",
  "home_star_3d_structure_motion_percent"
]) {
  assert.match(source, new RegExp(setting));
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
assert.match(source, /field: 320,/);
assert.match(source, /dust: 1920,/);
assert.match(source, /cluster: 422,/);
assert.match(source, /stream: 326,/);
assert.match(source, /nebula: 212/);
assert.match(source, /const DEFAULT_BACKGROUND_BRIGHTNESS = 2\.2;/);
assert.match(source, /const DEFAULT_DUST_BRIGHTNESS = 2\.6;/);
assert.match(source, /const DEFAULT_BACKGROUND_SIZE_SCALE = 1\.6;/);
assert.match(source, /const DRIFT_SPEED_MULTIPLIER = 2\.4;/);
assert.equal(
  (source.match(/\* DRIFT_SPEED_MULTIPLIER;/g) || []).length,
  3,
  "all smooth drift axes must use the tuned speed multiplier"
);
assert.match(source, /const SPIKE_ART_SCALE = 2\.1;/);
assert.match(source, /const CONTENT_EXPOSURE = 0\.28;/);
assert.match(source, /initializeSmoothDrift/);
assert.match(source, /background-stars-3d/);
assert.match(source, /attribute float aPhase;/);
assert.match(source, /attribute float aDust;/);
assert.match(source, /attribute float aStructure;/);
assert.match(source, /attribute vec4 aMotion;/);
assert.match(source, /attribute vec4 aEffect;/);
assert.match(source, /attribute vec4 aEffect2;/);
assert.match(source, /uniform float uTime;/);
assert.match(source, /uniform float uLayerKind;/);
assert.match(source, /float coronaMask =/);
assert.match(source, /vEffect\.z \* coronaMask \* turbulence/);
assert.match(
  source,
  /1\.0 \+ pulse \* pulseGain \+ flare \* flareGain/
);
assert.match(source, /varying float vPulse;/);
assert.match(source, /varying float vFlare;/);
assert.match(source, /1\.0 \+ vPulse \* 3\.2/);
assert.match(source, /vFlare \* 0\.75/);
assert.match(source, /float haloEdge = 1\.0 - smoothstep\(0\.36, 0\.49, radius\);/);
assert.match(
  source,
  /alpha \*= mix\(haloEdge, 1\.0, step\(0\.5, uLayerKind\)\);/
);
assert.match(source, /backgroundLayer\.material\.uniforms\.uTime/);
assert.match(source, /uniform float uBrightness;/);
assert.match(source, /uniform float uDustBrightness;/);
assert.match(source, /uniform float uSizeScale;/);
assert.match(source, /uniform float uMotionScale;/);
assert.match(source, /const clusterCenters = \[/);
assert.match(source, /const nebulaCenters = \[/);
assert.match(source, /aStructure > 1\.5 && aStructure < 2\.5/);
assert.match(source, /aStructure > 2\.5 && aStructure < 3\.5/);
assert.match(source, /aStructure > 3\.5/);
assert.match(
  source,
  /float exposure = mix\(uBrightness, uDustBrightness, vDust\);/
);
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
assert.match(source, /glCanvas\.dataset\.backgroundFieldCount/);
assert.match(source, /glCanvas\.dataset\.backgroundFieldEnabled/);
assert.match(source, /glCanvas\.dataset\.backgroundDustEnabled/);
assert.match(source, /glCanvas\.dataset\.backgroundDustCount/);
assert.match(source, /glCanvas\.dataset\.backgroundClusterEnabled/);
assert.match(source, /glCanvas\.dataset\.backgroundClusterCount/);
assert.match(source, /glCanvas\.dataset\.backgroundStreamEnabled/);
assert.match(source, /glCanvas\.dataset\.backgroundStreamCount/);
assert.match(source, /glCanvas\.dataset\.backgroundNebulaEnabled/);
assert.match(source, /glCanvas\.dataset\.backgroundNebulaCount/);
assert.match(source, /glCanvas\.dataset\.backgroundStructureMotion/);
assert.match(source, /glCanvas\.dataset\.visualProfile = "deep-field"/);
assert.match(source, /glCanvas\.dataset\.spikeCount/);
assert.match(source, /glCanvas\.dataset\.animatedStarCount/);
assert.match(source, /glCanvas\.dataset\.hoveredStarId/);
assert.match(source, /glCanvas\.dataset\.hoverRelationCount/);
assert.match(source, /glCanvas\.dataset\.blueSupergiantCount/);
assert.match(source, /glCanvas\.dataset\.hypergiantCount/);
for (const tier of [
  ["yellow-dwarf", "黄矮星"],
  ["blue-giant", "蓝巨星"],
  ["blue-supergiant", "蓝超巨星"],
  ["hypergiant", "特超巨星"]
]) {
  assert.match(mapSource, new RegExp(`"${tier[0]}"`));
  assert.match(mapSource, new RegExp(tier[1]));
}
assert.match(mapSource, /variabilityAmplitude: 0\.105/);
assert.match(mapSource, /coronaStrength: 0\.7/);
assert.match(mapSource, /flareStrength: 0\.42/);
assert.match(mapSource, /temperatureShift: 0\.4/);
assert.match(mapSource, /surfaceFlowSpeed: 0\.38/);
for (const value of [
  "flareStrength: 0.08",
  "flareStrength: 0.38",
  "flareStrength: 0.14",
  "flareStrength: 0.18",
  "flareStrength: 0.26",
  "flareStrength: 0.42"
]) {
  assert.match(mapSource, new RegExp(value.replace(".", "\\.")));
}
assert.match(mapSource, /function tierMotion\(star, profile, time\)/);
assert.match(mapSource, /function createHoverLabel\(\)/);
assert.match(mapSource, /function starInformationText\(star\)/);
assert.match(mapSource, /function drawHoverRelations\(distanceLimit\)/);
assert.match(source, /function drawHoverRelations\(\)/);
assert.match(source, /function hoverPointerMove\(event\)/);
assert.match(cssSource, /\.star-map-hover-label/);
assert.match(mapSource, /const edgeProgress = Math\.max\(/);
assert.match(
  mapSource,
  /const intensity = Math\.min\(1, core \+ wing \+ ring\) \* edgeFeather;/
);
assert.match(source, /const CONTRIBUTION_SPACE_DURATION = 1300;/);
assert.match(source, /const STRUCTURE_TRANSITION_DURATION = 900;/);
assert.match(source, /const CONTRIBUTION_SPACE_RADIUS = 165;/);
assert.match(source, /home_star_portal_rotation_speed/);
assert.match(source, /home_star_portal_size_percent/);
assert.match(source, /home_star_portal_brightness_percent/);
assert.match(source, /home_star_portal_collapsed_structure/);
assert.match(source, /home_star_portal_expanded_structure/);
for (const structure of [
  "3d-spiral",
  "3d-nebula",
  "3d-clusters",
  "3d-shell"
]) {
  assert.match(source, new RegExp(`"${structure}"`));
  assert.match(mapSource, new RegExp(`"${structure}"`));
  assert.match(visualSource, new RegExp(`"${structure}"`));
}
assert.match(source, /function updatePortalTargets\(\)/);
assert.match(source, /function portalStrategyLayout\(structure\)/);
assert.match(source, /portal-structure:\$\{structure\}/);
assert.match(source, /function setExpandedStructure\(nextStructure/);
assert.match(source, /function updateStructureTransition\(time, delta\)/);
assert.match(
  source,
  /from\[offset\] \+ \(targetX - from\[offset\]\) \* progress/
);
assert.match(source, /glCanvas\.dataset\.structureTransition/);
assert.match(source, /structureSelect\.disabled/);
assert.equal(
  (source.match(/new THREE\.WebGLRenderer/g) || []).length,
  1,
  "structure changes must reuse the existing WebGL renderer"
);
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
assert.match(source, /knowledge-relations-field/);
assert.match(source, /function drawFormalRelation\(/);
assert.match(source, /function drawDirectionMarker\(/);
assert.match(source, /function drawEnergyPulse\(/);
assert.match(source, /activeNodeDepths/);
assert.doesNotMatch(source, /new THREE\.LineBasicMaterial/);
assert.doesNotMatch(source, /new THREE\.LineSegments/);
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
assert.match(indexSource, /data-contribution-space-structure/);
assert.match(indexSource, /data-lucide="orbit"/);
assert.match(indexSource, /data-lucide="chevron-down"/);
for (const structure of [
  "3d",
  "3d-drift",
  "3d-drift-anchored",
  "3d-galaxy",
  "3d-orbit",
  "3d-spiral",
  "3d-nebula",
  "3d-clusters",
  "3d-shell"
]) {
  assert.match(
    indexSource,
    new RegExp(`<option value="${structure}">`)
  );
}
assert.match(cssSource, /\.contribution-space-portal/);
assert.match(cssSource, /\.contribution-space-structure-control/);
assert.match(
  cssSource,
  /\.contribution-space-structure-select select option\s*\{[\s\S]*?color:\s*#12231e;[\s\S]*?background:\s*#f4fbf8;/
);
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
