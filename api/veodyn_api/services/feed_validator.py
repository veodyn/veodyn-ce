"""The boundary to the integrated GTFS-Realtime validator.

We do not write conformance rules. MobilityData's validator is the rule set
(Apache 2.0), it runs as a container, and this module is the only thing that
knows its report shape.

**Findings carry no structured entity reference.** Measured 2026-08-13: a
finding is a rule plus occurrences whose only locator is a free-text,
rule-specific prefix, like `vehicle_id bus-2 trip_id GHOST` or
`trip_id t2 stop_sequence [2, 1]`. Rendering is prefix + suffix, which is
fine; mapping one back to a source row would need a regex per rule and is not
something this design asks for.

**Every failure here is closed, never absent.** A timeout, a 500 or a body
that will not parse raises rather than returning an empty finding list,
because an empty list is indistinguishable from a clean feed and would publish
unvalidated bytes.

That rule reaches past transport into the shape of the body, because the ways
a verdict goes missing while the call succeeds all look identical downstream:

- A 200 with no `report` key, a null one, or one that is not a list, is not a
  report of nothing. `{"error": "validator crashed"}` is the crash itself.
- A verdict from zero enabled rules covers nothing, so it cannot be clean. An
  empty `report` alongside a non-empty `enabledRules` is the one legitimate
  clean pass.
- A report entry that cannot be read (no `errorId`, not an object) is an
  unintelligible verdict, not an absent finding.
- A severity this module does not recognize blocks. `has_error` is an equality
  test, so anything left verbatim that is not exactly `ERROR` fails open.
"""

from dataclasses import dataclass
from typing import Any

import httpx

# One feed is small, but the validator loads and parses the agency's static
# GTFS on every call, and that is the slow half. A ceiling is set here rather
# than left to httpx's five seconds, which a cold schedule load would exceed
# routinely and turn a working validator into an outage.
VALIDATE_TIMEOUT_SECONDS = 60.0


class ValidatorUnavailable(Exception):
    """The validator did not return a verdict. Never treat as a pass."""


# The only severities that are explicitly non-blocking. Everything else is
# folded into ERROR, including a label this module has never seen: the
# validator's own docs are not a contract we control, and a `FATAL` or a
# lowercase `error` passed through verbatim would slip past `has_error`.
NON_BLOCKING_SEVERITIES = frozenset({"WARNING", "INFO"})


def normalize_severity(raw: object) -> str:
    """Blocking unless recognizably, explicitly not.

    Case and surrounding space are the validator's to vary; the decision to let
    a feed publish is not.
    """
    if isinstance(raw, str):
        canonical = raw.strip().upper()
        if canonical in NON_BLOCKING_SEVERITIES:
            return canonical
    return "ERROR"


@dataclass(frozen=True)
class Finding:
    rule_id: str
    severity: str
    title: str
    # Free text, straight from the validator. See the module docstring.
    locator: str


@dataclass(frozen=True)
class ValidationOutcome:
    findings: tuple[Finding, ...]
    # Which rules the validator was configured to run. Recorded so a green
    # verdict states what it actually covered: a rule that never ran is not a
    # rule that passed.
    enabled_rules: tuple[str, ...]

    @property
    def errors(self) -> tuple[Finding, ...]:
        return tuple(finding for finding in self.findings if finding.severity == "ERROR")

    @property
    def has_error(self) -> bool:
        return any(finding.severity == "ERROR" for finding in self.findings)


# Annotated `list[Any]`, not `list[dict[str, Any]]`, because the entries come
# straight off the wire and being an object is one of the things checked here
# rather than something the caller can promise.
def normalize_report(report: list[Any]) -> tuple[Finding, ...]:
    """The validator's nested rule-and-occurrences shape, flattened one per occurrence.

    One Finding per occurrence rather than per rule, because a rule that fired
    against forty vehicles is forty separate defects to fix; collapsing them
    would report the count as one.

    Nothing here is skipped. An entry this function cannot read is raised on,
    and an entry it can read but which carries no occurrences still produces a
    finding, because the only thing an omission can mean downstream is that the
    rule did not fire.
    """
    findings: list[Finding] = []
    for index, item in enumerate(report):
        rule = _rule_of(item, index)
        rule_id = str(rule.get("errorId") or "").strip()
        if not rule_id:
            # An entry with no rule id is a finding that cannot be named, and a
            # finding that cannot be named cannot be triaged away either.
            raise ValidatorUnavailable(f"report entry {index} carries no errorId")
        severity = normalize_severity(rule.get("severity"))
        title = str(rule.get("title") or "")

        occurrences = item.get("occurrenceList")
        if occurrences is None:
            occurrences = []
        if not isinstance(occurrences, list):
            raise ValidatorUnavailable(
                f"report entry {index} ({rule_id}) has an occurrenceList that is a {type(occurrences).__name__}"
            )
        if not occurrences:
            # The rule is in the report, so it fired; it just did not say where.
            # Dropping it would turn a defect into silence, so it is kept with
            # an empty locator and left to block on its own severity.
            findings.append(Finding(rule_id=rule_id, severity=severity, title=title, locator=""))
            continue
        for occurrence in occurrences:
            if not isinstance(occurrence, dict):
                raise ValidatorUnavailable(
                    f"report entry {index} ({rule_id}) has an occurrence that is a {type(occurrence).__name__}"
                )
            findings.append(
                Finding(
                    rule_id=rule_id,
                    severity=severity,
                    title=title,
                    locator=str(occurrence.get("prefix") or ""),
                )
            )
    return tuple(findings)


def _rule_of(item: Any, index: int) -> dict[str, Any]:
    """The validationRule object of one report entry, or no verdict at all."""
    if not isinstance(item, dict):
        raise ValidatorUnavailable(f"report entry {index} is a {type(item).__name__}, not an object")
    message = item.get("errorMessage")
    rule = message.get("validationRule") if isinstance(message, dict) else None
    if not isinstance(rule, dict):
        raise ValidatorUnavailable(f"report entry {index} carries no validationRule object")
    return rule


def validate_feed(
    client: httpx.Client,
    base_url: str,
    feed_bytes: bytes,
    static_gtfs_ref: str,
    previous_feed: bytes | None,
) -> ValidationOutcome:
    """One feed against one schedule. Raises ValidatorUnavailable rather than guessing."""
    files: dict[str, tuple[str, bytes, str]] = {
        "feed": ("feed.pb", feed_bytes, "application/octet-stream"),
    }
    if previous_feed is not None:
        # Supplied explicitly because batch mode's previous-iteration rules
        # otherwise compare against whatever file sorted before this one, which
        # in a mixed directory is a different entity type entirely.
        files["previous"] = ("previous.pb", previous_feed, "application/octet-stream")

    try:
        response = client.post(
            f"{base_url.rstrip('/')}/validate",
            files=files,
            data={"gtfs": static_gtfs_ref},
            timeout=VALIDATE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        # httpx.HTTPError covers both transport failures (connect, timeout) and
        # the HTTPStatusError raised above; ValueError covers a 200 whose body
        # is not JSON. All three are "no verdict", and none of them may become
        # an empty finding list.
        raise ValidatorUnavailable(f"validator did not return a verdict: {exc}") from exc

    if not isinstance(payload, dict):
        # A JSON array or a bare string parses fine and carries no verdict.
        raise ValidatorUnavailable(f"validator returned a {type(payload).__name__}, not a report object")

    report = payload.get("report")
    if not isinstance(report, list):
        # `or []` here is what a missing key, a null and a crash body all used
        # to collapse into, and every one of them read as a clean feed.
        raise ValidatorUnavailable(
            f"validator returned no report list (report is a {type(report).__name__}); "
            "an absent report is not an empty one"
        )

    enabled_rules = payload.get("enabledRules")
    if not isinstance(enabled_rules, list) or not enabled_rules:
        # A validator configured with no rules validated nothing, so its clean
        # verdict covers nothing either. Only an empty report from a non-empty
        # rule set is a pass.
        raise ValidatorUnavailable("validator ran no rules, so its verdict covers nothing")

    return ValidationOutcome(
        findings=normalize_report(report),
        enabled_rules=tuple(str(rule) for rule in enabled_rules),
    )
