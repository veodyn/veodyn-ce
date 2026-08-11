"""The outline tool shape, shared by the two things that ask for an outline.

Split from ai_report.py, which now holds only the second report stage (outline
to draft blocks). The two are separate calls to the model with separate
grounding, and splitting them is what let this half learn to write a query
without the drafting half having to know about it.

Two callers ask the model for an outline, and they differ in one way that
matters. The Create-with-AI report conversation can also write a query for a
section nothing answers yet, so its tool schema carries `datasetTable`.
`/ai/outline` has no catalog and no generator, so its schema does not; see
`outline_schema`.

**Those two callers are on opposite sides of the CE/EE line, which is why the
schema is here on its own.** The conversation is community
(services/ai_converse_schema.py) and `/ai/outline` is enterprise
(services/ai_outline_ee.py, which holds `build_outline` and the system prompt
that goes with it). The shape of the tool is the part they share, so it stays
in the half that is always installed and the enterprise half imports it.
"""

from typing import Any

from veodyn_api.services.ai_viz_choice import VIZ_FIELD_DESCRIPTION

# The model says "no query fits" with 0 rather than null: a nullable integer in
# a tool schema is answered inconsistently, and 0 is not a Redash query id.
NO_QUERY = 0


def outline_schema(*, can_write: bool) -> dict[str, Any]:
    """The outline tool's shape, with or without the write-a-query fields.

    Two callers, and only one of them can act on a table the model names. The
    Create-with-AI report conversation generates SQL for a section nothing
    answers yet, so it needs `datasetTable` and a shape to draw the result in.
    `/ai/outline` has neither a catalog nor a generator, so offering it those
    fields would have the model spend an answer on keys that path then drops.

    `queryId` stops being required in the writing variant. Requiring it is what
    made the dashboard kind tell the analyst to go and create the query
    themselves, which PROPOSAL_FIELDS["dashboard"] in ai_converse_prompt.py
    records at the line where that was fixed.
    """
    section: dict[str, Any] = {
        "title": {"type": "string", "description": "A short section heading."},
        "intent": {
            "type": "string",
            "description": "One sentence: what this section shows and why it belongs in the report.",
        },
        "queryId": {
            "type": "integer",
            "description": "The id of a query from the list that backs this section, or 0 if none fits.",
        },
        "suggested": {
            "type": "boolean",
            "description": "True for an optional extra section the reader can toggle on.",
        },
    }
    required = ["title", "intent", "queryId", "suggested"]
    if can_write:
        section["datasetTable"] = {
            "type": "string",
            "description": (
                "For a section NO query in the list answers: the `table` of one dataset from the catalog, "
                "copied exactly, with `intent` saying what the SQL must do. Leave out when queryId names "
                "a query."
            ),
        }
        section["vizChoiceId"] = {"type": "string", "description": f"For a NEW query: {VIZ_FIELD_DESCRIPTION}"}
        required = ["title", "intent", "suggested"]
    return {
        "type": "object",
        "properties": {
            "goal": {"type": "string", "description": "The goal restated in one clear sentence."},
            "sections": {
                "type": "array",
                "maxItems": 8,
                "items": {"type": "object", "properties": section, "required": required},
            },
        },
        "required": ["goal", "sections"],
    }
