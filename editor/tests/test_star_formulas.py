from __future__ import annotations

import pytest

from app.star_formulas import (
    DEFAULT_STAR_BRIGHTNESS_RULES,
    DEFAULT_STAR_BRIGHTNESS_TIERS,
    LEGACY_DEFAULT_STAR_BRIGHTNESS_TIERS,
    PREVIOUS_DEFAULT_STAR_BRIGHTNESS_RULE_SETS,
    PREVIOUS_DEFAULT_STAR_BRIGHTNESS_TIERS,
    resolved_star_brightness_rules,
    resolved_star_brightness_tiers,
    validate_star_formula,
)


def test_formula_allowlist_accepts_supported_math() -> None:
    variables = validate_star_formula(
        "sin(pi / 2) + exp(1) + (reference_count ^ 2) % 7 + "
        "total_relation_count"
    )
    assert variables == {
        "pi",
        "reference_count",
        "total_relation_count",
    }


@pytest.mark.parametrize(
    "formula",
    [
        "star.value",
        "__import__('os')",
        "unknown + 1",
        "[1, 2]",
        "current_brightness if 1 else 0",
    ],
)
def test_formula_allowlist_rejects_unsafe_syntax(formula: str) -> None:
    with pytest.raises(ValueError):
        validate_star_formula(formula)


def test_legacy_rules_migrate_in_priority_order() -> None:
    rules = resolved_star_brightness_rules(
        [
            {"id": "document_reference_degree", "priority": 100},
            {"id": "contributor_contribution_count", "priority": "500"},
            {"id": "document_recent_activity", "priority": "invalid"},
        ]
    )
    assert [rule["id"] for rule in rules] == [
        "contributor-total",
        "document-reference",
        "document-recent",
    ]
    assert all("formula" in rule for rule in rules)


@pytest.mark.parametrize(
    "rules",
    PREVIOUS_DEFAULT_STAR_BRIGHTNESS_RULE_SETS,
)
def test_previous_default_formulas_upgrade_without_overwriting_custom_rules(
    rules: list[dict[str, object]],
) -> None:
    assert resolved_star_brightness_rules(rules) == (
        DEFAULT_STAR_BRIGHTNESS_RULES
    )
    customized = [dict(rule) for rule in rules]
    customized[0]["formula"] = "current_brightness + 1"
    assert resolved_star_brightness_rules(customized) == customized


def test_contributor_total_upgrades_inside_partially_customized_rules() -> None:
    rules = [
        dict(rule)
        for rule in PREVIOUS_DEFAULT_STAR_BRIGHTNESS_RULE_SETS[1]
    ]
    rules[1]["formula"] = (
        "current_brightness + brightness_span * 0.15 * "
        "min(1, log(1 + modification_30_count / log(501)))"
    )
    resolved = resolved_star_brightness_rules(rules)
    assert "total_relation_count" in resolved[0]["formula"]
    assert resolved[1]["formula"] == rules[1]["formula"]


def test_tiers_are_bounded_and_sorted() -> None:
    tiers = resolved_star_brightness_tiers(
        [
            {"id": "high", "name": "高亮", "min_brightness": 90},
            {"id": "low", "name": "低亮", "min_brightness": 0},
        ],
        10,
        80,
    )
    assert tiers == [
        {"id": "low", "name": "低亮", "min_brightness": 0},
        {"id": "high", "name": "高亮", "min_brightness": 90},
    ]


@pytest.mark.parametrize(
    "tiers",
    [
        LEGACY_DEFAULT_STAR_BRIGHTNESS_TIERS,
        PREVIOUS_DEFAULT_STAR_BRIGHTNESS_TIERS,
    ],
)
def test_previous_default_tiers_upgrade_high_brightness_thresholds(
    tiers: list[dict[str, object]],
) -> None:
    tiers = resolved_star_brightness_tiers(
        tiers,
        0,
        100,
    )
    assert tiers == DEFAULT_STAR_BRIGHTNESS_TIERS
    assert tiers[-3:] == [
        {
            "id": "blue-giant",
            "name": "蓝巨星",
            "min_brightness": 85.0,
        },
        {
            "id": "blue-supergiant",
            "name": "蓝超巨星",
            "min_brightness": 95.0,
        },
        {
            "id": "hypergiant",
            "name": "特超巨星",
            "min_brightness": 99.0,
        },
    ]


def test_custom_tiers_are_not_replaced_by_default_migration() -> None:
    custom = [
        {"id": "custom-low", "name": "自定义低阶", "min_brightness": 10},
        {"id": "custom-high", "name": "自定义高阶", "min_brightness": 90},
    ]
    assert resolved_star_brightness_tiers(custom, 0, 100) == custom
