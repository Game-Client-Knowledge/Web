const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/assets/js/home-star-3d.js"),
  "utf8"
);

assert.match(source, /const ORBIT_POINT_MIN_DEPTH = 280;/);
assert.match(source, /halo:\s*200,/);
assert.match(source, /core:\s*36,/);
assert.match(source, /spike:\s*240,/);
assert.match(source, /pulse:\s*36/);
assert.match(
  source,
  /float safeDepth = max\(-mvPosition\.z, uMinDepth\);/
);
assert.match(
  source,
  /gl_PointSize = min\(projectedSize, uMaxCssSize \* uPixelRatio\);/
);
assert.match(
  source,
  /strategy\.camera === "flat" \? 1 : ORBIT_POINT_MIN_DEPTH/
);

function projectedCssSize({
  aSize,
  viewportHeight,
  depth,
  pixelRatio,
  minDepth,
  maxCssSize,
  fov = 50
}) {
  const scale =
    (viewportHeight * pixelRatio) /
    (2 * Math.tan((fov * Math.PI) / 360));
  const physicalSize =
    aSize * scale / Math.max(depth, minDepth);
  return Math.min(
    physicalSize,
    maxCssSize * pixelRatio
  ) / pixelRatio;
}

for (const pixelRatio of [1, 1.25, 1.5, 2]) {
  assert.equal(
    projectedCssSize({
      aSize: 313,
      viewportHeight: 1440,
      depth: 620,
      pixelRatio,
      minDepth: 280,
      maxCssSize: 240
    }),
    240,
    `spike CSS cap changed at DPR ${pixelRatio}`
  );
}

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
      maxCssSize: 36
    }) - 26
  ) < 1e-9,
  "flat WebGL mode must retain its 1:1 CSS pixel mapping"
);

console.log("Home star 3D point-size limits passed.");
