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
 *   3d-spiral — four calm logarithmic arms around a bright core
 *   3d-nebula — stars follow a warped volumetric nebula ribbon
 *   3d-clusters — six slowly orbiting stellar groups
 *   3d-shell — layered fibonacci shells with gentle precession
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
    "3d-orbit",
    "3d-spiral",
    "3d-nebula",
    "3d-clusters",
    "3d-shell"
  ];
  const PORTAL_PRIMITIVE_STRUCTURES = [
    "match_expanded",
    "octahedron",
    "sphere",
    "cube"
  ];
  const CAMERA_RADIUS = {
    "3d": 700,
    "3d-drift": 620,
    "3d-drift-anchored": 620,
    "3d-galaxy": 780,
    "3d-orbit": 820,
    "3d-spiral": 790,
    "3d-nebula": 760,
    "3d-clusters": 820,
    "3d-shell": 780
  };
  const DEFAULT_ORBIT_POINT_MIN_DEPTH = 280;
  const DEFAULT_POINT_MAX_CSS_SIZE = Object.freeze({
    halo: 200,
    core: 36,
    spike: 240,
    pulse: 36
  });
  const POINT_SIZE_SOFT_KNEE = 0.62;
  const SECONDARY_SPIKE_FRACTION = 0.06;
  const DEFAULT_BACKGROUND_COUNTS = Object.freeze({
    field: 320,
    dust: 1920,
    cluster: 422,
    stream: 326,
    nebula: 212
  });
  const DEFAULT_BACKGROUND_BRIGHTNESS = 2.2;
  const DEFAULT_DUST_BRIGHTNESS = 2.6;
  const DEFAULT_BACKGROUND_SIZE_SCALE = 1.6;
  const DEFAULT_BACKGROUND_STRUCTURE_MOTION = 1;
  const DRIFT_SPEED_MULTIPLIER = 2.4;
  const SPIKE_ART_SCALE = 2.1;
  const CONTENT_EXPOSURE = 0.28;
  const CONTRIBUTION_SPACE_DURATION = 1300;
  const STRUCTURE_TRANSITION_DURATION = 900;
  const CONTRIBUTION_SPACE_RADIUS = 165;
  const DEFAULT_PORTAL_ROTATION_SPEED = 2.6;
  const DEFAULT_PORTAL_SIZE_PERCENT = 34;
  const DEFAULT_PORTAL_BRIGHTNESS_PERCENT = 42;

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

  function initializeSmoothDrift(star, random, bounds) {
    star.driftAmpX = 24 + random() * 52;
    star.driftAmpY = 14 + random() * 30;
    star.driftAmpZ = 24 + random() * 52;
    star.driftBaseX =
      (random() * 2 - 1) * (bounds.x - star.driftAmpX);
    star.driftBaseY =
      (random() * 2 - 1) * (bounds.y - star.driftAmpY);
    star.driftBaseZ =
      (random() * 2 - 1) * (bounds.z - star.driftAmpZ);
    star.driftPhaseX = random() * Math.PI * 2;
    star.driftPhaseY = random() * Math.PI * 2;
    star.driftPhaseZ = random() * Math.PI * 2;
    star.driftSpeedX =
      (0.000015 + random() * 0.00002) * DRIFT_SPEED_MULTIPLIER;
    star.driftSpeedY =
      (0.000012 + random() * 0.000016) * DRIFT_SPEED_MULTIPLIER;
    star.driftSpeedZ =
      (0.000014 + random() * 0.000019) * DRIFT_SPEED_MULTIPLIER;
    moveSmoothDrift(star, 0);
  }

  function moveSmoothDrift(star, time) {
    star.x =
      star.driftBaseX +
      Math.sin(time * star.driftSpeedX + star.driftPhaseX) *
        star.driftAmpX;
    star.y =
      star.driftBaseY +
      Math.sin(time * star.driftSpeedY + star.driftPhaseY) *
        star.driftAmpY;
    star.z =
      star.driftBaseZ +
      Math.cos(time * star.driftSpeedZ + star.driftPhaseZ) *
        star.driftAmpZ;
  }

  // Low-frequency bounded drift; close stars link up.
  function driftStrategy() {
    const BOUNDS = { x: 380, y: 190, z: 380 };
    return {
      camera: "orbit",
      proximity: true,
      bounds: BOUNDS,
      init(stars, ctx) {
        const { random } = ctx;
        for (const star of stars) {
          initializeSmoothDrift(star, random, BOUNDS);
        }
      },
      fit() {},
      move(stars, dt, time) {
        for (const star of stars) {
          moveSmoothDrift(star, time);
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
          initializeSmoothDrift(star, random, BOUNDS);
        });
      },
      fit() {},
      move(stars, dt, time) {
        for (const star of stars) {
          if (star.kind === "contributor") continue;
          moveSmoothDrift(star, time);
        }
      }
    };
  }

  function spiralStrategy() {
    return {
      camera: "orbit",
      init(stars, ctx) {
        const { random } = ctx;
        const brightest = stars
          .slice()
          .sort((left, right) => right.baseBrightness - left.baseBrightness);
        const coreIds = new Set(brightest.slice(0, 3).map((star) => star.id));
        for (const star of stars) {
          star.spiralCore = coreIds.has(star.id);
          if (star.spiralCore) {
            const coreIndex = brightest.indexOf(star);
            star.spiralR = coreIndex * 24;
            star.spiralTheta = coreIndex * Math.PI * 0.72;
            star.spiralY = (coreIndex - 1) * 9;
          } else {
            star.spiralR = 58 + 410 * Math.pow(random(), 0.62);
            const arm = star.index % 4;
            star.spiralTheta =
              arm * Math.PI * 0.5 +
              star.spiralR * 0.018 +
              (random() - 0.5) * 0.58;
            star.spiralY =
              (random() + random() - 1) *
              (12 + star.spiralR * 0.045);
          }
          star.spiralOmega =
            0.012 + 0.034 * (1 - Math.min(1, star.spiralR / 480));
          star.spiralPhase = random() * Math.PI * 2;
        }
      },
      fit() {},
      move(stars, dt, time) {
        const step = Math.min(dt, 100) / 1000;
        for (const star of stars) {
          star.spiralTheta += star.spiralOmega * step;
          const ripple = star.spiralCore
            ? 0
            : Math.sin(time * 0.00022 + star.spiralPhase) * 5;
          star.x = Math.cos(star.spiralTheta) * (star.spiralR + ripple);
          star.z = Math.sin(star.spiralTheta) * (star.spiralR + ripple);
          star.y =
            star.spiralY +
            Math.sin(time * 0.00016 + star.spiralPhase) *
              (star.spiralCore ? 2 : 7);
        }
      }
    };
  }

  function nebulaStrategy() {
    return {
      camera: "orbit",
      init(stars, ctx) {
        const { random } = ctx;
        for (const star of stars) {
          star.nebulaT = random() * 2 - 1;
          star.nebulaWidth = (random() + random() - 1) * 105;
          star.nebulaHeight = (random() + random() - 1) * 74;
          star.nebulaDepth = (random() + random() - 1) * 92;
          star.nebulaPhase = random() * Math.PI * 2;
          star.nebulaSpeed = 0.00008 + random() * 0.00009;
        }
      },
      fit() {},
      move(stars, dt, time) {
        for (const star of stars) {
          const t = star.nebulaT;
          const twist = t * Math.PI * 1.65 + time * 0.000035;
          const width =
            star.nebulaWidth +
            Math.sin(time * star.nebulaSpeed + star.nebulaPhase) * 8;
          star.x = t * 430 + Math.cos(twist) * width * 0.46;
          star.y =
            Math.sin(t * Math.PI * 1.28) * 118 +
            Math.sin(twist) * width * 0.28 +
            star.nebulaHeight;
          star.z =
            Math.sin(t * Math.PI * 2.05) * 185 +
            Math.cos(twist) * width * 0.72 +
            star.nebulaDepth;
        }
      }
    };
  }

  function clusterStrategy() {
    const CLUSTER_COUNT = 6;
    return {
      camera: "orbit",
      init(stars, ctx) {
        const { random } = ctx;
        const golden = Math.PI * (3 - Math.sqrt(5));
        for (const star of stars) {
          const cluster = star.index % CLUSTER_COUNT;
          const y =
            1 - (cluster / Math.max(1, CLUSTER_COUNT - 1)) * 2;
          const ring = Math.sqrt(Math.max(0, 1 - y * y));
          const theta = cluster * golden;
          star.clusterCenterX = Math.cos(theta) * ring * 315;
          star.clusterCenterY = y * 210;
          star.clusterCenterZ = Math.sin(theta) * ring * 315;
          const radius = 28 + 92 * Math.cbrt(random());
          const localTheta = random() * Math.PI * 2;
          const localCosPhi = random() * 2 - 1;
          const localSinPhi = Math.sqrt(
            Math.max(0, 1 - localCosPhi * localCosPhi)
          );
          star.clusterX =
            radius * localSinPhi * Math.cos(localTheta);
          star.clusterY = radius * localCosPhi * 0.72;
          star.clusterZ =
            radius * localSinPhi * Math.sin(localTheta);
          star.clusterPhase = random() * Math.PI * 2;
        }
      },
      fit() {},
      move(stars, dt, time) {
        const rotation = time * 0.000018;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        for (const star of stars) {
          const centerX =
            star.clusterCenterX * cos - star.clusterCenterZ * sin;
          const centerZ =
            star.clusterCenterX * sin + star.clusterCenterZ * cos;
          star.x =
            centerX +
            star.clusterX +
            Math.sin(time * 0.00012 + star.clusterPhase) * 4;
          star.y =
            star.clusterCenterY +
            star.clusterY +
            Math.cos(time * 0.0001 + star.clusterPhase) * 4;
          star.z = centerZ + star.clusterZ;
        }
      }
    };
  }

  function shellStrategy() {
    return {
      camera: "orbit",
      init(stars, ctx) {
        const { random } = ctx;
        const golden = Math.PI * (3 - Math.sqrt(5));
        for (const star of stars) {
          const shell = star.index % 3;
          const shellIndex = Math.floor(star.index / 3);
          const shellCount = Math.ceil(stars.length / 3);
          const y =
            1 - (shellIndex / Math.max(1, shellCount - 1)) * 2;
          const ring = Math.sqrt(Math.max(0, 1 - y * y));
          const theta = shellIndex * golden + shell * 0.78;
          star.shellRadius = 185 + shell * 118 + (random() - 0.5) * 18;
          star.shellX = Math.cos(theta) * ring;
          star.shellY = y;
          star.shellZ = Math.sin(theta) * ring;
          star.shellPhase = random() * Math.PI * 2;
        }
      },
      fit() {},
      move(stars, dt, time) {
        const yaw = time * 0.000021;
        const pitch = Math.sin(time * 0.000037) * 0.16;
        const cosYaw = Math.cos(yaw);
        const sinYaw = Math.sin(yaw);
        const cosPitch = Math.cos(pitch);
        const sinPitch = Math.sin(pitch);
        for (const star of stars) {
          const radius =
            star.shellRadius +
            Math.sin(time * 0.00011 + star.shellPhase) * 5;
          const x = star.shellX * radius;
          const y = star.shellY * radius;
          const z = star.shellZ * radius;
          const yawX = x * cosYaw - z * sinYaw;
          const yawZ = x * sinYaw + z * cosYaw;
          star.x = yawX;
          star.y = y * cosPitch - yawZ * sinPitch;
          star.z = y * sinPitch + yawZ * cosPitch;
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
    "3d-orbit": orbitStrategy,
    "3d-spiral": spiralStrategy,
    "3d-nebula": nebulaStrategy,
    "3d-clusters": clusterStrategy,
    "3d-shell": shellStrategy
  };

  // ---------- Renderer factory ----------

  function create(host) {
    const THREE = host.THREE;
    const runtimeSettings = host.settings;
    if (!THREE) return host.fallback2D();
    const portalExperience =
      runtimeSettings.home_star_experience_mode ===
      "contribution_portal";
    const portalExpandedStructure = WEBGL_MODES.includes(
      runtimeSettings.home_star_portal_expanded_structure
    )
      ? runtimeSettings.home_star_portal_expanded_structure
      : "3d-drift";
    const portalCollapsedStructure = [
      ...PORTAL_PRIMITIVE_STRUCTURES,
      ...WEBGL_MODES.filter((item) => item !== "2d-webgl")
    ].includes(runtimeSettings.home_star_portal_collapsed_structure)
      ? runtimeSettings.home_star_portal_collapsed_structure
      : "octahedron";
    const requestedMode = portalExperience
      ? portalExpandedStructure
      : runtimeSettings.home_star_render_mode;
    const configuredMode = WEBGL_MODES.includes(requestedMode)
      ? requestedMode
      : "3d-drift";
    const mode =
      portalExperience && configuredMode === "2d-webgl"
        ? "3d-drift"
        : configuredMode;
    let activeStructure = mode;
    let strategy = (STRATEGIES[activeStructure] || depthStrategy)();
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
      seededRandom,
      starDisplayName,
      starKindName
    } = host;
    const reducedMotion = host.reducedMotion;
    const portalElement = portalExperience
      ? document.querySelector("[data-contribution-space-portal]")
      : null;
    const returnButton = portalExperience
      ? document.querySelector("[data-contribution-space-return]")
      : null;
    const structureSelect = portalExperience
      ? document.querySelector("[data-contribution-space-structure]")
      : null;
    const structureControl = structureSelect?.closest(
      "[data-contribution-space-structure-control]"
    );
    const heroContent = portalExperience
      ? hero.querySelector(".library-intro-overlay")
      : null;

    // A 2D context already exists on the original canvas, and a canvas can
    // only host one context type — render WebGL into a dedicated element.
    const glCanvas = document.createElement("canvas");
    glCanvas.className = canvas.className;
    glCanvas.setAttribute("data-knowledge-field", "");
    canvas.removeAttribute("data-knowledge-field");
    canvas.style.display = "none";
    if (portalExperience) {
      document.body.appendChild(glCanvas);
    } else {
      canvas.parentElement.insertBefore(glCanvas, canvas);
    }
    const relationCanvas = document.createElement("canvas");
    relationCanvas.className =
      `${canvas.className} knowledge-relations-field`;
    relationCanvas.setAttribute("aria-hidden", "true");
    relationCanvas.toggleAttribute(
      "data-contribution-space-relations",
      portalExperience
    );
    glCanvas.parentElement.insertBefore(relationCanvas, glCanvas);
    const relationContext = relationCanvas.getContext("2d");
    document.body.classList.remove("home-stars-old");
    document.body.classList.toggle(
      "home-stars-full",
      !portalExperience &&
        runtimeSettings.home_star_scope === "full"
    );
    document.body.classList.toggle(
      "home-stars-hero",
      !portalExperience &&
        runtimeSettings.home_star_scope === "hero"
    );
    document.body.classList.toggle(
      "home-star-experience-portal",
      portalExperience
    );
    glCanvas.toggleAttribute(
      "data-contribution-space",
      portalExperience
    );
    glCanvas.dataset.starMap = `contribution-${mode}`;
    glCanvas.dataset.starStructure = activeStructure;
    glCanvas.dataset.structureTransition = "idle";
    glCanvas.dataset.structureTransitionProgress = "1.000";
    glCanvas.dataset.starScope = runtimeSettings.home_star_scope;
    glCanvas.dataset.starExperience = portalExperience
      ? "contribution_portal"
      : "immersive";

    const portalBackdrop = portalExperience
      ? document.createElement("div")
      : null;
    if (portalBackdrop) {
      portalBackdrop.className = "contribution-space-backdrop";
      portalBackdrop.setAttribute("aria-hidden", "true");
      document.body.appendChild(portalBackdrop);
    }
    const portalInteractionLock = portalExperience
      ? document.createElement("div")
      : null;
    if (portalInteractionLock) {
      portalInteractionLock.className =
        "contribution-space-interaction-lock";
      portalInteractionLock.setAttribute("aria-hidden", "true");
      document.body.appendChild(portalInteractionLock);
    }

    let renderer = null;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: glCanvas,
        alpha: true,
        antialias: true
      });
    } catch (error) {
      glCanvas.remove();
      relationCanvas.remove();
      portalBackdrop?.remove();
      portalInteractionLock?.remove();
      canvas.style.display = "";
      canvas.setAttribute("data-knowledge-field", "");
      return host.fallback2D();
    }

    const sourceGraph = host.sourceGraph;
    const random = seededRandom(
      hashSeed(`${sourceGraph.revision}:contribution-stars-3d`)
    );
    function starColorGain(star) {
      if (!runtimeSettings.home_star_color_random_enabled) {
        return [1, 1, 1];
      }
      const colorRandom = seededRandom(
        hashSeed(`${sourceGraph.revision}:${star.id}:temperature`)
      );
      const kindBias = star.kind === "contributor" ? -0.16 : 0.08;
      const temperature = Math.max(
        -1,
        Math.min(
          1,
          (colorRandom() * 2 - 1) *
            (0.35 + colorRandom() * 0.65) +
            kindBias
        )
      );
      const amount = Math.abs(temperature);
      return temperature < 0
        ? [1, 1 - amount * 0.1, 1 - amount * 0.26]
        : [1 - amount * 0.18, 1 - amount * 0.055, 1];
    }
    const stars = sourceGraph.stars.map((source, index) => {
      const brightnessDetails = formulaEngine.calculateBrightnessDetails(
        source,
        runtimeSettings.home_star_brightness_rules,
        runtimeSettings.home_star_brightness_min,
        runtimeSettings.home_star_brightness_initial,
        runtimeSettings.home_star_brightness_max,
        { totalRelationCount: sourceGraph.edges.length }
      );
      return {
        ...source,
        metrics: { ...(source.metrics || {}) },
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        baseBrightness: brightnessDetails.final,
        brightnessDetails,
        variationFrom: 0,
        variationTo: 0,
        variationStartedAt: 0,
        variationNextAt: 0,
        index
      };
    });
    for (const star of stars) {
      star.brightnessTier = formulaEngine.brightnessTier(
        star.baseBrightness,
        runtimeSettings.home_star_brightness_tiers,
        runtimeSettings.home_star_brightness_min,
        runtimeSettings.home_star_brightness_max
      );
      star.colorGain = starColorGain(star);
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

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
    const cameraState = {
      theta: 0.6,
      phi: Math.PI / 2.85,
      radius: CAMERA_RADIUS[mode] || 900,
      framingScale: 1
    };
    function boundedSetting(key, fallback, minimum, maximum) {
      const value = Number(runtimeSettings[key]);
      return Math.max(
        minimum,
        Math.min(maximum, Number.isFinite(value) ? value : fallback)
      );
    }
    const pointMinDepth =
      strategy.camera === "flat"
        ? 1
        : boundedSetting(
            "home_star_3d_min_depth",
            DEFAULT_ORBIT_POINT_MIN_DEPTH,
            100,
            1000
          );
    const pointMaxCssSize = Object.freeze({
      halo: boundedSetting(
        "home_star_3d_halo_max_css_size",
        DEFAULT_POINT_MAX_CSS_SIZE.halo,
        40,
        600
      ),
      core: boundedSetting(
        "home_star_3d_core_max_css_size",
        DEFAULT_POINT_MAX_CSS_SIZE.core,
        8,
        120
      ),
      spike: boundedSetting(
        "home_star_3d_spike_max_css_size",
        DEFAULT_POINT_MAX_CSS_SIZE.spike,
        40,
        800
      ),
      pulse: boundedSetting(
        "home_star_3d_pulse_max_css_size",
        DEFAULT_POINT_MAX_CSS_SIZE.pulse,
        8,
        120
      )
    });
    const backgroundFieldEnabled =
      runtimeSettings.home_star_3d_field_enabled !== false;
    const backgroundDustEnabled =
      runtimeSettings.home_star_3d_dust_enabled !== false;
    const backgroundClusterEnabled =
      runtimeSettings.home_star_3d_cluster_enabled !== false;
    const backgroundStreamEnabled =
      runtimeSettings.home_star_3d_stream_enabled !== false;
    const backgroundNebulaEnabled =
      runtimeSettings.home_star_3d_nebula_enabled !== false;
    const backgroundFieldCount = backgroundFieldEnabled
      ? Math.round(
          boundedSetting(
            "home_star_3d_field_star_count",
            DEFAULT_BACKGROUND_COUNTS.field,
            0,
            5000
          )
        )
      : 0;
    const backgroundDustCount = backgroundDustEnabled
      ? Math.round(
          boundedSetting(
            "home_star_3d_dust_star_count",
            DEFAULT_BACKGROUND_COUNTS.dust,
            0,
            3000
          )
        )
      : 0;
    const backgroundClusterCount = backgroundClusterEnabled
      ? Math.round(
          boundedSetting(
            "home_star_3d_cluster_star_count",
            DEFAULT_BACKGROUND_COUNTS.cluster,
            0,
            800
          )
        )
      : 0;
    const backgroundStreamCount = backgroundStreamEnabled
      ? Math.round(
          boundedSetting(
            "home_star_3d_stream_star_count",
            DEFAULT_BACKGROUND_COUNTS.stream,
            0,
            700
          )
        )
      : 0;
    const backgroundNebulaCount = backgroundNebulaEnabled
      ? Math.round(
          boundedSetting(
            "home_star_3d_nebula_star_count",
            DEFAULT_BACKGROUND_COUNTS.nebula,
            0,
            500
          )
        )
      : 0;
    const backgroundBrightness =
      boundedSetting(
        "home_star_3d_background_brightness_percent",
        DEFAULT_BACKGROUND_BRIGHTNESS * 100,
        0,
        400
      ) / 100;
    const dustBrightness =
      boundedSetting(
        "home_star_3d_dust_brightness_percent",
        DEFAULT_DUST_BRIGHTNESS * 100,
        0,
        500
      ) / 100;
    const backgroundSizeScale =
      boundedSetting(
        "home_star_3d_background_size_percent",
        DEFAULT_BACKGROUND_SIZE_SCALE * 100,
        25,
        300
      ) / 100;
    const backgroundStructureMotion =
      boundedSetting(
        "home_star_3d_structure_motion_percent",
        DEFAULT_BACKGROUND_STRUCTURE_MOTION * 100,
        0,
        200
      ) / 100;
    const portalRotationRadiansPerMs =
      boundedSetting(
        "home_star_portal_rotation_speed",
        DEFAULT_PORTAL_ROTATION_SPEED,
        0,
        30
      ) *
      Math.PI /
      180 /
      1000;
    const portalCollapsedScale =
      boundedSetting(
        "home_star_portal_size_percent",
        DEFAULT_PORTAL_SIZE_PERCENT,
        10,
        100
      ) / 100;
    const portalCollapsedBrightness =
      boundedSetting(
        "home_star_portal_brightness_percent",
        DEFAULT_PORTAL_BRIGHTNESS_PERCENT,
        10,
        100
      ) / 100;

    const pointVertexShader = [
      "attribute float aSize;",
      "attribute float aAlpha;",
      "attribute float aTile;",
      "attribute float aRot;",
      "attribute float aPhase;",
      "attribute vec4 aEffect;",
      "attribute vec4 aEffect2;",
      "attribute vec3 aColor;",
      "varying float vAlpha;",
      "varying float vTile;",
      "varying float vRot;",
      "varying float vPhase;",
      "varying float vPulse;",
      "varying float vFlare;",
      "varying vec4 vEffect;",
      "varying vec4 vEffect2;",
      "varying vec3 vColor;",
      "varying vec2 vScreenUv;",
      "uniform float uScale;",
      "uniform float uPixelRatio;",
      "uniform float uMinDepth;",
      "uniform float uMaxCssSize;",
      "uniform float uSoftKneeRatio;",
      "uniform float uPortalScale;",
      "uniform float uLayerKind;",
      "uniform float uTime;",
      "uniform vec2 uScreenOffset;",
      "void main() {",
      "  vAlpha = aAlpha;",
      "  vTile = aTile;",
      "  vRot = aRot + uTime * aEffect.w;",
      "  vPhase = aPhase;",
      "  vEffect = aEffect;",
      "  vEffect2 = aEffect2;",
      "  vColor = aColor;",
      "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
      "  float safeDepth = max(-mvPosition.z, uMinDepth);",
      "  float projectedSize =",
      "    aSize * uPortalScale * (uScale / safeDepth);",
      "  float pulse = sin(uTime * aEffect.y + aPhase) * aEffect.x;",
      "  float flareWave = max(",
      "    0.0,",
      "    sin(uTime * aEffect2.y + aPhase * 1.73)",
      "  );",
      "  float flare = pow(flareWave, 6.0) * aEffect2.x;",
      "  vPulse = pulse;",
      "  vFlare = flare;",
      "  float pulseGain = uLayerKind < 0.5",
      "    ? 2.4",
      "    : (uLayerKind < 1.5 ? 0.9 : 1.8);",
      "  float flareGain = uLayerKind < 0.5",
      "    ? 0.34",
      "    : (uLayerKind < 1.5 ? 0.12 : 0.45);",
      "  projectedSize *= max(",
      "    0.68,",
      "    1.0 + pulse * pulseGain + flare * flareGain",
      "  );",
      "  float sizeCap = uMaxCssSize * uPixelRatio;",
      "  float sizeKnee = sizeCap * uSoftKneeRatio;",
      "  float compressedSize = projectedSize;",
      "  if (projectedSize > sizeKnee) {",
      "    float softRange = max(1.0, sizeCap - sizeKnee);",
      "    float excess = (projectedSize - sizeKnee) / softRange;",
      "    compressedSize = sizeKnee + softRange * (1.0 - exp(-excess));",
      "  }",
      "  gl_PointSize = min(compressedSize, sizeCap);",
      "  gl_Position = projectionMatrix * mvPosition;",
      "  gl_Position.xy += uScreenOffset * gl_Position.w;",
      "  vec2 ndc = gl_Position.xy / max(gl_Position.w, 0.0001);",
      "  vScreenUv = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);",
      "}"
    ].join("\n");
    const pointFragmentShader = [
      "uniform sampler2D uAtlas;",
      "uniform float uTiles;",
      "varying float vAlpha;",
      "varying float vTile;",
      "varying float vRot;",
      "varying float vPhase;",
      "varying float vPulse;",
      "varying float vFlare;",
      "varying vec4 vEffect;",
      "varying vec4 vEffect2;",
      "varying vec3 vColor;",
      "varying vec2 vScreenUv;",
      "uniform vec4 uContentRect0;",
      "uniform vec4 uContentRect1;",
      "uniform vec4 uContentRect2;",
      "uniform vec2 uContentFeather;",
      "uniform float uContentExposure;",
      "uniform float uPortalBrightness;",
      "uniform float uLayerKind;",
      "uniform float uTime;",
      "float rectMask(vec2 point, vec4 rect) {",
      "  float x = smoothstep(",
      "    rect.x - uContentFeather.x,",
      "    rect.x + uContentFeather.x,",
      "    point.x",
      "  );",
      "  x *= 1.0 - smoothstep(",
      "    rect.z - uContentFeather.x,",
      "    rect.z + uContentFeather.x,",
      "    point.x",
      "  );",
      "  float y = smoothstep(",
      "    rect.y - uContentFeather.y,",
      "    rect.y + uContentFeather.y,",
      "    point.y",
      "  );",
      "  y *= 1.0 - smoothstep(",
      "    rect.w - uContentFeather.y,",
      "    rect.w + uContentFeather.y,",
      "    point.y",
      "  );",
      "  return x * y;",
      "}",
      "void main() {",
      "  vec2 uv = gl_PointCoord - vec2(0.5);",
      "  float c = cos(vRot);",
      "  float s = sin(vRot);",
      "  uv = mat2(c, -s, s, c) * uv + vec2(0.5);",
      // Rotated UVs may leave the tile — never sample the neighbour.
      "  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;",
      "  vec2 atlasUv = vec2((vTile + uv.x) / uTiles, uv.y);",
      "  vec4 tex = texture2D(uAtlas, atlasUv);",
      "  float twinkle =",
      "    0.94 + 0.06 * sin(uTime * (0.72 + mod(vPhase, 1.31)) + vPhase);",
      "  float variability =",
      "    1.0 + vPulse * 3.2;",
      "  vec2 centered = uv - vec2(0.5);",
      "  float radius = length(centered);",
      "  float angle = atan(centered.y, centered.x);",
      "  float flowTime = uTime * (0.25 + vEffect2.w);",
      "  float turbulence =",
      "    sin(angle * 7.0 + flowTime * 1.4 + vPhase) * 0.3 +",
      "    sin(angle * 13.0 - flowTime * 0.82 - vPhase) * 0.18 +",
      "    sin(radius * 42.0 - flowTime * 2.4 + vPhase) * 0.16;",
      "  float coronaMask =",
      "    smoothstep(0.08, 0.3, radius) *",
      "    (1.0 - smoothstep(0.3, 0.7, radius));",
      "  float corona = max(",
      "    0.42,",
      "    1.0 + vEffect.z * coronaMask * turbulence * 1.65",
      "  );",
      "  float alpha = tex.a * vAlpha * twinkle *",
      "    (variability + vFlare * 0.75) * corona;",
      "  float haloEdge = 1.0 - smoothstep(0.36, 0.49, radius);",
      "  alpha *= mix(haloEdge, 1.0, step(0.5, uLayerKind));",
      "  float contentMask = max(",
      "    rectMask(vScreenUv, uContentRect0),",
      "    max(",
      "      rectMask(vScreenUv, uContentRect1),",
      "      rectMask(vScreenUv, uContentRect2)",
      "    )",
      "  );",
      "  alpha *= mix(1.0, uContentExposure, contentMask);",
      "  alpha *= uPortalBrightness;",
      "  if (alpha < 0.004) discard;",
      "  vec3 emitted = tex.rgb * vColor * (0.94 + tex.a * 0.16);",
      "  emitted += vec3(0.08, 0.19, 0.34) *",
      "    max(0.0, turbulence) * coronaMask * vEffect.z * 1.8;",
      "  float temperatureWave =",
      "    sin(uTime * (0.55 + vEffect2.y) + vPhase * 1.91) *",
      "      vEffect2.z + vFlare * vEffect2.z * 0.9;",
      "  emitted += vec3(",
      "    -temperatureWave * 0.1,",
      "    abs(temperatureWave) * 0.07,",
      "    temperatureWave * 0.3",
      "  );",
      "  emitted += vec3(0.24, 0.18, 0.12) * vFlare * tex.a;",
      "  emitted = max(emitted, vec3(0.0));",
      "  gl_FragColor = vec4(emitted, alpha);",
      "}"
    ].join("\n");

    function createPointLayer(
      count,
      maxCssSize,
      contentExposure = CONTENT_EXPOSURE,
      layerKind = 0
    ) {
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
      geometry.setAttribute(
        "aPhase",
        new THREE.BufferAttribute(new Float32Array(count), 1)
      );
      geometry.setAttribute(
        "aEffect",
        new THREE.BufferAttribute(new Float32Array(count * 4), 4)
      );
      geometry.setAttribute(
        "aEffect2",
        new THREE.BufferAttribute(new Float32Array(count * 4), 4)
      );
      geometry.setAttribute(
        "aColor",
        new THREE.BufferAttribute(new Float32Array(count * 3), 3)
      );
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uAtlas: { value: atlasTexture },
          uTiles: { value: usedTierIds.length * 2 },
          uScale: { value: 1 },
          uPixelRatio: { value: 1 },
          uMinDepth: { value: pointMinDepth },
          uMaxCssSize: { value: maxCssSize },
          uSoftKneeRatio: {
            value:
              strategy.camera === "flat" ? 1 : POINT_SIZE_SOFT_KNEE
          },
          uPortalScale: { value: 1 },
          uLayerKind: { value: layerKind },
          uContentRect0: {
            value: new Float32Array([-2, -2, -2, -2])
          },
          uContentRect1: {
            value: new Float32Array([-2, -2, -2, -2])
          },
          uContentRect2: {
            value: new Float32Array([-2, -2, -2, -2])
          },
          uContentFeather: {
            value: new Float32Array([0.04, 0.04])
          },
          uContentExposure: { value: contentExposure },
          uPortalBrightness: { value: 1 },
          uTime: { value: 0 },
          uScreenOffset: {
            value: new Float32Array([0, 0])
          }
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

    function createBackgroundStarLayer() {
      const fieldCount =
        strategy.camera === "flat" ? 0 : backgroundFieldCount;
      const dustCount =
        strategy.camera === "flat" ? 0 : backgroundDustCount;
      const clusterCount =
        strategy.camera === "flat" ? 0 : backgroundClusterCount;
      const streamCount =
        strategy.camera === "flat" ? 0 : backgroundStreamCount;
      const nebulaCount =
        strategy.camera === "flat" ? 0 : backgroundNebulaCount;
      const count =
        fieldCount +
        dustCount +
        clusterCount +
        streamCount +
        nebulaCount;
      const clusterEnd = dustCount + clusterCount;
      const streamEnd = clusterEnd + streamCount;
      const nebulaEnd = streamEnd + nebulaCount;
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      const sizes = new Float32Array(count);
      const alphas = new Float32Array(count);
      const phases = new Float32Array(count);
      const dustWeights = new Float32Array(count);
      const structures = new Float32Array(count);
      const motions = new Float32Array(count * 4);
      const colors = new Float32Array(count * 3);
      const backgroundRandom = seededRandom(
        hashSeed(`${sourceGraph.revision}:background-stars-3d`)
      );
      const clusterCenters = [
        [-920, 280, -620],
        [840, 350, -760],
        [-720, -300, 780],
        [920, -240, 610]
      ];
      const nebulaCenters = [
        [-980, -120, 360],
        [170, 430, -920],
        [960, 80, 420]
      ];
      const centeredNoise = () => {
        return (
          backgroundRandom() +
          backgroundRandom() +
          backgroundRandom() -
          1.5
        );
      };
      for (let index = 0; index < count; index += 1) {
        const dust = index < dustCount;
        const cluster = index >= dustCount && index < clusterEnd;
        const stream = index >= clusterEnd && index < streamEnd;
        const nebula = index >= streamEnd && index < nebulaEnd;
        let x;
        let y;
        let z;
        if (dust) {
          const radius =
            620 + 1260 * Math.pow(backgroundRandom(), 0.72);
          const theta = backgroundRandom() * Math.PI * 2;
          x = Math.cos(theta) * radius;
          y = centeredNoise() * 112;
          z = Math.sin(theta) * radius;
          const tiltZ = 0.42;
          const tiltX = -0.28;
          const tiltedX = x * Math.cos(tiltZ) - y * Math.sin(tiltZ);
          const tiltedY = x * Math.sin(tiltZ) + y * Math.cos(tiltZ);
          x = tiltedX;
          y = tiltedY * Math.cos(tiltX) - z * Math.sin(tiltX);
          z = tiltedY * Math.sin(tiltX) + z * Math.cos(tiltX);
          sizes[index] =
            0.72 + Math.pow(backgroundRandom(), 2.5) * 3.1;
          alphas[index] =
            0.055 + Math.pow(backgroundRandom(), 1.55) * 0.2;
          structures[index] = 1;
          motions[index * 4 + 3] =
            (0.0024 + backgroundRandom() * 0.0018) *
            (backgroundRandom() < 0.5 ? -1 : 1);
        } else if (cluster) {
          const localIndex = index - dustCount;
          const clusterId = localIndex % clusterCenters.length;
          const center = clusterCenters[clusterId];
          const radius = 24 + 150 * Math.cbrt(backgroundRandom());
          const theta = backgroundRandom() * Math.PI * 2;
          const cosPhi = backgroundRandom() * 2 - 1;
          const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
          x = center[0] + radius * sinPhi * Math.cos(theta);
          y = center[1] + radius * cosPhi * 0.74;
          z = center[2] + radius * sinPhi * Math.sin(theta);
          sizes[index] =
            0.8 + Math.pow(backgroundRandom(), 2.2) * 4.4;
          alphas[index] =
            0.12 + Math.pow(backgroundRandom(), 1.4) * 0.34;
          structures[index] = 2;
          motions.set(
            [
              center[0],
              center[1],
              center[2],
              (0.014 + clusterId * 0.002) *
                (clusterId % 2 ? -1 : 1)
            ],
            index * 4
          );
        } else if (stream) {
          const localIndex = index - clusterEnd;
          const streamId = localIndex % 2;
          const t = backgroundRandom() * 2 - 1;
          const thickness = centeredNoise() * 42;
          x = t * 1650 + thickness * 0.4;
          if (streamId === 0) {
            y = Math.sin(t * Math.PI * 1.45) * 330 + thickness;
            z = Math.cos(t * Math.PI * 0.8) * 520 +
              centeredNoise() * 55;
          } else {
            y = Math.cos(t * Math.PI * 1.2) * 270 + thickness;
            z = Math.sin(t * Math.PI * 0.95) * 610 +
              centeredNoise() * 55;
          }
          sizes[index] =
            0.7 + Math.pow(backgroundRandom(), 2.3) * 3.4;
          alphas[index] =
            0.08 + Math.pow(backgroundRandom(), 1.5) * 0.26;
          structures[index] = 3;
          motions[index * 4 + 3] =
            0.1 + backgroundRandom() * 0.08;
        } else if (nebula) {
          const localIndex = index - streamEnd;
          const nebulaId = localIndex % nebulaCenters.length;
          const center = nebulaCenters[nebulaId];
          x = center[0] + centeredNoise() * 240;
          y = center[1] + centeredNoise() * 145;
          z = center[2] + centeredNoise() * 210;
          sizes[index] =
            1.4 + Math.pow(backgroundRandom(), 1.8) * 6.8;
          alphas[index] =
            0.035 + Math.pow(backgroundRandom(), 1.7) * 0.12;
          structures[index] = 4;
          motions.set(
            [
              center[0],
              center[1],
              center[2],
              0.11 + nebulaId * 0.025
            ],
            index * 4
          );
        } else {
          const radius = 1550 + backgroundRandom() * 520;
          const theta = backgroundRandom() * Math.PI * 2;
          const cosPhi = backgroundRandom() * 2 - 1;
          const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
          x = radius * sinPhi * Math.cos(theta);
          y = radius * cosPhi;
          z = radius * sinPhi * Math.sin(theta);
          sizes[index] =
            0.9 + Math.pow(backgroundRandom(), 2.55) * 6.2;
          alphas[index] =
            0.1 + Math.pow(backgroundRandom(), 1.5) * 0.38;
        }
        positions[index * 3] = x;
        positions[index * 3 + 1] = y;
        positions[index * 3 + 2] = z;
        phases[index] = backgroundRandom() * Math.PI * 2;
        dustWeights[index] = dust ? 1 : 0;
        const temperature = backgroundRandom();
        const color = nebula
          ? nebulaCenters[(index - streamEnd) % nebulaCenters.length][0] < 0
            ? [0.55, 0.82, 1]
            : [1, 0.62, 0.78]
          : stream
            ? temperature < 0.5
              ? [0.52, 0.94, 0.9]
              : [1, 0.78, 0.46]
            : cluster
              ? [0.72, 0.88, 1]
              : temperature < 0.22
                ? [1, 0.72 + temperature * 0.45, 0.58]
                : temperature > 0.68
                  ? [0.58, 0.78 + (1 - temperature) * 0.35, 1]
                  : [0.82, 0.93, 0.91];
        colors.set(color, index * 3);
      }
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3)
      );
      geometry.setAttribute(
        "aSize",
        new THREE.BufferAttribute(sizes, 1)
      );
      geometry.setAttribute(
        "aAlpha",
        new THREE.BufferAttribute(alphas, 1)
      );
      geometry.setAttribute(
        "aPhase",
        new THREE.BufferAttribute(phases, 1)
      );
      geometry.setAttribute(
        "aDust",
        new THREE.BufferAttribute(dustWeights, 1)
      );
      geometry.setAttribute(
        "aStructure",
        new THREE.BufferAttribute(structures, 1)
      );
      geometry.setAttribute(
        "aMotion",
        new THREE.BufferAttribute(motions, 4)
      );
      geometry.setAttribute(
        "aColor",
        new THREE.BufferAttribute(colors, 3)
      );
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uScale: { value: 1 },
          uPixelRatio: { value: 1 },
          uOpacity: { value: 1 },
          uTime: { value: 0 },
          uBrightness: { value: backgroundBrightness },
          uDustBrightness: { value: dustBrightness },
          uSizeScale: { value: backgroundSizeScale },
          uMotionScale: { value: backgroundStructureMotion }
        },
        vertexShader: [
          "attribute float aSize;",
          "attribute float aAlpha;",
          "attribute float aPhase;",
          "attribute float aDust;",
          "attribute float aStructure;",
          "attribute vec4 aMotion;",
          "attribute vec3 aColor;",
          "varying float vAlpha;",
          "varying float vSparkle;",
          "varying float vDust;",
          "varying float vStructure;",
          "varying vec3 vColor;",
          "uniform float uScale;",
          "uniform float uPixelRatio;",
          "uniform float uSizeScale;",
          "uniform float uMotionScale;",
          "uniform float uTime;",
          "void main() {",
          "  float pulse = 0.78 + 0.22 * sin(",
          "    uTime * (0.38 + fract(aPhase) * 0.62) + aPhase",
          "  );",
          "  vAlpha = aAlpha * pulse;",
          "  vSparkle = smoothstep(2.25, 4.1, aSize);",
          "  vDust = aDust;",
          "  vStructure = aStructure;",
          "  vColor = aColor;",
          "  vec3 animatedPosition = position;",
          "  if (aStructure > 0.5 && aStructure < 1.5) {",
          "    float angle = uTime * aMotion.w * uMotionScale;",
          "    float c = cos(angle);",
          "    float s = sin(angle);",
          "    animatedPosition.xz = mat2(c, -s, s, c) * position.xz;",
          "  } else if (aStructure > 1.5 && aStructure < 2.5) {",
          "    vec3 relative = position - aMotion.xyz;",
          "    float angle = uTime * aMotion.w * uMotionScale;",
          "    float c = cos(angle);",
          "    float s = sin(angle);",
          "    relative.xz = mat2(c, -s, s, c) * relative.xz;",
          "    animatedPosition = aMotion.xyz + relative;",
          "    animatedPosition.y += sin(uTime * 0.18 + aPhase) *",
          "      4.0 * uMotionScale;",
          "  } else if (aStructure > 2.5 && aStructure < 3.5) {",
          "    animatedPosition.y += sin(",
          "      uTime * aMotion.w + aPhase + position.x * 0.002",
          "    ) * 18.0 * uMotionScale;",
          "    animatedPosition.z += cos(",
          "      uTime * aMotion.w * 0.7 + aPhase",
          "    ) * 9.0 * uMotionScale;",
          "  } else if (aStructure > 3.5) {",
          "    vec3 relative = position - aMotion.xyz;",
          "    float breathing = 1.0 + sin(",
          "      uTime * aMotion.w + aPhase",
          "    ) * 0.045 * uMotionScale;",
          "    animatedPosition = aMotion.xyz + relative * breathing;",
          "  }",
          "  vec4 mvPosition =",
          "    modelViewMatrix * vec4(animatedPosition, 1.0);",
          "  float projected =",
          "    aSize * uSizeScale * (uScale / max(-mvPosition.z, 500.0));",
          "  float structureSize = aStructure > 3.5",
          "    ? 4.6",
          "    : (aStructure > 2.5 ? 1.6 : (aStructure > 1.5 ? 1.25 : 1.0));",
          "  projected *= max(mix(1.0, 3.2, aDust), structureSize);",
          "  gl_PointSize = clamp(",
          "    projected,",
          "    0.65 * uPixelRatio,",
          "    max(mix(6.4, 18.0, aDust), structureSize * 5.0) * uPixelRatio",
          "  );",
          "  gl_Position = projectionMatrix * mvPosition;",
          "}"
        ].join("\n"),
        fragmentShader: [
          "varying float vAlpha;",
          "varying float vSparkle;",
          "varying float vDust;",
          "varying float vStructure;",
          "varying vec3 vColor;",
          "uniform float uOpacity;",
          "uniform float uBrightness;",
          "uniform float uDustBrightness;",
          "void main() {",
          "  vec2 offset = gl_PointCoord - vec2(0.5);",
          "  float radius = length(offset);",
          "  if (radius > 0.5) discard;",
          "  float core = exp(-radius * radius * 26.0);",
          "  float rayX = pow(max(0.0, 1.0 - abs(offset.x) * 28.0), 3.0)",
          "    * exp(-abs(offset.y) * 6.0);",
          "  float rayY = pow(max(0.0, 1.0 - abs(offset.y) * 28.0), 3.0)",
          "    * exp(-abs(offset.x) * 6.0);",
          "  float falloff = max(core, (rayX + rayY) * 0.24 * vSparkle);",
          "  float dustFalloff = exp(-radius * radius * 7.0) * 0.2;",
          "  falloff = mix(falloff, max(core * 0.55, dustFalloff), vDust);",
          "  float clusterMask =",
          "    step(1.5, vStructure) * (1.0 - step(2.5, vStructure));",
          "  float streamMask =",
          "    step(2.5, vStructure) * (1.0 - step(3.5, vStructure));",
          "  float nebulaMask = step(3.5, vStructure);",
          "  float streamFalloff = exp(-radius * radius * 14.0) * 0.38;",
          "  float nebulaFalloff = exp(-radius * radius * 5.5) * 0.16;",
          "  falloff = mix(falloff, max(core, falloff * 1.35), clusterMask);",
          "  falloff = mix(falloff, streamFalloff, streamMask);",
          "  falloff = mix(falloff, nebulaFalloff, nebulaMask);",
          "  float exposure = mix(uBrightness, uDustBrightness, vDust);",
          "  exposure *= 1.0 + clusterMask * 0.35 +",
          "    streamMask * 0.25 + nebulaMask * 0.5;",
          "  float alpha = falloff * vAlpha * uOpacity * exposure;",
          "  if (alpha < 0.003) discard;",
          "  gl_FragColor = vec4(vColor, alpha);",
          "}"
        ].join("\n"),
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      points.renderOrder = -2;
      points.userData.fieldCount = fieldCount;
      points.userData.dustCount = dustCount;
      points.userData.clusterCount = clusterCount;
      points.userData.streamCount = streamCount;
      points.userData.nebulaCount = nebulaCount;
      return points;
    }

    const backgroundLayer = createBackgroundStarLayer();
    const haloLayer = createPointLayer(
      stars.length,
      pointMaxCssSize.halo,
      CONTENT_EXPOSURE,
      0
    );
    haloLayer.renderOrder = 1;
    // Solid-ish core dots. The Canvas 2D map always draws a bright core,
    // so without this layer dim stars are almost invisible in WebGL.
    const coreLayer = createPointLayer(
      stars.length,
      pointMaxCssSize.core,
      CONTENT_EXPOSURE,
      1
    );
    coreLayer.renderOrder = 2;
    const spikeCandidates = stars.filter((star) => {
      return tierProfile(star.brightnessTier).spikeGain > 0;
    });
    const primarySpikedStars = spikeCandidates.filter((star) => {
      return (
        tierProfile(star.brightnessTier).variabilityAmplitude >= 0.02
      );
    });
    const secondarySpikeLimit = Math.max(
      1,
      Math.ceil(stars.length * SECONDARY_SPIKE_FRACTION)
    );
    const secondarySpikedStars = spikeCandidates
      .filter((star) => {
        return (
          tierProfile(star.brightnessTier).variabilityAmplitude < 0.02
        );
      })
      .sort((left, right) => {
        return (
          right.baseBrightness - left.baseBrightness ||
          left.index - right.index
        );
      })
      .slice(0, secondarySpikeLimit);
    const spikedStars = [
      ...primarySpikedStars,
      ...secondarySpikedStars
    ].sort((left, right) => left.index - right.index);
    const spikeLayer = createPointLayer(
      spikedStars.length,
      pointMaxCssSize.spike,
      CONTENT_EXPOSURE,
      2
    );
    function assignPointEffects(layer, sourceStars) {
      const phases = layer.geometry.attributes.aPhase;
      const effects = layer.geometry.attributes.aEffect;
      const secondaryEffects = layer.geometry.attributes.aEffect2;
      sourceStars.forEach((star, index) => {
        const profile = tierProfile(star.brightnessTier);
        phases.setX(
          index,
          ((star.index + 1) * 2.399963229728653) %
            (Math.PI * 2)
        );
        effects.setXYZW(
          index,
          profile.variabilityAmplitude,
          profile.variabilitySpeed,
          profile.coronaStrength,
          profile.rotationSpeed
        );
        secondaryEffects.setXYZW(
          index,
          profile.flareStrength,
          profile.flareSpeed,
          profile.temperatureShift,
          profile.surfaceFlowSpeed
        );
      });
      phases.needsUpdate = true;
      effects.needsUpdate = true;
      secondaryEffects.needsUpdate = true;
    }
    assignPointEffects(haloLayer, stars);
    assignPointEffects(coreLayer, stars);
    assignPointEffects(spikeLayer, spikedStars);
    spikeLayer.renderOrder = 3;
    scene.add(backgroundLayer);
    scene.add(haloLayer);
    scene.add(coreLayer);
    scene.add(spikeLayer);

    // Relations are projected onto a Canvas 2D layer below the WebGL stars.
    // This preserves relation-type colors and directional details without
    // adding WebGL draw calls.
    const visibility = runtimeSettings.home_star_relation_visibility;
    const NEAR_LIMIT = 170;
    const PROXIMITY_LIMIT = 120;
    const PROXIMITY_MAX = 260;
    let highlightEdges = [];
    const relationProjectionCache = new Map();

    const panel = host.createCoveragePanel();
    const label = host.createLabel();
    const hoverLabel = host.createHoverLabel();
    let width = 1;
    let height = 1;
    let frame = 0;
    let disposed = false;
    let selectedRoot = "";
    let selectedIds = new Set();
    let selectedTier = null;
    let activeRelationPlan = null;
    let activeVisualEdgeIds = new Set();
    let activeNodeDepths = new Map();
    let labelStar = null;
    let labelExpiresAt = 0;
    let labelTimer = 0;
    let selectionTimer = 0;
    let hoverStar = null;
    let hoverSelectedIds = new Set();
    let hoverRelationPlan = null;
    let hoverVisualEdgeIds = new Set();
    let hoverNodeDepths = new Map();
    let hoverHighlightEdges = [];
    let lastFrameAt = 0;
    let contentMaskFrame = 0;
    const portalState = {
      enabled: portalExperience && Boolean(portalElement),
      phase: portalExperience ? "collapsed" : "expanded",
      progress: portalExperience ? 0 : 1,
      startedAt: 0,
      yaw: 0.64,
      pitch: -0.36,
      rotationAt: 0,
      dragging: false,
      moved: 0,
      x: 0,
      y: 0,
      scrollY: 0,
      rectangle: null,
      heroRectangle: null,
      heroContentRectangle: null,
      screenOffset: [0, 0],
      reason: ""
    };
    const expandedStructures = WEBGL_MODES.filter(
      (item) => item !== "2d-webgl"
    );
    const structureTransition = {
      active: false,
      source: activeStructure,
      target: activeStructure,
      startedAt: 0,
      duration: STRUCTURE_TRANSITION_DURATION,
      progress: 1,
      from: null
    };
    const contentMaskMaterials = [
      haloLayer.material,
      coreLayer.material,
      spikeLayer.material
    ];
    const portalPhases = [
      "collapsed",
      "opening",
      "expanded",
      "closing"
    ];

    function setPortalPhase(phase, reason) {
      if (!portalPhases.includes(phase)) return;
      portalState.phase = phase;
      portalState.reason = reason || portalState.reason || "";
      if (phase !== "expanded") {
        setHoverStar(null, performance.now());
      }
      document.body.classList.toggle(
        "home-contribution-space-opening",
        phase === "opening"
      );
      document.body.classList.toggle(
        "home-contribution-space-expanded",
        phase === "expanded"
      );
      document.body.classList.toggle(
        "home-contribution-space-closing",
        phase === "closing"
      );
      document.body.dataset.contributionSpaceState = phase;
      glCanvas.dataset.contributionSpaceState = phase;
      updateStructureControl();
      window.dispatchEvent(
        new CustomEvent("gck:contribution-space-state", {
          detail: {
            phase,
            reason: portalState.reason
          }
        })
      );
    }

    function portalTransitioning() {
      return (
        portalState.phase === "opening" ||
        portalState.phase === "closing"
      );
    }

    function easePortal(value) {
      const progress = Math.max(0, Math.min(1, value));
      return progress * progress * (3 - 2 * progress);
    }

    function updateStructureControl() {
      if (!structureSelect) return;
      structureSelect.value = activeStructure;
      structureSelect.disabled =
        portalState.phase !== "expanded" ||
        structureTransition.active;
      structureControl?.toggleAttribute(
        "data-transitioning",
        structureTransition.active
      );
    }

    function finishStructureTransition() {
      structureTransition.active = false;
      structureTransition.progress = 1;
      structureTransition.from = null;
      glCanvas.dataset.structureTransition = "idle";
      glCanvas.dataset.structureTransitionProgress = "1.000";
      updateStructureControl();
      window.dispatchEvent(
        new CustomEvent("gck:star-structure-change", {
          detail: {
            phase: "complete",
            source: structureTransition.source,
            structure: activeStructure
          }
        })
      );
    }

    function setExpandedStructure(nextStructure, options = {}) {
      if (
        !portalState.enabled ||
        portalState.phase !== "expanded" ||
        !expandedStructures.includes(nextStructure) ||
        (
          nextStructure === activeStructure &&
          !structureTransition.active
        )
      ) {
        updateStructureControl();
        return false;
      }
      const now = Number.isFinite(options.time)
        ? options.time
        : performance.now();
      const from = new Float32Array(stars.length * 3);
      for (let index = 0; index < stars.length; index += 1) {
        const star = stars[index];
        const offset = index * 3;
        from[offset] = star.x;
        from[offset + 1] = star.y;
        from[offset + 2] = star.z;
      }

      const previousStructure = activeStructure;
      const nextStrategy = (
        STRATEGIES[nextStructure] || depthStrategy
      )();
      const nextRandom = seededRandom(
        hashSeed(
          `${sourceGraph.revision}:expanded-structure:${nextStructure}`
        )
      );
      nextStrategy.init(stars, {
        random: nextRandom,
        edges,
        starById
      });
      if (nextStrategy.camera === "flat") {
        nextStrategy.fit(stars, { width, height });
      }
      nextStrategy.move(stars, 0, now);

      activeStructure = nextStructure;
      strategy = nextStrategy;
      structureTransition.source = previousStructure;
      structureTransition.target = nextStructure;
      structureTransition.startedAt = now;
      structureTransition.progress = 0;
      structureTransition.from = from;
      structureTransition.active =
        !reducedMotion && options.immediate !== true;
      glCanvas.dataset.starMap = `contribution-${activeStructure}`;
      glCanvas.dataset.starStructure = activeStructure;
      glCanvas.dataset.structureTransition = structureTransition.active
        ? "active"
        : "idle";
      glCanvas.dataset.structureTransitionProgress =
        structureTransition.active ? "0.000" : "1.000";

      if (structureTransition.active) {
        for (let index = 0; index < stars.length; index += 1) {
          const star = stars[index];
          const offset = index * 3;
          star.x = from[offset];
          star.y = from[offset + 1];
          star.z = from[offset + 2];
        }
        updateStructureControl();
        window.dispatchEvent(
          new CustomEvent("gck:star-structure-change", {
            detail: {
              phase: "start",
              source: previousStructure,
              structure: activeStructure
            }
          })
        );
      } else {
        finishStructureTransition();
      }
      return true;
    }

    function updateStructureTransition(time, delta) {
      strategy.move(stars, delta, time);
      if (!structureTransition.active) return;
      const progress = Math.max(
        0,
        Math.min(
          1,
          (time - structureTransition.startedAt) /
            structureTransition.duration
        )
      );
      const from = structureTransition.from;
      for (let index = 0; index < stars.length; index += 1) {
        const star = stars[index];
        const offset = index * 3;
        const targetX = star.x;
        const targetY = star.y;
        const targetZ = star.z;
        star.x = from[offset] + (targetX - from[offset]) * progress;
        star.y =
          from[offset + 1] +
          (targetY - from[offset + 1]) * progress;
        star.z =
          from[offset + 2] +
          (targetZ - from[offset + 2]) * progress;
      }
      structureTransition.progress = progress;
      glCanvas.dataset.structureTransitionProgress =
        progress.toFixed(3);
      if (progress >= 1) finishStructureTransition();
    }

    function updatePortalRotation(time) {
      if (!portalState.enabled) return;
      if (!portalState.rotationAt) {
        portalState.rotationAt = time;
        return;
      }
      const elapsed = Math.max(
        0,
        Math.min(100, time - portalState.rotationAt)
      );
      portalState.rotationAt = time;
      if (!portalState.dragging && !reducedMotion) {
        portalState.yaw +=
          elapsed * portalRotationRadiansPerMs;
      }
    }

    function portalDisplayPosition(star, time) {
      const autoPitch =
        portalState.pitch +
        (reducedMotion ? 0 : Math.sin(time * 0.00012) * 0.045);
      const cosYaw = Math.cos(portalState.yaw);
      const sinYaw = Math.sin(portalState.yaw);
      const cosPitch = Math.cos(autoPitch);
      const sinPitch = Math.sin(autoPitch);
      const yawX = star.portalX * cosYaw - star.portalZ * sinYaw;
      const yawZ = star.portalX * sinYaw + star.portalZ * cosYaw;
      return {
        x: yawX,
        y: star.portalY * cosPitch - yawZ * sinPitch,
        z: star.portalY * sinPitch + yawZ * cosPitch
      };
    }

    const portalLayoutCache = new Map();
    function portalStrategyLayout(structure) {
      if (portalLayoutCache.has(structure)) {
        return portalLayoutCache.get(structure);
      }
      const snapshotStars = stars.map((star) => ({
        id: star.id,
        kind: star.kind,
        baseBrightness: star.baseBrightness,
        index: star.index,
        metrics: { ...(star.metrics || {}) },
        x: 0,
        y: 0,
        z: 0
      }));
      const snapshotById = new Map(
        snapshotStars.map((star) => [star.id, star])
      );
      const snapshotStrategy = (
        STRATEGIES[structure] || depthStrategy
      )();
      const snapshotRandom = seededRandom(
        hashSeed(
          `${sourceGraph.revision}:portal-structure:${structure}`
        )
      );
      snapshotStrategy.init(snapshotStars, {
        random: snapshotRandom,
        edges,
        starById: snapshotById
      });
      snapshotStrategy.move(snapshotStars, 16, 0);
      snapshotStrategy.move(snapshotStars, 16, 16);
      let maximum = 1;
      for (const star of snapshotStars) {
        maximum = Math.max(
          maximum,
          Math.hypot(star.x || 0, star.y || 0, star.z || 0)
        );
      }
      const scale = CONTRIBUTION_SPACE_RADIUS * 0.94 / maximum;
      const positions = new Map(
        snapshotStars.map((star) => [
          star.id,
          {
            x: (star.x || 0) * scale,
            y: (star.y || 0) * scale,
            z: (star.z || 0) * scale
          }
        ])
      );
      portalLayoutCache.set(structure, positions);
      return positions;
    }

    function updatePortalTargets() {
      if (!portalState.enabled) return;
      const independentLayout = WEBGL_MODES.includes(
        portalCollapsedStructure
      )
        ? portalStrategyLayout(portalCollapsedStructure)
        : null;
      let maxRadius = 1;
      for (const star of stars) {
        star.expandedX = star.x;
        star.expandedY = star.y;
        star.expandedZ = star.z;
        maxRadius = Math.max(
          maxRadius,
          Math.hypot(star.x, star.y, star.z)
        );
      }
      for (const star of stars) {
        const independent = independentLayout?.get(star.id);
        if (independent) {
          star.portalX = independent.x;
          star.portalY = independent.y;
          star.portalZ = independent.z;
          continue;
        }
        const radius = Math.hypot(star.x, star.y, star.z);
        if (radius < 0.0001) {
          star.portalX = 0;
          star.portalY = 0;
          star.portalZ = 0;
          continue;
        }
        const directionX = star.x / radius;
        const directionY = star.y / radius;
        const directionZ = star.z / radius;
        const fraction = Math.max(0, Math.min(1, radius / maxRadius));
        let targetRadius = CONTRIBUTION_SPACE_RADIUS * fraction;
        if (portalCollapsedStructure === "sphere") {
          targetRadius =
            CONTRIBUTION_SPACE_RADIUS *
            (0.28 + Math.sqrt(fraction) * 0.72);
        } else if (portalCollapsedStructure === "octahedron") {
          const boundary =
            CONTRIBUTION_SPACE_RADIUS /
            Math.max(
              0.0001,
              Math.abs(directionX) +
                Math.abs(directionY) +
                Math.abs(directionZ)
            );
          targetRadius =
            boundary * (0.18 + Math.sqrt(fraction) * 0.82);
        } else if (portalCollapsedStructure === "cube") {
          const boundary =
            CONTRIBUTION_SPACE_RADIUS /
            Math.max(
              0.0001,
              Math.abs(directionX),
              Math.abs(directionY),
              Math.abs(directionZ)
            );
          targetRadius =
            boundary * (0.18 + Math.sqrt(fraction) * 0.82);
        }
        star.portalX = directionX * targetRadius;
        star.portalY = directionY * targetRadius;
        star.portalZ = directionZ * targetRadius;
      }
    }

    function updatePortalProgress(time) {
      if (!portalState.enabled) return 1;
      if (
        portalState.phase !== "opening" &&
        portalState.phase !== "closing"
      ) {
        return portalState.progress;
      }
      const raw = Math.max(
        0,
        Math.min(
          1,
          (time - portalState.startedAt) /
            CONTRIBUTION_SPACE_DURATION
        )
      );
      portalState.progress =
        portalState.phase === "opening" ? raw : 1 - raw;
      if (raw < 1) return portalState.progress;
      if (portalState.phase === "opening") {
        portalState.progress = 1;
        setPortalPhase("expanded");
      } else {
        portalState.progress = 0;
        setPortalPhase("collapsed");
        window.scrollTo(0, portalState.scrollY);
      }
      return portalState.progress;
    }

    function updatePortalStarPositions(time) {
      updatePortalRotation(time);
      const rawProgress = updatePortalProgress(time);
      if (!portalState.enabled || rawProgress >= 1) return;
      updatePortalTargets();
      const progress = easePortal(rawProgress);
      for (const star of stars) {
        const fullX = star.x;
        const fullY = star.y;
        const fullZ = star.z;
        const portal = portalDisplayPosition(star, time);
        star.x = portal.x + (fullX - portal.x) * progress;
        star.y = portal.y + (fullY - portal.y) * progress;
        star.z = portal.z + (fullZ - portal.z) * progress;
      }
    }

    function measurePortal() {
      if (!portalState.enabled) return;
      const rectangle = portalElement.getBoundingClientRect();
      const heroRectangle = hero.getBoundingClientRect();
      const heroContentRectangle =
        heroContent?.getBoundingClientRect();
      const valid =
        rectangle.width > 1 &&
        rectangle.height > 1;
      portalState.rectangle = valid
        ? {
            left: rectangle.left,
            top: rectangle.top,
            right: rectangle.right,
            bottom: rectangle.bottom,
            width: rectangle.width,
            height: rectangle.height
          }
        : null;
      portalState.heroRectangle =
        heroRectangle.width > 1 && heroRectangle.height > 1
          ? {
              top: heroRectangle.top,
              bottom: heroRectangle.bottom
            }
          : null;
      portalState.heroContentRectangle =
        heroContentRectangle?.width > 1 &&
        heroContentRectangle?.height > 1
          ? {
              left: heroContentRectangle.left,
              top: heroContentRectangle.top,
              right: heroContentRectangle.right,
              bottom: heroContentRectangle.bottom,
              width: heroContentRectangle.width,
              height: heroContentRectangle.height
            }
          : null;
      if (valid) {
        const style = document.documentElement.style;
        style.setProperty(
          "--contribution-space-top",
          `${Math.max(0, rectangle.top)}px`
        );
        style.setProperty(
          "--contribution-space-right",
          `${Math.max(0, window.innerWidth - rectangle.right)}px`
        );
        style.setProperty(
          "--contribution-space-bottom",
          `${Math.max(0, window.innerHeight - rectangle.bottom)}px`
        );
        style.setProperty(
          "--contribution-space-left",
          `${Math.max(0, rectangle.left)}px`
        );
      }
    }

    function contributionSpaceClip(progress) {
      const rectangle = portalState.rectangle;
      const heroRectangle = portalState.heroRectangle;
      if (!rectangle || !heroRectangle) {
        return {
          clip: progress >= 1 ? "inset(0)" : "",
          expansion: null
        };
      }
      const eased = easePortal(progress);
      const left = Math.max(
        0,
        Math.min(
          width,
          rectangle.left * (1 - eased)
        )
      );
      const top = Math.max(
        0,
        Math.min(
          height,
          rectangle.top * (1 - eased)
        )
      );
      const right = Math.max(
        0,
        Math.min(
          width,
          rectangle.right +
            (width - rectangle.right) * eased
        )
      );
      const bottom = Math.max(
        0,
        Math.min(
          height,
          rectangle.bottom +
            (height - rectangle.bottom) * eased
        )
      );
      if (
        right - left < 0.5 ||
        bottom - top < 0.5
      ) {
        return {
          clip: "inset(100%)",
          expansion: null
        };
      }
      const heroTop = Math.max(
        0,
        Math.min(height, heroRectangle.top)
      );
      const heroBottom = Math.max(
        heroTop,
        Math.min(height, heroRectangle.bottom)
      );
      const points = [];
      if (top < heroTop) {
        points.push(
          [left, top],
          [right, top],
          [right, heroTop],
          [width, heroTop]
        );
      } else {
        points.push([0, heroTop], [width, heroTop]);
      }
      points.push([width, heroBottom]);
      if (bottom > heroBottom) {
        points.push(
          [right, heroBottom],
          [right, bottom],
          [left, bottom],
          [left, heroBottom]
        );
      }
      points.push([0, heroBottom]);
      if (top < heroTop) {
        points.push([0, heroTop], [left, heroTop]);
      }
      return {
        clip: `polygon(${points
          .map(([x, y]) => `${x.toFixed(2)}px ${y.toFixed(2)}px`)
          .join(", ")})`,
        expansion: { left, top, right, bottom }
      };
    }

    function updateHeroContentCover(expansion) {
      if (!heroContent) return;
      const content = portalState.heroContentRectangle;
      if (
        portalState.phase === "collapsed" ||
        !expansion ||
        expansion.left >= content?.right ||
        expansion.top >= content?.bottom ||
        expansion.right <= content?.left ||
        expansion.bottom <= content?.top
      ) {
        heroContent.style.clipPath = "";
        return;
      }
      const left = Math.max(
        0,
        Math.min(content.width, expansion.left - content.left)
      );
      const top = Math.max(
        0,
        Math.min(content.height, expansion.top - content.top)
      );
      const right = Math.max(
        0,
        Math.min(content.width, expansion.right - content.left)
      );
      const bottom = Math.max(
        0,
        Math.min(content.height, expansion.bottom - content.top)
      );
      if (
        left <= 0 &&
        top <= 0 &&
        right >= content.width &&
        bottom >= content.height
      ) {
        heroContent.style.clipPath = "inset(100%)";
        return;
      }
      heroContent.style.clipPath = [
        "polygon(evenodd, ",
        "0 0, 100% 0, 100% 100%, 0 100%, 0 0, ",
        `${left.toFixed(2)}px ${top.toFixed(2)}px, `,
        `${left.toFixed(2)}px ${bottom.toFixed(2)}px, `,
        `${right.toFixed(2)}px ${bottom.toFixed(2)}px, `,
        `${right.toFixed(2)}px ${top.toFixed(2)}px, `,
        `${left.toFixed(2)}px ${top.toFixed(2)}px)`
      ].join("");
    }

    function updatePortalPresentation() {
      if (!portalState.enabled) return;
      const rectangle = portalState.rectangle;
      const valid = Boolean(rectangle);
      const centerX = valid
        ? (rectangle.left + rectangle.right) / 2
        : window.innerWidth / 2;
      const centerY = valid
        ? (rectangle.top + rectangle.bottom) / 2
        : window.innerHeight / 2;
      const collapsed = 1 - easePortal(portalState.progress);
      const offset = [
        (centerX / width * 2 - 1) * collapsed,
        (1 - centerY / height * 2) * collapsed
      ];
      portalState.screenOffset = offset;
      const portalScale =
        portalCollapsedScale +
        (1 - portalCollapsedScale) *
          easePortal(portalState.progress);
      const portalBrightness =
        portalCollapsedBrightness +
        (1 - portalCollapsedBrightness) *
          easePortal(portalState.progress);
      for (const material of contentMaskMaterials) {
        material.uniforms.uScreenOffset.value.set(offset);
        material.uniforms.uPortalScale.value = portalScale;
        material.uniforms.uPortalBrightness.value =
          portalBrightness;
      }
      const geometry = contributionSpaceClip(portalState.progress);
      if (geometry.clip) {
        glCanvas.style.clipPath = geometry.clip;
        relationCanvas.style.clipPath = geometry.clip;
        portalBackdrop.style.clipPath = geometry.clip;
      }
      updateHeroContentCover(geometry.expansion);
      backgroundLayer.visible = true;
      backgroundLayer.material.uniforms.uOpacity.value =
        portalBrightness;
      relationCanvas.dataset.relationsVisible = String(
        portalState.progress > 0.72
      );
      label.hidden =
        portalState.progress < 0.98 || !labelStar;
      glCanvas.dataset.contributionSpaceState = portalState.phase;
      glCanvas.dataset.contributionSpaceProgress =
        portalState.progress.toFixed(3);
    }

    function openContributionSpace(reason) {
      if (
        !portalState.enabled ||
        portalState.phase === "expanded" ||
        portalState.phase === "opening"
      ) {
        return false;
      }
      const now = performance.now();
      updatePortalProgress(now);
      if (portalState.phase === "expanded") return false;
      if (portalState.phase === "collapsed") {
        portalState.scrollY = window.scrollY;
      }
      portalState.reason =
        typeof reason === "string" ? reason : "manual";
      if (reducedMotion) {
        portalState.progress = 1;
        setPortalPhase("expanded");
        draw(now);
        return true;
      }
      portalState.startedAt =
        now - portalState.progress * CONTRIBUTION_SPACE_DURATION;
      setPortalPhase(
        "opening",
        portalState.reason
      );
      return true;
    }

    function closeContributionSpace(reason) {
      if (
        !portalState.enabled ||
        portalState.phase === "collapsed" ||
        portalState.phase === "closing"
      ) {
        return false;
      }
      const now = performance.now();
      updatePortalProgress(now);
      if (portalState.phase === "collapsed") return false;
      portalState.reason =
        typeof reason === "string" ? reason : "manual";
      clearSelection();
      label.hidden = true;
      if (reducedMotion) {
        portalState.progress = 0;
        setPortalPhase("collapsed");
        window.scrollTo(0, portalState.scrollY);
        draw(now);
        return true;
      }
      portalState.startedAt =
        now -
        (1 - portalState.progress) * CONTRIBUTION_SPACE_DURATION;
      setPortalPhase(
        "closing",
        portalState.reason
      );
      return true;
    }

    function updateContentMask() {
      const hidden =
        portalState.enabled ||
        document.body.classList.contains("home-content-hidden");
      const canvasRectangle = glCanvas.getBoundingClientRect();
      const targets = hidden
        ? []
        : [
            hero.querySelector(".library-intro-copy"),
            hero.querySelector(".intro-stats"),
            document.querySelector(".contribution-ledger")
          ];
      const rectangles = targets.map((element) => {
        if (!element || element.hidden) return [-2, -2, -2, -2];
        const rectangle = element.getBoundingClientRect();
        const left = Math.max(
          0,
          (rectangle.left - canvasRectangle.left) / width
        );
        const top = Math.max(
          0,
          (rectangle.top - canvasRectangle.top) / height
        );
        const right = Math.min(
          1,
          (rectangle.right - canvasRectangle.left) / width
        );
        const bottom = Math.min(
          1,
          (rectangle.bottom - canvasRectangle.top) / height
        );
        return right > left && bottom > top
          ? [left, top, right, bottom]
          : [-2, -2, -2, -2];
      });
      while (rectangles.length < 3) {
        rectangles.push([-2, -2, -2, -2]);
      }
      for (const material of contentMaskMaterials) {
        material.uniforms.uContentRect0.value.set(rectangles[0]);
        material.uniforms.uContentRect1.value.set(rectangles[1]);
        material.uniforms.uContentRect2.value.set(rectangles[2]);
        material.uniforms.uContentFeather.value.set([
          56 / width,
          56 / height
        ]);
      }
    }

    function scheduleContentMaskUpdate() {
      if (disposed || contentMaskFrame) return;
      contentMaskFrame = window.requestAnimationFrame(() => {
        contentMaskFrame = 0;
        measurePortal();
        updateContentMask();
        if (reducedMotion) draw(performance.now());
      });
    }

    function resize() {
      const rectangle =
        runtimeSettings.home_star_scope === "full"
          ? { width: window.innerWidth, height: window.innerHeight }
          : hero.getBoundingClientRect();
      width = Math.max(1, Math.round(rectangle.width));
      height = Math.max(1, Math.round(rectangle.height));
      if (portalState.enabled) {
        width = Math.max(1, Math.round(window.innerWidth));
        height = Math.max(1, Math.round(window.innerHeight));
      }
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      glCanvas.style.width = `${width}px`;
      glCanvas.style.height = `${height}px`;
      relationCanvas.width = Math.max(1, Math.round(width * ratio));
      relationCanvas.height = Math.max(1, Math.round(height * ratio));
      relationCanvas.style.width = `${width}px`;
      relationCanvas.style.height = `${height}px`;
      relationContext.setTransform(ratio, 0, 0, ratio, 0, 0);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      cameraState.framingScale =
        width < height
          ? Math.min(1.24, 1 + (height / width - 1) * 0.14)
          : 1;
      const uScale =
        (height * ratio) /
        (2 * Math.tan((camera.fov * Math.PI) / 360));
      haloLayer.material.uniforms.uScale.value = uScale;
      coreLayer.material.uniforms.uScale.value = uScale;
      spikeLayer.material.uniforms.uScale.value = uScale;
      backgroundLayer.material.uniforms.uScale.value = uScale;
      haloLayer.material.uniforms.uPixelRatio.value = ratio;
      coreLayer.material.uniforms.uPixelRatio.value = ratio;
      spikeLayer.material.uniforms.uPixelRatio.value = ratio;
      backgroundLayer.material.uniforms.uPixelRatio.value = ratio;
      measurePortal();
      updateContentMask();
      updatePortalPresentation();
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
          star.baseBrightness + variation(star, time) * 0.35
        )
      );
    }

    function writePointAttributes(time) {
      const haloPosition = haloLayer.geometry.attributes.position;
      const haloSize = haloLayer.geometry.attributes.aSize;
      const haloAlpha = haloLayer.geometry.attributes.aAlpha;
      const haloTile = haloLayer.geometry.attributes.aTile;
      const haloColor = haloLayer.geometry.attributes.aColor;
      const corePosition = coreLayer.geometry.attributes.position;
      const coreSize = coreLayer.geometry.attributes.aSize;
      const coreAlpha = coreLayer.geometry.attributes.aAlpha;
      const coreTile = coreLayer.geometry.attributes.aTile;
      const coreColor = coreLayer.geometry.attributes.aColor;
      const spikePosition = spikeLayer.geometry.attributes.position;
      const spikeSize = spikeLayer.geometry.attributes.aSize;
      const spikeAlpha = spikeLayer.geometry.attributes.aAlpha;
      const spikeTile = spikeLayer.geometry.attributes.aTile;
      const spikeRot = spikeLayer.geometry.attributes.aRot;
      const spikeColor = spikeLayer.geometry.attributes.aColor;
      stars.forEach((star, index) => {
        const brightness = currentBrightness(star, time);
        const selected = selectedIds.has(star.id);
        const presentation = illumination.brightnessPresentation(
          star.baseBrightness,
          star.kind,
          selected,
          runtimeSettings.home_star_brightness_max
        );
        const intensityPresentation = illumination.brightnessPresentation(
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
          intensityPresentation.haloAlpha * profile.haloAlphaScale;
        haloPosition.setXYZ(index, star.x, star.y, star.z);
        haloSize.setX(index, Math.max(1, tierHaloRadius * 2 * 3));
        haloAlpha.setX(
          index,
          tierHaloAlpha > 0.04
            ? Math.max(0.13, Math.min(1, tierHaloAlpha * 2.4))
            : 0
        );
        haloTile.setX(index, tierTileIndex.get(tierIdOf(star)) * 2);
        haloColor.setXYZ(index, ...star.colorGain);
        corePosition.setXYZ(index, star.x, star.y, star.z);
        coreSize.setX(index, Math.max(8, tierRadius * 4));
        coreAlpha.setX(index, Math.min(1, intensityPresentation.alpha));
        coreTile.setX(index, tierTileIndex.get(tierIdOf(star)) * 2);
        coreColor.setXYZ(index, ...star.colorGain);
      });
      spikedStars.forEach((star, index) => {
        const brightness = currentBrightness(star, time);
        const selected = selectedIds.has(star.id);
        const presentation = illumination.brightnessPresentation(
          star.baseBrightness,
          star.kind,
          selected,
          runtimeSettings.home_star_brightness_max
        );
        const intensityPresentation = illumination.brightnessPresentation(
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
        spikeSize.setX(
          index,
          (spikeExtent * 2 * SPIKE_ART_SCALE) / SPIKE_INSET
        );
        spikeAlpha.setX(
          index,
          intensityPresentation.luminous > 0.06
            ? Math.min(
                1,
                (
                  0.35 +
                  intensityPresentation.luminous * 0.7 +
                  (selected ? 0.15 : 0)
                ) *
                  profile.spikeAlpha *
                  1.45
              )
            : 0
        );
        spikeTile.setX(index, tierTileIndex.get(tierIdOf(star)) * 2 + 1);
        spikeRot.setX(index, ((star.index * 53) % 7 - 3) * (Math.PI / 180));
        spikeColor.setXYZ(index, ...star.colorGain);
      });
      haloPosition.needsUpdate = true;
      haloSize.needsUpdate = true;
      haloAlpha.needsUpdate = true;
      haloTile.needsUpdate = true;
      haloColor.needsUpdate = true;
      corePosition.needsUpdate = true;
      coreSize.needsUpdate = true;
      coreAlpha.needsUpdate = true;
      coreTile.needsUpdate = true;
      coreColor.needsUpdate = true;
      spikePosition.needsUpdate = true;
      spikeSize.needsUpdate = true;
      spikeAlpha.needsUpdate = true;
      spikeTile.needsUpdate = true;
      spikeRot.needsUpdate = true;
      spikeColor.needsUpdate = true;
    }

    function relationStyle(type) {
      if (type === "reference") {
        return runtimeSettings.home_star_reference_relation_style;
      }
      if (type === "contribution") {
        return runtimeSettings.home_star_contributor_relation_style;
      }
      return runtimeSettings.home_star_strong_relation_style;
    }

    function edgeCurve(edge, source, target) {
      const seed = hashSeed(illumination.edgeId(edge));
      const bend = ((seed % 1000) / 1000 - 0.5) * 0.24;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const length = Math.hypot(dx, dy) || 1;
      return {
        cx: (source.x + target.x) / 2 - dy * bend,
        cy: (source.y + target.y) / 2 + dx * bend,
        length
      };
    }

    function curvePoint(source, target, curve, progress) {
      const inverse = 1 - progress;
      return {
        x:
          inverse * inverse * source.x +
          2 * inverse * progress * curve.cx +
          progress * progress * target.x,
        y:
          inverse * inverse * source.y +
          2 * inverse * progress * curve.cy +
          progress * progress * target.y
      };
    }

    function curveTangent(source, target, curve, progress) {
      return {
        x:
          2 * (1 - progress) * (curve.cx - source.x) +
          2 * progress * (target.x - curve.cx),
        y:
          2 * (1 - progress) * (curve.cy - source.y) +
          2 * progress * (target.y - curve.cy)
      };
    }

    function drawDirectionMarker(
      source,
      target,
      curve,
      progress,
      color,
      alpha,
      size
    ) {
      const point = curvePoint(source, target, curve, progress);
      const tangent = curveTangent(source, target, curve, progress);
      const angle = Math.atan2(tangent.y, tangent.x);
      relationContext.save();
      relationContext.translate(point.x, point.y);
      relationContext.rotate(angle);
      relationContext.fillStyle = `rgba(${color}, ${alpha})`;
      relationContext.beginPath();
      relationContext.moveTo(size, 0);
      relationContext.lineTo(-size * 0.7, -size * 0.55);
      relationContext.lineTo(-size * 0.3, 0);
      relationContext.lineTo(-size * 0.7, size * 0.55);
      relationContext.closePath();
      relationContext.fill();
      relationContext.restore();
    }

    function drawEnergyPulse(
      source,
      target,
      curve,
      progress,
      color,
      alpha,
      radius
    ) {
      const point = curvePoint(source, target, curve, progress);
      const gradient = relationContext.createRadialGradient(
        point.x,
        point.y,
        0,
        point.x,
        point.y,
        radius
      );
      gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      gradient.addColorStop(0.22, `rgba(${color}, ${alpha * 0.92})`);
      gradient.addColorStop(1, `rgba(${color}, 0)`);
      relationContext.fillStyle = gradient;
      relationContext.beginPath();
      relationContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
      relationContext.fill();
    }

    function edgeDepth(edge, depths) {
      const sourceDepth = depths.get(edge.source);
      const targetDepth = depths.get(edge.target);
      return Math.min(
        Number.isFinite(sourceDepth) ? sourceDepth : 20,
        Number.isFinite(targetDepth) ? targetDepth : 20
      );
    }

    function drawFormalRelation(
      edge,
      time,
      highlighted,
      hoverHighlighted
    ) {
      const sourceStar = starById.get(edge.source);
      const targetStar = starById.get(edge.target);
      if (!sourceStar || !targetStar) return false;
      const worldDistance = Math.hypot(
        sourceStar.x - targetStar.x,
        sourceStar.y - targetStar.y,
        sourceStar.z - targetStar.z
      );
      if (
        !highlighted &&
        !hoverHighlighted &&
        (
          visibility === "hidden" ||
          (visibility === "near" && worldDistance > NEAR_LIMIT)
        )
      ) {
        return false;
      }
      const source = projectRelationStar(sourceStar);
      const target = projectRelationStar(targetStar);
      if (!source.visible || !target.visible) return false;
      const curve = edgeCurve(edge, source, target);
      const typeColor =
        relationColors[edge.type] || relationColors.strong;
      const previewed = highlighted || hoverHighlighted;
      const depth = highlighted
        ? edgeDepth(edge, activeNodeDepths)
        : hoverHighlighted
          ? edgeDepth(edge, hoverNodeDepths)
          : 0;
      const levelGain = previewed
        ? Math.max(0.42, 1 - depth * 0.11)
        : 1;
      const previewEdgeCount = highlighted
        ? highlightEdges.length
        : hoverHighlightEdges.length;
      const densityGain = previewed
        ? Math.max(
            0.28,
            Math.min(
              1,
              Math.sqrt(90 / Math.max(90, previewEdgeCount))
            )
          )
        : 1;
      const ambientDensityGain = Math.max(
        0.36,
        Math.min(1, Math.sqrt(180 / Math.max(180, edges.length)))
      );
      const alpha = highlighted
        ? 0.88 * levelGain * densityGain
        : hoverHighlighted
          ? 0.88 *
            levelGain *
            densityGain *
            (
              runtimeSettings
                .home_star_hover_relation_opacity_percent / 100
            )
        : visibility === "always"
          ? 0.1 * ambientDensityGain
          : Math.max(
              0.03,
              0.2 *
                ambientDensityGain *
                (1 - worldDistance / NEAR_LIMIT)
            );
      const style = relationStyle(edge.type);
      const gradient = relationContext.createLinearGradient(
        source.x,
        source.y,
        target.x,
        target.y
      );
      gradient.addColorStop(0, `rgba(${typeColor}, ${alpha * 0.35})`);
      gradient.addColorStop(0.22, `rgba(${typeColor}, ${alpha})`);
      gradient.addColorStop(0.78, `rgba(${typeColor}, ${alpha})`);
      gradient.addColorStop(1, `rgba(${typeColor}, ${alpha * 0.35})`);
      relationContext.save();
      relationContext.strokeStyle = gradient;
      relationContext.lineWidth = previewed
        ? Math.max(
            0.7,
            (2.25 - depth * 0.16) * (0.72 + densityGain * 0.28)
          )
        : style === "glow"
          ? 1.1
          : 0.72;
      relationContext.lineCap = "round";
      relationContext.setLineDash(
        style === "dashed"
          ? previewed
            ? [9, 7]
            : [6, 8]
          : []
      );
      relationContext.lineDashOffset = previewed
        ? -(time * 0.018 + depth * 6)
        : 0;
      if (style === "glow" || previewed) {
        relationContext.shadowColor = `rgba(${typeColor}, ${alpha})`;
        relationContext.shadowBlur = previewed
          ? 8 * (hoverHighlighted ? 0.35 : 1)
          : 4;
      }
      relationContext.beginPath();
      relationContext.moveTo(source.x, source.y);
      relationContext.quadraticCurveTo(
        curve.cx,
        curve.cy,
        target.x,
        target.y
      );
      relationContext.stroke();
      relationContext.restore();

      const directed = edge.type !== "strong";
      if (directed) {
        const markerProgress = previewed
          ? 0.58 + ((time * 0.00016 + depth * 0.11) % 0.22)
          : 0.72;
        drawDirectionMarker(
          source,
          target,
          curve,
          markerProgress,
          typeColor,
          previewed ? alpha : alpha * 0.72,
          previewed ? 5.2 : 3.2
        );
      }
      const pulseSeed = hashSeed(`${illumination.edgeId(edge)}:pulse`);
      const pulseStride = Math.max(
        1,
        Math.ceil(highlightEdges.length / 140)
      );
      if (
        highlighted &&
        !reducedMotion &&
        pulseSeed % pulseStride === 0
      ) {
        const seed = pulseSeed;
        const progress =
          (time * 0.00032 + (seed % 1000) / 1000) % 1;
        drawEnergyPulse(
          source,
          target,
          curve,
          progress,
          typeColor,
          alpha,
          Math.max(
            5,
            Math.min(12, pointMaxCssSize.pulse * 0.25) -
              depth * 0.45
          )
        );
      }
      return true;
    }

    function drawProximityRelations() {
      if (
        !strategy.proximity ||
        visibility !== "near" ||
        highlightEdges.length ||
        hoverHighlightEdges.length
      ) {
        return 0;
      }
      let count = 0;
      relationContext.save();
      relationContext.lineWidth = 0.55;
      relationContext.lineCap = "round";
      for (let left = 0; left < stars.length && count < PROXIMITY_MAX; left += 1) {
        for (
          let right = left + 1;
          right < stars.length && count < PROXIMITY_MAX;
          right += 1
        ) {
          const sourceStar = stars[left];
          const targetStar = stars[right];
          const distance = Math.hypot(
            sourceStar.x - targetStar.x,
            sourceStar.y - targetStar.y,
            sourceStar.z - targetStar.z
          );
          if (distance > PROXIMITY_LIMIT) continue;
          const source = projectRelationStar(sourceStar);
          const target = projectRelationStar(targetStar);
          if (!source.visible || !target.visible) continue;
          const alpha = 0.1 * (1 - distance / PROXIMITY_LIMIT);
          relationContext.strokeStyle =
            `rgba(112, 190, 171, ${Math.max(0.015, alpha)})`;
          relationContext.beginPath();
          relationContext.moveTo(source.x, source.y);
          relationContext.lineTo(target.x, target.y);
          relationContext.stroke();
          count += 1;
        }
      }
      relationContext.restore();
      return count;
    }

    function drawRelations(time) {
      relationContext.clearRect(0, 0, width, height);
      relationProjectionCache.clear();
      if (
        portalState.enabled &&
        portalState.progress <= 0.72
      ) {
        relationCanvas.dataset.visibleRelationCount = "0";
        glCanvas.dataset.hoverRelationCount = "0";
        return;
      }
      let visibleCount = drawProximityRelations();
      let hoverRelationCount = 0;
      for (const edge of edges) {
        const edgeId = illumination.edgeId(edge);
        const highlighted = activeVisualEdgeIds.has(edgeId);
        const hoverHighlighted =
          !selectedRoot && hoverVisualEdgeIds.has(edgeId);
        if (
          drawFormalRelation(
            edge,
            time,
            highlighted,
            hoverHighlighted
          )
        ) {
          visibleCount += 1;
          if (hoverHighlighted) hoverRelationCount += 1;
        }
      }
      relationCanvas.dataset.visibleRelationCount =
        String(visibleCount);
      relationCanvas.dataset.activeRelationCount =
        String(highlightEdges.length);
      glCanvas.dataset.hoverRelationCount =
        String(hoverRelationCount);
    }

    function projectStar(star) {
      const vector = new THREE.Vector3(star.x, star.y, star.z);
      vector.project(camera);
      const offset = portalState.enabled
        ? portalState.screenOffset
        : [0, 0];
      return {
        x: ((vector.x + offset[0] + 1) / 2) * width,
        y: ((1 - vector.y - offset[1]) / 2) * height,
        visible: vector.z < 1
      };
    }

    function projectRelationStar(star) {
      if (!relationProjectionCache.has(star.id)) {
        relationProjectionCache.set(star.id, projectStar(star));
      }
      return relationProjectionCache.get(star.id);
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
      const position = host.positionStarLabel(
        x,
        y,
        labelWidth,
        labelHeight,
        panel
      );
      label.style.transform =
        `translate3d(${Math.round(position.x)}px, ` +
        `${Math.round(position.y)}px, 0)`;
    }

    function updateHoverLabel() {
      if (
        !runtimeSettings.home_star_hover_info_enabled ||
        !hoverStar ||
        labelStar ||
        (
          portalState.enabled &&
          portalState.phase !== "expanded"
        )
      ) {
        hoverLabel.hidden = true;
        return;
      }
      const offset = glCanvas.getBoundingClientRect();
      const projected = projectStar(hoverStar);
      if (!projected.visible) {
        hoverLabel.hidden = true;
        return;
      }
      hoverLabel.hidden = false;
      const labelWidth = hoverLabel.offsetWidth || 180;
      const labelHeight = hoverLabel.offsetHeight || 34;
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
      const position = host.positionStarLabel(
        x,
        y,
        labelWidth,
        labelHeight,
        panel
      );
      hoverLabel.style.transform =
        `translate3d(${Math.round(position.x)}px, ` +
        `${Math.round(position.y)}px, 0)`;
    }

    function draw(time) {
      updateVariations(time);
      updateStructureTransition(
        time,
        time - (draw.lastTime || time)
      );
      draw.lastTime = time;
      updatePortalStarPositions(time);
      updatePortalPresentation();
      if (strategy.camera !== "flat") {
        const cameraRadius =
          cameraState.radius * cameraState.framingScale;
        camera.position.set(
          cameraRadius *
            Math.sin(cameraState.phi) *
            Math.sin(cameraState.theta),
          cameraRadius * Math.cos(cameraState.phi),
          cameraRadius *
            Math.sin(cameraState.phi) *
            Math.cos(cameraState.theta)
        );
        camera.lookAt(0, 0, 0);
      }
      const shaderTime = reducedMotion ? 0 : time * 0.001;
      for (const material of contentMaskMaterials) {
        material.uniforms.uTime.value = shaderTime;
      }
      backgroundLayer.material.uniforms.uTime.value = shaderTime;
      camera.updateMatrixWorld();
      writePointAttributes(time);
      drawRelations(time);
      renderer.render(scene, camera);
      updateLabel(time);
      updateHoverLabel();
    }
    function animate(time) {
      frame = 0;
      if (disposed || document.hidden) return;
      const delta = lastFrameAt ? time - lastFrameAt : 16;
      lastFrameAt = time;
      if (
        !portalState.enabled &&
        !dragState.active &&
        !reducedMotion &&
        strategy.camera !== "flat"
      ) {
        cameraState.theta += delta * 0.000015;
      }
      draw(time);
      frame = window.requestAnimationFrame(animate);
    }

    function percentage(value, total) {
      return total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";
    }

    function updateCoverage() {
      const hoverPreview =
        !selectedRoot &&
        hoverStar &&
        runtimeSettings.home_star_hover_info_enabled;
      const rootId = selectedRoot || (hoverPreview ? hoverStar.id : "");
      const previewIds = selectedRoot ? selectedIds : hoverSelectedIds;
      const previewPlan = selectedRoot
        ? activeRelationPlan
        : hoverRelationPlan;
      if (!rootId || !previewPlan) {
        panel.hidden = true;
        panel.dataset.previewMode = "";
        return;
      }
      const litContributors = contributors.filter((star) =>
        previewIds.has(star.id)
      ).length;
      const litDocuments = documents.filter((star) =>
        previewIds.has(star.id)
      ).length;
      const selectedStar = starById.get(rootId);
      panel.hidden = false;
      panel.dataset.previewMode = selectedRoot ? "selection" : "hover";
      panel.querySelector("[data-star-coverage-name]").textContent =
        selectedStar ? starDisplayName(selectedStar) : "未选择";
      panel.querySelector("[data-star-coverage-kind]").textContent =
        selectedStar ? starKindName(selectedStar) : "";
      panel.querySelector("[data-star-coverage-tier]").textContent =
        selectedStar?.brightnessTier?.name || "未分级";
      panel.querySelector("[data-star-coverage-brightness]").textContent =
        `${selectedStar.baseBrightness.toFixed(1)} / ` +
        `${runtimeSettings.home_star_brightness_max}`;
      host.renderBrightnessBreakdown(panel, selectedStar);
      panel.querySelector("[data-star-coverage-total]").textContent =
        `${previewIds.size} / ${stars.length} · ` +
        percentage(previewIds.size, stars.length);
      panel.querySelector("[data-star-coverage-contributors]").textContent =
        `${litContributors} / ${contributors.length} · ` +
        percentage(litContributors, contributors.length);
      panel.querySelector("[data-star-coverage-documents]").textContent =
        `${litDocuments} / ${documents.length} · ` +
        percentage(litDocuments, documents.length);
      panel.querySelector("[data-star-coverage-relations]").textContent =
        `${previewPlan.coverageCount} / ` +
        `${previewPlan.totalCount} · ` +
        percentage(
          previewPlan.coverageCount,
          previewPlan.totalCount
        );
    }

    function showLabel(star, now) {
      const secondClick = labelStar === star && now < labelExpiresAt;
      if (secondClick && star.kind === "document" && star.route) {
        window.location.assign(star.route);
        return;
      }
      labelStar = star;
      label.textContent = host.starLabelText(star);
      label.dataset.starKind = star.kind;
      hoverLabel.hidden = true;
      labelExpiresAt = now + runtimeSettings.home_star_label_duration_ms;
      window.clearTimeout(labelTimer);
      labelTimer = window.setTimeout(() => {
        label.hidden = true;
        labelStar = null;
        updateHoverLabel();
      }, runtimeSettings.home_star_label_duration_ms);
      updateLabel(now);
    }

    function relationDepths(rootId, activeEdges) {
      const adjacency = new Map();
      for (const edge of activeEdges) {
        if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
        if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
        adjacency.get(edge.source).push(edge.target);
        adjacency.get(edge.target).push(edge.source);
      }
      const depths = new Map([[rootId, 0]]);
      const queue = [rootId];
      while (queue.length) {
        const current = queue.shift();
        const depth = depths.get(current);
        for (const neighbor of adjacency.get(current) || []) {
          if (depths.has(neighbor)) continue;
          depths.set(neighbor, depth + 1);
          queue.push(neighbor);
        }
      }
      return depths;
    }

    function clearSelection() {
      selectedRoot = "";
      selectedIds = new Set();
      selectedTier = null;
      activeRelationPlan = null;
      activeVisualEdgeIds = new Set();
      activeNodeDepths = new Map();
      highlightEdges = [];
      updateCoverage();
      glCanvas.dataset.selectedCount = "0";
      glCanvas.dataset.selectedTier = "";
      if (reducedMotion) draw(performance.now());
    }

    function selectStar(star, now) {
      setHoverStar(null, now);
      showLabel(star, now);
      window.clearTimeout(selectionTimer);
      selectedRoot = star.id;
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
      activeNodeDepths = relationDepths(
        star.id,
        activeRelationPlan.coverageEdges
      );
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
        const profile = tierProfile(star.brightnessTier);
        const limit = Math.max(
          star.kind === "contributor" ? 14 : 10,
          Math.min(32, 11 + profile.radiusBoost * 13)
        );
        if (distance <= limit && distance < nearestDistance) {
          nearest = star;
          nearestDistance = distance;
        }
      }
      return nearest;
    }

    function setHoverStar(star, now) {
      if (selectedRoot) star = null;
      if (hoverStar === star) return;
      hoverStar = star;
      hoverSelectedIds = new Set();
      hoverRelationPlan = null;
      hoverVisualEdgeIds = new Set();
      hoverNodeDepths = new Map();
      hoverHighlightEdges = [];
      if (star) {
        hoverSelectedIds = illumination.illuminate(
          stars,
          edges,
          star.id,
          runtimeSettings.home_star_illumination_rule,
          runtimeSettings.home_star_illumination_depth,
          runtimeSettings.home_star_graph_direction
        );
        hoverRelationPlan = illumination.relationPlan(
          stars,
          edges,
          hoverSelectedIds,
          runtimeSettings.home_star_active_edge_mode
        );
        if (runtimeSettings.home_star_hover_relations_enabled) {
          hoverVisualEdgeIds = new Set(
            hoverRelationPlan.visualEdges.map(illumination.edgeId)
          );
          hoverHighlightEdges =
            hoverRelationPlan.visualEdges.filter((edge) => {
              return hoverVisualEdgeIds.has(
                illumination.edgeId(edge)
              );
            });
          hoverNodeDepths = relationDepths(
            star.id,
            hoverRelationPlan.coverageEdges
          );
        }
      }
      glCanvas.dataset.hoveredStarId = star?.id || "";
      glCanvas.dataset.hoverRelationCount = String(
        hoverVisualEdgeIds.size
      );
      if (star && runtimeSettings.home_star_hover_info_enabled) {
        hoverLabel.textContent = host.starLabelText(star);
        hoverLabel.dataset.starKind = star.kind;
      } else {
        hoverLabel.hidden = true;
      }
      updateCoverage();
      updateHoverLabel();
      if (reducedMotion) draw(now);
    }

    function hoverPointerMove(event) {
      if (
        event.pointerType &&
        event.pointerType !== "mouse"
      ) {
        return;
      }
      if (
        !runtimeSettings.home_star_hover_info_enabled &&
        !runtimeSettings.home_star_hover_relations_enabled
      ) {
        return;
      }
      if (
        dragState.active ||
        (
          portalState.enabled &&
          portalState.phase !== "expanded"
        ) ||
        event.target?.closest?.(
          "a, button, input, select, textarea, summary, [role='button']"
        )
      ) {
        setHoverStar(null, performance.now());
        return;
      }
      const rectangle = glCanvas.getBoundingClientRect();
      if (
        event.clientX < rectangle.left ||
        event.clientX > rectangle.right ||
        event.clientY < rectangle.top ||
        event.clientY > rectangle.bottom
      ) {
        setHoverStar(null, performance.now());
        return;
      }
      setHoverStar(hitTest(event), performance.now());
    }

    function documentClick(event) {
      if (event.target === label) return;
      if (
        portalState.enabled &&
        portalState.phase !== "expanded"
      ) {
        return;
      }
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

    function portalPointerDown(event) {
      if (
        !portalState.enabled ||
        portalState.phase !== "collapsed" ||
        event.button !== 0
      ) {
        return;
      }
      event.preventDefault();
      portalState.dragging = true;
      portalState.moved = 0;
      portalState.x = event.clientX;
      portalState.y = event.clientY;
      portalElement.setPointerCapture?.(event.pointerId);
    }

    function portalPointerMove(event) {
      if (!portalState.dragging) return;
      event.preventDefault();
      const dx = event.clientX - portalState.x;
      const dy = event.clientY - portalState.y;
      portalState.x = event.clientX;
      portalState.y = event.clientY;
      portalState.moved += Math.abs(dx) + Math.abs(dy);
      portalState.yaw += dx * 0.008;
      portalState.pitch = Math.max(
        -Math.PI * 0.45,
        Math.min(Math.PI * 0.45, portalState.pitch + dy * 0.006)
      );
      if (reducedMotion) draw(performance.now());
    }

    function portalPointerUp(event) {
      if (!portalState.dragging) return;
      portalState.dragging = false;
      portalElement.releasePointerCapture?.(event.pointerId);
    }

    function portalClick(event) {
      if (!portalState.enabled) return;
      if (portalState.moved > 6) {
        event.preventDefault();
        portalState.moved = 0;
        return;
      }
      openContributionSpace();
    }

    function portalKeyDown(event) {
      if (event.key === "Escape") {
        closeContributionSpace();
      }
    }

    function portalRequest(event) {
      const action = event.detail?.action;
      const reason = event.detail?.reason || "external";
      if (action === "open") {
        openContributionSpace(reason);
      } else if (action === "close") {
        closeContributionSpace(reason);
      }
    }

    function structureChange(event) {
      const changed = setExpandedStructure(event.currentTarget.value);
      if (!changed) {
        updateStructureControl();
        return;
      }
      if (reducedMotion) draw(performance.now());
    }

    function blockPortalTransitionInteraction(event) {
      if (!portalTransitioning()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    const portalBlockedEvents = [
      "click",
      "pointerdown",
      "pointerup",
      "touchstart",
      "touchend",
      "wheel",
      "keydown",
      "submit"
    ];

    // Drag-to-orbit (depth modes only), guarded like the click handler.
    const dragState = { active: false, x: 0, y: 0, moved: 0 };
    function pointerDown(event) {
      if (strategy.camera === "flat") return;
      if (
        portalState.enabled &&
        portalState.phase !== "expanded"
      ) {
        return;
      }
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
    window.addEventListener("scroll", scheduleContentMaskUpdate, {
      passive: true
    });
    window.addEventListener(
      "gck:home-content-visibility",
      scheduleContentMaskUpdate
    );
    window.addEventListener(
      "gck:contribution-space-request",
      portalRequest
    );
    if (portalElement) {
      portalElement.addEventListener(
        "pointerdown",
        portalPointerDown
      );
      portalElement.addEventListener("click", portalClick);
    }
    if (returnButton) {
      returnButton.addEventListener(
        "click",
        closeContributionSpace
      );
    }
    if (structureSelect) {
      structureSelect.addEventListener("change", structureChange);
    }
    document.addEventListener("pointermove", portalPointerMove, {
      passive: false
    });
    document.addEventListener("pointerup", portalPointerUp);
    document.addEventListener("pointercancel", portalPointerUp);
    document.addEventListener("keydown", portalKeyDown);
    document.addEventListener("click", documentClick, true);
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("pointermove", pointerMove, true);
    document.addEventListener("pointermove", hoverPointerMove, true);
    document.addEventListener("pointerup", pointerUp, true);
    for (const eventName of portalBlockedEvents) {
      document.addEventListener(
        eventName,
        blockPortalTransitionInteraction,
        {
          capture: true,
          passive: false
        }
      );
    }
    label.addEventListener("click", labelClick);
    resize();
    if (portalState.enabled) {
      document.body.classList.add(
        "home-contribution-space-ready"
      );
      setPortalPhase("collapsed", "ready");
    }
    updateStructureControl();
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
    glCanvas.dataset.spikeCount = String(spikedStars.length);
    glCanvas.dataset.animatedStarCount = String(
      stars.filter((star) => {
        return tierProfile(star.brightnessTier).variabilityAmplitude > 0;
      }).length
    );
    glCanvas.dataset.blueSupergiantCount = String(
      stars.filter((star) => {
        return star.brightnessTier?.id === "blue-supergiant";
      }).length
    );
    glCanvas.dataset.hypergiantCount = String(
      stars.filter((star) => star.brightnessTier?.id === "hypergiant").length
    );
    glCanvas.dataset.backgroundStarCount = String(
      backgroundLayer.geometry.attributes.position.count
    );
    glCanvas.dataset.backgroundFieldEnabled = String(backgroundFieldEnabled);
    glCanvas.dataset.backgroundFieldCount = String(
      backgroundLayer.userData.fieldCount || 0
    );
    glCanvas.dataset.backgroundDustEnabled = String(backgroundDustEnabled);
    glCanvas.dataset.backgroundDustCount = String(
      backgroundLayer.userData.dustCount || 0
    );
    glCanvas.dataset.backgroundBrightness = String(backgroundBrightness);
    glCanvas.dataset.dustBrightness = String(dustBrightness);
    glCanvas.dataset.backgroundSizeScale = String(backgroundSizeScale);
    glCanvas.dataset.backgroundClusterEnabled = String(
      backgroundClusterEnabled
    );
    glCanvas.dataset.backgroundClusterCount = String(
      backgroundLayer.userData.clusterCount || 0
    );
    glCanvas.dataset.backgroundStreamEnabled = String(
      backgroundStreamEnabled
    );
    glCanvas.dataset.backgroundStreamCount = String(
      backgroundLayer.userData.streamCount || 0
    );
    glCanvas.dataset.backgroundNebulaEnabled = String(
      backgroundNebulaEnabled
    );
    glCanvas.dataset.backgroundNebulaCount = String(
      backgroundLayer.userData.nebulaCount || 0
    );
    glCanvas.dataset.backgroundStructureMotion = String(
      backgroundStructureMotion
    );
    glCanvas.dataset.visualProfile = "deep-field";
    glCanvas.dataset.selectedCount = "0";
    glCanvas.dataset.selectedTier = "";
    glCanvas.dataset.hoverInfoEnabled = String(
      runtimeSettings.home_star_hover_info_enabled
    );
    glCanvas.dataset.hoverRelationsEnabled = String(
      runtimeSettings.home_star_hover_relations_enabled
    );
    glCanvas.dataset.hoverRelationOpacity = String(
      runtimeSettings.home_star_hover_relation_opacity_percent / 100
    );
    glCanvas.dataset.hoveredStarId = "";
    glCanvas.dataset.hoverRelationCount = "0";
    glCanvas.dataset.relationRenderer = "canvas-2d";
    relationCanvas.dataset.relationRenderer = "canvas-2d";
    if (!reducedMotion) frame = window.requestAnimationFrame(animate);
    else draw(performance.now());

    // Debug handle for automated visual verification.
    window.__GCK_STAR3D_DEBUG = {
      renderer,
      scene,
      camera,
      stars,
      edges,
      portalState,
      structureTransition,
      openContributionSpace,
      closeContributionSpace,
      setExpandedStructure,
      selectStar,
      clearSelection,
      draw,
      availableStructures: expandedStructures,
      get activeStructure() {
        return activeStructure;
      },
      portalSettings: {
        collapsedStructure: portalCollapsedStructure,
        expandedStructure: portalExpandedStructure,
        rotationDegreesPerSecond:
          portalRotationRadiansPerMs * 1000 * 180 / Math.PI,
        collapsedScale: portalCollapsedScale,
        collapsedBrightness: portalCollapsedBrightness
      },
      pointSizeLimits: {
        minDepth: pointMinDepth,
        ...pointMaxCssSize
      },
      backgroundLayer,
      relationCanvas,
      hoverLabel,
      get hoverStar() {
        return hoverStar;
      },
      layers: { haloLayer, coreLayer, spikeLayer }
    };

    return function () {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (contentMaskFrame) {
        window.cancelAnimationFrame(contentMaskFrame);
      }
      window.clearTimeout(labelTimer);
      window.clearTimeout(selectionTimer);
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", scheduleContentMaskUpdate);
      window.removeEventListener(
        "gck:home-content-visibility",
        scheduleContentMaskUpdate
      );
      window.removeEventListener(
        "gck:contribution-space-request",
        portalRequest
      );
      if (portalElement) {
        portalElement.removeEventListener(
          "pointerdown",
          portalPointerDown
        );
        portalElement.removeEventListener("click", portalClick);
      }
      if (returnButton) {
        returnButton.removeEventListener(
          "click",
          closeContributionSpace
        );
      }
      if (structureSelect) {
        structureSelect.removeEventListener(
          "change",
          structureChange
        );
      }
      document.removeEventListener(
        "pointermove",
        portalPointerMove
      );
      document.removeEventListener("pointerup", portalPointerUp);
      document.removeEventListener(
        "pointercancel",
        portalPointerUp
      );
      document.removeEventListener("keydown", portalKeyDown);
      document.removeEventListener("click", documentClick, true);
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("pointermove", pointerMove, true);
      document.removeEventListener(
        "pointermove",
        hoverPointerMove,
        true
      );
      document.removeEventListener("pointerup", pointerUp, true);
      for (const eventName of portalBlockedEvents) {
        document.removeEventListener(
          eventName,
          blockPortalTransitionInteraction,
          { capture: true }
        );
      }
      label.removeEventListener("click", labelClick);
      label.remove();
      hoverLabel.remove();
      panel.remove();
      for (const layer of [
        backgroundLayer,
        haloLayer,
        coreLayer,
        spikeLayer
      ]) {
        layer.geometry.dispose();
        layer.material.dispose();
      }
      atlasTexture.dispose();
      renderer.dispose();
      relationCanvas.remove();
      glCanvas.remove();
      portalBackdrop?.remove();
      portalInteractionLock?.remove();
      if (heroContent) {
        heroContent.style.clipPath = "";
      }
      canvas.style.display = "";
      canvas.setAttribute("data-knowledge-field", "");
      document.body.classList.remove(
        "home-stars-full",
        "home-stars-hero",
        "home-contribution-space-ready",
        "home-contribution-space-opening",
        "home-contribution-space-expanded",
        "home-contribution-space-closing"
      );
      delete document.body.dataset.contributionSpaceState;
      const documentStyle = document.documentElement.style;
      for (const name of [
        "--contribution-space-top",
        "--contribution-space-right",
        "--contribution-space-bottom",
        "--contribution-space-left"
      ]) {
        documentStyle.removeProperty(name);
      }
    };
  }

  window.GCK_STAR3D_MODES = { create, WEBGL_MODES };
})();
