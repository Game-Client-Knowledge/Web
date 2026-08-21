const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const engine = require("../lib/star-formula-engine");

const root = path.resolve(__dirname, "..");
for (const relative of [
  "src/assets/js/home-star-map.js",
  "src/assets/js/home-star-3d.js"
]) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  assert.match(
    source,
    /totalRelationCount:\s*sourceGraph\.edges\.length/,
    `${relative} must supply the complete relation count`
  );
}

assert.equal(engine.VARIABLE_DEFINITIONS.length, 18);
assert.ok(
  engine.VARIABLE_DEFINITIONS.every((definition) => {
    return (
      definition.id &&
      definition.label &&
      definition.description &&
      definition.description.length >= 8
    );
  }),
  "every formula variable must explain its meaning"
);

assert.equal(
  engine.evaluateFormula("sin(pi / 2) + cos(0)", { pi: Math.PI }),
  2
);
assert.equal(engine.evaluateFormula("2 ^ 3 ^ 2", {}), 512);
assert.equal(engine.evaluateFormula("7 % 4", {}), 3);
assert.equal(engine.evaluateFormula("exp(1)", {}), Math.E);
assert.equal(engine.evaluateFormula("pow(3, 2) + sqrt(16)", {}), 13);

assert.deepEqual(
  engine.validateFormula(
    "current_brightness + reference_count * 2 + total_relation_count"
  ),
  {
    valid: true,
    message: "",
    variables: [
      "current_brightness",
      "reference_count",
      "total_relation_count"
    ]
  }
);
assert.equal(engine.validateFormula("unknown + 1").valid, false);
assert.equal(engine.validateFormula("star.value").valid, false);
assert.equal(engine.validateFormula("constructor(1)").valid, false);
assert.equal(engine.validateFormula("[1, 2]").valid, false);
assert.throws(
  () => engine.evaluateFormula("1 / 0", {}),
  /有限数值/
);

const star = {
  kind: "document",
  metrics: {
    referenceCount: 2,
    referencedByCount: 3,
    strongRelationCount: 4,
    activity7Count: 5,
    activity30Count: 8,
    modification7Count: 13,
    modification30Count: 21,
    contributorCount: 2
  }
};
const rules = [
  {
    target: "document",
    enabled: true,
    formula:
      "current_brightness + reference_count + " +
      "referenced_by_count + strong_relation_count"
  },
  {
    target: "document",
    enabled: true,
    formula:
      "current_brightness + activity_7_count + " +
      "modification_30_count"
  },
  {
    target: "contributor",
    enabled: true,
    formula: "max_brightness"
  }
];
assert.equal(engine.calculateBrightness(star, rules, 0, 10, 100), 45);
assert.equal(
  engine.calculateBrightness(
    star,
    [{ target: "document", formula: "max_brightness + 100" }],
    5,
    10,
    80
  ),
  80
);

const previousDefaults = [
  {
    id: "contributor-total",
    name: "静星累计贡献",
    enabled: true,
    target: "contributor",
    formula:
      "current_brightness + brightness_span * 0.55 * " +
      "min(1, log(1 + contribution_count) / log(50001))"
  },
  {
    id: "contributor-recent",
    name: "静星近期修改",
    enabled: true,
    target: "contributor",
    formula:
      "current_brightness + brightness_span * 0.10 * " +
      "min(1, log(1 + modification_30_count) / log(501))"
  },
  {
    id: "document-reference",
    name: "动星引用关系",
    enabled: true,
    target: "document",
    formula:
      "current_brightness + brightness_span * 0.25 * " +
      "min(1, sqrt((reference_count + referenced_by_count) / 12))"
  },
  {
    id: "document-contributors",
    name: "动星贡献者",
    enabled: true,
    target: "document",
    formula:
      "current_brightness + brightness_span * 0.10 * " +
      "min(1, log(1 + contributor_count) / log(9))"
  },
  {
    id: "document-recent",
    name: "动星近期修改",
    enabled: true,
    target: "document",
    formula:
      "current_brightness + brightness_span * 0.10 * " +
      "min(1, log(1 + modification_30_count) / log(501))"
  }
];
assert.deepEqual(
  engine.migrateDefaultBrightnessRules(previousDefaults),
  engine.DEFAULT_BRIGHTNESS_RULES
);
const rebalancedDefaults = engine.DEFAULT_BRIGHTNESS_RULES.map((rule) => ({
  ...rule,
  formula:
    rule.id === "contributor-total"
      ? "current_brightness + brightness_span * 0.40 * " +
        "min(1, log(1 + contribution_count) / log(250001))"
      : rule.formula
}));
assert.deepEqual(
  engine.migrateDefaultBrightnessRules(rebalancedDefaults),
  engine.DEFAULT_BRIGHTNESS_RULES
);
const partiallyCustomizedDefaults = previousDefaults.map((rule) => ({
  ...rule
}));
partiallyCustomizedDefaults[1].formula =
  "current_brightness + brightness_span * 0.15 * " +
  "min(1, log(1 + modification_30_count / log(501)))";
const partiallyMigrated = engine.migrateDefaultBrightnessRules(
  partiallyCustomizedDefaults
);
assert.match(
  partiallyMigrated[0].formula,
  /total_relation_count/
);
assert.equal(
  partiallyMigrated[1].formula,
  partiallyCustomizedDefaults[1].formula
);
assert.equal(
  engine.migrateDefaultBrightnessRules([
    { ...previousDefaults[0], formula: "current_brightness + 1" }
  ])[0].formula,
  "current_brightness + 1"
);

const productionScaleFixtures = [
  {
    name: "core contributor",
    kind: "contributor",
    metrics: {
      contributionCount: 57379,
      modification30Count: 57379
    },
    minimum: 50,
    maximum: 70
  },
  {
    name: "established contributor",
    kind: "contributor",
    metrics: {
      contributionCount: 1431,
      modification30Count: 1431
    },
    minimum: 50,
    maximum: 70
  },
  {
    name: "highly connected document",
    kind: "document",
    metrics: {
      referenceCount: 10,
      referencedByCount: 14,
      strongRelationCount: 7,
      contributorCount: 1,
      modification30Count: 82
    },
    minimum: 50,
    maximum: 60
  },
  {
    name: "ordinary document",
    kind: "document",
    metrics: {
      referenceCount: 1,
      referencedByCount: 0,
      strongRelationCount: 1,
      contributorCount: 1,
      modification30Count: 13
    },
    minimum: 20,
    maximum: 40
  }
];
for (const fixture of productionScaleFixtures) {
  const brightness = engine.calculateBrightness(
    fixture,
    engine.DEFAULT_BRIGHTNESS_RULES,
    0,
    20,
    100,
    { totalRelationCount: 890 }
  );
  assert.ok(
    brightness >= fixture.minimum && brightness < fixture.maximum,
    `${fixture.name} brightness ${brightness} is outside the intended band`
  );
}

const tiers = [
  { id: "brown", name: "褐矮星", min_brightness: 0 },
  { id: "red", name: "红矮星", min_brightness: 25 },
  { id: "yellow", name: "黄矮星", min_brightness: 50 },
  { id: "blue", name: "蓝巨星", min_brightness: 80 },
  { id: "blue-supergiant", name: "蓝超巨星", min_brightness: 92 },
  { id: "hypergiant", name: "特超巨星", min_brightness: 98 }
];
assert.equal(engine.brightnessTier(10, tiers).name, "褐矮星");
assert.equal(engine.brightnessTier(50, tiers).name, "黄矮星");
assert.equal(engine.brightnessTier(85, tiers).name, "蓝巨星");
assert.equal(engine.brightnessTier(95, tiers).name, "蓝超巨星");
assert.equal(engine.brightnessTier(100, tiers).name, "特超巨星");
assert.equal(
  engine.brightnessTier(
    10,
    [{ id: "red", name: "红矮星", min_brightness: 25 }]
  ),
  null
);

process.stdout.write("Star formula engine checks passed\n");
