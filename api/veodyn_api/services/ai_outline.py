"""The outline tool shape, shared by the two things that ask for an outline.

The Create-with-AI report conversation can also write a query for a section
nothing answers yet, so its schema carries `datasetTable`; `/ai/outline` has no
catalog and no generator, so its schema does not.

**The two callers sit on opposite sides of the CE/EE line**, the conversation in
services/ai_converse_schema.py and `/ai/outline` in services/ai_outline_ee.py, so
the shared tool shape stays in the half that is always installed.
"""

from typing import Any

from veodyn_api.services.ai_viz_choice import VIZ_FIELD_DESCRIPTION

# The model says "no query fits" with 0 rather than null: a nullable integer in
# a tool schema is answered inconsistently, and 0 is not a Redash query id.
NO_QUERY = 0


def outline_schema(*, can_write: bool) -> dict[str, Any]:
    """The outline tool's shape, with or without the write-a-query fields.

    Only the writing caller can act on a table the model names, so only it gets
    `datasetTable` and a shape. `queryId` stops being required there: requiring it
    made the model tell the analyst to create the query themselves. See
    PROPOSAL_FIELDS["dashboard"] in ai_converse_prompt.py.
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
