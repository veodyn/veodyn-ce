"""Running one `/validate` request through the package, and shaping its report.

Two departures from calling `gtfs_rt_validator.api.validate` and
`gtfs_rt_validator.report.modern.build_report` back to back:

1. **The previous message must not appear in the report.** `validate` walks
   every cycle it is handed and merges every message's findings into one
   report, because an archive replay wants exactly that: a run over a
   directory of thousands of files reports on all of them. A previous-
   iteration comparison does not want that. `previous` exists only to feed
   `RuleContext.previous` for iteration-sensitive rules (see the package's
   `runner/run.py`, where `_Run.record` sets `state.previous` from whichever
   cycle was validated last), and its own findings are not a fact about the
   feed the caller asked to validate; they are a fact about whatever was
   published last cycle, however broken. So this module sinks every
   `MessageResult` `validate` produces and keeps only the one whose source
   name is `_CURRENT`, rather than the run's own merged container, which
   would silently fold the previous message's findings into `totalNotices`.
2. **`title` is added per notice.** It is not in the package's own
   `build_report` output; see `manifest.rule`. A code with no manifest entry
   (an `S`- or `P`-tier rule; only `E`/`W` upstream ids are in the packed
   manifest) gets an empty title rather than an error, per the brief.
"""

from __future__ import annotations

from typing import Any, cast

from gtfs_rt_validator.api import Inputs, Mode, PreparedFeed, Request, validate
from gtfs_rt_validator.report.manifest import rule as manifest_rule
from gtfs_rt_validator.report.modern import build_report
from gtfs_rt_validator.report.occurrence import NoticeContainer
from gtfs_rt_validator.runner import MessageResult, Source, url_cycle

#: Source names for the two cycles a request can carry. Not real URLs: they
#: only need to be stable and distinct, since `url_cycle` uses the name purely
#: as `Source.name` / `MessageResult.source.name`, which is how this module
#: tells the previous message's `MessageResult` apart from the current one's.
_PREVIOUS = "previous"
_CURRENT = "current"


class FeedDecodeError(Exception):
    """The `feed` bytes could not be decoded as a GTFS-Realtime message.

    Decode failures are normally silent to `validate` (recorded as a system
    error, not raised, so a directory replay does not abort on one bad file).
    But when the *current* message is the one that failed, there is no
    `MessageResult` to build a report from at all, and the brief's contract
    has nowhere to put that except a 400: the caller sent bytes this service
    cannot validate.
    """


def run_validation(
    prepared: PreparedFeed,
    feed_bytes: bytes,
    previous_bytes: bytes | None,
) -> dict[str, Any]:
    """The enriched report for `feed_bytes`, using `previous_bytes` as context.

    Raises `FeedDecodeError` if `feed_bytes` does not decode. A `previous_bytes`
    that fails to decode is treated as no previous message at all: the package
    skips a cycle whose only source failed to decode entirely (see
    `runner/run.py`'s `if not decoded: continue`), so `state.previous` is never
    set from it and the current message is validated exactly as it would be
    with no `previous` sent. That is a deliberate choice: `previous` is a
    best-effort optimization input, not a second payload this service is
    responsible for validating.
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
    # override), so mypy resolves everything imported from it, including
    # build_report's real `dict[str, object]` return, as Any. The cast states
    # what the source annotation already promises.
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

    `manifest.rule` only knows the 61 upstream (`E`/`W`) ids; an `S` or `P`
    rule raises `KeyError` there, and the brief is explicit that such a code
    gets an empty title rather than an error, so this catches exactly that.
    """
    notices = cast(list[dict[str, Any]], report["notices"])
    for notice in notices:
        code = cast(str, notice["code"])
        try:
            notice["title"] = manifest_rule(code).title
        except KeyError:
            notice["title"] = ""
