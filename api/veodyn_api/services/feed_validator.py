"""The boundary to the GTFS-Realtime validator service.

We do not write conformance rules. `gtfs-rt-validator` is the rule set, it runs
as a service beside this one, and this module is the only thing here that knows
its report shape.

**Why a service and not an import.** The validator loads the agency's static
GTFS archive to validate against, which costs about 48 seconds and retains
about 1.9 GB. Held in this process, every API replica would carry its own copy
and pay that on a cold call. The service holds one prepared archive and answers
in about half a second, which is what makes validation possible inside a
synchronous publish request at all. `validator/README.md` is the contract.

**Findings carry no structured entity reference.** A notice is a rule plus
sample occurrences whose only locator is a free-text, rule-specific prefix,
like `vehicle_id bus-2 trip_id GHOST`. Rendering is prefix plus suffix, which
is fine; mapping one back to a source row would need a regex per rule and is
not something this design asks for.

**Occurrences are SAMPLED and the count is not.** `sampleNotices` is capped at
`MAX_EXPORTS_PER_RULE`, 1000 in 0.2.0, while `totalNotices` is the true number.
Below that ceiling the two agree; above it a rule that fired 4000 times arrives
as `totalNotices: 4000` with 1000 samples, which is reachable for an agency
running thousands of vehicles against a rule that trips on all of them.

`Finding.occurrence_count` carries the validator's own total rather than what
this module can count, so the surface never reports the sample size as the
truth. That is the same silent under-report the rest of the publish path
refuses: an operator told "1000 bad vehicles" when 4000 are broken has been
given a number that looks precise and is not.

**Every failure here is closed, never absent.** A timeout, a 500 or a body that
will not parse raises rather than returning an empty finding list, because an
empty list is indistinguishable from a clean feed and would publish unvalidated
bytes.

That rule reaches past transport into the shape of the body, because the ways a
verdict goes missing while the call succeeds all look identical downstream:

- A 200 with no `notices` key, a null one, or one that is not a list, is not a
  report of nothing. `{"error": "validator crashed"}` is the crash itself.
- A verdict from zero rules covers nothing, so it cannot be clean. The report
  states its own inventory in `summary.rulesRun`, and that field distinguishes
  two failures worth telling apart: ABSENT means the report cannot say what
  ran, `[]` means a registry was supplied and held nothing. Both refuse, and
  collapsing them would lose which of the two happened.
- A notice that cannot be read (no `code`, not an object, no usable count) is
  an unintelligible verdict, not an absent finding.
- A severity this module does not recognize blocks. `has_error` is an equality
  test, so anything left verbatim that is not exactly `ERROR` fails open.
"""

from dataclasses import dataclass
from typing import Any

import httpx

# One message is small, but the service may have to fetch and prepare the
# agency's static archive before it can answer, and that is the slow half. A
# ceiling is set here rather than left to httpx's five seconds, which a cold
# prepare would exceed routinely and turn a working validator into an outage.
VALIDATE_TIMEOUT_SECONDS = 60.0


class ValidatorUnavailable(Exception):
    """The validator did not return a verdict. Never treat as a pass."""


# The only severities that are explicitly non-blocking. Everything else is
# folded into ERROR, including a label this module has never seen: the
# validator's own vocabulary is not a contract we control, and a `FATAL` or a
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
    # How many times the rule actually fired, which is NOT how many findings
    # this rule produced: the validator exports a sample. Every finding split
    # out of one notice carries that notice's total, so a reader sees "1 of 40"
    # rather than "1".
    occurrence_count: int


@dataclass(frozen=True)
class ValidationOutcome:
    findings: tuple[Finding, ...]
    # Which rules the validator actually ran, read from the report rather than
    # assumed. Recorded so a green verdict states what it covered: a rule that
    # never ran is not a rule that passed.
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
def normalize_report(notices: list[Any]) -> tuple[Finding, ...]:
    """The validator's per-rule notices, flattened one finding per sample.

    Nothing here is skipped. An entry this function cannot read is raised on,
    and an entry it can read but which carries no samples still produces a
    finding, because the only thing an omission can mean downstream is that the
    rule did not fire.
    """
    findings: list[Finding] = []
    for index, item in enumerate(notices):
        if not isinstance(item, dict):
            raise ValidatorUnavailable(f"notice {index} is a {type(item).__name__}, not an object")

        rule_id = str(item.get("code") or "").strip()
        if not rule_id:
            # A notice with no rule id is a finding that cannot be named, and a
            # finding that cannot be named cannot be triaged away either.
            raise ValidatorUnavailable(f"notice {index} carries no code")

        severity = normalize_severity(item.get("severity"))
        title = str(item.get("title") or "")
        total = _total_of(item, index, rule_id)
        samples = _samples_of(item, index, rule_id)

        if not samples:
            # The rule is in the report, so it fired; it just did not say where.
            # Dropping it would turn a defect into silence, so it is kept with
            # an empty locator and left to block on its own severity.
            findings.append(
                Finding(rule_id=rule_id, severity=severity, title=title, locator="", occurrence_count=total)
            )
            continue

        for sample in samples:
            if not isinstance(sample, dict):
                kind = type(sample).__name__
                raise ValidatorUnavailable(f"notice {index} ({rule_id}) has a sample that is a {kind}")
            findings.append(
                Finding(
                    rule_id=rule_id,
                    severity=severity,
                    title=title,
                    # Absent when the occurrence had no prefix, which the
                    # validator omits rather than sending empty.
                    locator=str(sample.get("prefix") or ""),
                    occurrence_count=total,
                )
            )
    return tuple(findings)


def _total_of(item: dict[str, Any], index: int, rule_id: str) -> int:
    """How many times the rule fired, refused rather than guessed.

    Defaulting a missing count to the number of samples would quietly restate
    the sample size as the truth, which is the one thing `occurrence_count`
    exists to stop.
    """
    total = item.get("totalNotices")
    if not isinstance(total, int) or isinstance(total, bool) or total < 0:
        raise ValidatorUnavailable(f"notice {index} ({rule_id}) has no usable totalNotices")
    return total


def _samples_of(item: dict[str, Any], index: int, rule_id: str) -> list[Any]:
    samples = item.get("sampleNotices")
    if samples is None:
        return []
    if not isinstance(samples, list):
        kind = type(samples).__name__
        raise ValidatorUnavailable(f"notice {index} ({rule_id}) has a sampleNotices that is a {kind}")
    return samples


def _rules_run(payload: dict[str, Any]) -> tuple[str, ...]:
    """The inventory the run actually built, or no verdict at all.

    Two refusals rather than one, because the two states are different facts
    and a single message would lose which happened. The key is ABSENT when the
    validator had no registry to report, and an empty LIST when it had one that
    held nothing. Neither can support a clean verdict.
    """
    summary = payload.get("summary")
    if not isinstance(summary, dict):
        raise ValidatorUnavailable(f"validator returned no summary object (summary is a {type(summary).__name__})")

    if "rulesRun" not in summary:
        raise ValidatorUnavailable(
            "validator's report does not say which rules it ran, so its verdict cannot be read as covering any"
        )

    rules = summary["rulesRun"]
    if not isinstance(rules, list):
        raise ValidatorUnavailable(f"validator reported rulesRun as a {type(rules).__name__}, not a list")
    if not rules:
        raise ValidatorUnavailable("validator ran no rules, so its verdict covers nothing")
    return tuple(str(rule) for rule in rules)


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
        # Supplied explicitly because the previous-iteration rules otherwise
        # compare against whatever the service last happened to see, which for a
        # service shared by several feeds is a different feed entirely.
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

    notices = payload.get("notices")
    if not isinstance(notices, list):
        # `or []` here is what a missing key, a null and a crash body all used
        # to collapse into, and every one of them read as a clean feed.
        raise ValidatorUnavailable(
            f"validator returned no notices list (notices is a {type(notices).__name__}); "
            "an absent report is not an empty one"
        )

    # Read BEFORE the notices are normalized, so a report that cannot say what
    # it ran is refused even when it happens to carry readable findings.
    enabled_rules = _rules_run(payload)
    return ValidationOutcome(findings=normalize_report(notices), enabled_rules=enabled_rules)
