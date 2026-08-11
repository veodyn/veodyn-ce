"""The wire contract for the community AI endpoints.

This mirrors app/src/types/ai.ts and ai-report.ts, and it is checked
TWICE: once here on the way out, and again by the relay in
app/src/lib/ai-proxy.ts on the way in. The relay's copy is deliberately
unforgiving (an extra field, a missing queryId on a chart block, a `result`
that was not there before are all refused and become a 502), so a drift between
these models and those Zod schemas surfaces as "AI is broken", not as a
tolerated difference. Change one, change the other.

The Create-with-AI conversation is schemas/ai_create.py, which mirrors
app/src/types/ai-create.ts the same way. It imports from here and not the
other way round: a proposal is built out of these pieces (a generated query, a
report outline), while nothing here needs to know a conversation exists.

The enterprise endpoints' half is schemas/ai_ee.py, which also imports from here
and not the reverse. **The line between the two is that import direction rather
than the subject.** `OutlineSectionOut` and `ReportOutlineOut` describe an
outline, and outline GENERATION is enterprise, but they stay here because
ai_create.py assembles a converse proposal out of them and converse is
community. A build with no pack can propose a report in an interview turn and
has no endpoint that drafts one.
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

    Beside generate-sql rather than with the proposals, because that is what it
    is: the output of one `generate_sql` call, so it has been through the
    one-statement, read-only, right-table check and its retry-with-reason. Three
    containers carry one (a dashboard widget, a KPI, a report section) and two of
    them live in ai_create.py, so putting it there would make an outline section
    import the conversation contract to describe a query.

    Carries everything QueryProposalOut does except its `kind` discriminator,
    because whoever holds one creates it with exactly the same call: write the
    query, then point the container at what it produced.
    """

    name: str
    description: str
    sql: str
    dataset_table: str
    # A VIZ_CHOICES id, not a Redash type. See CHOICE_IDS in
    # services/ai_viz_choice.py for the closed list and where it comes from.
    viz_choice_id: str
    # The renderer options for that shape: a column mapping, stacking, an axis
    # scale. Always present and often empty, never optional: ConverseOut's own
    # comment explains why (the relay's schema is strict, and an optional field
    # here becomes a "may be absent" in the generated frontend contract).
    #
    # Sanitized against schemas/public_viz_options.py and checked against the
    # statement's real columns before it gets here, so what the card receives
    # names only keys a renderer reads and columns the query returns.
    #
    # No default, for the reason the comment above claims and a default would
    # have quietly broken: pydantic marks a defaulted field OPTIONAL in the
    # OpenAPI schema, openapi-typescript then generates `vizOptions?`, and the
    # generated contract test refuses it against the hand-written type. The wire
    # always carries this key, so the schema has to say so.
    viz_options: dict[str, Any]


# --- the outline a conversation can propose ---------------------------------
#
# The RESPONSE side of an outline only. The request types (OutlineIn and the
# rest) are in schemas/ai_ee.py with the endpoint that accepts them; these two
# are here because ai_create.py's ReportProposalOut is built out of them.


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

        A section carrying both would have the card create a query and then draw
        a different one beside the same words. Unlike a dashboard widget, NEITHER
        is valid here: a section with no source is prose, which is a section an
        outline is allowed to contain.
        """
        if self.source_query_id is not None and self.new_query is not None:
            raise ValueError("a section names an existing query or writes one, not both")
        return self


class ReportOutlineOut(CamelModel):
    goal: str
    sections: list[OutlineSectionOut]
