/* WebGL star map modes for the home page.
 *
 * Modes:
 *   2d-webgl  — flat 2D layout rendered through WebGL point sprites
 *               (GPU PSF halos + spikes, no spatial depth)
 *   3d        — depth scene, fixed: wider ellipsoid layout, edge
 *               visibility honored, every star gently wanders
 *   3d-drift  — all stars drift randomly in a bounded volume; links
 *               appear between stars that come close (visibility=near)
 *   3d-galaxy — brightest star anchors the center, everyone else rides
 *               a Keplerian donut with random jitter
 *   3d-orbit  — top contributors become star systems; their documents
 *               orbit them like planets; the rest forms an outer belt
 *
 * Bandwidth: this file and the three.js vendor bundle are lazy-loaded
 * only when a WebGL mode is enabled. All motion is computed on the
 * client from the graph payload already embedded in the page — no
 * extra requests, no extra data.
 */
(function () {
  "use strict";

  const WEBGL_MODES = [
    "3d",
    "2d-webgl",
    "3d-drift",
    "3d-drift-anchored",
    "3d-galaxy",
    "3d-orbit"
  ];
  const CAMERA_RADIUS = {
    "3d": 700,
    "3d-drift": 620,
    "3d-drift-anchored": 620,
    "3d-galaxy": 780,
    "3d-orbit": 820
  };

  // ---------- Layout / motion strategies ----------
  // init() assigns base positions and motion parameters once; move()
  // writes the live star.x/y/z every frame. Everything is deterministic
  // per graph revision via the seeded random passed in the context.

  // Flat 2D layout in the z=0 plane — same composition as the Canvas 2D
  // map, but rendered with GPU sprites.
  function flatStrategy() {
    return {
      camera: "flat",
      init(stars, ctx) {
        const contributors = stars.filter((s) => s.kind === "contributor");
        const documents = stars.filter((s) => s.kind !== "contributor");
        contributors.forEach((star, index) => {
          star.flatDoc = false;
          star.flatAngle =
            index * (Math.PI * (3 - Math.sqrt(5))) - Math.PI / 2;
          star.flatRing = 0.2 + (index % 3) * 0.055;
        });
        documents.forEach((star) => {
          star.flatDoc = true;
          star.nx = 0.03 + ctx.random() * 0.94;
          star.ny = 0.03 + ctx.random() * 0.94;
        });
      },
      fit(stars, world) {
        const minDim = Math.min(world.width, world.height);
        for (const star of stars) {
          if (star.flatDoc) {
            star.baseX = (star.nx - 0.5) * world.width;
            star.baseY = (0.5 - star.ny) * world.height;
          } else {
            star.baseX = Math.cos(star.flatAngle) * minDim * star.flatRing;
            star.baseY = -Math.sin(star.flatAngle) * minDim * star.flatRing;
          }
          star.baseZ = 0;
          star.x = star.baseX;
          star.y = star.baseY;
          star.z = 0;
        }
      },
      move() {}
    };
  }

  // Depth scene (fixed): flattened ellipsoid, all stars wander.
  function depthStrategy() {
    return {
      camera: "orbit",
      init(stars, ctx) {
        const { random } = ctx;
        const contributors = stars.filter((s) => s.kind === "contributor");
        const documents = stars.filter((s) => s.kind !== "contributor");
        const golden = Math.PI * (3 - Math.sqrt(5));
        contributors.forEach((star, index) => {
          const y = 1 - (index / Math.max(1, contributors.length - 1)) * 2;
          const ring = Math.sqrt(Math.max(0, 1 - y * y));
          const theta = golden * index;
          star.baseX = Math.cos(theta) * ring * 340;
          star.baseY = y * 340 * 0.62;
          star.baseZ = Math.sin(theta) * ring * 340;
        });
        documents.forEach((star) => {
          const radius = 480 * Math.cbrt(random());
          const theta = random() * Math.PI * 2;
          const cosPhi = random() * 2 - 1;
          const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
          star.baseX = radius * sinPhi * Math.cos(theta);
          star.baseY = radius * cosPhi * 0.55;
          star.baseZ = radius * sinPhi * Math.sin(theta);
        });
        for (const star of stars) {
          star.wanderAmp = 8 + random() * 9;
          star.wanderSpeed = 0.00006 + random() * 0.00011;
          star.wanderP1 = random() * Math.PI * 2;
          star.wanderP2 = random() * Math.PI * 2;
          star.wanderP3 = random() * Math.PI * 2;
        }
      },
      fit() {},
      move(stars, dt, time) {
        for (const star of stars) {
          star.x =
            star.baseX +
            Math.sin(time * star.wanderSpeed + star.wanderP1) *
              star.wanderAmp;
          star.y =
            star.baseY +
            Math.sin(time * star.wanderSpeed * 1.31 + star.wanderP2) *
              star.wanderAmp *
              0.6;
          star.z =
            star.baseZ +
            Math.cos(time * star.wanderSpeed * 0.83 + star.wanderP3) *
              star.wanderAmp;
        }
      }
    };
  }

  // Random drift in a bounded volume; close stars link up.
  function driftStrategy() {
    const BOUNDS = { x: 380, y: 190, z: 380 };
    return {
      camera: "orbit",
      proximity: true,
      bounds: BOUNDS,
      init(stars, ctx) {
        const { random } = ctx;
        for (const star of stars) {
          star.x = (random() * 2 - 1) * BOUNDS.x;
          star.y = (random() * 2 - 1) * BOUNDS.y;
          star.z = (random() * 2 - 1) * BOUNDS.z;
          const speed = 9 + random() * 13;
          const theta = random() * Math.PI * 2;
          const cosPhi = random() * 2 - 1;
          const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
          star.vx = speed * sinPhi * Math.cos(theta);
          star.vy = speed * cosPhi * 0.5;
          star.vz = speed * sinPhi * Math.sin(theta);
        }
      },
      fit() {},
      move(stars, dt) {
        const step = Math.min(dt, 100) / 1000;
        for (const star of stars) {
          star.x += star.vx * step;
          star.y += star.vy * step;
          star.z += star.vz * step;
          if (Math.abs(star.x) > BOUNDS.x) {
            star.x = Math.sign(star.x) * BOUNDS.x;
            star.vx *= -1;
          }
          if (Math.abs(star.y) > BOUNDS.y) {
            star.y = Math.sign(star.y) * BOUNDS.y;
            star.vy *= -1;
          }
          if (Math.abs(star.z) > BOUNDS.z) {
            star.z = Math.sign(star.z) * BOUNDS.z;
            star.vz *= -1;
          }
        }
      }
    };
  }

  // Galaxy: brightest star at the center, everyone else on a donut with
  // Keplerian angular velocity plus small random jitter.
  function galaxyStrategy() {
    return {
      camera: "orbit",
      init(stars, ctx) {
        const { random } = ctx;
        let center = stars[0];
        for (const star of stars) {
          if (star.baseBrightness > center.baseBrightness) center = star;
        }
        for (const star of stars) {
          if (star === center) {
            star.galaxyCenter = true;
            star.baseX = 0;
            star.baseY = 0;
            star.baseZ = 0;
            continue;
          }
          star.galaxyR = 130 + 360 * Math.pow(random(), 0.75);
          star.galaxyTheta = random() * Math.PI * 2;
          // Keplerian: omega ~ r^-1.5, scaled for a calm 15-90s revolution.
          star.galaxyOmega = 460 / Math.pow(star.galaxyR, 1.5);
          star.galaxyY = (random() + random() - 1) * 26;
          star.jitterAmp = 2 + random() * 4;
          star.jitterSpeed = 0.0004 + random() * 0.0007;
          star.jitterPhase = random() * Math.PI * 2;
        }
      },
      fit() {},
      move(stars, dt, time) {
        const step = Math.min(dt, 100) / 1000;
        for (const star of stars) {
          if (star.galaxyCenter) {
            star.x = 0;
            star.y = Math.sin(time * 0.0003) * 3;
            star.z = 0;
            continue;
          }
          star.galaxyTheta += star.galaxyOmega * step;
          const jitter =
            Math.sin(time * star.jitterSpeed + star.jitterPhase) *
            star.jitterAmp;
          star.x = Math.cos(star.galaxyTheta) * star.galaxyR + jitter;
          star.z = Math.sin(star.galaxyTheta) * star.galaxyR;
          star.y =
            star.galaxyY +
            Math.sin(time * star.jitterSpeed * 1.7 + star.jitterPhase) * 4;
        }
      }
    };
  }

  // Orbital systems: top contributors are local suns, their documents
  // orbit them; everything unaffiliated drifts in an outer belt.
  function orbitStrategy() {
    return {
      camera: "orbit",
      init(stars, ctx) {
        const { random, edges, starById } = ctx;
        const contributors = stars
          .filter((s) => s.kind === "contributor")
          .sort((a, b) => b.baseBrightness - a.baseBrightness);
        const centers = contributors.slice(0, 6);
        if (!centers.length) {
          // No contributors in the graph — behave like the depth scene.
          const fallback = depthStrategy();
          fallback.init(stars, ctx);
          this.move = fallback.move;
          return;
        }
        const golden = Math.PI * (3 - Math.sqrt(5));
        centers.forEach((star, index) => {
          star.systemCenter = true;
          star.centerAngle = index * golden;
          star.centerR = 330;
          star.centerOmega = 0.018;
          star.centerY = (random() - 0.5) * 110;
        });
        // Brightest contributor's documents first, so every document
        // orbits its most prominent center.
        const hostByDocId = new Map();
        for (const edge of edges) {
          if (edge.type !== "contribution") continue;
          const source = starById.get(edge.source);
          const target = starById.get(edge.target);
          if (!source || !target) continue;
          const contributor =
            source.kind === "contributor"
              ? source
              : target.kind === "contributor"
                ? target
                : null;
          const doc = contributor === source ? target : source;
          if (!contributor || !contributor.systemCenter) continue;
          if (doc.kind === "contributor") continue;
          if (!hostByDocId.has(doc.id)) hostByDocId.set(doc.id, contributor);
        }
        const orbitCountByCenter = new Map();
        for (const star of stars) {
          if (star.systemCenter) continue;
          const host = hostByDocId.get(star.id);
          if (host) {
            const order = orbitCountByCenter.get(host.id) || 0;
            orbitCountByCenter.set(host.id, order + 1);
            star.orbitHost = host;
            star.orbitR = 46 + (order % 6) * 17 + random() * 9;
            star.orbitTheta = random() * Math.PI * 2;
            star.orbitOmega = Math.min(0.55, 26 / star.orbitR);
            star.orbitPhase = random() * Math.PI * 2;
          } else {
            star.beltR = 470 + random() * 110;
            star.beltTheta = random() * Math.PI * 2;
            star.beltOmega = 0.006 + random() * 0.012;
            star.beltY = (random() - 0.5) * 170;
            star.beltPhase = random() * Math.PI * 2;
          }
        }
      },
      fit() {},
      move(stars, dt, time) {
        const step = Math.min(dt, 100) / 1000;
        for (const star of stars) {
          if (star.systemCenter) {
            star.centerAngle += star.centerOmega * step;
            star.x = Math.cos(star.centerAngle) * star.centerR;
            star.z = Math.sin(star.centerAngle) * star.centerR;
            star.y =
              star.centerY + Math.sin(time * 0.00022 + star.centerAngle) * 9;
          } else if (star.orbitHost) {
            star.orbitTheta += star.orbitOmega * step;
            const host = star.orbitHost;
            star.x = host.x + Math.cos(star.orbitTheta) * star.orbitR;
            star.z = host.z + Math.sin(star.orbitTheta) * star.orbitR;
            star.y =
              host.y +
              Math.sin(star.orbitTheta * 2 + star.orbitPhase) * 9;
          } else {
            star.beltTheta += star.beltOmega * step;
            star.x = Math.cos(star.beltTheta) * star.beltR;
            star.z = Math.sin(star.beltTheta) * star.beltR;
            star.y =
              star.beltY + Math.sin(time * 0.0003 + star.beltPhase) * 12;
          }
        }
      }
    };
  }

  // Anchored drift: contributor stars hold their positions while
  // documents wander; close pairs link up transiently.
  function anchoredDriftStrategy() {
    const BOUNDS = { x: 380, y: 190, z: 380 };
    return {
      camera: "orbit",
      proximity: true,
      bounds: BOUNDS,
      init(stars, ctx) {
        const { random } = ctx;
        const contributors = stars.filter((s) => s.kind === "contributor");
        const documents = stars.filter((s) => s.kind !== "contributor");
        // Static stars rest on a stable fibonacci shell.
        const golden = Math.PI * (3 - Math.sqrt(5));
        contributors.forEach((star, index) => {
          const y = 1 - (index / Math.max(1, contributors.length - 1)) * 2;
          const ring = Math.sqrt(Math.max(0, 1 - y * y));
          const theta = golden * index;
          star.x = Math.cos(theta) * ring * 300;
          star.y = y * 300 * 0.6;
          star.z = Math.sin(theta) * ring * 300;
        });
        documents.forEach((star) => {
          star.x = (random() * 2 - 1) * BOUNDS.x;
          star.y = (random() * 2 - 1) * BOUNDS.y;
          star.z = (random() * 2 - 1) * BOUNDS.z;
          const speed = 9 + random() * 13;
          const theta = random() * Math.PI * 2;
          const cosPhi = random() * 2 - 1;
          const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
          star.vx = speed * sinPhi * Math.cos(theta);
          star.vy = speed * cosPhi * 0.5;
          star.vz = speed * sinPhi * Math.sin(theta);
        });
      },
      fit() {},
      move(stars, dt) {
        const step = Math.min(dt, 100) / 1000;
        for (const star of stars) {
          if (star.kind === "contributor") continue;
          star.x += star.vx * step;
          star.y += star.vy * step;
          star.z += star.vz * step;
          if (Math.abs(star.x) > BOUNDS.x) {
            star.x = Math.sign(star.x) * BOUNDS.x;
            star.vx *= -1;
          }
          if (Math.abs(star.y) > BOUNDS.y) {
            star.y = Math.sign(star.y) * BOUNDS.y;
            star.vy *= -1;
          }
          if (Math.abs(star.z) > BOUNDS.z) {
            star.z = Math.sign(star.z) * BOUNDS.z;
            star.vz *= -1;
          }
        }
      }
    };
  }

  const STRATEGIES = {
    "2d-webgl": flatStrategy,
    "3d": depthStrategy,
    "3d-drift": driftStrategy,
    "3d-drift-anchored": anchoredDriftStrategy,
    "3d-galaxy": galaxyStrategy,
    "3d-orbit": orbitStrategy
  };

  // ---------- Renderer factory ----------

  function create(host) {
    const THREE = host.THREE;
    const runtimeSettings = host.settings;
    if (!THREE) return host.fallback2D();
    const mode = WEBGL_MODES.includes(runtimeSettings.home_star_render_mode)
      ? runtimeSettings.home_star_render_mode
      : "3d";
    const strategy = (STRATEGIES[mode] || depthStrategy)();
    const {
      canvas,
      hero,
      illumination,
      formulaEngine,
      tierProfile,
      haloSprite,
      spikeSprite,
      relationColors,
      hashSeed,
      seededRandom
    } = host;
    const reducedMotion = host.reducedMotion;

    // A 2D context already exists on the original canvas, and a canvas can
    // only host one context type — render WebGL into a dedicated element.
    const glCanvas = document.createElement("canvas");
    glCanvas.className = canvas.className;
    glCanvas.setAttribute("data-knowledge-field", "");
    canvas.removeAttribute("data-knowledge-field");
    canvas.style.display = "none";
    canvas.parentElement.insertBefore(glCanvas, canvas);
    document.body.classList.remove("home-stars-old");
    document.body.classList.toggle(
      "home-stars-full",
      runtimeSettings.home_star_scope === "full"
    );
    document.body.classList.toggle(
      "home-stars-hero",
      runtimeSettings.home_star_scope === "hero"
    );
    glCanvas.dataset.starMap = `contribution-${mode}`;
    glCanvas.dataset.starScope = runtimeSettings.home_star_scope;

    let renderer = null;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: glCanvas,
        alpha: true,
        antialias: true
      });
    } catch (error) {
      glCanvas.remove();
      canvas.style.display = "";
      canvas.setAttribute("data-knowledge-field", "");
      return host.fallback2D();
    }

    const sourceGraph = host.sourceGraph;
    const random = seededRandom(
      hashSeed(`${sourceGraph.revision}:contribution-stars-3d`)
    );
    const stars = sourceGraph.stars.map((source, index) => ({
      ...source,
      metrics: { ...(source.metrics || {}) },
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      baseBrightness: formulaEngine.calculateBrightness(
        source,
        runtimeSettings.home_star_brightness_rules,
        runtimeSettings.home_star_brightness_min,
        runtimeSettings.home_star_brightness_initial,
        runtimeSettings.home_star_brightness_max,
        { totalRelationCount: sourceGraph.edges.length }
      ),
      variationFrom: 0,
      variationTo: 0,
      variationStartedAt: 0,
      variationNextAt: 0,
      index
    }));
    for (const star of stars) {
      star.brightnessTier = formulaEngine.brightnessTier(
        star.baseBrightness,
        runtimeSettings.home_star_brightness_tiers,
        runtimeSettings.home_star_brightness_min,
        runtimeSettings.home_star_brightness_max
      );
    }
    const starById = new Map(stars.map((star) => [star.id, star]));
    const edges = sourceGraph.edges.filter((edge) => {
      return starById.has(edge.source) && starById.has(edge.target);
    });
    const contributors = stars.filter((star) => star.kind === "contributor");
    const documents = stars.filter((star) => star.kind !== "contributor");

    strategy.init(stars, { random, edges, starById });

    // Texture atlas: one halo tile + one spike tile per used tier.
    // Spike sprites are 192px canvases — they MUST be scaled into the
    // 128px tile (the previous build drew them unscaled, which cropped
    // the cross and shifted it off the star). Content is inset to 72%
    // so per-star rotation never samples the neighbouring tile.
    const usedTierIds = [];
    for (const star of stars) {
      const id = star.brightnessTier?.id || "default";
      if (!usedTierIds.includes(id)) usedTierIds.push(id);
    }
    const TILE = 128;
    const SPIKE_INSET = 0.72;
    const atlasCanvas = document.createElement("canvas");
    atlasCanvas.width = TILE * usedTierIds.length * 2;
    atlasCanvas.height = TILE;
    const atlasContext = atlasCanvas.getContext("2d");
    const tierTileIndex = new Map();
    usedTierIds.forEach((id, index) => {
      const tier = id === "default" ? null : { id };
      const profile = tierProfile(tier);
      const canonical = profile.tintHex || "#ffffff";
      atlasContext.drawImage(haloSprite(tier, canonical), index * 2 * TILE, 0);
      const spike = spikeSprite(tier, canonical);
      if (spike) {
        const size = TILE * SPIKE_INSET;
        const offset = (TILE - size) / 2;
        atlasContext.drawImage(
          spike,
          0,
          0,
          spike.width,
          spike.height,
          (index * 2 + 1) * TILE + offset,
          offset,
          size,
          size
        );
      }
      tierTileIndex.set(id, index);
    });
    const atlasTexture = new THREE.CanvasTexture(atlasCanvas);

    function tierIdOf(star) {
      return star.brightnessTier?.id || "default";
    }

    // Tier canonical colors as 0..1 RGB, cached per tier id. Edges blend
    // these so a link between two different brightness tiers renders as
    // a smooth nebula-like gradient.
    const tierRgbCache = new Map();
    function tierRgbOf(star) {
      const id = tierIdOf(star);
      let rgb = tierRgbCache.get(id);
      if (!rgb) {
        const hex = String(
          tierProfile(star.brightnessTier).tintHex || "#ffffff"
        ).replace("#", "");
        rgb = [
          parseInt(hex.slice(0, 2), 16) / 255 || 0,
          parseInt(hex.slice(2, 4), 16) / 255 || 0,
          parseInt(hex.slice(4, 6), 16) / 255 || 0
        ];
        tierRgbCache.set(id, rgb);
      }
      return rgb;
    }

    function relationRgbOf(type) {
      const parts = String(relationColors[type] || "255, 255, 255").split(",");
      return [
        (Number(parts[0]) || 255) / 255,
        (Number(parts[1]) || 255) / 255,
        (Number(parts[2]) || 255) / 255
      ];
    }

    // Edge glow strength follows the star's brightness: the same edge is
    // radiant at a blue giant's end and faint at a brown dwarf's end.
    // Kept deliberately subtle so lines never wash out the stars.
    function starEdgeGain(star, time) {
      const maximum = runtimeSettings.home_star_brightness_max || 100;
      const normalized = Math.max(
        0,
        Math.min(1, currentBrightness(star, time) / maximum)
      );
      return 0.14 + 0.58 * Math.pow(normalized, 1.55);
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
    const cameraState = {
      theta: 0.6,
      phi: Math.PI / 2.25,
      radius: CAMERA_RADIUS[mode] || 900
    };

    const pointVertexShader = [
      "attribute float aSize;",
      "attribute float aAlpha;",
      "attribute float aTile;",
      "attribute float aRot;",
      "varying float vAlpha;",
      "varying float vTile;",
      "varying float vRot;",
      "uniform float uScale;",
      "void main() {",
      "  vAlpha = aAlpha;",
      "  vTile = aTile;",
      "  vRot = aRot;",
      "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
      "  gl_PointSize = aSize * (uScale / -mvPosition.z);",
      "  gl_Position = projectionMatrix * mvPosition;",
      "}"
    ].join("\n");
    const pointFragmentShader = [
      "uniform sampler2D uAtlas;",
      "uniform float uTiles;",
      "varying float vAlpha;",
      "varying float vTile;",
      "varying float vRot;",
      "void main() {",
      "  vec2 uv = gl_PointCoord - vec2(0.5);",
      "  float c = cos(vRot);",
      "  float s = sin(vRot);",
      "  uv = mat2(c, -s, s, c) * uv + vec2(0.5);",
      // Rotated UVs may leave the tile — never sample the neighbour.
      "  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;",
      "  vec2 atlasUv = vec2((vTile + uv.x) / uTiles, uv.y);",
      "  vec4 tex = texture2D(uAtlas, atlasUv);",
      "  float alpha = tex.a * vAlpha;",
      "  if (alpha < 0.004) discard;",
      "  gl_FragColor = vec4(tex.rgb, alpha);",
      "}"
    ].join("\n");

    function createPointLayer(count) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(count * 3), 3)
      );
      geometry.setAttribute(
        "aSize",
        new THREE.BufferAttribute(new Float32Array(count), 1)
      );
      geometry.setAttribute(
        "aAlpha",
        new THREE.BufferAttribute(new Float32Array(count), 1)
      );
      geometry.setAttribute(
        "aTile",
        new THREE.BufferAttribute(new Float32Array(count), 1)
      );
      geometry.setAttribute(
        "aRot",
        new THREE.BufferAttribute(new Float32Array(count), 1)
      );
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uAtlas: { value: atlasTexture },
          uTiles: { value: usedTierIds.length * 2 },
          uScale: { value: 1 }
        },
        vertexShader: pointVertexShader,
        fragmentShader: pointFragmentShader,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      return points;
    }

    const haloLayer = createPointLayer(stars.length);
    haloLayer.renderOrder = 1;
    // Solid-ish core dots. The Canvas 2D map always draws a bright core,
    // so without this layer dim stars are almost invisible in WebGL.
    const coreLayer = createPointLayer(stars.length);
    coreLayer.renderOrder = 2;
    const spikedStars = stars.filter((star) => {
      return tierProfile(star.brightnessTier).spikeGain > 0;
    });
    const spikeLayer = createPointLayer(spikedStars.length);
    spikeLayer.renderOrder = 3;
    scene.add(haloLayer);
    scene.add(coreLayer);
    scene.add(spikeLayer);

    // Relation edges. Visibility comes from the existing admin setting:
    //   always — every formal edge, every frame
    //   near   — formal edges shorter than a range limit, plus (in drift
    //            mode) transient links between any two close stars
    //   hidden — none
    const visibility = runtimeSettings.home_star_relation_visibility;
    const NEAR_LIMIT = 170;
    const edgeLayers = [];
    if (visibility !== "hidden") {
      for (const type of ["strong", "reference", "contribution"]) {
        const typeEdges = edges.filter((edge) => edge.type === type);
        if (!typeEdges.length) continue;
        const positions = new Float32Array(typeEdges.length * 6);
        const colors = new Float32Array(typeEdges.length * 6);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(positions, 3)
        );
        geometry.setAttribute(
          "color",
          new THREE.BufferAttribute(colors, 3)
        );
        const material = new THREE.LineBasicMaterial({
          // Per-vertex colors carry the tier gradient and the
          // brightness-scaled glow; opacity is just the global gain.
          vertexColors: true,
          transparent: true,
          opacity: visibility === "always" ? 0.18 : 0.4,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false
        });
        const lines = new THREE.LineSegments(geometry, material);
        lines.renderOrder = 0;
        lines.userData.edges = typeEdges;
        lines.userData.relationRgb = relationRgbOf(type);
        scene.add(lines);
        edgeLayers.push(lines);
      }
    }

    // Transient proximity links for the drift mode.
    const PROXIMITY_LIMIT = 120;
    const PROXIMITY_MAX = 700;
    let proximityLayer = null;
    if (strategy.proximity && visibility === "near") {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(PROXIMITY_MAX * 6), 3)
      );
      geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(new Float32Array(PROXIMITY_MAX * 6), 3)
      );
      proximityLayer = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.2,
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false
        })
      );
      proximityLayer.renderOrder = 0;
      scene.add(proximityLayer);
    }

    // Highlight path + travelling pulses for the active selection.
    const highlightGeometry = new THREE.BufferGeometry();
    highlightGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(0), 3)
    );
    const highlightLayer = new THREE.LineSegments(
      highlightGeometry,
      new THREE.LineBasicMaterial({
        color: new THREE.Color("#dff5ec"),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false
      })
    );
    highlightLayer.renderOrder = 3;
    scene.add(highlightLayer);
    let highlightEdges = [];

    const pulseGeometry = new THREE.BufferGeometry();
    pulseGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(0), 3)
    );
    pulseGeometry.setAttribute(
      "aSize",
      new THREE.BufferAttribute(new Float32Array(0), 1)
    );
    pulseGeometry.setAttribute(
      "aAlpha",
      new THREE.BufferAttribute(new Float32Array(0), 1)
    );
    pulseGeometry.setAttribute(
      "aTile",
      new THREE.BufferAttribute(new Float32Array(0), 1)
    );
    pulseGeometry.setAttribute(
      "aRot",
      new THREE.BufferAttribute(new Float32Array(0), 1)
    );
    const pulseLayer = new THREE.Points(
      pulseGeometry,
      new THREE.ShaderMaterial({
        uniforms: {
          uAtlas: { value: atlasTexture },
          uTiles: { value: usedTierIds.length * 2 },
          uScale: { value: 1 }
        },
        vertexShader: pointVertexShader,
        fragmentShader: pointFragmentShader,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true
      })
    );
    pulseLayer.frustumCulled = false;
    pulseLayer.renderOrder = 4;
    scene.add(pulseLayer);

    const panel = host.createCoveragePanel();
    const label = host.createLabel();
    let width = 1;
    let height = 1;
    let frame = 0;
    let disposed = false;
    let selectedRoot = "";
    let selectedIds = new Set();
    let selectedBrightness = 0;
    let selectedTier = null;
    let activeRelationPlan = null;
    let activeVisualEdgeIds = new Set();
    let labelStar = null;
    let labelExpiresAt = 0;
    let labelTimer = 0;
    let selectionTimer = 0;
    let lastFrameAt = 0;

    function resize() {
      const rectangle =
        runtimeSettings.home_star_scope === "full"
          ? { width: window.innerWidth, height: window.innerHeight }
          : hero.getBoundingClientRect();
      width = Math.max(1, Math.round(rectangle.width));
      height = Math.max(1, Math.round(rectangle.height));
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      glCanvas.style.width = `${width}px`;
      glCanvas.style.height = `${height}px`;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const uScale =
        (height * ratio) /
        (2 * Math.tan((camera.fov * Math.PI) / 360));
      haloLayer.material.uniforms.uScale.value = uScale;
      coreLayer.material.uniforms.uScale.value = uScale;
      spikeLayer.material.uniforms.uScale.value = uScale;
      pulseLayer.material.uniforms.uScale.value = uScale;
      if (strategy.camera === "flat") {
        // Pin the camera so the z=0 plane maps 1:1 to CSS pixels.
        const distance =
          height / 2 / Math.tan((camera.fov * Math.PI) / 360);
        camera.position.set(0, 0, distance);
        camera.lookAt(0, 0, 0);
        strategy.fit(stars, { width, height });
      }
      if (reducedMotion) draw(performance.now());
    }

    function variation(star, time) {
      if (
        reducedMotion ||
        !runtimeSettings.home_star_brightness_variation_enabled
      ) {
        return 0;
      }
      const progress = Math.max(
        0,
        Math.min(
          1,
          (time - star.variationStartedAt) /
            runtimeSettings.home_star_brightness_transition_ms
        )
      );
      const eased = progress * progress * (3 - 2 * progress);
      return (
        star.variationFrom +
        (star.variationTo - star.variationFrom) * eased
      );
    }

    function updateVariations(time) {
      if (!runtimeSettings.home_star_brightness_variation_enabled) return;
      const interval = runtimeSettings.home_star_brightness_interval_ms;
      for (const star of stars) {
        if (!star.variationNextAt) {
          star.variationNextAt = time + random() * interval;
          continue;
        }
        if (time < star.variationNextAt) continue;
        star.variationFrom = variation(star, time);
        star.variationTo =
          (random() * 2 - 1) *
          runtimeSettings.home_star_brightness_variation_amount;
        star.variationStartedAt = time;
        star.variationNextAt = time + interval * (0.55 + random() * 0.9);
      }
    }

    function currentBrightness(star, time) {
      return Math.max(
        runtimeSettings.home_star_brightness_min,
        Math.min(
          runtimeSettings.home_star_brightness_max,
          star.baseBrightness + variation(star, time)
        )
      );
    }

    function writePointAttributes(time) {
      const haloPosition = haloLayer.geometry.attributes.position;
      const haloSize = haloLayer.geometry.attributes.aSize;
      const haloAlpha = haloLayer.geometry.attributes.aAlpha;
      const haloTile = haloLayer.geometry.attributes.aTile;
      const corePosition = coreLayer.geometry.attributes.position;
      const coreSize = coreLayer.geometry.attributes.aSize;
      const coreAlpha = coreLayer.geometry.attributes.aAlpha;
      const coreTile = coreLayer.geometry.attributes.aTile;
      const spikePosition = spikeLayer.geometry.attributes.position;
      const spikeSize = spikeLayer.geometry.attributes.aSize;
      const spikeAlpha = spikeLayer.geometry.attributes.aAlpha;
      const spikeTile = spikeLayer.geometry.attributes.aTile;
      const spikeRot = spikeLayer.geometry.attributes.aRot;
      stars.forEach((star, index) => {
        const brightness = currentBrightness(star, time);
        const selected = selectedIds.has(star.id);
        const presentation = illumination.brightnessPresentation(
          brightness,
          star.kind,
          selected,
          runtimeSettings.home_star_brightness_max
        );
        const profile = tierProfile(star.brightnessTier);
        const tierRadius =
          presentation.radius *
          (1 + profile.radiusBoost * presentation.luminous);
        const tierHaloRadius = presentation.haloRadius * profile.haloScale;
        const tierHaloAlpha =
          presentation.haloAlpha * profile.haloAlphaScale;
        haloPosition.setXYZ(index, star.x, star.y, star.z);
        haloSize.setX(index, Math.max(1, tierHaloRadius * 2 * 3));
        haloAlpha.setX(
          index,
          tierHaloAlpha > 0.04
            ? Math.max(0.12, Math.min(1, tierHaloAlpha * 2.2))
            : 0
        );
        haloTile.setX(index, tierTileIndex.get(tierIdOf(star)) * 2);
        corePosition.setXYZ(index, star.x, star.y, star.z);
        coreSize.setX(index, Math.max(8, tierRadius * 4));
        coreAlpha.setX(index, Math.min(1, presentation.alpha));
        coreTile.setX(index, tierTileIndex.get(tierIdOf(star)) * 2);
      });
      spikedStars.forEach((star, index) => {
        const brightness = currentBrightness(star, time);
        const selected = selectedIds.has(star.id);
        const presentation = illumination.brightnessPresentation(
          brightness,
          star.kind,
          selected,
          runtimeSettings.home_star_brightness_max
        );
        const profile = tierProfile(star.brightnessTier);
        const tierRadius =
          presentation.radius *
          (1 + profile.radiusBoost * presentation.luminous);
        const tierHaloRadius = presentation.haloRadius * profile.haloScale;
        const spikeExtent = Math.max(
          tierHaloRadius * 1.25,
          tierRadius * profile.spikeLength,
          14
        );
        spikePosition.setXYZ(index, star.x, star.y, star.z);
        // The spike artwork occupies the central 72% of its tile, so the
        // point size is scaled up to keep the on-screen arm length.
        spikeSize.setX(index, (spikeExtent * 2 * 3) / SPIKE_INSET);
        spikeAlpha.setX(
          index,
          presentation.luminous > 0.06
            ? Math.min(
                1,
                (0.35 + presentation.luminous * 0.7 + (selected ? 0.15 : 0)) *
                  profile.spikeAlpha *
                  2.2
              )
            : 0
        );
        spikeTile.setX(index, tierTileIndex.get(tierIdOf(star)) * 2 + 1);
        spikeRot.setX(index, ((star.index * 53) % 50 - 25) * (Math.PI / 180));
      });
      haloPosition.needsUpdate = true;
      haloSize.needsUpdate = true;
      haloAlpha.needsUpdate = true;
      haloTile.needsUpdate = true;
      corePosition.needsUpdate = true;
      coreSize.needsUpdate = true;
      coreAlpha.needsUpdate = true;
      coreTile.needsUpdate = true;
      spikePosition.needsUpdate = true;
      spikeSize.needsUpdate = true;
      spikeAlpha.needsUpdate = true;
      spikeTile.needsUpdate = true;
      spikeRot.needsUpdate = true;
    }

    function writeEdgePositions(time) {
      // Per-frame glow strength of every star, so each edge end can be
      // tinted and scaled by its own star's brightness tier.
      const gains = new Map();
      for (const star of stars) {
        gains.set(star.id, starEdgeGain(star, time));
      }
      for (const layer of edgeLayers) {
        const attribute = layer.geometry.attributes.position;
        const colorAttribute = layer.geometry.attributes.color;
        const relationRgb = layer.userData.relationRgb;
        let count = 0;
        for (const edge of layer.userData.edges) {
          const source = starById.get(edge.source);
          const target = starById.get(edge.target);
          if (visibility === "near") {
            const length = Math.hypot(
              source.x - target.x,
              source.y - target.y,
              source.z - target.z
            );
            if (length > NEAR_LIMIT) continue;
          }
          attribute.setXYZ(count * 2, source.x, source.y, source.z);
          attribute.setXYZ(count * 2 + 1, target.x, target.y, target.z);
          const sourceTier = tierRgbOf(source);
          const targetTier = tierRgbOf(target);
          const sourceGain = gains.get(source.id);
          const targetGain = gains.get(target.id);
          colorAttribute.setXYZ(
            count * 2,
            (sourceTier[0] * 0.65 + relationRgb[0] * 0.35) * sourceGain,
            (sourceTier[1] * 0.65 + relationRgb[1] * 0.35) * sourceGain,
            (sourceTier[2] * 0.65 + relationRgb[2] * 0.35) * sourceGain
          );
          colorAttribute.setXYZ(
            count * 2 + 1,
            (targetTier[0] * 0.65 + relationRgb[0] * 0.35) * targetGain,
            (targetTier[1] * 0.65 + relationRgb[1] * 0.35) * targetGain,
            (targetTier[2] * 0.65 + relationRgb[2] * 0.35) * targetGain
          );
          count += 1;
        }
        layer.geometry.setDrawRange(0, count * 2);
        attribute.needsUpdate = true;
        colorAttribute.needsUpdate = true;
      }
      if (proximityLayer) {
        const attribute = proximityLayer.geometry.attributes.position;
        const colorAttribute = proximityLayer.geometry.attributes.color;
        let count = 0;
        for (let i = 0; i < stars.length && count < PROXIMITY_MAX; i += 1) {
          for (let j = i + 1; j < stars.length && count < PROXIMITY_MAX; j += 1) {
            const a = stars[i];
            const b = stars[j];
            const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
            if (distance > PROXIMITY_LIMIT) continue;
            attribute.setXYZ(count * 2, a.x, a.y, a.z);
            attribute.setXYZ(count * 2 + 1, b.x, b.y, b.z);
            const aTier = tierRgbOf(a);
            const bTier = tierRgbOf(b);
            const aGain = gains.get(a.id) * 0.6;
            const bGain = gains.get(b.id) * 0.6;
            colorAttribute.setXYZ(
              count * 2,
              aTier[0] * aGain,
              aTier[1] * aGain,
              aTier[2] * aGain
            );
            colorAttribute.setXYZ(
              count * 2 + 1,
              bTier[0] * bGain,
              bTier[1] * bGain,
              bTier[2] * bGain
            );
            count += 1;
          }
        }
        proximityLayer.geometry.setDrawRange(0, count * 2);
        attribute.needsUpdate = true;
        colorAttribute.needsUpdate = true;
      }
      // Highlight path follows the moving stars.
      if (highlightEdges.length) {
        const attribute = highlightGeometry.attributes.position;
        highlightEdges.forEach((edge, index) => {
          const source = starById.get(edge.source);
          const target = starById.get(edge.target);
          attribute.setXYZ(index * 2, source.x, source.y, source.z);
          attribute.setXYZ(index * 2 + 1, target.x, target.y, target.z);
        });
        attribute.needsUpdate = true;
      }
    }

    function writePulses(time) {
      const count = highlightEdges.length;
      if (!count) {
        pulseGeometry.setDrawRange(0, 0);
        return;
      }
      const position = pulseGeometry.attributes.position;
      const size = pulseGeometry.attributes.aSize;
      const alpha = pulseGeometry.attributes.aAlpha;
      const tile = pulseGeometry.attributes.aTile;
      const rot = pulseGeometry.attributes.aRot;
      highlightEdges.forEach((edge, index) => {
        const source = starById.get(edge.source);
        const target = starById.get(edge.target);
        const t = (time * 0.0004 + index * 0.37) % 1;
        position.setXYZ(
          index,
          source.x + (target.x - source.x) * t,
          source.y + (target.y - source.y) * t,
          source.z + (target.z - source.z) * t
        );
        size.setX(index, 26);
        alpha.setX(index, 0.9);
        tile.setX(index, 0);
        rot.setX(index, 0);
      });
      pulseGeometry.setDrawRange(0, count);
      position.needsUpdate = true;
      size.needsUpdate = true;
      alpha.needsUpdate = true;
      tile.needsUpdate = true;
      rot.needsUpdate = true;
    }

    function projectStar(star) {
      const vector = new THREE.Vector3(star.x, star.y, star.z);
      vector.project(camera);
      return {
        x: ((vector.x + 1) / 2) * width,
        y: ((1 - vector.y) / 2) * height,
        visible: vector.z < 1
      };
    }

    function updateLabel(time) {
      if (!labelStar || time >= labelExpiresAt) {
        label.hidden = true;
        labelStar = null;
        return;
      }
      const offset = glCanvas.getBoundingClientRect();
      const projected = projectStar(labelStar);
      label.hidden = false;
      const labelWidth = label.offsetWidth || 180;
      const labelHeight = label.offsetHeight || 34;
      const x = Math.max(
        8,
        Math.min(
          window.innerWidth - labelWidth - 8,
          offset.left + projected.x + 10
        )
      );
      const y = Math.max(
        8,
        Math.min(
          window.innerHeight - labelHeight - 8,
          offset.top + projected.y - 18
        )
      );
      label.style.transform =
        `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    }

    function draw(time) {
      updateVariations(time);
      strategy.move(stars, time - (draw.lastTime || time), time);
      draw.lastTime = time;
      if (strategy.camera !== "flat") {
        camera.position.set(
          cameraState.radius *
            Math.sin(cameraState.phi) *
            Math.sin(cameraState.theta),
          cameraState.radius * Math.cos(cameraState.phi),
          cameraState.radius *
            Math.sin(cameraState.phi) *
            Math.cos(cameraState.theta)
        );
        camera.lookAt(0, 0, 0);
      }
      writePointAttributes(time);
      writeEdgePositions(time);
      writePulses(time);
      renderer.render(scene, camera);
      updateLabel(time);
    }

    function animate(time) {
      frame = 0;
      if (disposed || document.hidden) return;
      const delta = lastFrameAt ? time - lastFrameAt : 16;
      lastFrameAt = time;
      if (!dragState.active && !reducedMotion && strategy.camera !== "flat") {
        cameraState.theta += delta * 0.00004;
      }
      draw(time);
      frame = window.requestAnimationFrame(animate);
    }

    function percentage(value, total) {
      return total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";
    }

    function updateCoverage() {
      if (
        !selectedRoot ||
        runtimeSettings.home_star_relation_visibility === "always"
      ) {
        panel.hidden = true;
        return;
      }
      const litContributors = contributors.filter((star) =>
        selectedIds.has(star.id)
      ).length;
      const litDocuments = documents.filter((star) =>
        selectedIds.has(star.id)
      ).length;
      panel.hidden = false;
      panel.querySelector("[data-star-coverage-tier]").textContent =
        selectedTier?.name || "未分级";
      panel.querySelector("[data-star-coverage-brightness]").textContent =
        `${selectedBrightness.toFixed(1)} / ` +
        `${runtimeSettings.home_star_brightness_max}`;
      panel.querySelector("[data-star-coverage-total]").textContent =
        `${selectedIds.size} / ${stars.length} · ` +
        percentage(selectedIds.size, stars.length);
      panel.querySelector("[data-star-coverage-contributors]").textContent =
        `${litContributors} / ${contributors.length} · ` +
        percentage(litContributors, contributors.length);
      panel.querySelector("[data-star-coverage-documents]").textContent =
        `${litDocuments} / ${documents.length} · ` +
        percentage(litDocuments, documents.length);
      panel.querySelector("[data-star-coverage-relations]").textContent =
        `${activeRelationPlan.coverageCount} / ` +
        `${activeRelationPlan.totalCount} · ` +
        percentage(
          activeRelationPlan.coverageCount,
          activeRelationPlan.totalCount
        );
    }

    function showLabel(star, now) {
      const secondClick = labelStar === star && now < labelExpiresAt;
      if (secondClick && star.kind === "document" && star.route) {
        window.location.assign(star.route);
        return;
      }
      labelStar = star;
      const title = star.kind === "document" ? star.title : star.name;
      const tier = star.brightnessTier?.name || "未分级";
      label.textContent =
        `${title} · ${tier} · ${star.baseBrightness.toFixed(1)}`;
      label.dataset.starKind = star.kind;
      labelExpiresAt = now + runtimeSettings.home_star_label_duration_ms;
      window.clearTimeout(labelTimer);
      labelTimer = window.setTimeout(() => {
        label.hidden = true;
        labelStar = null;
      }, runtimeSettings.home_star_label_duration_ms);
      updateLabel(now);
    }

    function clearSelection() {
      selectedRoot = "";
      selectedIds = new Set();
      selectedBrightness = 0;
      selectedTier = null;
      activeRelationPlan = null;
      activeVisualEdgeIds = new Set();
      highlightEdges = [];
      highlightGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(0), 3)
      );
      for (const name of ["position", "aSize", "aAlpha", "aTile", "aRot"]) {
        pulseGeometry.setAttribute(
          name,
          new THREE.BufferAttribute(new Float32Array(0), 3)
        );
      }
      panel.hidden = true;
      glCanvas.dataset.selectedCount = "0";
      glCanvas.dataset.selectedTier = "";
      if (reducedMotion) draw(performance.now());
    }

    function selectStar(star, now) {
      showLabel(star, now);
      window.clearTimeout(selectionTimer);
      if (runtimeSettings.home_star_relation_visibility === "always") {
        clearSelection();
        return;
      }
      selectedRoot = star.id;
      selectedBrightness = star.baseBrightness;
      selectedTier = star.brightnessTier;
      selectedIds = illumination.illuminate(
        stars,
        edges,
        star.id,
        runtimeSettings.home_star_illumination_rule,
        runtimeSettings.home_star_illumination_depth,
        runtimeSettings.home_star_graph_direction
      );
      activeRelationPlan = illumination.relationPlan(
        stars,
        edges,
        selectedIds,
        runtimeSettings.home_star_active_edge_mode
      );
      activeVisualEdgeIds = new Set(
        activeRelationPlan.visualEdges.map(illumination.edgeId)
      );
      highlightEdges = activeRelationPlan.visualEdges.filter((edge) => {
        return activeVisualEdgeIds.has(illumination.edgeId(edge));
      });
      highlightGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(highlightEdges.length * 6), 3)
      );
      const pulseCount = highlightEdges.length;
      pulseGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(pulseCount * 3), 3)
      );
      for (const name of ["aSize", "aAlpha", "aTile", "aRot"]) {
        pulseGeometry.setAttribute(
          name,
          new THREE.BufferAttribute(new Float32Array(pulseCount), 1)
        );
      }
      glCanvas.dataset.selectedCount = String(selectedIds.size);
      glCanvas.dataset.selectedTier = selectedTier?.name || "";
      updateCoverage();
      selectionTimer = window.setTimeout(
        clearSelection,
        runtimeSettings.home_star_selection_duration_ms
      );
      if (reducedMotion) draw(now);
    }

    function hitTest(event) {
      const rectangle = glCanvas.getBoundingClientRect();
      const x = event.clientX - rectangle.left;
      const y = event.clientY - rectangle.top;
      let nearest = null;
      let nearestDistance = Infinity;
      for (const star of stars) {
        const projected = projectStar(star);
        if (!projected.visible) continue;
        const distance = Math.hypot(projected.x - x, projected.y - y);
        const limit = star.kind === "contributor" ? 14 : 10;
        if (distance <= limit && distance < nearestDistance) {
          nearest = star;
          nearestDistance = distance;
        }
      }
      return nearest;
    }

    function documentClick(event) {
      if (event.target === label) return;
      if (
        event.target.closest(
          "a, button, input, select, textarea, summary, [role='button']"
        )
      ) {
        return;
      }
      const rectangle = glCanvas.getBoundingClientRect();
      if (
        event.clientX < rectangle.left ||
        event.clientX > rectangle.right ||
        event.clientY < rectangle.top ||
        event.clientY > rectangle.bottom
      ) {
        return;
      }
      const star = hitTest(event);
      if (star) {
        event.preventDefault();
        selectStar(star, performance.now());
      }
    }

    function labelClick() {
      if (labelStar) selectStar(labelStar, performance.now());
    }

    // Drag-to-orbit (depth modes only), guarded like the click handler.
    const dragState = { active: false, x: 0, y: 0, moved: 0 };
    function pointerDown(event) {
      if (strategy.camera === "flat") return;
      if (
        event.target.closest(
          "a, button, input, select, textarea, summary, [role='button']"
        )
      ) {
        return;
      }
      const rectangle = glCanvas.getBoundingClientRect();
      if (
        event.clientX < rectangle.left ||
        event.clientX > rectangle.right ||
        event.clientY < rectangle.top ||
        event.clientY > rectangle.bottom
      ) {
        return;
      }
      dragState.active = true;
      dragState.moved = 0;
      dragState.x = event.clientX;
      dragState.y = event.clientY;
    }
    function pointerMove(event) {
      if (!dragState.active) return;
      const dx = event.clientX - dragState.x;
      const dy = event.clientY - dragState.y;
      dragState.x = event.clientX;
      dragState.y = event.clientY;
      dragState.moved += Math.abs(dx) + Math.abs(dy);
      cameraState.theta -= dx * 0.004;
      cameraState.phi = Math.max(
        Math.PI * 0.18,
        Math.min(Math.PI * 0.82, cameraState.phi - dy * 0.003)
      );
    }
    function pointerUp() {
      dragState.active = false;
    }

    const resizeObserver =
      runtimeSettings.home_star_scope === "hero"
        ? new ResizeObserver(resize)
        : null;
    if (resizeObserver) resizeObserver.observe(hero);
    else window.addEventListener("resize", resize);
    document.addEventListener("click", documentClick, true);
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("pointermove", pointerMove, true);
    document.addEventListener("pointerup", pointerUp, true);
    label.addEventListener("click", labelClick);
    resize();
    glCanvas.dataset.starCount = String(stars.length);
    glCanvas.dataset.edgeCount = String(edges.length);
    glCanvas.dataset.contributorCount = String(contributors.length);
    glCanvas.dataset.documentCount = String(documents.length);
    glCanvas.dataset.codeSystemCount = String(
      stars.filter((star) => star.resourceKind === "code_system").length
    );
    glCanvas.dataset.contributionEdgeCount = String(
      edges.filter((edge) => edge.type === "contribution").length
    );
    glCanvas.dataset.selectedCount = "0";
    glCanvas.dataset.selectedTier = "";
    if (!reducedMotion) frame = window.requestAnimationFrame(animate);
    else draw(performance.now());

    // Debug handle for automated visual verification.
    window.__GCK_STAR3D_DEBUG = {
      renderer,
      scene,
      camera,
      stars,
      layers: { haloLayer, coreLayer, spikeLayer, pulseLayer }
    };

    return function () {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(labelTimer);
      window.clearTimeout(selectionTimer);
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener("resize", resize);
      document.removeEventListener("click", documentClick, true);
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("pointermove", pointerMove, true);
      document.removeEventListener("pointerup", pointerUp, true);
      label.removeEventListener("click", labelClick);
      label.remove();
      panel.remove();
      for (const layer of [
        haloLayer,
        coreLayer,
        spikeLayer,
        pulseLayer,
        highlightLayer,
        ...(proximityLayer ? [proximityLayer] : []),
        ...edgeLayers
      ]) {
        layer.geometry.dispose();
        layer.material.dispose();
      }
      atlasTexture.dispose();
      renderer.dispose();
      glCanvas.remove();
      canvas.style.display = "";
      canvas.setAttribute("data-knowledge-field", "");
      document.body.classList.remove("home-stars-full", "home-stars-hero");
    };
  }

  window.GCK_STAR3D_MODES = { create, WEBGL_MODES };
})();
