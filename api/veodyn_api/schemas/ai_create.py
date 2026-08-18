"""The Create-with-AI conversation contract: one request per turn, and a
proposal on the turn it converges. The single-shot AI endpoints are schemas/ai.py.

Its authority is app/src/types/ai-create.ts, field for field; the relay's Zod
copy in app/src/app/api/ai/converse/route.ts checks the same shape on arrival
and is unforgiving, so a drift here surfaces as "AI is broken" rather than as a
tolerated difference. Change one, change the other (docs/ai-provider.md).

Imports from schemas/ai.py and never the reverse.
"""

from typing import Annotated, Any, Literal

from pydantic import Field, field_validator, model_validator

from veodyn_api.schemas.ai import CamelModel, NewQueryProposalOut, ReportOutlineOut

CreateKind = Literal["query", "dashboard", "kpi", "report", "snippet"]
# Mirrors KpiDirection/KpiCadence in app/src/types/kpi.ts. Named aliases so the
# service can clamp a model's pick to one of them without a cast.
KpiDirection = Literal["higher-is-better", "lower-is-better"]
KpiCadence = Literal["hourly", "daily", "weekly"]

# Spec section 4.3, the same constants as ai-create.ts. Enforced here as well as
# in the composer and the relay, which are the two an attacker can replace.
MAX_USER_TURNS = 12
MAX_MESSAGE_CHARS = 4_000
MAX_TRANSCRIPT_MESSAGES = 25
MAX_SUGGESTED_ANSWERS = 4


class ConverseMessageIn(CamelModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class ConverseIn(CamelModel):
    kind: CreateKind
    messages: list[ConverseMessageIn] = Field(min_length=1, max_length=MAX_TRANSCRIPT_MESSAGES)
    # The dashboard being EDITED. An id and nothing else: the widgets it holds
    # are read from Redash as the caller, never accepted from the browser.
    target_dashboard_id: int | None = Field(default=None, gt=0)
    # The table the conversation has settled on, handed back from the previous
    # turn. Only a LOOKUP KEY, resolved against the catalog this service
    # assembles itself, so a forged value can at worst match nothing and cost the
    # turn its profile.
    focus_table: str | None = Field(default=None, max_length=255)

    @field_validator("messages")
    @classmethod
    def _within_the_turn_cap(cls, messages: list[ConverseMessageIn]) -> list[ConverseMessageIn]:
        """The user-turn cap, which counts a subset and so cannot be a Field
        constraint. Truncating the transcript instead would drop the opening
        turns, which is where the goal is."""
        turns = sum(1 for message in messages if message.role == "user")
        if turns > MAX_USER_TURNS:
            raise ValueError(f"a conversation may not exceed {MAX_USER_TURNS} user turns")
        return messages


class QueryProposalOut(CamelModel):
    kind: Literal["query"] = "query"
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


class DashboardWidgetProposalOut(CamelModel):
    """One widget: either a query that exists, or one to be written first.

    Exactly one of the two, enforced below: a widget carrying both would let the
    card create a query and then hang a different one on the dashboard, and one
    carrying neither is a row with nothing behind it.
    """

    # No defaults: all five are present on the wire with the unused half null. A
    # default would make them optional in the generated schema, and the client
    # would have to read two shapes (absent, or null) for one fact.
    title: str
    query_id: int | None
    visualization_id: int | None
    # The shape this widget should be drawn as, from ai_viz_choice.CHOICE_IDS.
    # Null means "as it is drawn now". Set with `visualization_id` it names the
    # shape that id already is; set WITHOUT one, the client must create the
    # visualization, which is the only path here that writes to a saved query and
    # so the one that has to check who owns it first.
    viz_choice_id: str | None
    new_query: NewQueryProposalOut | None

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "DashboardWidgetProposalOut":
        existing = self.query_id is not None
        if existing == (self.new_query is not None):
            raise ValueError("a widget names either an existing query, or a new one")
        if existing and self.visualization_id is None and not self.viz_choice_id:
            raise ValueError("a widget over an existing query needs a visualization to show or a shape to create")
        return self


class DashboardProposalOut(CamelModel):
    kind: Literal["dashboard"] = "dashboard"
    name: str
    widgets: list[DashboardWidgetProposalOut]


class KpiProposalOut(CamelModel):
    """A KPI over a query that exists, or over one written for it.

    A KPI reads one number from one query, so it needs exactly one source. Both
    halves are always on the wire with the unused one null, the same rule
    DashboardWidgetProposalOut follows and for the same reason.
    """

    kind: Literal["kpi"] = "kpi"
    name: str
    description: str
    source_query_id: int | None
    new_query: NewQueryProposalOut | None
    # Not checkable without running the query, which this service will not do,
    # so it is a plain string the card surfaces as an editable field.
    value_column: str
    unit: str | None
    target: float | None
    direction: KpiDirection
    cadence: KpiCadence
    # The bands, when the analyst asked for them explicitly. Null is the ordinary
    # case and means "derive from the target", which is what the card does.
    #
    # Required rather than defaulted, so they are `required` in the OpenAPI
    # schema and the generated TypeScript reads `number | null` rather than
    # optional.
    at_risk: float | None
    breached: float | None

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "KpiProposalOut":
        if (self.source_query_id is not None) == (self.new_query is not None):
            raise ValueError("a KPI names either an existing query or a new one")
        return self

    @model_validator(mode="after")
    def _coherent_bands(self) -> "KpiProposalOut":
        """Drop a pair that would erase a band, rather than refusing the KPI.

        `statusForValue` reads the two in direction order, so for
        higher-is-better a breached bound ABOVE the at-risk one makes the at-risk
        band unreachable. Dropped to null (the target then derives them) rather
        than raised, so the whole proposal is not lost over a detail the card can
        fill in. Both or neither, since one bound alone has no band to end.
        """
        if self.at_risk is None or self.breached is None:
            self.at_risk = None
            self.breached = None
            return self
        worse_is_lower = self.direction == "higher-is-better"
        ordered = self.breached <= self.at_risk if worse_is_lower else self.breached >= self.at_risk
        if not ordered:
            self.at_risk = None
            self.breached = None
        return self


class ReportProposalOut(CamelModel):
    kind: Literal["report"] = "report"
    outline: ReportOutlineOut


class SnippetProposalOut(CamelModel):
    kind: Literal["snippet"] = "snippet"
    trigger: str
    snippet: str
    description: str


# The bare union is what services annotate against; the discriminated form is
# what the field uses.
AnyProposalOut = QueryProposalOut | DashboardProposalOut | KpiProposalOut | ReportProposalOut | SnippetProposalOut

# Discriminated on `kind`, so a proposal that does not match its own kind is a
# validation failure here rather than a card the frontend cannot render.
ProposalOut = Annotated[AnyProposalOut, Field(discriminator="kind")]


class ConverseOut(CamelModel):
    reply: str
    # All five required, and `proposal` required-and-nullable rather than
    # optional: the relay's schema demands the key be present, and a default here
    # would put an optional field in the OpenAPI schema that the generated
    # frontend contract then reads as "may be absent".
    suggested_answers: list[str] = Field(max_length=MAX_SUGGESTED_ANSWERS)
    ready: bool
    proposal: ProposalOut | None
    # The table this conversation is about, for the client to send back on the
    # next turn. No default, for the reason above.
    focus_table: str | None

    @model_validator(mode="after")
    def _ready_means_a_proposal(self) -> "ConverseOut":
        """There is exactly one way to be ready.

        Enforced here so a UI cannot render a Create button for nothing and a
        "here is your dashboard" reply cannot arrive empty. The relay refuses
        both directions too; this is the copy that runs before the bytes leave.
        """
        if self.ready != (self.proposal is not None):
            raise ValueError("ready must be true if and only if a proposal is present")
        return self
