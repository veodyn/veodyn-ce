"""The shape the interview forces its answer into, one variant per kind.

Split from ai_converse_prompt.py, which is the prose the model reads. This is the
tool definition it must answer with. The two fail differently and are argued
about differently: prose that is slightly wrong makes the model unhelpful, and a
field that is missing here makes an answer impossible to give at all.

The rule the whole file follows: a kind that can write a query is given the
fields to ASK for one, and requiring `queryId` is what made a kind tell the
analyst to go and create the query themselves instead.
"""

from typing import Any

from veodyn_api.schemas.ai_create import MAX_SUGGESTED_ANSWERS, CreateKind
from veodyn_api.services.ai_converse_prompt import CADENCES, DIRECTIONS
from veodyn_api.services.ai_outline import outline_schema
from veodyn_api.services.ai_viz_choice import VIZ_FIELD_DESCRIPTION


def _string(description: str) -> dict[str, Any]:
    return {"type": "string", "description": description}


def _new_query_fields(*, viz: bool) -> dict[str, Any]:
    """The fields a kind uses to ask for a query that does not exist yet.

    Written once and spread into the kinds that offer it, so a dashboard widget
    and a KPI cannot end up describing the same mechanism two ways.

    `viz` is false for the KPI, which is not sent the shape guide: its source
    query's shape is known from the kind. See VIZ_KINDS and KPI_SOURCE_VIZ.
    """
    fields: dict[str, Any] = {
        "datasetTable": _string("For a NEW query: the `table` of one dataset from the catalog, copied exactly."),
        "intent": _string(
            "For a NEW query: what the SQL must do, in one or two sentences, naming the columns and any window."
        ),
    }
    if viz:
        fields["vizChoiceId"] = _string(f"For a NEW query: {VIZ_FIELD_DESCRIPTION}")
    return fields


PROPOSAL_FIELDS: dict[CreateKind, dict[str, Any]] = {
    "query": {
        "name": _string("A short name for the query."),
        "description": _string("One sentence: what the query answers."),
        "datasetTable": _string("The `table` of one dataset from the catalog, copied exactly."),
        "intent": _string("What the SQL must do, in one or two sentences, naming the columns and any window."),
        "vizChoiceId": _string(VIZ_FIELD_DESCRIPTION),
    },
    "dashboard": {
        "name": _string("A short name for the dashboard."),
        "widgets": {
            "type": "array",
            "maxItems": 8,
            "items": {
                "type": "object",
                "properties": {
                    "queryId": {
                        "type": "integer",
                        "description": "The id of a query from the list. Leave out for a new query.",
                    },
                    **_new_query_fields(viz=False),
                    # Outside _new_query_fields, unlike every other kind's, because
                    # a widget's shape is the one field here that means something
                    # for a query that ALREADY exists. Scoped to new queries it
                    # made "turn these tables into charts" a request the model had
                    # no way to answer: it would describe the change in prose, the
                    # answer carried nothing but the same query ids, and the card
                    # correctly reported that nothing had changed.
                    "vizChoiceId": _string(
                        f"{VIZ_FIELD_DESCRIPTION} Set it for a new query, and for an existing one whose "
                        "shape should change. Leave it out to keep an existing widget as it is drawn now."
                    ),
                    "title": _string("The widget's heading."),
                },
                # `title` only: a widget names an existing query OR describes a
                # new one, and requiring queryId is what made the model tell the
                # analyst to go and create the query themselves.
                "required": ["title"],
            },
        },
    },
    "kpi": {
        "name": _string("A short name for the KPI."),
        "description": _string("One sentence: what it measures and why it matters."),
        # Not required, for the same reason the dashboard widget's is not: a KPI
        # names the query that produces its number OR describes the one that
        # should, and demanding the id is what left it with nothing to offer an
        # analyst whose instance has no such query.
        "queryId": {
            "type": "integer",
            "description": "The id of the query from the list that produces the value. Leave out for a new query.",
        },
        **_new_query_fields(viz=False),
        "valueColumn": _string("The result column holding the number."),
        "unit": _string("The unit, or an empty string when it has none."),
        # Null, not 0, for "they gave none". Zero is a target an analyst asks
        # for in this domain (zero dropped feeds, zero safety incidents), and a
        # sentinel that collides with a real value makes it unaskable.
        "target": {
            "type": ["number", "null"],
            "description": "The target the analyst gave, or null when they gave none.",
        },
        "direction": _string(f"One of: {', '.join(DIRECTIONS)}."),
        "cadence": _string(f"How often it is evaluated. One of: {', '.join(CADENCES)}."),
        # Only when the analyst names a band. Without these fields an analyst
        # who said "at risk below 80" was agreed with in conversation and then
        # given a KPI at risk at 100, because the bands are derived from the
        # target and the instruction had nowhere to go.
        "atRisk": {
            "type": ["number", "null"],
            "description": (
                "The value the analyst said the KPI is at risk at, or null when they did not say. "
                "Leave it null unless they named a band; the target derives both bounds otherwise."
            ),
        },
        "breached": {
            "type": ["number", "null"],
            "description": (
                "The value the analyst said counts as breached, or null when they did not say. "
                "Worse than atRisk in the direction this KPI is measured, or both are ignored."
            ),
        },
    },
    # The writing variant: this conversation has the catalog and a generator on
    # the other side of it, which /ai/outline does not.
    "report": {"outline": outline_schema(can_write=True)},
    "snippet": {
        "trigger": _string("A single lowercase token that expands the snippet."),
        "snippet": _string("The SQL fragment."),
        "description": _string("One sentence: when to use it."),
    },
}


def _words_fields() -> dict[str, Any]:
    """The two fields the analyst reads, in the one shape both schemas ask for."""
    return {
        "reply": _string("What you say to the analyst this turn."),
        "suggestedAnswers": {
            "type": "array",
            "maxItems": MAX_SUGGESTED_ANSWERS,
            "items": {"type": "string"},
            "description": "Short replies the analyst can click. Empty when a free-text answer is wanted.",
        },
    }


def converse_schema(kind: CreateKind) -> dict[str, Any]:
    """The forced tool's shape for one kind.

    `proposal` is deliberately absent from `required`: an interview turn has
    nothing to propose, and demanding the object back on every turn is how a
    model ends up inventing one to fill it in.
    """
    return {
        "type": "object",
        "properties": {
            **_words_fields(),
            "ready": {"type": "boolean", "description": "True only when proposal is filled in."},
            "focusTable": _string(
                "The `table` of the ONE dataset this conversation is now about, copied exactly from the "
                "catalog. Set it as soon as you know, and keep setting it. You are told what that table "
                "currently holds on your next turn: how many rows a snapshot has, what its columns range "
                "over, which of them are categories."
            ),
            "proposal": {"type": "object", "properties": PROPOSAL_FIELDS[kind]},
        },
        # `focusTable` is absent for the same reason `proposal` is: a turn that
        # has not settled on a table must be able to answer without inventing one
        # to fill the field in.
        "required": ["reply", "suggestedAnswers", "ready"],
    }


def reply_schema() -> dict[str, Any]:
    """The words alone, for a turn that came back without any.

    No `proposal` and no `ready`, on purpose: those are the fields the model
    spends the answer on when it drops `reply`. ai_converse.py has the evidence.
    """
    return {"type": "object", "properties": _words_fields(), "required": ["reply", "suggestedAnswers"]}
