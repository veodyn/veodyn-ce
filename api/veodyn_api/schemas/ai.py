"""The wire contract for the community AI endpoints.

This mirrors app/src/types/ai.ts and ai-report.ts, and it is checked TWICE: once
here on the way out, and again by the relay in app/src/lib/ai-proxy.ts on the way
in. The relay's copy is unforgiving (an extra field, a missing queryId on a chart
block, an unexpected `result` are all refused and become a 502), so a drift
between these models and those Zod schemas surfaces as "AI is broken" rather than
as a tolerated difference. Change one, change the other.

schemas/ai_create.py and schemas/ai_ee.py both import from here and never the
reverse, and that import direction is the line between them rather than the
subject: `OutlineSectionOut` and `ReportOutlineOut` stay here even though outline
GENERATION is enterprise, because ai_create.py assembles a community converse
proposal out of them.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """camelCase on the wire, snake_case in Python. Same rule as schemas/kpi.py."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --- generate-sql -----------------------------------------------------------


class AiDatasetColumnIn(CamelModel):
    name: str = Field(max_length=255)
    type: str = Field(max_length=128)
    description: str | None = Field(default=None, max_length=4_000)


class AiDatasetIn(CamelModel):
    table: str = Field(max_length=255)
    columns: list[AiDatasetColumnIn] = Field(max_length=500)


class GenerateSqlIn(CamelModel):
    prompt: str = Field(min_length=1, max_length=10_000)
    dataset: AiDatasetIn
    current_sql: str | None = Field(default=None, max_length=50_000)


class GenerateSqlOut(CamelModel):
    sql: str
    rationale: str


class NewQueryProposalOut(CamelModel):
    """A query the AI wrote because the instance did not have one that fits.

    The output of one `generate_sql` call, so it has been through the
    one-statement, read-only, right-table check and its retry-with-reason. It
    sits beside generate-sql rather than with the proposals in ai_create.py, or an
    outline section would import the conversation contract to describe a query.

    Carries everything QueryProposalOut does except its `kind` discriminator.
    """

    name: str
    description: str
    sql: str
    dataset_table: str
    # A VIZ_CHOICES id, not a Redash type. See CHOICE_IDS in
    # services/ai_viz_choice.py for the closed list and where it comes from.
    viz_choice_id: str
    # The renderer options for that shape (a column mapping, stacking, an axis
    # scale), sanitized against schemas/public_viz_options.py and checked against
    # the statement's real columns before it gets here.
    #
    # No default: pydantic marks a defaulted field OPTIONAL in the OpenAPI
    # schema, openapi-typescript then generates `vizOptions?`, and the generated
    # contract test refuses it against the hand-written type. The wire always
    # carries this key.
    viz_options: dict[str, Any]


# --- the outline a conversation can propose ---------------------------------
#
# The RESPONSE side only. The request types (OutlineIn and the rest) are in
# schemas/ai_ee.py with the endpoint that accepts them.


class OutlineSectionOut(CamelModel):
    id: str
    title: str
    intent: str
    # Required and nullable, not optional: the relay's schema demands the key be
    # present. Null means "no query backs this section yet", which is a valid
    # outline and becomes a narrative-only block.
    source_query_id: int | None
    # Set when the report conversation wrote SQL for a section no existing query
    # answers. The card creates it and puts the id it gets back into
    # source_query_id before asking for the blocks, so build_report_blocks never
    # sees one of these.
    new_query: NewQueryProposalOut | None
    suggested: bool
    enabled: bool

    @model_validator(mode="after")
    def _not_both_sources(self) -> "OutlineSectionOut":
        """A section names a query, writes one, or is prose. Never two.

        A section carrying both would have the card create a query and then draw a
        different one beside the same words. Unlike a dashboard widget, NEITHER is
        valid here: a section with no source is prose.
        """
        if self.source_query_id is not None and self.new_query is not None:
            raise ValueError("a section names an existing query or writes one, not both")
        return self


class ReportOutlineOut(CamelModel):
    goal: str
    sections: list[OutlineSectionOut]
