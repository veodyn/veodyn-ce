"""Findings as stored on a publish attempt.

Split out of `publish_engine.py` when that file crossed the size limit, and
this is the seam because it is the one piece with no engine state in it: a pure
mapping from the validator's model to the shape the column holds.

camelCase, because `publish_attempt.findings` is served verbatim.
`FindingOut.model_validate` reads it straight back off the JSONB, so the keys
here and that model's aliases are one contract with no translation between
them.
"""

from typing import Any

from veodyn_api.services.feed_validator import Finding


def findings_as_json(findings: tuple[Finding, ...]) -> list[dict[str, Any]]:
    """One stored object per finding, including the count it was split from.

    `occurrenceCount` is on every finding even though it describes the notice
    they came out of, because the reader is looking at one finding at a time.
    The validator caps exported samples per rule (1000 in 0.3.0) while
    reporting the true total separately, so past that ceiling the rows are a
    sample and only this field knows how many there really were.
    """
    return [
        {
            "ruleId": finding.rule_id,
            "severity": finding.severity,
            "title": finding.title,
            "locator": finding.locator,
            "occurrenceCount": finding.occurrence_count,
        }
        for finding in findings
    ]
