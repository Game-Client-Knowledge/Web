const jsep = require("jsep");

const TARGETS = new Set(["contributor", "document"]);
const DEFAULT_BRIGHTNESS_RULES = [
  {
    id: "contributor-total",
    name: "静星累计贡献",
    enabled: true,
    target: "contributor",
    formula:
      "current_brightness + brightness_span * 0.40 * " +
      "min(1, log(1 + contribution_count) / " +
      "log(1 + total_relation_count))"
  },
  {
    id: "contributor-recent",
    name: "静星近期修改",
    enabled: true,
    target: "contributor",
    formula:
      "current_brightness + brightness_span * 0.05 * " +
      "min(1, log(1 + modification_30_count) / log(5001))"
  },
  {
    id: "document-reference",
    name: "动星引用关系",
    enabled: true,
    target: "document",
    formula:
      "current_brightness + brightness_span * 0.22 * " +
      "min(1, sqrt((reference_count + referenced_by_count) / 24))"
  },
  {
    id: "document-strong",
    name: "动星强联系",
    enabled: true,
    target: "document",
    formula:
      "current_brightness + brightness_span * 0.08 * " +
      "min(1, sqrt(strong_relation_count / 12))"
  },
  {
    id: "document-contributors",
    name: "动星贡献者",
    enabled: true,
    target: "document",
    formula:
      "current_brightness + brightness_span * 0.06 * " +
      "min(1, log(1 + contributor_count) / log(9))"
  },
  {
    id: "document-recent",
    name: "动星近期修改",
    enabled: true,
    target: "document",
    formula:
      "current_brightness + brightness_span * 0.06 * " +
      "min(1, log(1 + modification_30_count) / log(2001))"
  }
];
const PREVIOUS_DEFAULT_FORMULAS = new Map([
  [
    "contributor-total",
    "current_brightness + brightness_span * 0.55 * " +
      "min(1, log(1 + contribution_count) / log(50001))"
  ],
  [
    "contributor-recent",
    "current_brightness + brightness_span * 0.10 * " +
      "min(1, log(1 + modification_30_count) / log(501))"
  ],
  [
    "document-reference",
    "current_brightness + brightness_span * 0.25 * " +
      "min(1, sqrt((reference_count + referenced_by_count) / 12))"
  ],
  [
    "document-strong",
    "current_brightness + brightness_span * 0.10 * " +
      "min(1, sqrt(strong_relation_count / 8))"
  ],
  [
    "document-contributors",
    "current_brightness + brightness_span * 0.10 * " +
      "min(1, log(1 + contributor_count) / log(9))"
  ],
  [
    "document-recent",
    "current_brightness + brightness_span * 0.10 * " +
      "min(1, log(1 + modification_30_count) / log(501))"
  ]
]);
const REBALANCED_DEFAULT_FORMULAS = new Map(
  DEFAULT_BRIGHTNESS_RULES.map((rule) => [rule.id, rule.formula])
);
REBALANCED_DEFAULT_FORMULAS.set(
  "contributor-total",
  "current_brightness + brightness_span * 0.40 * " +
    "min(1, log(1 + contribution_count) / log(250001))"
);
const PREVIOUS_DEFAULT_FORMULA_SETS = [
  PREVIOUS_DEFAULT_FORMULAS,
  REBALANCED_DEFAULT_FORMULAS
];
const PREVIOUS_CONTRIBUTOR_TOTAL_FORMULAS = new Set(
  PREVIOUS_DEFAULT_FORMULA_SETS.map((formulas) => {
    return formulas.get("contributor-total");
  })
);
const PREVIOUS_DEFAULT_ORDERS = [
  [
    "contributor-total",
    "contributor-recent",
    "document-reference",
    "document-strong",
    "document-contributors",
    "document-recent"
  ],
  [
    "contributor-total",
    "contributor-recent",
    "document-reference",
    "document-contributors",
    "document-recent"
  ]
];
const VARIABLE_DEFINITIONS = Object.freeze([
  {
    id: "current_brightness",
    label: "当前亮度",
    description: "上一条已执行规则的结果；第一条规则中等于初始亮度。"
  },
  {
    id: "initial_brightness",
    label: "初始亮度",
    description: "后台配置的计算起点，每颗星开始执行公式时使用该值。"
  },
  {
    id: "max_brightness",
    label: "最大亮度",
    description: "每条规则执行后允许保留的亮度上限。"
  },
  {
    id: "min_brightness",
    label: "最小亮度",
    description: "每条规则执行后允许保留的亮度下限。"
  },
  {
    id: "brightness_span",
    label: "亮度范围",
    description: "最大亮度减最小亮度，适合按配置区间缩放增益。"
  },
  {
    id: "reference_count",
    label: "引用数",
    description: "动星在完整图中主动引用其他动星的出边数量；静星为 0。"
  },
  {
    id: "referenced_by_count",
    label: "被引用数",
    description: "动星在完整图中被其他动星引用的入边数量；静星为 0。"
  },
  {
    id: "strong_relation_count",
    label: "强联系数",
    description: "动星在完整图中的强关系邻居数量；不随点亮策略变化。"
  },
  {
    id: "total_relation_count",
    label: "全图关系总数",
    description: "当前完整关系图的真实边总数；不受点亮裁剪和显示模式影响。"
  },
  {
    id: "activity_7_count",
    label: "近 7 天活跃数",
    description: "构建时刻前 7 天内触及该贡献者或内容星的去重 commit 数。"
  },
  {
    id: "activity_30_count",
    label: "近 30 天活跃数",
    description: "构建时刻前 30 天内触及该贡献者或内容星的去重 commit 数。"
  },
  {
    id: "modification_7_count",
    label: "近 7 天被修改数",
    description: "近 7 天新增、修改和删除的行数之和；代码系统汇总成员文件。"
  },
  {
    id: "modification_30_count",
    label: "近 30 天被修改数",
    description: "近 30 天新增、修改和删除的行数之和；代码系统汇总成员文件。"
  },
  {
    id: "contribution_count",
    label: "累计贡献行数",
    description: "静星对应贡献者的累计变更行数；动星为 0。"
  },
  {
    id: "contributor_count",
    label: "贡献者数",
    description: "动星对应文档或代码系统的去重贡献者人数；静星为 0。"
  },
  {
    id: "commit_count",
    label: "累计活跃数",
    description: "静星对应贡献者的累计内容 commit 数；动星为 0。"
  },
  {
    id: "pi",
    label: "圆周率",
    description: "数学常数 π，值为 Math.PI。"
  },
  {
    id: "e",
    label: "自然常数",
    description: "自然对数的底数 e，值为 Math.E。"
  }
]);
const VARIABLES = new Set(VARIABLE_DEFINITIONS.map((item) => item.id));
const FUNCTIONS = Object.freeze({
  abs: Math.abs,
  ceil: Math.ceil,
  cos: Math.cos,
  exp: Math.exp,
  floor: Math.floor,
  log: Math.log,
  log10: Math.log10,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan
});
const BINARY_OPERATORS = new Set(["+", "-", "*", "/", "%", "^"]);
const UNARY_OPERATORS = new Set(["+", "-"]);
const compiled = new Map();

jsep.removeBinaryOp("^");
jsep.addBinaryOp("^", 11, true);

function walk(node, identifiers, state) {
  if (!node || typeof node !== "object") {
    throw new Error("公式包含无效节点");
  }
  state.count += 1;
  if (state.count > 200) throw new Error("公式过于复杂");
  if (node.type === "Literal") {
    if (typeof node.value !== "number" || !Number.isFinite(node.value)) {
      throw new Error("公式只允许有限数值常量");
    }
    return;
  }
  if (node.type === "Identifier") {
    if (!VARIABLES.has(node.name)) {
      throw new Error(`未知变量：${node.name}`);
    }
    identifiers.add(node.name);
    return;
  }
  if (node.type === "UnaryExpression") {
    if (!UNARY_OPERATORS.has(node.operator)) {
      throw new Error(`不支持一元运算符：${node.operator}`);
    }
    walk(node.argument, identifiers, state);
    return;
  }
  if (node.type === "BinaryExpression") {
    if (!BINARY_OPERATORS.has(node.operator)) {
      throw new Error(`不支持运算符：${node.operator}`);
    }
    walk(node.left, identifiers, state);
    walk(node.right, identifiers, state);
    return;
  }
  if (node.type === "CallExpression") {
    if (
      node.callee?.type !== "Identifier" ||
      !Object.hasOwn(FUNCTIONS, node.callee.name)
    ) {
      throw new Error("公式调用了不支持的函数");
    }
    node.arguments.forEach((argument) => {
      walk(argument, identifiers, state);
    });
    return;
  }
  throw new Error(`公式不支持 ${node.type}`);
}

function compileFormula(formula) {
  const source = String(formula || "").trim();
  if (!source) throw new Error("公式不能为空");
  if (source.length > 500) throw new Error("公式不能超过 500 个字符");
  if (compiled.has(source)) return compiled.get(source);
  let ast;
  try {
    ast = jsep(source);
  } catch (error) {
    throw new Error(`公式语法错误：${error.message}`);
  }
  const identifiers = new Set();
  walk(ast, identifiers, { count: 0 });
  const result = { ast, source, variables: Array.from(identifiers).sort() };
  compiled.set(source, result);
  return result;
}

function evaluateNode(node, variables) {
  if (node.type === "Literal") return node.value;
  if (node.type === "Identifier") {
    return Number(variables[node.name]) || 0;
  }
  if (node.type === "UnaryExpression") {
    const value = evaluateNode(node.argument, variables);
    return node.operator === "-" ? -value : value;
  }
  if (node.type === "BinaryExpression") {
    const left = evaluateNode(node.left, variables);
    const right = evaluateNode(node.right, variables);
    if (node.operator === "+") return left + right;
    if (node.operator === "-") return left - right;
    if (node.operator === "*") return left * right;
    if (node.operator === "/") return left / right;
    if (node.operator === "%") return left % right;
    return Math.pow(left, right);
  }
  const values = node.arguments.map((argument) => {
    return evaluateNode(argument, variables);
  });
  return FUNCTIONS[node.callee.name](...values);
}

function validateFormula(formula) {
  try {
    const parsed = compileFormula(formula);
    return { valid: true, message: "", variables: parsed.variables };
  } catch (error) {
    return { valid: false, message: error.message, variables: [] };
  }
}

function evaluateFormula(formula, variables) {
  const parsed = compileFormula(formula);
  const value = evaluateNode(parsed.ast, variables || {});
  if (!Number.isFinite(value)) {
    throw new Error("公式结果不是有限数值");
  }
  return value;
}

function normalizedRange(minimumValue, initialValue, maximumValue) {
  const maximum = Math.max(1, Math.min(100, Number(maximumValue) || 100));
  const minimumInput = Number(minimumValue);
  const minimum = Math.max(
    0,
    Math.min(maximum, Number.isFinite(minimumInput) ? minimumInput : 0)
  );
  const initialInput = Number(initialValue);
  const initial = Math.max(
    minimum,
    Math.min(
      maximum,
      Number.isFinite(initialInput) ? initialInput : Math.max(10, minimum)
    )
  );
  return {
    minimum,
    initial,
    maximum,
    span: Math.max(0, maximum - minimum)
  };
}

function formulaVariables(
  star,
  range,
  currentBrightness,
  formulaContext = {}
) {
  const metrics = star?.metrics || {};
  return {
    current_brightness: currentBrightness,
    max_brightness: range.maximum,
    min_brightness: range.minimum,
    brightness_span: range.span,
    reference_count: Number(metrics.referenceCount) || 0,
    referenced_by_count: Number(metrics.referencedByCount) || 0,
    strong_relation_count: Number(metrics.strongRelationCount) || 0,
    activity_7_count: Number(metrics.activity7Count) || 0,
    activity_30_count: Number(metrics.activity30Count) || 0,
    modification_7_count: Number(metrics.modification7Count) || 0,
    modification_30_count: Number(metrics.modification30Count) || 0,
    contribution_count: Number(metrics.contributionCount) || 0,
    contributor_count: Number(metrics.contributorCount) || 0,
    commit_count: Number(metrics.commitCount) || 0,
    total_relation_count:
      Number(formulaContext.totalRelationCount) || 0,
    pi: Math.PI,
    e: Math.E
  };
}

function calculateBrightness(
  star,
  rules,
  minimumValue,
  initialValue,
  maximumValue,
  formulaContext = {}
) {
  const range = normalizedRange(minimumValue, initialValue, maximumValue);
  let brightness = range.initial;
  for (const rule of rules || []) {
    if (
      rule?.enabled === false ||
      !TARGETS.has(rule?.target) ||
      rule.target !== star?.kind
    ) {
      continue;
    }
    try {
      brightness = evaluateFormula(
        rule.formula,
        formulaVariables(star, range, brightness, formulaContext)
      );
      brightness = Math.max(
        range.minimum,
        Math.min(range.maximum, brightness)
      );
    } catch {
      // A stale invalid client cache cannot break star-map rendering.
    }
  }
  return brightness;
}

function migrateDefaultBrightnessRules(rules) {
  if (!Array.isArray(rules)) return rules;
  const matchesPreviousDefault = PREVIOUS_DEFAULT_FORMULA_SETS.some(
    (formulas) => {
      return PREVIOUS_DEFAULT_ORDERS.some((order) => {
        return (
          rules.length === order.length &&
          rules.every((rule, index) => {
            const currentDefault = DEFAULT_BRIGHTNESS_RULES.find((item) => {
              return item.id === rule?.id;
            });
            return (
              rule?.id === order[index] &&
              rule.name === currentDefault?.name &&
              rule.enabled === true &&
              rule.target === currentDefault?.target &&
              rule.formula === formulas.get(rule.id)
            );
          })
        );
      });
    }
  );
  if (matchesPreviousDefault) {
    return DEFAULT_BRIGHTNESS_RULES.map((rule) => ({ ...rule }));
  }
  const contributorFormula = DEFAULT_BRIGHTNESS_RULES[0].formula;
  return rules.map((rule) => {
    if (
      rule?.id === "contributor-total" &&
      PREVIOUS_CONTRIBUTOR_TOTAL_FORMULAS.has(rule.formula)
    ) {
      return { ...rule, formula: contributorFormula };
    }
    return rule;
  });
}

function normalizeTiers(tiers, minimumValue, maximumValue) {
  const values = [];
  const seen = new Set();
  for (const [index, tier] of (tiers || []).entries()) {
    const name = String(tier?.name || "").trim();
    const threshold = Math.max(
      0,
      Math.min(100, Number(tier?.min_brightness))
    );
    if (!name || !Number.isFinite(threshold) || seen.has(threshold)) continue;
    seen.add(threshold);
    values.push({
      id: String(tier?.id || `tier-${index + 1}`),
      name,
      min_brightness: threshold
    });
  }
  return values.sort((left, right) => {
    return left.min_brightness - right.min_brightness;
  });
}

function brightnessTier(value, tiers, minimumValue = 0, maximumValue = 100) {
  const normalized = normalizeTiers(tiers, minimumValue, maximumValue);
  let result = null;
  for (const tier of normalized) {
    if (Number(value) < tier.min_brightness) break;
    result = tier;
  }
  return result;
}

module.exports = {
  DEFAULT_BRIGHTNESS_RULES,
  FUNCTIONS: Object.keys(FUNCTIONS),
  TARGETS,
  VARIABLE_DEFINITIONS,
  VARIABLES,
  brightnessTier,
  calculateBrightness,
  compileFormula,
  evaluateFormula,
  formulaVariables,
  migrateDefaultBrightnessRules,
  normalizedRange,
  normalizeTiers,
  validateFormula
};
