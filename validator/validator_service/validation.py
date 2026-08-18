"""Running one `/validate` request through the package, and shaping its report.

Two departures from calling `gtfs_rt_validator.api.validate` and
`gtfs_rt_validator.report.modern.build_report` back to back:

1. **The previous message must not appear in the report.** `validate` merges
   every cycle's findings into one report, which is what an archive replay
   wants. `previous` exists only to feed `RuleContext.previous` for
   iteration-sensitive rules (the package's `runner/run.py`, where `_Run.record`
   sets `state.previous`), so this module sinks every `MessageResult` and keeps
   only the one whose source name is `_CURRENT`, rather than the run's own merged
   container, which would fold the previous message's findings into
   `totalNotices`.
2. **`title` is added per notice**, from `manifest.rule`; it is not in the
   package's own `build_report` output. A code with no manifest entry (an `S`- or
   `P`-tier rule) gets an empty title rather than an error, per the brief.
"""

from __future__ import annotations

from typing import Any, cast

from gtfs_rt_validator.api import Inputs, Mode, PreparedFeed, Request, validate
from gtfs_rt_validator.report.manifest import rule as manifest_rule
from gtfs_rt_validator.report.modern import build_report
from gtfs_rt_validator.report.occurrence import NoticeContainer
from gtfs_rt_validator.runner import MessageResult, Source, url_cycle

#: Source names for the two cycles a request can carry. Not real URLs: they only
#: need to be stable and distinct, since they arrive as
#: `MessageResult.source.name`, which is how the two are told apart below.
_PREVIOUS = "previous"
_CURRENT = "current"


class FeedDecodeError(Exception):
    """The `feed` bytes could not be decoded as a GTFS-Realtime message.

    Decode failures are normally silent to `validate` (recorded as a system
    error, not raised). But when the *current* message is the one that failed
    there is no `MessageResult` to build a report from at all, which the brief's
    contract answers with a 400.
    """


def run_validation(
    prepared: PreparedFeed,
    feed_bytes: bytes,
    previous_bytes: bytes | None,
) -> dict[str, Any]:
    """The enriched report for `feed_bytes`, using `previous_bytes` as context.

    Raises `FeedDecodeError` if `feed_bytes` does not decode. A `previous_bytes`
    that fails to decode is treated as no previous message at all: the package
    skips a cycle whose only source failed to decode (see `runner/run.py`'s
    `if not decoded: continue`), so `state.previous` is never set from it.
    `previous` is a best-effort input, not a second payload this service
    validates.
    """
    cycles: list[tuple[Source, ...]] = []
    if previous_bytes is not None:
        cycles.append(url_cycle(_PREVIOUS, lambda: previous_bytes))
    cycles.append(url_cycle(_CURRENT, lambda: feed_bytes))
    inputs = Inputs(cycles=tuple(cycles), directory_replay=False)
    request = Request(mode=Mode.MODERN, gtfs=prepared, inputs=inputs)

    message_results: list[MessageResult] = []
    result = validate(request, sink=message_results.append)

    notices = _current_notices(message_results)
    # gtfs_rt_validator ships no py.typed marker (see pyproject.toml's mypy
    # override), so build_report's real `dict[str, object]` return resolves as
    # Any. The cast states what the source annotation already promises.
    report = cast(dict[str, Any], build_report(notices, result.summary()))
    _add_titles(report)
    return report


def _current_notices(message_results: list[MessageResult]) -> NoticeContainer:
    for message_result in message_results:
        if message_result.source.name == _CURRENT:
            return message_result.notices
    raise FeedDecodeError("feed could not be decoded as a GTFS-Realtime FeedMessage")


def _add_titles(report: dict[str, Any]) -> None:
    """Add `title` to every notice entry, in place.

    `manifest.rule` only knows the 61 upstream (`E`/`W`) ids and raises
    `KeyError` for an `S` or `P` rule, which the brief says gets an empty title.
    """
    notices = cast(list[dict[str, Any]], report["notices"])
    for notice in notices:
        code = cast(str, notice["code"])
        try:
            notice["title"] = manifest_rule(code).title
        except KeyError:
            notice["title"] = ""
