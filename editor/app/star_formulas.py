from __future__ import annotations

import ast
import math
import re
from copy import deepcopy
from typing import Any


STAR_FORMULA_TARGETS = {"contributor", "document"}
STAR_FORMULA_VARIABLES = {
    "current_brightness",
    "initial_brightness",
    "max_brightness",
    "min_brightness",
    "brightness_span",
    "reference_count",
    "referenced_by_count",
    "strong_relation_count",
    "activity_7_count",
    "activity_30_count",
    "modification_7_count",
    "modification_30_count",
    "contribution_count",
    "contributor_count",
    "commit_count",
    "total_relation_count",
    "pi",
    "e",
}
STAR_FORMULA_FUNCTIONS = {
    "abs",
    "ceil",
    "cos",
    "exp",
    "floor",
    "log",
    "log10",
    "max",
    "min",
    "pow",
    "round",
    "sin",
    "sqrt",
    "tan",
}
STAR_FORMULA_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

PREVIOUS_DEFAULT_STAR_BRIGHTNESS_RULES = [
    {
        "id": "contributor-total",
        "name": "静星累计贡献",
        "enabled": True,
        "target": "contributor",
        "formula": (
            "current_brightness + brightness_span * 0.55 * "
            "min(1, log(1 + contribution_count) / log(50001))"
        ),
    },
    {
        "id": "contributor-recent",
        "name": "静星近期修改",
        "enabled": True,
        "target": "contributor",
        "formula": (
            "current_brightness + brightness_span * 0.10 * "
            "min(1, log(1 + modification_30_count) / log(501))"
        ),
    },
    {
        "id": "document-reference",
        "name": "动星引用关系",
        "enabled": True,
        "target": "document",
        "formula": (
            "current_brightness + brightness_span * 0.25 * "
            "min(1, sqrt((reference_count + referenced_by_count) / 12))"
        ),
    },
    {
        "id": "document-strong",
        "name": "动星强联系",
        "enabled": True,
        "target": "document",
        "formula": (
            "current_brightness + brightness_span * 0.10 * "
            "min(1, sqrt(strong_relation_count / 8))"
        ),
    },
    {
        "id": "document-contributors",
        "name": "动星贡献者",
        "enabled": True,
        "target": "document",
        "formula": (
            "current_brightness + brightness_span * 0.10 * "
            "min(1, log(1 + contributor_count) / log(9))"
        ),
    },
    {
        "id": "document-recent",
        "name": "动星近期修改",
        "enabled": True,
        "target": "document",
        "formula": (
            "current_brightness + brightness_span * 0.10 * "
            "min(1, log(1 + modification_30_count) / log(501))"
        ),
    },
]

PREVIOUS_DEFAULT_STAR_BRIGHTNESS_RULE_SETS = [
    PREVIOUS_DEFAULT_STAR_BRIGHTNESS_RULES,
    [
        rule
        for rule in PREVIOUS_DEFAULT_STAR_BRIGHTNESS_RULES
        if rule["id"] != "document-strong"
    ],
    [
        {
            **rule,
            "formula": (
                "current_brightness + brightness_span * 0.40 * "
                "min(1, log(1 + contribution_count) / log(250001))"
            ),
        }
        if rule["id"] == "contributor-total"
        else {
            **rule,
            "formula": {
                "contributor-recent": (
                    "current_brightness + brightness_span * 0.05 * "
                    "min(1, log(1 + modification_30_count) / log(5001))"
                ),
                "document-reference": (
                    "current_brightness + brightness_span * 0.22 * "
                    "min(1, sqrt((reference_count + "
                    "referenced_by_count) / 24))"
                ),
                "document-strong": (
                    "current_brightness + brightness_span * 0.08 * "
                    "min(1, sqrt(strong_relation_count / 12))"
                ),
                "document-contributors": (
                    "current_brightness + brightness_span * 0.06 * "
                    "min(1, log(1 + contributor_count) / log(9))"
                ),
                "document-recent": (
                    "current_brightness + brightness_span * 0.06 * "
                    "min(1, log(1 + modification_30_count) / log(2001))"
                ),
            }[rule["id"]],
        }
        for rule in PREVIOUS_DEFAULT_STAR_BRIGHTNESS_RULES
    ],
]

DEFAULT_STAR_BRIGHTNESS_RULES = [
    {
        "id": "contributor-total",
        "name": "静星累计贡献",
        "enabled": True,
        "target": "contributor",
        "formula": (
            "current_brightness + brightness_span * 0.40 * "
            "min(1, log(1 + contribution_count) / "
            "log(1 + total_relation_count))"
        ),
    },
    {
        "id": "contributor-recent",
        "name": "静星近期修改",
        "enabled": True,
        "target": "contributor",
        "formula": (
            "current_brightness + brightness_span * 0.05 * "
            "min(1, log(1 + modification_30_count) / log(5001))"
        ),
    },
    {
        "id": "document-reference",
        "name": "动星引用关系",
        "enabled": True,
        "target": "document",
        "formula": (
            "current_brightness + brightness_span * 0.22 * "
            "min(1, sqrt((reference_count + referenced_by_count) / 24))"
        ),
    },
    {
        "id": "document-strong",
        "name": "动星强联系",
        "enabled": True,
        "target": "document",
        "formula": (
            "current_brightness + brightness_span * 0.08 * "
            "min(1, sqrt(strong_relation_count / 12))"
        ),
    },
    {
        "id": "document-contributors",
        "name": "动星贡献者",
        "enabled": True,
        "target": "document",
        "formula": (
            "current_brightness + brightness_span * 0.06 * "
            "min(1, log(1 + contributor_count) / log(9))"
        ),
    },
    {
        "id": "document-recent",
        "name": "动星近期修改",
        "enabled": True,
        "target": "document",
        "formula": (
            "current_brightness + brightness_span * 0.06 * "
            "min(1, log(1 + modification_30_count) / log(2001))"
        ),
    },
]

DEFAULT_STAR_BRIGHTNESS_TIERS = [
    {"id": "brown-dwarf", "name": "褐矮星", "min_brightness": 0.0},
    {"id": "red-dwarf", "name": "红矮星", "min_brightness": 25.0},
    {"id": "yellow-dwarf", "name": "黄矮星", "min_brightness": 50.0},
    {"id": "blue-giant", "name": "蓝巨星", "min_brightness": 80.0},
]

LEGACY_STAR_BRIGHTNESS_RULE_IDS = {
    "contributor_contribution_count": "contributor-total",
    "contributor_recent_activity": "contributor-recent",
    "document_reference_degree": "document-reference",
    "document_contributor_count": "document-contributors",
    "document_recent_activity": "document-recent",
}


def validate_star_formula(formula: str) -> set[str]:
    source = formula.strip()
    if not source:
        raise ValueError("公式不能为空")
    if len(source) > 500:
        raise ValueError("公式不能超过 500 个字符")
    try:
        expression = ast.parse(source, mode="eval")
    except SyntaxError as error:
        raise ValueError(f"公式语法错误：{error.msg}") from error

    variables: set[str] = set()
    visited = 0

    def visit(node: ast.AST) -> None:
        nonlocal visited
        visited += 1
        if visited > 200:
            raise ValueError("公式过于复杂")
        if isinstance(node, ast.Expression):
            visit(node.body)
            return
        if isinstance(node, ast.Constant):
            if (
                isinstance(node.value, bool)
                or not isinstance(node.value, (int, float))
                or not math.isfinite(float(node.value))
            ):
                raise ValueError("公式只允许有限数值常量")
            return
        if isinstance(node, ast.Name):
            if node.id not in STAR_FORMULA_VARIABLES:
                raise ValueError(f"未知变量：{node.id}")
            variables.add(node.id)
            return
        if isinstance(node, ast.UnaryOp):
            if not isinstance(node.op, (ast.UAdd, ast.USub)):
                raise ValueError("公式包含不支持的一元运算符")
            visit(node.operand)
            return
        if isinstance(node, ast.BinOp):
            if not isinstance(
                node.op,
                (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod, ast.BitXor),
            ):
                raise ValueError("公式包含不支持的运算符")
            visit(node.left)
            visit(node.right)
            return
        if isinstance(node, ast.Call):
            if (
                not isinstance(node.func, ast.Name)
                or node.func.id not in STAR_FORMULA_FUNCTIONS
                or node.keywords
            ):
                raise ValueError("公式调用了不支持的函数")
            for argument in node.args:
                visit(argument)
            return
        raise ValueError(f"公式不支持 {type(node).__name__}")

    visit(expression)
    return variables


def resolved_star_brightness_rules(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return deepcopy(DEFAULT_STAR_BRIGHTNESS_RULES)
    if value in PREVIOUS_DEFAULT_STAR_BRIGHTNESS_RULE_SETS:
        return deepcopy(DEFAULT_STAR_BRIGHTNESS_RULES)
    if value and all(
        isinstance(item, dict)
        and "formula" not in item
        and item.get("id") in LEGACY_STAR_BRIGHTNESS_RULE_IDS
        for item in value
    ):
        definitions = {
            item["id"]: item for item in DEFAULT_STAR_BRIGHTNESS_RULES
        }

        def legacy_priority(item: dict[str, Any]) -> int:
            try:
                return int(item.get("priority", 0))
            except (TypeError, ValueError):
                return 0

        ordered = sorted(
            value,
            key=legacy_priority,
            reverse=True,
        )
        return [
            deepcopy(
                definitions[LEGACY_STAR_BRIGHTNESS_RULE_IDS[item["id"]]]
            )
            for item in ordered
        ]

    rules: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        rule_id = str(item.get("id", "")).strip()
        name = str(item.get("name", "")).strip()
        target = str(item.get("target", "")).strip()
        formula = str(item.get("formula", "")).strip()
        if (
            not STAR_FORMULA_ID_PATTERN.fullmatch(rule_id)
            or rule_id in seen
            or not name
            or target not in STAR_FORMULA_TARGETS
        ):
            continue
        try:
            validate_star_formula(formula)
        except ValueError:
            continue
        seen.add(rule_id)
        rules.append(
            {
                "id": rule_id,
                "name": name[:80],
                "enabled": item.get("enabled") is not False,
                "target": target,
                "formula": formula,
            }
        )
    return rules


def resolved_star_brightness_tiers(
    value: Any,
    _minimum: float,
    _maximum: float,
) -> list[dict[str, Any]]:
    source = value if isinstance(value, list) else DEFAULT_STAR_BRIGHTNESS_TIERS
    tiers: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_thresholds: set[float] = set()
    for item in source:
        if not isinstance(item, dict):
            continue
        tier_id = str(item.get("id", "")).strip()
        name = str(item.get("name", "")).strip()
        try:
            threshold = float(item.get("min_brightness"))
        except (TypeError, ValueError):
            continue
        threshold = max(0, min(100, threshold))
        if (
            not STAR_FORMULA_ID_PATTERN.fullmatch(tier_id)
            or tier_id in seen_ids
            or threshold in seen_thresholds
            or not name
        ):
            continue
        seen_ids.add(tier_id)
        seen_thresholds.add(threshold)
        tiers.append(
            {
                "id": tier_id,
                "name": name[:80],
                "min_brightness": threshold,
            }
        )
    if not tiers:
        return resolved_star_brightness_tiers(
            DEFAULT_STAR_BRIGHTNESS_TIERS,
            _minimum,
            _maximum,
        )
    return sorted(tiers, key=lambda item: item["min_brightness"])
