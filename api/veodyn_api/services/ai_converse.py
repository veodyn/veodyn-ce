"""The Create-with-AI interview: a transcript in, a grounded proposal out.

Same division of labour as ai_report.py, applied to a conversation rather than a
one-shot: **the model writes words, this module assigns ids.** The model names a
table, a query, a chart shape. Every one of those names is looked up against the
grounding assembled here, and a name that is not in the list is DROPPED: the
turn degrades to `ready: false` with a reply saying what could not be resolved.
An ungrounded id never reaches the response, so the worst a steered or confused
model can do is fail to propose, not propose a link to something imaginary.

Two consequences worth stating:

- The client sends no grounding. Unlike /ai/outline, which takes a dataset list
  from the browser, this endpoint assembles the catalog and the query list
  itself, so a modified client cannot make the model believe in a table that
  does not exist. The one thing it does send back is `focusTable`, and that is
  a lookup key into the same list rather than a name (see below).
- Generated SQL is not written here. A ready `query` turn calls the existing
  generate_sql(), so validate_sql and its retry-with-reason apply unchanged and
  this service keeps exactly one SQL validator.

What the model is told lives in ai_converse_prompt.py.
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

# What the analyst reads when both asks came back without words. It is this
# service's sentence, not the model's, and it says what happened rather than
# "tell me a little more": that sentence asked a reader who had been perfectly
# clear to explain themselves again for a failure that was ours.
NO_REPLY_FALLBACK = (
    "That turn came back from the model with nothing in it. Send your message again, or add a "
    "detail to it, and I will have another go."
)

# The tool schema's own field names. The log line below reports which of THESE
# came back and counts the rest, rather than printing the keys it was given: a
# key name is model output like any other, and the transcript it was derived
# from has no business in a pod log.
KNOWN_ANSWER_KEYS = frozenset({"reply", "suggestedAnswers", "ready", "proposal", "focusTable"})

# Appended to the system block on the second attempt. It names the field that
# was missing rather than restating the whole contract: the first answer proved
# the model had read the rules, since it filled in the other fields.
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
    """Logged on both asks, so the follow-up's own success rate is readable from
    the pod log rather than inferred. Keys and counts only, never the transcript
    or the model's prose."""
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

    `resolve_visualization` and `columns_of` are injected rather than taken off a
    Redash client so this function does no I/O of its own beyond the calls it
    delegates, and so both paths are testable without a stubbed HTTP layer. Only
    the dashboard kind uses the first; only a KPI over an existing query uses the
    second.
    """
    # Resolved against the service's OWN catalog, every turn. It arrives through
    # the client, which is the half of this an attacker can rewrite, and that is
    # fine precisely because it is only a lookup key: the worst a forged value
    # can do is fail to match and cost the turn its profile.
    focused = next((one for one in grounding.datasets if one.id == payload.focus_table), None)
    profile = cached_profile(warehouse, focused) if warehouse is not None and focused is not None else None
    system = system_prompt(
        grounding.kind,
        datasets=grounding.datasets,
        queries=grounding.queries,
        # Not part of the grounding: that is cached per kind and shared by
        # every caller, and one dashboard's widgets are neither.
        editing=editing,
        profile=profile,
    )
    messages = transcript(payload.messages)
    schema = converse_schema(payload.kind)

    # `reply` is a required field of the tool, and a forced tool call does not
    # reliably deliver one. Observed on stage, with the answer's own keys in the
    # log: `known=['proposal', 'ready']`, so the model answered with a proposal
    # and no words at all. That turn is unusable (`ready` is what gates a
    # proposal), and the analyst spent one of twelve on it to be told "tell me a
    # little more".
    answer = llm.conversation(system=system, messages=messages, schema=schema, tool_name="propose")
    reply = text_of(answer.get("reply"), 4_000)
    chips = _chips(answer)
    # The previous focus is the fallback, so a turn that does not restate the
    # table keeps it. Without that the profile would arrive on one turn and be
    # gone on the next, which is the conversation forgetting what it is about.
    #
    # Resolved against the catalog on the way OUT as well as on the way in. The
    # incoming value was already checked, but the model's own answer was not, and
    # a name it invented would be handed to the client, sent back next turn,
    # match nothing again, and stick: every later turn would carry a table that
    # does not exist and no profile, with the real one displaced. An unmatched
    # name keeps whatever the conversation had already settled on.
    named = text_of(answer.get("focusTable"), 255)
    focus = named if any(one.id == named for one in grounding.datasets) else payload.focus_table

    if not reply:
        _log_no_reply(payload.kind, 1, answer, chips)
        # The second ask is for the WORDS, not for the turn again. Asking the
        # identical question a second time is what this used to do, and on
        # 2026-07-29 a report turn came back `known=['proposal', 'ready']` on
        # both attempts: the reply goes missing exactly when the model has a
        # proposal to write, so repeating the question reproduces the answer.
        # reply_schema() has no proposal field to spend the answer on, and
        # `answer` is left alone, so a proposal the first ask did produce is
        # still built below.
        words = llm.conversation(
            system=f"{system}\n\n{NO_REPLY_RETRY}",
            messages=messages,
            schema=reply_schema(),
            tool_name="say",
        )
        reply = text_of(words.get("reply"), 4_000)
        # From the ask that produced the words: chips are answers to the
        # sentence beside them, and the first ask's chips answer a question
        # nobody read.
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

    # `proposal` should be an object. A model that answered it with a JSON
    # string is the same failure as_objects exists for.
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
    # ConverseOut refuses the pair anyway; this is what keeps that unreachable.
    return ConverseOut(
        # Appended to the model's own words rather than replacing them, which is
        # what `degraded` does: there IS a proposal here, so the reply describing
        # it is still true. What it does not know is that part of it was dropped,
        # and a card showing five widgets under a sentence promising six is the
        # silent version of this.
        reply=partial_note(reply or "Here is what I would create.", built.dropped, built.held_removals),
        suggested_answers=chips,
        ready=True,
        proposal=built.proposal,
        focus_table=focus,
    )
