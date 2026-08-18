(function () {
  "use strict";

  window.GCK_HOME_STAR_MAP_ENGINE = true;

  const defaults = {
    home_background_style: "old_star_map",
    home_star_scope: "hero",
    home_star_relation_visibility: "near",
    home_star_strong_relation_style: "solid",
    home_star_reference_relation_style: "dashed",
    home_star_contributor_relation_style: "solid",
    home_star_brightness_variation_enabled: false,
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
    home_star_active_edge_mode: "single_path",
    home_star_brightness_rules: [
      { id: "contributor_contribution_count", priority: 500 },
      { id: "contributor_recent_activity", priority: 400 },
      { id: "document_reference_degree", priority: 300 },
      { id: "document_contributor_count", priority: 200 },
      { id: "document_recent_activity", priority: 100 }
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
  const cachePrefix = "gck-contribution-graph:v1:";
  let settings = { ...defaults };
  let cleanup = function () {};
  let ready = false;

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

  function hexToRgbChannels(hex) {
    const value = String(hex || "#ffffff").replace("#", "");
    return [
      parseInt(value.slice(0, 2), 16) || 0,
      parseInt(value.slice(2, 4), 16) || 0,
      parseInt(value.slice(4, 6), 16) || 0
    ].join(", ");
  }

  const glowSprites = new Map();
  function glowSprite(color) {
    let sprite = glowSprites.get(color);
    if (sprite) return sprite;
    const size = 96;
    const rgb = hexToRgbChannels(color);
    sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const spriteContext = sprite.getContext("2d");
    const gradient = spriteContext.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    gradient.addColorStop(0, `rgba(${rgb}, 0.9)`);
    gradient.addColorStop(0.22, `rgba(${rgb}, 0.38)`);
    gradient.addColorStop(0.5, `rgba(${rgb}, 0.1)`);
    gradient.addColorStop(1, `rgba(${rgb}, 0)`);
    spriteContext.fillStyle = gradient;
    spriteContext.fillRect(0, 0, size, size);
    glowSprites.set(color, sprite);
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
    const sourceContributorMetrics = new Map(
      source.stars
        .filter((star) => star.kind === "contributor")
        .map((star) => [
          normalizeName(star.name),
          { ...(star.metrics || {}) }
        ])
    );
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
        const sourceMetrics =
          sourceContributorMetrics.get(normalizeName(name)) || {};
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
            commitCount: 0,
            lastActiveAt: ""
          }
        };
        result.stars.push(contributorStar);
        contributors.set(contributorId, contributorStar);
      }
      contributorStar.metrics.commitCount += Number(
        link.commit_count || 0
      );
      contributorStar.metrics.contributionCount += Number(
        link.commit_count || 0
      );
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
    for (const documentStar of documents.values()) {
      documentStar.metrics.contributorCount =
        contributorSets.get(documentStar.id)?.size || 0;
    }
    return result;
  }

  function normalizeSettings(value) {
    const merged = { ...defaults, ...(value || {}) };
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
    const brightnessInitial = Math.max(
      0,
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
      home_star_relation_visibility: ["always", "near", "hidden"].includes(
        merged.home_star_relation_visibility
      )
        ? merged.home_star_relation_visibility
        : defaults.home_star_relation_visibility,
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
      home_star_active_edge_mode: [
        "full",
        "minimal_tree",
        "single_path"
      ].includes(merged.home_star_active_edge_mode)
        ? merged.home_star_active_edge_mode
        : defaults.home_star_active_edge_mode,
      home_star_brightness_rules: validRules
        .filter((rule) => rule && rule.id)
        .map((rule) => ({
          id: rule.id,
          priority: Number(rule.priority) || 0
        }))
        .sort((left, right) => right.priority - left.priority)
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
      "<span>Connection coverage</span>" +
      "<strong data-star-coverage-total></strong>" +
      "<dl>" +
      "<div><dt>起点亮度</dt><dd data-star-coverage-brightness></dd></div>" +
      "<div><dt>静星</dt><dd data-star-coverage-contributors></dd></div>" +
      "<div><dt>动星</dt><dd data-star-coverage-documents></dd></div>" +
      "<div><dt>关系</dt><dd data-star-coverage-relations></dd></div>" +
      "</dl>";
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
      baseBrightness: illumination.calculateBrightness(
        source,
        runtimeSettings.home_star_brightness_rules,
        runtimeSettings.home_star_brightness_initial,
        runtimeSettings.home_star_brightness_max
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

    function applyLineStyle(type, alpha, time) {
      const style = relationStyle(type);
      context.strokeStyle = `rgba(${relationColors[type]}, ${alpha})`;
      context.lineWidth = style === "glow" ? 1.35 : 0.8;
      context.setLineDash(style === "dashed" ? [5, 6] : []);
      context.shadowColor =
        style === "glow" ? `rgba(${relationColors[type]}, 0.75)` : "transparent";
      context.shadowBlur =
        style === "glow" ? 5 + Math.sin(time * 0.003) * 1.5 : 0;
    }

    function drawEdges(time) {
      const visibility = runtimeSettings.home_star_relation_visibility;
      const distanceLimit = width < 700 ? 100 : 150;
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
        const alpha = highlighted
          ? 0.78
          : visibility === "always"
            ? 0.18
            : 0.28 * (1 - distance / distanceLimit);
        applyLineStyle(edge.type, Math.max(0.05, alpha), time);
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.stroke();
      }
      context.setLineDash([]);
      context.shadowBlur = 0;
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
        0,
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
        runtimeSettings.home_star_brightness_max
      );

      // Soft glow from a pre-rendered radial gradient sprite. This avoids
      // per-frame shadowBlur and the hard edge of a flat halo disc.
      if (presentation.haloAlpha > 0.04) {
        const diameter = presentation.haloRadius * 2;
        context.globalAlpha = Math.min(1, presentation.haloAlpha * 2.4);
        context.drawImage(
          glowSprite(star.color),
          star.x - presentation.haloRadius,
          star.y - presentation.haloRadius,
          diameter,
          diameter
        );
      }

      context.fillStyle = star.color;
      context.globalAlpha = presentation.alpha;
      context.beginPath();
      context.arc(
        star.x,
        star.y,
        presentation.radius,
        0,
        Math.PI * 2
      );
      context.fill();

      // Bright stars get a hotter white center for extra depth.
      if (presentation.coreAlpha > 0.02) {
        context.globalAlpha = presentation.coreAlpha;
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(
          star.x,
          star.y,
          Math.max(0.45, presentation.radius * 0.42),
          0,
          Math.PI * 2
        );
        context.fill();
      }

      if (star.kind === "contributor") {
        context.globalAlpha = presentation.alpha * 0.55;
        context.strokeStyle = star.color;
        context.lineWidth = selected ? 1.2 : 0.7;
        context.beginPath();
        context.moveTo(
          star.x - presentation.radius * 2.4,
          star.y
        );
        context.lineTo(
          star.x + presentation.radius * 2.4,
          star.y
        );
        context.moveTo(
          star.x,
          star.y - presentation.radius * 2.4
        );
        context.lineTo(
          star.x,
          star.y + presentation.radius * 2.4
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
      if (!selectedRoot || runtimeSettings.home_star_relation_visibility === "always") {
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
      panel.hidden = false;
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
      label.textContent = star.kind === "document" ? star.title : star.name;
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
      activeRelationPlan = null;
      activeVisualEdgeIds = new Set();
      panel.hidden = true;
      canvas.dataset.selectedCount = "0";
      canvas.dataset.selectedBrightness = "0";
      canvas.dataset.selectedRelationCount = "0";
      canvas.dataset.selectedRelationCoverage = "0";
      canvas.dataset.activeVisualEdgeCount = "0";
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
      selectedBrightness = currentBrightness(star, now);
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
    canvas.dataset.brightnessMax = String(
      runtimeSettings.home_star_brightness_max
    );
    canvas.dataset.selectedCount = "0";
    canvas.dataset.selectedBrightness = "0";
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

  function apply(nextSettings) {
    settings = normalizeSettings(nextSettings);
    cleanup();
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
