const assert = require("node:assert/strict");
const engine = require("../lib/star-formula-engine");

assert.equal(engine.VARIABLE_DEFINITIONS.length, 17);
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
  engine.validateFormula("current_brightness + reference_count * 2"),
  {
    valid: true,
    message: "",
    variables: ["current_brightness", "reference_count"]
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

const tiers = [
  { id: "brown", name: "褐矮星", min_brightness: 0 },
  { id: "red", name: "红矮星", min_brightness: 25 },
  { id: "yellow", name: "黄矮星", min_brightness: 50 },
  { id: "blue", name: "蓝巨星", min_brightness: 80 }
];
assert.equal(engine.brightnessTier(10, tiers).name, "褐矮星");
assert.equal(engine.brightnessTier(50, tiers).name, "黄矮星");
assert.equal(engine.brightnessTier(100, tiers).name, "蓝巨星");
assert.equal(
  engine.brightnessTier(
    10,
    [{ id: "red", name: "红矮星", min_brightness: 25 }]
  ),
  null
);

process.stdout.write("Star formula engine checks passed\n");
