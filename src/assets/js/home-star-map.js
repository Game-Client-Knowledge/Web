(function () {
  "use strict";

  window.GCK_HOME_STAR_MAP_ENGINE = true;

  // Render modes that run on the WebGL pipeline. The mode implementations
  // live in home-star-3d.js, which is lazy-loaded together with the
  // three.js vendor bundle so plain 2D visitors never download them.
  const STAR_WEBGL_MODES = [
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
  const formulaEngine = window.GCK_STAR_FORMULA_ENGINE;
  if (!formulaEngine) return;

  const defaults = {
    home_background_style: "old_star_map",
    home_star_scope: "hero",
    home_star_render_mode: "2d",
    home_star_experience_mode: "immersive",
    home_star_portal_collapsed_structure: "octahedron",
    home_star_portal_expanded_structure: "3d-drift",
    home_star_portal_rotation_speed: 2.6,
    home_star_portal_size_percent: 34,
    home_star_portal_brightness_percent: 42,
    home_star_relation_visibility: "near",
    home_star_strong_relation_style: "solid",
    home_star_reference_relation_style: "dashed",
    home_star_contributor_relation_style: "solid",
    home_star_brightness_variation_enabled: false,
    home_star_brightness_min: 0,
    home_star_brightness_initial: 10,
    home_star_brightness_max: 100,
    home_star_brightness_variation_amount: 2,
    home_star_brightness_transition_ms: 900,
    home_star_brightness_interval_ms: 2400,
    home_star_color_random_enabled: false,
    home_star_graph_direction: "directed",
    home_star_illumination_rule: "bfs",
    home_star_illumination_depth: 3,
    home_star_selection_duration_ms: 3000,
    home_star_label_duration_ms: 3000,
    home_star_selected_radius_boost: 1,
    home_star_selected_alpha_boost: 0.16,
    home_star_selected_halo_alpha_boost: 0.18,
    home_star_selected_glow_scale: 1.25,
    home_star_selected_contributor_line_width: 1.4,
    home_star_3d_min_depth: 280,
    home_star_3d_halo_max_css_size: 200,
    home_star_3d_core_max_css_size: 36,
    home_star_3d_spike_max_css_size: 240,
    home_star_3d_pulse_max_css_size: 36,
    home_star_active_edge_mode: "single_path",
    home_star_brightness_rules:
      formulaEngine.DEFAULT_BRIGHTNESS_RULES.map((rule) => ({ ...rule })),
    home_star_brightness_tiers: [
      { id: "brown-dwarf", name: "褐矮星", min_brightness: 0 },
      { id: "red-dwarf", name: "红矮星", min_brightness: 25 },
      { id: "yellow-dwarf", name: "黄矮星", min_brightness: 50 },
      { id: "blue-giant", name: "蓝巨星", min_brightness: 80 }
    ]
  };
  const graph = window.GCK_HOME_STAR_GRAPH;
  const canvas = document.querySelector("[data-knowledge-field]");
  const hero = canvas && canvas.closest(".library-intro");
  if (!canvas || !hero || !graph) return;

  const context = canvas.getContext("2d");
  const illumination = window.GCK_HOME_STAR_ILLUMINATION;
  if (!context || !illumination) return;

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  const paletteFamilies = [
    ["#9ce0cd", "#86d8c0", "#b5ead8", "#6fc9b2"],
    ["#f0bd78", "#e5a95f", "#f7d9a8", "#d99a4e"]
  ];
  const relationColors = {
    strong: "132, 220, 196",
    reference: "238, 190, 111",
    contribution: "239, 142, 120"
  };
  const cachePrefix = "gck-contribution-graph:v2:";
  let settings = { ...defaults };
  let cleanup = function () {};
  let ready = false;
  const legacyRuleIds = new Map([
    ["contributor_contribution_count", "contributor-total"],
    ["contributor_recent_activity", "contributor-recent"],
    ["document_reference_degree", "document-reference"],
    ["document_contributor_count", "document-contributors"],
    ["document_recent_activity", "document-recent"]
  ]);

  function hashSeed(value) {
    let hash = 2166136261;
    for (const character of String(value || "")) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return function () {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalizeName(value) {
    return String(value || "").trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
  }

  function isGeneratedPath(value) {
    return String(value || "")
      .split("/")
      .some((part) => part === "bin" || part === "obj");
  }

  function pickStarColor(random) {
    const roll = random();
    if (roll < 0.14) return "#ffffff";
    const family = paletteFamilies[roll < 0.57 ? 0 : 1];
    return family[Math.floor(random() * family.length)];
  }

  // Per-tier visual profile. Sprites are rendered pixel-by-pixel with a
  // point-spread-function model (gaussian Airy core + power-law wing + first
  // Airy ring + gaussian-section diffraction spikes) so each tier reads like
  // a real telescopic star instead of a flat gradient disc.
  const TIER_PROFILES = {
    // 褐矮星：将熄未熄的暗红余烬，几乎无光晕，深藏进背景
    "brown-dwarf": {
      tintHex: "#6e2f14",
      tintMix: 0.72,
      coreMix: 0.6,
      haloScale: 0.5,
      haloAlphaScale: 0.38,
      coreAlphaScale: 0.35,
      radiusBoost: 0,
      coreSigma: 0.055,
      wingGain: 0.05,
      wingScale: 0.16,
      wingPower: 2.6,
      ringGain: 0,
      ringRadius: 0.3,
      ringWidth: 0.02,
      spikeGain: 0,
      spikeWidth: 0.012,
      spikeLength: 0,
      spikeEight: false,
      spikeAlpha: 0
    },
    // 红矮星：温暖的橙红小火苗，光晕收敛柔和
    "red-dwarf": {
      tintHex: "#e2632f",
      tintMix: 0.5,
      coreMix: 0.4,
      haloScale: 0.85,
      haloAlphaScale: 0.8,
      coreAlphaScale: 0.8,
      radiusBoost: 0.12,
      coreSigma: 0.06,
      wingGain: 0.16,
      wingScale: 0.2,
      wingPower: 2.4,
      ringGain: 0,
      ringRadius: 0.3,
      ringWidth: 0.02,
      spikeGain: 0,
      spikeWidth: 0.012,
      spikeLength: 0,
      spikeEight: false,
      spikeAlpha: 0
    },
    // 黄矮星：类太阳暖白，明显辉光 + 纤细四芒
    "yellow-dwarf": {
      tintHex: "#ffd9a0",
      tintMix: 0.3,
      coreMix: 0.18,
      haloScale: 1.7,
      haloAlphaScale: 1.15,
      coreAlphaScale: 1.1,
      radiusBoost: 0.3,
      coreSigma: 0.05,
      wingGain: 0.4,
      wingScale: 0.22,
      wingPower: 2.2,
      ringGain: 0.06,
      ringRadius: 0.3,
      ringWidth: 0.016,
      spikeGain: 0.75,
      spikeWidth: 0.022,
      spikeLength: 5.0,
      spikeEight: false,
      spikeAlpha: 0.5
    },
    // 蓝巨星：冰蓝白炽亮星，大光晕 + 八芒 + 艾里环
    "blue-giant": {
      tintHex: "#cfe4ff",
      tintMix: 0.4,
      coreMix: 0.22,
      haloScale: 2.6,
      haloAlphaScale: 1.5,
      coreAlphaScale: 1.5,
      radiusBoost: 0.65,
      coreSigma: 0.045,
      wingGain: 0.55,
      wingScale: 0.26,
      wingPower: 2.0,
      ringGain: 0.2,
      ringRadius: 0.34,
      ringWidth: 0.014,
      spikeGain: 1.0,
      spikeWidth: 0.017,
      spikeLength: 8.0,
      spikeEight: true,
      spikeAlpha: 0.75
    },
    default: {
      tintHex: null,
      tintMix: 0,
      coreMix: 0,
      haloScale: 1,
      haloAlphaScale: 1,
      coreAlphaScale: 1,
      radiusBoost: 0,
      coreSigma: 0.055,
      wingGain: 0.2,
      wingScale: 0.2,
      wingPower: 2.3,
      ringGain: 0,
      ringRadius: 0.3,
      ringWidth: 0.02,
      spikeGain: 0,
      spikeWidth: 0.012,
      spikeLength: 0,
      spikeEight: false,
      spikeAlpha: 0
    }
  };

  function tierProfile(tier) {
    if (!tier) return TIER_PROFILES.default;
    return TIER_PROFILES[tier.id] || TIER_PROFILES.default;
  }

  function hexToRgb(hex) {
    const value = String(hex || "#ffffff").replace("#", "");
    return {
      r: parseInt(value.slice(0, 2), 16) || 0,
      g: parseInt(value.slice(2, 4), 16) || 0,
      b: parseInt(value.slice(4, 6), 16) || 0
    };
  }

  function mixRgb(sourceHex, targetHex, ratio) {
    if (!targetHex) return hexToRgb(sourceHex);
    const clamped = Math.max(0, Math.min(1, ratio || 0));
    const source = hexToRgb(sourceHex);
    const target = hexToRgb(targetHex);
    return {
      r: Math.round(source.r + (target.r - source.r) * clamped),
      g: Math.round(source.g + (target.g - source.g) * clamped),
      b: Math.round(source.b + (target.b - source.b) * clamped)
    };
  }

  function rgbString(rgb) {
    return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  }

  const HALO_SPRITE_SIZE = 128;
  const haloSprites = new Map();
  function haloSprite(tier, color) {
    const profile = tierProfile(tier);
    const key = `${tier?.id || "default"}\u0000${color}`;
    let sprite = haloSprites.get(key);
    if (sprite) return sprite;
    const size = HALO_SPRITE_SIZE;
    const half = size / 2;
    const bodyRgb = mixRgb(color, profile.tintHex, profile.tintMix);
    const coreRgb = mixRgb("#ffffff", profile.tintHex, profile.coreMix);
    sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const ctx = sprite.getContext("2d");
    const image = ctx.createImageData(size, size);
    const data = image.data;
    const sigma = Math.max(0.02, profile.coreSigma);
    const wingScale = Math.max(0.05, profile.wingScale);
    const colorFalloff = 1 / (wingScale * 1.6);
    for (let y = 0; y < size; y += 1) {
      const dy = (y + 0.5 - half) / half;
      for (let x = 0; x < size; x += 1) {
        const dx = (x + 0.5 - half) / half;
        const r = Math.sqrt(dx * dx + dy * dy);
        // Gaussian core approximating the Airy disk.
        const core = Math.exp(-(r * r) / (2 * sigma * sigma));
        // Power-law wing — the long smooth tail that makes stars feel
        // photographic rather than sticker-like.
        const wingRatio = r / wingScale;
        const wing =
          profile.wingGain *
          Math.pow(1 + wingRatio * wingRatio, -profile.wingPower);
        // Optional first Airy ring for the brightest tiers.
        let ring = 0;
        if (profile.ringGain > 0) {
          const ringDr = (r - profile.ringRadius) / profile.ringWidth;
          ring = profile.ringGain * Math.exp(-ringDr * ringDr);
        }
        const intensity = Math.min(1, core + wing + ring);
        // Color travels from the white-hot core to the tier tint with radius.
        const t = Math.min(1, r * colorFalloff);
        const index = (y * size + x) * 4;
        data[index] = Math.round(coreRgb.r + (bodyRgb.r - coreRgb.r) * t);
        data[index + 1] = Math.round(coreRgb.g + (bodyRgb.g - coreRgb.g) * t);
        data[index + 2] = Math.round(coreRgb.b + (bodyRgb.b - coreRgb.b) * t);
        data[index + 3] = Math.round(intensity * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
    haloSprites.set(key, sprite);
    return sprite;
  }

  const SPIKE_SPRITE_SIZE = 192;
  const spikeSprites = new Map();
  // One diffraction arm: gaussian cross-section perpendicular to the axis,
  // power-law falloff along it. `alongScale`/`power` control reach — primary
  // arms are long and sharp, secondary (diagonal) arms short and faint.
  function spikeArm(perp, along, width, gain, alongScale, power) {
    const section = Math.exp(-(perp * perp) / (2 * width * width));
    const falloff = Math.pow(1 + along * alongScale, -power);
    return gain * section * falloff;
  }
  function spikeSprite(tier, color) {
    const profile = tierProfile(tier);
    if (profile.spikeGain <= 0 || profile.spikeAlpha <= 0) return null;
    const key = `${tier?.id || "default"}\u0000${color}`;
    let sprite = spikeSprites.get(key);
    if (sprite) return sprite;
    const size = SPIKE_SPRITE_SIZE;
    const half = size / 2;
    const bodyRgb = mixRgb(color, profile.tintHex, profile.tintMix * 0.5);
    const coreRgb = mixRgb("#ffffff", profile.tintHex, profile.coreMix * 0.5);
    sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const ctx = sprite.getContext("2d");
    const image = ctx.createImageData(size, size);
    const data = image.data;
    const width = Math.max(0.004, profile.spikeWidth);
    for (let y = 0; y < size; y += 1) {
      const dy = (y + 0.5 - half) / half;
      for (let x = 0; x < size; x += 1) {
        const dx = (x + 0.5 - half) / half;
        // Main 4-point cross: distance to the nearer axis is the
        // cross-section, distance along it drives the falloff.
        const crossPerp = Math.min(Math.abs(dx), Math.abs(dy));
        const crossAlong = Math.max(Math.abs(dx), Math.abs(dy));
        let intensity = spikeArm(
          crossPerp,
          crossAlong,
          width,
          profile.spikeGain,
          5.0,
          1.5
        );
        if (profile.spikeEight) {
          // Diagonal 4-point set: clearly thinner, shorter and weaker than
          // the primary cross so the 8-spike hierarchy reads distinctly.
          const diagA = Math.abs((dx - dy) * Math.SQRT1_2);
          const diagB = Math.abs((dx + dy) * Math.SQRT1_2);
          intensity += spikeArm(
            Math.min(diagA, diagB),
            Math.max(diagA, diagB),
            width * 0.6,
            profile.spikeGain * 0.4,
            10.0,
            2.3
          );
        }
        if (intensity <= 0.004) continue;
        const r = Math.sqrt(dx * dx + dy * dy);
        const t = Math.min(1, r * 2.2);
        const index = (y * size + x) * 4;
        data[index] = Math.round(coreRgb.r + (bodyRgb.r - coreRgb.r) * t);
        data[index + 1] = Math.round(coreRgb.g + (bodyRgb.g - coreRgb.g) * t);
        data[index + 2] = Math.round(coreRgb.b + (bodyRgb.b - coreRgb.b) * t);
        data[index + 3] = Math.round(Math.min(1, intensity) * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
    spikeSprites.set(key, sprite);
    return sprite;
  }

  function matchingRevision(value) {
    const expected = String(
      window.GCK_CONFIG && window.GCK_CONFIG.contentVersion || ""
    );
    const actual = String(value || "");
    return Boolean(
      expected &&
      actual &&
      (actual.startsWith(expected) || expected.startsWith(actual))
    );
  }

  function cacheContributionGraph(value) {
    if (
      !value ||
      Number(value.version) !== 2 ||
      !matchingRevision(value.revision)
    ) {
      return;
    }
    try {
      window.localStorage.setItem(
        `${cachePrefix}${window.GCK_CONFIG.contentVersion}`,
        JSON.stringify(value)
      );
    } catch {
      // The embedded graph remains authoritative without local storage.
    }
  }

  function readContributionGraph() {
    try {
      const value = JSON.parse(
        window.localStorage.getItem(
          `${cachePrefix}${window.GCK_CONFIG.contentVersion}`
        ) || "null"
      );
      return (
        value &&
        Number(value.version) === 2 &&
        matchingRevision(value.revision)
          ? value
          : null
      );
    } catch {
      return null;
    }
  }

  function graphWithCachedContributions(source, cached) {
    if (!cached || !Array.isArray(cached.links)) return source;
    const sourceContributorMetricsById = new Map(
      source.stars
        .filter((star) => star.kind === "contributor")
        .map((star) => [
          String(star.contributorId || ""),
          { ...(star.metrics || {}) }
        ])
    );
    const sourceContributorMetricsByName = new Map(
      source.stars
        .filter((star) => star.kind === "contributor")
        .map((star) => [
          normalizeName(star.name),
          { ...(star.metrics || {}) }
        ])
    );
    function sourceMetricsFor(contributorId, name) {
      const identityIds = new Set([
        contributorId,
        ...(
          cached.identity_aliases?.[contributorId] || []
        )
      ]);
      const matched = Array.from(identityIds)
        .map((identityId) => {
          return sourceContributorMetricsById.get(String(identityId));
        })
        .filter(Boolean);
      if (!matched.length) {
        return sourceContributorMetricsByName.get(normalizeName(name));
      }
      return matched.reduce((combined, metrics) => {
        for (const [key, value] of Object.entries(metrics)) {
          if (key === "lastActiveAt") {
            combined[key] =
              String(value || "") > String(combined[key] || "")
                ? value
                : combined[key] || "";
          } else if (typeof value === "number") {
            combined[key] = Number(combined[key] || 0) + value;
          } else if (!(key in combined)) {
            combined[key] = value;
          }
        }
        return combined;
      }, {});
    }
    const result = {
      ...source,
      stars: source.stars
        .filter((star) => star.kind === "document")
        .map((star) => ({
          ...star,
          metrics: { ...(star.metrics || {}) }
        })),
      edges: source.edges.filter((edge) => edge.type !== "contribution")
    };
    const documents = new Map();
    const documentByPath = new Map();
    const codeSystems = [];
    for (const star of result.stars) {
      if (star.kind !== "document") continue;
      documents.set(star.id, star);
      for (const sourcePath of star.sourcePaths || [star.sourcePath]) {
        documentByPath.set(sourcePath, star);
      }
      if (star.systemPath) codeSystems.push(star);
    }
    const documentForPath = (sourcePath) => {
      if (isGeneratedPath(sourcePath)) return null;
      const exact = documentByPath.get(sourcePath);
      if (exact) return exact;
      return codeSystems.find((star) => {
        return sourcePath.startsWith(`${star.systemPath}/`);
      }) || null;
    };
    const contributors = new Map(
      []
    );
    const contributorSets = new Map();
    const contributionEdges = new Map();

    for (const link of cached.links) {
      const documentStar = documentForPath(link.path);
      if (!documentStar) continue;
      const name = String(link.contributor_name || "Unknown");
      const contributorId = String(
        link.contributor_id || normalizeName(name)
      );
      let contributorStar = contributors.get(contributorId);
      if (!contributorStar) {
        const staticMetrics = sourceMetricsFor(contributorId, name);
        const sourceMetrics = staticMetrics || {};
        contributorStar = {
          id: `contributor:server:${contributorId}`,
          kind: "contributor",
          contributorId,
          name,
          brightness: 10,
          metrics: {
            ...sourceMetrics,
            contributionCount: Number(
              sourceMetrics.contributionCount || 0
            ),
            commitCount: Number(sourceMetrics.commitCount || 0),
            lastActiveAt: String(sourceMetrics.lastActiveAt || "")
          },
          hasStaticMetrics: Boolean(staticMetrics)
        };
        result.stars.push(contributorStar);
        contributors.set(contributorId, contributorStar);
      }
      if (!contributorStar.hasStaticMetrics) {
        contributorStar.metrics.commitCount += Number(
          link.commit_count || 0
        );
        contributorStar.metrics.contributionCount += Number(
          link.commit_count || 0
        );
      }
      if (
        link.last_contributed_at &&
        link.last_contributed_at >
          String(contributorStar.metrics.lastActiveAt || "")
      ) {
        contributorStar.metrics.lastActiveAt =
          link.last_contributed_at;
      }
      const edgeKey = `${contributorStar.id}\u0000${documentStar.id}`;
      const existingEdge = contributionEdges.get(edgeKey);
      if (existingEdge) {
        existingEdge.commitCount += Number(link.commit_count || 0);
        if (
          link.last_contributed_at &&
          link.last_contributed_at > existingEdge.lastContributedAt
        ) {
          existingEdge.lastContributedAt = link.last_contributed_at;
        }
      } else {
        contributionEdges.set(edgeKey, {
          type: "contribution",
          source: contributorStar.id,
          target: documentStar.id,
          commitCount: Number(link.commit_count || 0),
          lastContributedAt: link.last_contributed_at || ""
        });
      }
      if (!contributorSets.has(documentStar.id)) {
        contributorSets.set(documentStar.id, new Set());
      }
      contributorSets.get(documentStar.id).add(contributorStar.id);
      if (
        link.last_contributed_at &&
        link.last_contributed_at >
          String(documentStar.metrics.lastContributedAt || "")
      ) {
        documentStar.metrics.lastContributedAt = link.last_contributed_at;
      }
    }
    result.edges.push(...contributionEdges.values());
    result.stars.forEach((star) => {
      delete star.hasStaticMetrics;
    });
    for (const documentStar of documents.values()) {
      documentStar.metrics.contributorCount =
        contributorSets.get(documentStar.id)?.size || 0;
    }
    return result;
  }

  function normalizeSettings(value) {
    const merged = { ...defaults, ...(value || {}) };
    const clampedSetting = (key, minimum, maximum) => {
      const parsed = Number(merged[key]);
      return Math.max(
        minimum,
        Math.min(
          maximum,
          Number.isFinite(parsed) ? parsed : defaults[key]
        )
      );
    };
    const brightnessMax = Math.max(
      1,
      Math.min(
        100,
        Number(merged.home_star_brightness_max) || 100
      )
    );
    const rawBrightnessInitial = Number(
      merged.home_star_brightness_initial
    );
    const rawBrightnessMinimum = Number(
      merged.home_star_brightness_min
    );
    const brightnessMinimum = Math.max(
      0,
      Math.min(
        brightnessMax,
        Number.isFinite(rawBrightnessMinimum)
          ? rawBrightnessMinimum
          : defaults.home_star_brightness_min
      )
    );
    const brightnessInitial = Math.max(
      brightnessMinimum,
      Math.min(
        brightnessMax,
        Number.isFinite(rawBrightnessInitial)
          ? rawBrightnessInitial
          : defaults.home_star_brightness_initial
      )
    );
    const validRules = Array.isArray(merged.home_star_brightness_rules)
      ? merged.home_star_brightness_rules
      : defaults.home_star_brightness_rules;
    const defaultRulesById = new Map(
      defaults.home_star_brightness_rules.map((rule) => [rule.id, rule])
    );
    const legacyMigratedRules =
      validRules.length &&
      validRules.every((rule) => legacyRuleIds.has(rule?.id))
        ? validRules
            .slice()
            .sort(
              (left, right) =>
                Number(right.priority || 0) - Number(left.priority || 0)
            )
            .map((rule) => {
              return defaultRulesById.get(legacyRuleIds.get(rule.id));
            })
        : validRules;
    const migratedRules = formulaEngine.migrateDefaultBrightnessRules(
      legacyMigratedRules
    );
    const validTiers = formulaEngine.normalizeTiers(
      merged.home_star_brightness_tiers,
      brightnessMinimum,
      brightnessMax
    );
    return {
      ...merged,
      home_background_style: [
        "old_star_map",
        "contribution_star_map"
      ].includes(merged.home_background_style)
        ? merged.home_background_style
        : defaults.home_background_style,
      home_star_scope: ["hero", "full"].includes(merged.home_star_scope)
        ? merged.home_star_scope
        : defaults.home_star_scope,
      home_star_render_mode: STAR_WEBGL_MODES.includes(
        merged.home_star_render_mode
      )
        ? merged.home_star_render_mode
        : defaults.home_star_render_mode,
      home_star_experience_mode: [
        "immersive",
        "contribution_portal"
      ].includes(merged.home_star_experience_mode)
        ? merged.home_star_experience_mode
        : defaults.home_star_experience_mode,
      home_star_portal_collapsed_structure: [
        "match_expanded",
        "octahedron",
        "sphere",
        "cube",
        "3d",
        "3d-drift",
        "3d-drift-anchored",
        "3d-galaxy",
        "3d-orbit",
        "3d-spiral",
        "3d-nebula",
        "3d-clusters",
        "3d-shell"
      ].includes(merged.home_star_portal_collapsed_structure)
        ? merged.home_star_portal_collapsed_structure
        : defaults.home_star_portal_collapsed_structure,
      home_star_portal_expanded_structure: [
        "3d",
        "3d-drift",
        "3d-drift-anchored",
        "3d-galaxy",
        "3d-orbit",
        "3d-spiral",
        "3d-nebula",
        "3d-clusters",
        "3d-shell"
      ].includes(merged.home_star_portal_expanded_structure)
        ? merged.home_star_portal_expanded_structure
        : defaults.home_star_portal_expanded_structure,
      home_star_portal_rotation_speed: clampedSetting(
        "home_star_portal_rotation_speed",
        0,
        30
      ),
      home_star_portal_size_percent: clampedSetting(
        "home_star_portal_size_percent",
        10,
        100
      ),
      home_star_portal_brightness_percent: clampedSetting(
        "home_star_portal_brightness_percent",
        10,
        100
      ),
      home_star_relation_visibility: ["always", "near", "hidden"].includes(
        merged.home_star_relation_visibility
      )
        ? merged.home_star_relation_visibility
        : defaults.home_star_relation_visibility,
      home_star_brightness_min: brightnessMinimum,
      home_star_brightness_initial: brightnessInitial,
      home_star_brightness_max: brightnessMax,
      home_star_brightness_variation_amount: Math.max(
        0,
        Math.min(20, Number(merged.home_star_brightness_variation_amount) || 0)
      ),
      home_star_brightness_transition_ms: Math.max(
        100,
        Math.min(10000, Number(merged.home_star_brightness_transition_ms) || 900)
      ),
      home_star_brightness_interval_ms: Math.max(
        200,
        Math.min(30000, Number(merged.home_star_brightness_interval_ms) || 2400)
      ),
      home_star_illumination_rule: illumination.RULES.has(
        merged.home_star_illumination_rule
      )
        ? merged.home_star_illumination_rule
        : defaults.home_star_illumination_rule,
      home_star_graph_direction: illumination.normalizedDirectionMode(
        merged.home_star_graph_direction
      ),
      home_star_illumination_depth: illumination.normalizedDepth(
        merged.home_star_illumination_depth
      ),
      home_star_selection_duration_ms: Math.max(
        500,
        Math.min(
          60000,
          Number(merged.home_star_selection_duration_ms) || 3000
        )
      ),
      home_star_label_duration_ms: Math.max(
        500,
        Math.min(
          60000,
          Number(merged.home_star_label_duration_ms) || 3000
        )
      ),
      home_star_selected_radius_boost: clampedSetting(
        "home_star_selected_radius_boost",
        0,
        4
      ),
      home_star_selected_alpha_boost: clampedSetting(
        "home_star_selected_alpha_boost",
        0,
        0.5
      ),
      home_star_selected_halo_alpha_boost: clampedSetting(
        "home_star_selected_halo_alpha_boost",
        0,
        0.5
      ),
      home_star_selected_glow_scale: clampedSetting(
        "home_star_selected_glow_scale",
        1,
        3
      ),
      home_star_selected_contributor_line_width: clampedSetting(
        "home_star_selected_contributor_line_width",
        0.5,
        4
      ),
      home_star_3d_min_depth: clampedSetting(
        "home_star_3d_min_depth",
        100,
        1000
      ),
      home_star_3d_halo_max_css_size: clampedSetting(
        "home_star_3d_halo_max_css_size",
        40,
        600
      ),
      home_star_3d_core_max_css_size: clampedSetting(
        "home_star_3d_core_max_css_size",
        8,
        120
      ),
      home_star_3d_spike_max_css_size: clampedSetting(
        "home_star_3d_spike_max_css_size",
        40,
        800
      ),
      home_star_3d_pulse_max_css_size: clampedSetting(
        "home_star_3d_pulse_max_css_size",
        8,
        120
      ),
      home_star_active_edge_mode: [
        "full",
        "minimal_tree",
        "single_path"
      ].includes(merged.home_star_active_edge_mode)
        ? merged.home_star_active_edge_mode
        : defaults.home_star_active_edge_mode,
      home_star_brightness_rules: migratedRules.filter((rule) => {
        return (
          rule &&
          formulaEngine.TARGETS.has(rule.target) &&
          formulaEngine.validateFormula(rule.formula).valid
        );
      }),
      home_star_brightness_tiers: validTiers.length
        ? validTiers
        : formulaEngine.normalizeTiers(
            defaults.home_star_brightness_tiers,
            brightnessMinimum,
            brightnessMax
          )
    };
  }

  function createLegacyMap(runtimeSettings) {
    document.body.classList.remove("home-stars-full", "home-stars-hero");
    document.body.classList.add("home-stars-old");
    if (canvas.parentElement !== hero) hero.prepend(canvas);
    canvas.dataset.starMap = "old";
    const random = seededRandom(hashSeed(graph.revision));
    let width = 1;
    let height = 1;
    let ratio = 1;
    let frame = 0;
    let nodes = [];
    let disposed = false;
    const pointer = { x: 0, y: 0, active: false };

    function resize() {
      const rectangle = hero.getBoundingClientRect();
      width = Math.max(1, Math.round(rectangle.width));
      height = Math.max(1, Math.round(rectangle.height));
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.max(
        24,
        Math.min(width < 700 ? 36 : 68, Math.round(width * height / 15000))
      );
      nodes = Array.from({ length: count }, (_, index) => ({
        x: random() * width,
        y: random() * height,
        vx: (random() - 0.5) * 0.22,
        vy: (random() - 0.5) * 0.22,
        radius: 0.8 + random() * 1.4,
        depth: 0.25 + random() * 0.75,
        color: ["#9ce0cd", "#eea868", "#e5c970", "#ffffff"][index % 4]
      }));
      draw();
    }

    function draw() {
      context.clearRect(0, 0, width, height);
      const limit = width < 700 ? 92 : 132;
      for (let left = 0; left < nodes.length; left += 1) {
        for (let right = left + 1; right < nodes.length; right += 1) {
          const distance = Math.hypot(
            nodes[left].x - nodes[right].x,
            nodes[left].y - nodes[right].y
          );
          if (distance >= limit) continue;
          context.strokeStyle =
            `rgba(132, 197, 179, ${0.2 * (1 - distance / limit)})`;
          context.lineWidth = 0.7;
          context.beginPath();
          context.moveTo(nodes[left].x, nodes[left].y);
          context.lineTo(nodes[right].x, nodes[right].y);
          context.stroke();
        }
      }
      for (const node of nodes) {
        const offsetX = runtimeSettings.pointer_effect_enabled && pointer.active
          ? (pointer.x - width / 2) * node.depth * 0.012
          : 0;
        const offsetY = runtimeSettings.pointer_effect_enabled && pointer.active
          ? (pointer.y - height / 2) * node.depth * 0.012
          : 0;
        context.fillStyle = node.color;
        context.beginPath();
        context.arc(node.x + offsetX, node.y + offsetY, node.radius, 0, Math.PI * 2);
        context.fill();
        if (reducedMotion) continue;
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < -4) node.x = width + 4;
        if (node.x > width + 4) node.x = -4;
        if (node.y < -4) node.y = height + 4;
        if (node.y > height + 4) node.y = -4;
      }
    }

    function animate() {
      frame = 0;
      if (disposed || document.hidden) return;
      draw();
      frame = window.requestAnimationFrame(animate);
    }
    function pointerMove(event) {
      const rectangle = hero.getBoundingClientRect();
      pointer.x = event.clientX - rectangle.left;
      pointer.y = event.clientY - rectangle.top;
      pointer.active = true;
    }
    function pointerLeave() {
      pointer.active = false;
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(hero);
    if (runtimeSettings.pointer_effect_enabled) {
      hero.addEventListener("pointermove", pointerMove);
      hero.addEventListener("pointerleave", pointerLeave);
    }
    resize();
    if (!reducedMotion) frame = window.requestAnimationFrame(animate);
    return function () {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      hero.removeEventListener("pointermove", pointerMove);
      hero.removeEventListener("pointerleave", pointerLeave);
      document.body.classList.remove("home-stars-old");
    };
  }

  function createCoveragePanel() {
    const panel = document.createElement("aside");
    panel.className = "star-coverage-panel";
    panel.hidden = true;
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML =
      "<span>Star profile</span>" +
      "<strong data-star-coverage-name></strong>" +
      "<small data-star-coverage-kind></small>" +
      "<dl>" +
      "<div><dt>星体等级</dt><dd data-star-coverage-tier></dd></div>" +
      "<div><dt>基础亮度</dt><dd data-star-coverage-brightness></dd></div>" +
      "<div><dt>点亮星体</dt><dd data-star-coverage-total></dd></div>" +
      "<div><dt>静星</dt><dd data-star-coverage-contributors></dd></div>" +
      "<div><dt>动星</dt><dd data-star-coverage-documents></dd></div>" +
      "<div><dt>关系</dt><dd data-star-coverage-relations></dd></div>" +
      "</dl>" +
      '<div class="star-relation-legend" aria-label="联系图例">' +
      '<span data-relation-type="strong">强联系</span>' +
      '<span data-relation-type="reference">引用</span>' +
      '<span data-relation-type="contribution">贡献</span>' +
      "</div>";
    document.body.append(panel);
    return panel;
  }

  function createLabel() {
    const label = document.createElement("button");
    label.type = "button";
    label.className = "star-map-label";
    label.hidden = true;
    document.body.append(label);
    return label;
  }

  function starDisplayName(star) {
    return star.kind === "document" ? star.title : star.name;
  }

  function starKindName(star) {
    if (star.kind === "contributor") return "静星 · 贡献者";
    if (star.resourceKind === "code_system") return "动星 · 代码系统";
    return "动星 · 文档";
  }

  function createContributionMap(runtimeSettings) {
    document.body.classList.remove("home-stars-old");
    document.body.classList.toggle(
      "home-stars-full",
      runtimeSettings.home_star_scope === "full"
    );
    document.body.classList.toggle(
      "home-stars-hero",
      runtimeSettings.home_star_scope === "hero"
    );
    if (runtimeSettings.home_star_scope === "full") {
      document.body.prepend(canvas);
    } else if (canvas.parentElement !== hero) {
      hero.prepend(canvas);
    }
    canvas.dataset.starMap = "contribution";
    canvas.dataset.starScope = runtimeSettings.home_star_scope;

    const cached = readContributionGraph();
    const sourceGraph = graphWithCachedContributions(graph, cached);
    const random = seededRandom(hashSeed(`${graph.revision}:contribution-stars`));
    const stars = sourceGraph.stars.map((source, index) => ({
      ...source,
      metrics: { ...(source.metrics || {}) },
      x: 0,
      y: 0,
      vx: source.kind === "document" ? (random() - 0.5) * 0.18 : 0,
      vy: source.kind === "document" ? (random() - 0.5) * 0.18 : 0,
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
      color: runtimeSettings.home_star_color_random_enabled
        ? pickStarColor(random)
        : "#ffffff",
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

    const panel = createCoveragePanel();
    const label = createLabel();
    let width = 1;
    let height = 1;
    let ratio = 1;
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

    function positionStars(initial) {
      const contributors = stars.filter((star) => star.kind === "contributor");
      const documents = stars.filter((star) => star.kind === "document");
      contributors.forEach((star, index) => {
        const angle =
          index * (Math.PI * (3 - Math.sqrt(5))) - Math.PI / 2;
        const radius =
          Math.min(width, height) * (0.2 + (index % 3) * 0.055);
        star.x = width * 0.5 + Math.cos(angle) * radius;
        star.y = height * 0.5 + Math.sin(angle) * radius;
      });
      documents.forEach((star) => {
        if (initial || !Number.isFinite(star.x) || !Number.isFinite(star.y)) {
          star.x = 18 + random() * Math.max(1, width - 36);
          star.y = 18 + random() * Math.max(1, height - 36);
        } else {
          star.x = Math.max(12, Math.min(width - 12, star.x));
          star.y = Math.max(12, Math.min(height - 12, star.y));
        }
      });
    }

    function resize() {
      const rectangle =
        runtimeSettings.home_star_scope === "full"
          ? { width: window.innerWidth, height: window.innerHeight }
          : hero.getBoundingClientRect();
      const oldWidth = width;
      const oldHeight = height;
      width = Math.max(1, Math.round(rectangle.width));
      height = Math.max(1, Math.round(rectangle.height));
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (oldWidth <= 1 || oldHeight <= 1) {
        positionStars(true);
      } else {
        for (const star of stars) {
          star.x = star.x / oldWidth * width;
          star.y = star.y / oldHeight * height;
        }
        positionStars(false);
      }
      draw(performance.now());
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

    // Deterministic per-edge bend so the constellation arcs are stable
    // frame to frame but vary organically from edge to edge.
    function edgeCurve(edge, source, target) {
      const seed = hashSeed(illumination.edgeId(edge));
      const bend = ((seed % 1000) / 1000 - 0.5) * 0.32;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const length = Math.hypot(dx, dy) || 1;
      return {
        cx: (source.x + target.x) / 2 - (dy / length) * length * bend,
        cy: (source.y + target.y) / 2 + (dx / length) * length * bend
      };
    }

    function applyLineStyle(type, time) {
      const style = relationStyle(type);
      context.lineWidth = style === "glow" ? 1.35 : 0.8;
      context.setLineDash(style === "dashed" ? [5, 6] : []);
      context.shadowColor =
        style === "glow" ? `rgba(${relationColors[type]}, 0.75)` : "transparent";
      context.shadowBlur =
        style === "glow" ? 5 + Math.sin(time * 0.003) * 1.5 : 0;
    }

    // Stroke one edge as a curved arc whose color fades in and out toward
    // the endpoints — the "deep space energy thread" look.
    function strokeEdge(edge, source, target, alpha) {
      const curve = edgeCurve(edge, source, target);
      const rgb = relationColors[edge.type];
      const gradient = context.createLinearGradient(
        source.x,
        source.y,
        target.x,
        target.y
      );
      gradient.addColorStop(0, `rgba(${rgb}, 0)`);
      gradient.addColorStop(0.22, `rgba(${rgb}, ${alpha})`);
      gradient.addColorStop(0.78, `rgba(${rgb}, ${alpha})`);
      gradient.addColorStop(1, `rgba(${rgb}, 0)`);
      context.strokeStyle = gradient;
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.quadraticCurveTo(curve.cx, curve.cy, target.x, target.y);
      context.stroke();
      return curve;
    }

    // A bright pulse traveling along a highlighted edge — the sci-fi
    // "data stream" accent on the active knowledge path.
    function drawEdgePulse(edge, source, target, curve, time) {
      const seed = hashSeed(`${illumination.edgeId(edge)}:pulse`);
      const t = (time * 0.00042 + (seed % 1000) / 1000) % 1;
      const u = 1 - t;
      const px = u * u * source.x + 2 * u * t * curve.cx + t * t * target.x;
      const py = u * u * source.y + 2 * u * t * curve.cy + t * t * target.y;
      const sprite = haloSprite(null, "#ffffff");
      const size = 16;
      context.globalCompositeOperation = "lighter";
      context.globalAlpha = 0.85;
      context.drawImage(sprite, px - size / 2, py - size / 2, size, size);
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
    }

    function drawEdges(time) {
      const visibility = runtimeSettings.home_star_relation_visibility;
      const distanceLimit = width < 700 ? 100 : 150;
      const pulses = [];
      for (const edge of edges) {
        const source = starById.get(edge.source);
        const target = starById.get(edge.target);
        const distance = Math.hypot(source.x - target.x, source.y - target.y);
        const highlighted = activeVisualEdgeIds.has(
          illumination.edgeId(edge)
        );
        const visible =
          highlighted ||
          visibility === "always" ||
          (visibility === "near" && distance <= distanceLimit);
        if (!visible) continue;
        const baseAlpha = highlighted
          ? 0.78
          : visibility === "always"
            ? 0.18
            : 0.28 * (1 - distance / distanceLimit);
        // Slow per-edge breathing keeps the web of relations alive.
        const seed = hashSeed(illumination.edgeId(edge));
        const breath = 0.82 + 0.18 * Math.sin(time * 0.0007 + (seed % 628) / 100);
        const alpha = Math.max(0.05, baseAlpha * breath);
        applyLineStyle(edge.type, time);
        const curve = strokeEdge(edge, source, target, alpha);
        if (highlighted) pulses.push([edge, source, target, curve]);
      }
      context.setLineDash([]);
      context.shadowBlur = 0;
      for (const [edge, source, target, curve] of pulses) {
        drawEdgePulse(edge, source, target, curve, time);
      }
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
      if (!runtimeSettings.home_star_brightness_variation_enabled) {
        return;
      }
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

    function drawStar(star, time) {
      const brightness = currentBrightness(star, time);
      const selected = selectedIds.has(star.id);
      const presentation = illumination.brightnessPresentation(
        brightness,
        star.kind,
        selected,
        runtimeSettings.home_star_brightness_max,
        {
          radiusBoost:
            runtimeSettings.home_star_selected_radius_boost,
          alphaBoost:
            runtimeSettings.home_star_selected_alpha_boost,
          haloAlphaBoost:
            runtimeSettings.home_star_selected_halo_alpha_boost,
          glowScale:
            runtimeSettings.home_star_selected_glow_scale
        }
      );
      const profile = tierProfile(star.brightnessTier);
      const tierRadius =
        presentation.radius * (1 + profile.radiusBoost * presentation.luminous);
      const tierHaloRadius =
        presentation.haloRadius * profile.haloScale;
      const tierHaloAlpha =
        presentation.haloAlpha * profile.haloAlphaScale;
      const tierCoreAlpha =
        presentation.coreAlpha * profile.coreAlphaScale;

      // Halo — pre-rendered radial gradient, tier-tinted. We composite with
      // "lighter" so overlapping stars accumulate to true bright zones instead
      // of washing out into gray.
      if (tierHaloAlpha > 0.04) {
        const diameter = tierHaloRadius * 2;
        const previousComposite = context.globalCompositeOperation;
        context.globalCompositeOperation = "lighter";
        context.globalAlpha = Math.min(1, tierHaloAlpha * 2.2);
        context.drawImage(
          haloSprite(star.brightnessTier, star.color),
          star.x - tierHaloRadius,
          star.y - tierHaloRadius,
          diameter,
          diameter
        );
        context.globalCompositeOperation = previousComposite;
      }

      // Diffraction spikes for higher tiers (yellow-dwarf / blue-giant). The
      // spike sprite is nullable — dim tiers skip this entirely. Each star
      // gets a deterministic slight rotation so the field doesn't look like
      // a stamped grid of identical crosses.
      const spike = spikeSprite(star.brightnessTier, star.color);
      if (spike && presentation.luminous > 0.06) {
        const spikeExtent = Math.max(
          tierHaloRadius * 1.25,
          tierRadius * profile.spikeLength,
          14
        );
        const rotation =
          (((star.index * 53) % 50) - 25) * (Math.PI / 180);
        context.save();
        context.translate(star.x, star.y);
        context.rotate(rotation);
        context.globalCompositeOperation = "lighter";
        context.globalAlpha = Math.min(
          1,
          (0.35 + presentation.luminous * 0.7 + (selected ? 0.15 : 0)) *
            profile.spikeAlpha *
            2.2
        );
        context.drawImage(
          spike,
          -spikeExtent,
          -spikeExtent,
          spikeExtent * 2,
          spikeExtent * 2
        );
        context.restore();
      }

      context.fillStyle = star.color;
      context.globalAlpha = presentation.alpha;
      context.beginPath();
      context.arc(
        star.x,
        star.y,
        tierRadius,
        0,
        Math.PI * 2
      );
      context.fill();

      // Bright stars get a hotter white center for extra depth, biased toward
      // the tier's canonical color so blue giants read cyan-white and yellow
      // dwarfs read cream-white.
      if (tierCoreAlpha > 0.02) {
        const coreColor = profile.tintHex
          ? `rgb(${rgbString(mixRgb("#ffffff", profile.tintHex, profile.coreMix * 0.6))})`
          : "#ffffff";
        context.globalAlpha = Math.min(0.95, tierCoreAlpha);
        context.fillStyle = coreColor;
        context.beginPath();
        context.arc(
          star.x,
          star.y,
          Math.max(0.45, tierRadius * 0.42),
          0,
          Math.PI * 2
        );
        context.fill();
      }

      if (star.kind === "contributor") {
        context.globalAlpha = presentation.alpha * 0.55;
        context.strokeStyle = star.color;
        context.lineWidth = selected
          ? runtimeSettings.home_star_selected_contributor_line_width
          : 0.7;
        context.beginPath();
        context.moveTo(
          star.x - tierRadius * 2.4,
          star.y
        );
        context.lineTo(
          star.x + tierRadius * 2.4,
          star.y
        );
        context.moveTo(
          star.x,
          star.y - tierRadius * 2.4
        );
        context.lineTo(
          star.x,
          star.y + tierRadius * 2.4
        );
        context.stroke();
      }
      context.globalAlpha = 1;
    }

    function moveDocuments() {
      if (reducedMotion) return;
      for (const star of stars) {
        if (star.kind !== "document") continue;
        star.x += star.vx;
        star.y += star.vy;
        if (star.x < 8 || star.x > width - 8) {
          star.vx *= -1;
          star.x = Math.max(8, Math.min(width - 8, star.x));
        }
        if (star.y < 8 || star.y > height - 8) {
          star.vy *= -1;
          star.y = Math.max(8, Math.min(height - 8, star.y));
        }
      }
    }

    function canvasOffset() {
      const rectangle = canvas.getBoundingClientRect();
      return { left: rectangle.left, top: rectangle.top };
    }

    function updateLabel(time) {
      if (!labelStar || time >= labelExpiresAt) {
        label.hidden = true;
        labelStar = null;
        return;
      }
      const offset = canvasOffset();
      label.hidden = false;
      const labelWidth = label.offsetWidth || 180;
      const labelHeight = label.offsetHeight || 34;
      const x = Math.max(
        8,
        Math.min(
          window.innerWidth - labelWidth - 8,
          offset.left + labelStar.x + 10
        )
      );
      const y = Math.max(
        8,
        Math.min(
          window.innerHeight - labelHeight - 8,
          offset.top + labelStar.y - 18
        )
      );
      label.style.transform =
        `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    }

    function draw(time) {
      context.clearRect(0, 0, width, height);
      updateVariations(time);
      drawEdges(time);
      for (const star of stars) drawStar(star, time);
      moveDocuments();
      updateLabel(time);
    }

    function animate(time) {
      frame = 0;
      if (disposed || document.hidden) return;
      draw(time);
      frame = window.requestAnimationFrame(animate);
    }

    function percentage(value, total) {
      return total ? `${(value / total * 100).toFixed(1)}%` : "0.0%";
    }

    function updateCoverage() {
      if (!selectedRoot) {
        panel.hidden = true;
        return;
      }
      const contributors = stars.filter(
        (star) => star.kind === "contributor"
      );
      const documents = stars.filter((star) => star.kind === "document");
      const litContributors = contributors.filter((star) =>
        selectedIds.has(star.id)
      ).length;
      const litDocuments = documents.filter((star) =>
        selectedIds.has(star.id)
      ).length;
      const selectedStar = starById.get(selectedRoot);
      panel.hidden = false;
      panel.querySelector("[data-star-coverage-name]").textContent =
        selectedStar ? starDisplayName(selectedStar) : "未选择";
      panel.querySelector("[data-star-coverage-kind]").textContent =
        selectedStar ? starKindName(selectedStar) : "";
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
      const title = starDisplayName(star);
      const tier = star.brightnessTier?.name || "未分级";
      label.textContent =
        `${title} · ${tier} · ${star.baseBrightness.toFixed(1)}`;
      label.dataset.starKind = star.kind;
      labelExpiresAt =
        now + runtimeSettings.home_star_label_duration_ms;
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
      panel.hidden = true;
      canvas.dataset.selectedCount = "0";
      canvas.dataset.selectedBrightness = "0";
      canvas.dataset.selectedTier = "";
      canvas.dataset.selectedRelationCount = "0";
      canvas.dataset.selectedRelationCoverage = "0";
      canvas.dataset.activeVisualEdgeCount = "0";
      if (reducedMotion) draw(performance.now());
    }

    function selectStar(star, now) {
      showLabel(star, now);
      window.clearTimeout(selectionTimer);
      selectedRoot = star.id;
      selectedBrightness = star.baseBrightness;
      selectedTier = star.brightnessTier;
      if (runtimeSettings.home_star_relation_visibility === "always") {
        selectedIds = new Set([star.id]);
        activeRelationPlan = {
          coverageCount: edges.filter((edge) => {
            return edge.source === star.id || edge.target === star.id;
          }).length,
          totalCount: edges.length
        };
        updateCoverage();
        selectionTimer = window.setTimeout(
          clearSelection,
          runtimeSettings.home_star_selection_duration_ms
        );
        return;
      }
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
      canvas.dataset.selectedCount = String(selectedIds.size);
      canvas.dataset.selectedBrightness = String(selectedBrightness);
      canvas.dataset.selectedTier = selectedTier?.name || "";
      canvas.dataset.selectedRelationCount = String(
        activeRelationPlan.coverageCount
      );
      canvas.dataset.selectedRelationCoverage = String(
        activeRelationPlan.coverageRate
      );
      canvas.dataset.activeVisualEdgeCount = String(
        activeRelationPlan.visualCount
      );
      updateCoverage();
      selectionTimer = window.setTimeout(
        clearSelection,
        runtimeSettings.home_star_selection_duration_ms
      );
      if (reducedMotion) draw(now);
    }

    function hitTest(event) {
      const rectangle = canvas.getBoundingClientRect();
      const x = event.clientX - rectangle.left;
      const y = event.clientY - rectangle.top;
      let nearest = null;
      let nearestDistance = Infinity;
      for (const star of stars) {
        const distance = Math.hypot(star.x - x, star.y - y);
        const limit = star.kind === "contributor" ? 13 : 9;
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
      const rectangle = canvas.getBoundingClientRect();
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

    const resizeObserver =
      runtimeSettings.home_star_scope === "hero"
        ? new ResizeObserver(resize)
        : null;
    if (resizeObserver) resizeObserver.observe(hero);
    else window.addEventListener("resize", resize);
    document.addEventListener("click", documentClick, true);
    label.addEventListener("click", labelClick);
    resize();
    canvas.dataset.starCount = String(stars.length);
    canvas.dataset.edgeCount = String(edges.length);
    canvas.dataset.illuminationRule =
      runtimeSettings.home_star_illumination_rule;
    canvas.dataset.illuminationDepth = String(
      runtimeSettings.home_star_illumination_depth
    );
    canvas.dataset.graphDirection =
      runtimeSettings.home_star_graph_direction;
    canvas.dataset.brightnessInitial = String(
      runtimeSettings.home_star_brightness_initial
    );
    canvas.dataset.brightnessMin = String(
      runtimeSettings.home_star_brightness_min
    );
    canvas.dataset.brightnessMax = String(
      runtimeSettings.home_star_brightness_max
    );
    canvas.dataset.selectedRadiusBoost = String(
      runtimeSettings.home_star_selected_radius_boost
    );
    canvas.dataset.selectedAlphaBoost = String(
      runtimeSettings.home_star_selected_alpha_boost
    );
    canvas.dataset.selectedHaloAlphaBoost = String(
      runtimeSettings.home_star_selected_halo_alpha_boost
    );
    canvas.dataset.selectedGlowScale = String(
      runtimeSettings.home_star_selected_glow_scale
    );
    canvas.dataset.selectedContributorLineWidth = String(
      runtimeSettings.home_star_selected_contributor_line_width
    );
    canvas.dataset.selectedCount = "0";
    canvas.dataset.selectedBrightness = "0";
    canvas.dataset.selectedTier = "";
    canvas.dataset.selectedRelationCount = "0";
    canvas.dataset.selectedRelationCoverage = "0";
    canvas.dataset.activeVisualEdgeCount = "0";
    canvas.dataset.activeEdgeMode =
      runtimeSettings.home_star_active_edge_mode;
    canvas.dataset.contributorCount = String(
      stars.filter((star) => star.kind === "contributor").length
    );
    canvas.dataset.documentCount = String(
      stars.filter((star) => star.kind === "document").length
    );
    canvas.dataset.codeSystemCount = String(
      stars.filter((star) => star.resourceKind === "code_system").length
    );
    canvas.dataset.contributionEdgeCount = String(
      edges.filter((edge) => edge.type === "contribution").length
    );
    if (!reducedMotion) frame = window.requestAnimationFrame(animate);

    return function () {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(labelTimer);
      window.clearTimeout(selectionTimer);
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener("resize", resize);
      document.removeEventListener("click", documentClick, true);
      label.removeEventListener("click", labelClick);
      label.remove();
      panel.remove();
      document.body.classList.remove("home-stars-full", "home-stars-hero");
      if (canvas.parentElement !== hero) hero.prepend(canvas);
    };
  }

  // Lazy loader for the tree-shaken three.js vendor bundle. The 2D renderer
  // stays the default; the bundle is only fetched when 3D mode is requested.
  const star3dLoader = { loading: false, callbacks: [] };
  function ensureStar3D(callback) {
    if (window.GCK_STAR3D && window.GCK_STAR3D_MODES) {
      callback();
      return;
    }
    star3dLoader.callbacks.push(callback);
    if (star3dLoader.loading) return;
    star3dLoader.loading = true;
    let remaining = 2;
    function done() {
      remaining -= 1;
      if (remaining > 0) return;
      const pending = star3dLoader.callbacks.splice(0);
      for (const queued of pending) queued();
    }
    function loadScript(src) {
      const script = document.createElement("script");
      script.src = src;
      script.onload = done;
      // Resolve on error as well — the factory falls back to 2D.
      script.onerror = done;
      document.head.append(script);
    }
    loadScript(
      window.GCK_STAR3D_VENDOR_URL || "/assets/vendor/star3d-engine.js"
    );
    loadScript(
      window.GCK_STAR3D_MODES_URL || "/assets/js/home-star-3d.js"
    );
  }

  // WebGL star maps. All scene construction lives in home-star-3d.js;
  // this bridge hands over the shared context (graph, settings, sprite
  // generators, illumination engine) and falls back to the Canvas 2D
  // renderer whenever WebGL is unavailable.
  function createContributionMapWebGL(runtimeSettings) {
    const factory = window.GCK_STAR3D_MODES && window.GCK_STAR3D_MODES.create;
    if (!window.GCK_STAR3D || !factory) {
      return createContributionMap(runtimeSettings);
    }
    const cached = readContributionGraph();
    const sourceGraph = graphWithCachedContributions(graph, cached);
    return factory({
      THREE: window.GCK_STAR3D,
      canvas,
      hero,
      settings: runtimeSettings,
      sourceGraph,
      illumination,
      formulaEngine,
      tierProfile,
      haloSprite,
      spikeSprite,
      relationColors,
      reducedMotion,
      createCoveragePanel,
      createLabel,
      starDisplayName,
      starKindName,
      hashSeed,
      seededRandom,
      fallback2D: () => createContributionMap(runtimeSettings)
    });
  }

  function apply(nextSettings) {
    settings = normalizeSettings(nextSettings);
    cleanup();
    const portalExperience =
      settings.home_star_experience_mode ===
      "contribution_portal";
    const webglMode =
      portalExperience ||
      STAR_WEBGL_MODES.includes(settings.home_star_render_mode);
    if (
      settings.home_background_style === "contribution_star_map" &&
      webglMode
    ) {
      if (window.GCK_STAR3D && window.GCK_STAR3D_MODES) {
        cleanup = createContributionMapWebGL(settings);
      } else {
        // Render 2D immediately and swap to WebGL once the vendor bundle
        // and the mode module arrive, so enabling 3D never blanks the
        // background.
        cleanup = createContributionMap(
          portalExperience
            ? { ...settings, home_star_scope: "hero" }
            : settings
        );
        ensureStar3D(() => {
          if (
            ready &&
            (
              settings.home_star_experience_mode ===
                "contribution_portal" ||
              STAR_WEBGL_MODES.includes(
                settings.home_star_render_mode
              )
            )
          ) {
            apply(settings);
          }
        });
      }
      return;
    }
    cleanup =
      settings.home_background_style === "contribution_star_map"
        ? createContributionMap(settings)
        : createLegacyMap(settings);
  }

  window.addEventListener("gck:visual-settings", (event) => {
    const detail = event.detail || {};
    if (detail.contribution_graph) {
      cacheContributionGraph(detail.contribution_graph);
    }
    settings = normalizeSettings({ ...settings, ...detail });
    if (ready) apply(settings);
  });

  Promise.all([
    window.GCK_VISUAL_SETTINGS || Promise.resolve({}),
    window.GCK_HOME_INTRO_READY || Promise.resolve("skipped")
  ]).then(([resolved]) => {
    settings = normalizeSettings({ ...settings, ...(resolved || {}) });
    if (resolved && resolved.contribution_graph) {
      cacheContributionGraph(resolved.contribution_graph);
    }
    ready = true;
    apply(settings);
  });
})();
