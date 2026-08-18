"""The Create-with-AI interview: a transcript in, a grounded proposal out.

The model writes words, this module assigns ids: every table, query and chart
shape it names is looked up against the grounding, and a name outside the list is
DROPPED to a `ready: false` turn. An ungrounded id never reaches the response.

The client sends no grounding of its own; `focusTable` comes back but is a lookup
key into the same list. Generated SQL is written by generate_sql(), so this
service keeps exactly one SQL validator. What the model is told lives in
ai_converse_prompt.py.
"""

import logging
from typing import Any

from veodyn_api.schemas.ai_create import MAX_SUGGESTED_ANSWERS, ConverseIn, ConverseOut, CreateKind
from veodyn_api.services.ai_converse_dashboard import VisualizationResolver
from veodyn_api.services.ai_converse_grounding import Grounding
from veodyn_api.services.ai_converse_prompt import system_prompt, text_of, transcript
from veodyn_api.services.ai_converse_proposals import (
    ResultColumns,
    build_proposal,
    degraded,
    partial_note,
)
from veodyn_api.services.ai_converse_schema import converse_schema, reply_schema
from veodyn_api.services.ai_grounding import DashboardWidget
from veodyn_api.services.clickhouse import ClickHouseClient
from veodyn_api.services.dataset_profile_cache import cached_profile
from veodyn_api.services.llm import LlmClient, as_objects

logger = logging.getLogger(__name__)

# What the analyst reads when both asks came back without words.
NO_REPLY_FALLBACK = (
    "That turn came back from the model with nothing in it. Send your message again, or add a "
    "detail to it, and I will have another go."
)

# The tool schema's own field names. The log line below reports which of THESE
# came back and counts the rest: a key name is model output, and model output does
# not belong in a pod log.
KNOWN_ANSWER_KEYS = frozenset({"reply", "suggestedAnswers", "ready", "proposal", "focusTable"})

# Appended to the system block on the second attempt.
NO_REPLY_RETRY = (
    "Your previous answer carried no `reply`, so the analyst is looking at a blank turn. Answer "
    "again with the words alone: what you say to them now. Anything you proposed has already been "
    "recorded, so do not propose it again here. If you cannot propose anything yet, say what you "
    "still need to know."
)


def _chips(answer: dict[str, Any]) -> list[str]:
    """The clickable replies, trimmed, emptied of blanks and capped."""
    chips = [text_of(one, 120) for one in answer.get("suggestedAnswers") or [] if isinstance(one, str)]
    return [one for one in chips if one][:MAX_SUGGESTED_ANSWERS]


def _log_no_reply(kind: CreateKind, ask: int, answer: dict[str, Any], chips: list[str]) -> None:
    """Logged on both asks. Keys and counts only, never the transcript or the
    model's prose."""
    logger.warning(
        "converse(%s): the model returned no reply text on attempt %d (known=%s, unknown=%d, chips=%d)",
        kind,
        ask,
        sorted(key for key in answer if key in KNOWN_ANSWER_KEYS),
        sum(1 for key in answer if key not in KNOWN_ANSWER_KEYS),
        len(chips),
    )


def converse(
    llm: LlmClient,
    payload: ConverseIn,
    grounding: Grounding,
    *,
    resolve_visualization: VisualizationResolver | None = None,
    editing: tuple[DashboardWidget, ...] = (),
    warehouse: ClickHouseClient | None = None,
    columns_of: ResultColumns | None = None,
) -> ConverseOut:
    """One turn: ask the model, then check every id it named.

    `resolve_visualization` and `columns_of` are injected so this function does no
    I/O of its own. Only the dashboard kind uses the first; only a KPI over an
    existing query uses the second.
    """
    # Resolved against the service's OWN catalog every turn. It arrives from the
    # client, so a forged value can only fail to match and cost the turn its
    # profile.
    focused = next((one for one in grounding.datasets if one.id == payload.focus_table), None)
    profile = cached_profile(warehouse, focused) if warehouse is not None and focused is not None else None
    system = system_prompt(
        grounding.kind,
        datasets=grounding.datasets,
        queries=grounding.queries,
        # Not part of the grounding: that is cached per kind and shared by every
        # caller, and one dashboard's widgets are neither.
        editing=editing,
        profile=profile,
    )
    messages = transcript(payload.messages)
    schema = converse_schema(payload.kind)

    # `reply` is a required field of the tool, and a forced tool call does not
    # reliably deliver one: observed on stage as `known=['proposal', 'ready']`.
    answer = llm.conversation(system=system, messages=messages, schema=schema, tool_name="propose")
    reply = text_of(answer.get("reply"), 4_000)
    chips = _chips(answer)
    # Resolved against the catalog on the way OUT as well as in, because the
    # model's own answer was never checked. An unmatched name falls back to the
    # previous focus rather than sticking for every later turn.
    named = text_of(answer.get("focusTable"), 255)
    focus = named if any(one.id == named for one in grounding.datasets) else payload.focus_table

    if not reply:
        _log_no_reply(payload.kind, 1, answer, chips)
        # The second ask is for the WORDS, not for the turn again: the reply goes
        # missing exactly when the model has a proposal to write, so repeating the
        # question reproduces the answer. `answer` is left alone, so a proposal
        # the first ask produced is still built below.
        words = llm.conversation(
            system=f"{system}\n\n{NO_REPLY_RETRY}",
            messages=messages,
            schema=reply_schema(),
            tool_name="say",
        )
        reply = text_of(words.get("reply"), 4_000)
        # From the ask that produced the words: chips are answers to the sentence
        # beside them.
        chips = _chips(words) or chips
        if not reply:
            _log_no_reply(payload.kind, 2, words, chips)

    if not answer.get("ready"):
        return ConverseOut(
            reply=reply or NO_REPLY_FALLBACK,
            suggested_answers=chips,
            ready=False,
            proposal=None,
            focus_table=focus,
        )

    # `proposal` should be an object; a JSON string is what as_objects exists for.
    candidates = as_objects(answer.get("proposal"))
    built = build_proposal(
        llm,
        payload.kind,
        candidates[0] if candidates else {},
        grounding,
        resolve_visualization,
        warehouse=warehouse,
        columns_of=columns_of,
        editing=editing,
    )
    if built.proposal is None:
        return degraded(built.dropped, focus)
    # ready and proposal are set in one expression, so they cannot disagree.
    return ConverseOut(
        # Appended to the model's own words rather than replacing them: there IS a
        # proposal, it just does not know part of it was dropped.
        reply=partial_note(reply or "Here is what I would create.", built.dropped, built.held_removals),
        suggested_answers=chips,
        ready=True,
        proposal=built.proposal,
        focus_table=focus,
    )
