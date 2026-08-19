"""Wire models for the published-feed binding endpoints.

camelCase on the wire, snake_case in Python, the same rule as schemas/catalog.py.
Changing a field here obliges `pnpm gen:api-types` from `app/`, or the openapi
diff fails the pipeline.
"""

from typing import Literal

from pydantic import Field, field_validator, model_validator

from veodyn_api.schemas.catalog import CamelModel
from veodyn_api.services import feed_registry
from veodyn_api.services.gbfs_serializer import check_system_info

# PostgreSQL `INTEGER`, which is the column type behind both of the integer
# fields below. Without the bound a larger value passes request validation and
# then fails at COMMIT, inside psycopg, as an unhandled 500 that names no field.
# With it the refusal is the 422 every other bad field here already gets.
PG_INT_MAX = 2_147_483_647


# Slugs that cannot be feed names because a static route on `/published-feeds`
# already answers to them. Kept beside the schema that refuses them rather than
# in the router, because the write path is where a collision is still
# preventable; by the time a request reaches the router the shadowing has
# already happened.
RESERVED_SLUGS = frozenset({"capabilities"})


class PublishedFeedIn(CamelModel):
    """A declaration that one query publishes one standard feed.

    The whole binding on every write, PUT rather than PATCH, because every field
    here is an input to the same question ("what will this feed contain, and
    what is it checked against"), and a partial edit would leave the caller
    guessing which of the untouched fields the revision bump now covers.
    """

    slug: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")
    query_id: int = Field(gt=0, le=PG_INT_MAX)
    # A Literal, because both standards are community code rather than something
    # a pack adds, so the committed openapi may name them.
    standard: Literal["gtfs-rt", "gbfs"]
    # A plain string, checked against the chosen standard's supported set in
    # `_shape_matches_standard`. A binding may not claim a version its own
    # serializer would contradict, and the refusal names the set it may claim
    # instead, which is the same argument `entity` makes below.
    version: str = Field(min_length=1)
    # A plain string, validated against `feed_registry` below, not a `Literal`.
    # A `Literal` here would make the generated openapi schema depend on which
    # pack is installed, and `api/openapi.json` is committed and diffed in CI:
    # a deployment naming an enterprise pack would fail its own pipeline the
    # moment the registry widened. The registry keeps one wire contract for
    # every deployment and moves the variation into the refusal message
    # instead. See design section 4 for the full reasoning, and note revision 1
    # of that design put `visibility` in this same registry -- it does not
    # belong here, see `feed_registry.py`.
    entity: str = Field(min_length=1)
    # Each of these belongs to exactly one standard, so both are optional here
    # and paired with their standard by `_shape_matches_standard`, which mirrors
    # the two CHECK constraints on the table.
    static_gtfs_ref: str | None = None
    system_info: dict[str, str] | None = None
    source_column: str | None = None
    column_map: dict[str, str]
    on_error: Literal["block", "last_good"] = "block"
    last_good_max_age_seconds: int | None = Field(default=None, gt=0, le=PG_INT_MAX)
    visibility: Literal["private", "public"] = "private"

    @field_validator("slug")
    @classmethod
    def _slug_is_not_a_reserved_segment(cls, value: str) -> str:
        """`GET /published-feeds/capabilities` is a static route on the same
        prefix as `GET /published-feeds/{slug}`, and `routers/__init__.py`
        registers it first so the wildcard cannot swallow it. That ordering has
        a cost this refusal pays off: without it a feed slugged `capabilities`
        is accepted, and its own detail endpoint then answers the capabilities
        payload forever, so the feed can be created, edited and deleted but
        never read back.

        Refused at the write instead, which is the only place the two can still
        be told apart. Dropping the reservation and reordering the routers is
        not the alternative it looks like: that trades an unreadable feed for an
        unreachable capabilities endpoint on any deployment where somebody has
        claimed the name.
        """
        if value in RESERVED_SLUGS:
            reserved = ", ".join(sorted(RESERVED_SLUGS))
            raise ValueError(
                f"{value!r} is a reserved name on this collection and cannot be a feed slug; reserved: {reserved}"
            )
        return value

    @model_validator(mode="after")
    def _shape_matches_standard(self) -> "PublishedFeedIn":
        """Every rule that needs to know which standard this is.

        `entity` is checked here rather than as a field validator because a
        field validator cannot see `standard`, and `stations` is a real entity
        under one standard and a typo under the other. The refusal names the
        deployment, not an enum: a caller should read it as "this deployment
        does not support that entity" and see what it does support.

        The two shape fields are refused here as well as by their CHECK
        constraints, so the caller gets a 422 naming the field rather than a 500
        out of a constraint violation.
        """
        versions = feed_registry.VERSIONS_BY_STANDARD[self.standard]
        if self.version not in versions:
            raise ValueError(
                f"version {self.version!r} is not supported for {self.standard}; supported: {', '.join(versions)}"
            )
        if not feed_registry.is_registered(self.entity, self.standard):
            supported = ", ".join(sorted(feed_registry.entities(self.standard))) or "(none registered)"
            raise ValueError(
                f"{self.entity!r} is not a supported entity in this deployment for {self.standard}; "
                f"this deployment supports: {supported}"
            )
        # Blank collapses to None BEFORE the pairing is judged, and the collapsed
        # value is what gets stored. A blank kept as "" reads as absent here and
        # as NOT NULL to ck_published_feed_static_ref_matches_standard, which is
        # a 500 at COMMIT instead of the 422 below.
        if self.static_gtfs_ref is not None and not self.static_gtfs_ref.strip():
            self.static_gtfs_ref = None
        if (self.standard == "gtfs-rt") != (self.static_gtfs_ref is not None):
            raise ValueError("a gtfs-rt feed requires a static GTFS reference, and a gbfs feed cannot carry one")
        if (self.standard == "gbfs") != (self.system_info is not None):
            raise ValueError("a gbfs feed requires system information, and a gtfs-rt feed cannot carry it")
        if self.system_info is not None:
            # The serializer owns this vocabulary: it is the module that writes
            # the file these keys become.
            problems = check_system_info(self.version, self.system_info)
            if problems:
                raise ValueError("; ".join(problems))
        return self

    @model_validator(mode="after")
    def _cap_matches_mode(self) -> "PublishedFeedIn":
        """Refused here as well as by the check constraint, so the caller gets a
        422 naming the field rather than a 500 out of a constraint violation."""
        has_cap = self.last_good_max_age_seconds is not None
        if (self.on_error == "last_good") != has_cap:
            raise ValueError("last_good requires last_good_max_age_seconds, and block forbids it")
        return self


class PublishedFeedOut(CamelModel):
    slug: str
    revision: int
    query_id: int
    standard: str
    version: str
    entity: str
    static_gtfs_ref: str | None
    system_info: dict[str, str] | None
    source_column: str | None
    column_map: dict[str, str]
    on_error: str
    last_good_max_age_seconds: int | None
    visibility: str
    # ok | unvalidated | unknown. Derived from the binding check rather than
    # stored, because a query gaining or losing a column changes this answer
    # without anything writing to the binding.
    #
    # `unknown` is not one of BindingCheck's states, and it is here because the
    # read paths do not run the check: it costs a whole result body per binding
    # (see `ai_grounding.query_result_columns`), which a list of feeds cannot
    # afford. Saying `ok` there instead would put a green tick on a binding that
    # may be broken, which is the one answer worse than no answer. `invalid`
    # never reaches this model at all -- a write carrying it is refused with a
    # 422, so no stored binding is known-invalid at the moment it is written.
    binding_state: str


class StandardCapabilityOut(CamelModel):
    """One standard this deployment can bind a feed to, with the versions it can
    publish and the entities registered under it.

    `versions` comes from `feed_registry.VERSIONS_BY_STANDARD` and is empty for a
    standard only a pack registers entities under.
    """

    standard: str
    versions: list[str]
    entities: list[str]


class FeedCapabilitiesOut(CamelModel):
    """What this deployment's feed registry actually holds, read at runtime
    rather than inferred from a values file or a matching image digest.

    Root CLAUDE.md records that an installed layer is inert until a deployment
    names it, and the deploy succeeds either way -- costing four releases before
    this pattern got an interrogation endpoint. `standards`, and `entities`
    within each, are sorted so the response is stable across the registry's
    unordered sets.

    The frontend's binding form renders `entity` as a stated fact when there is
    exactly one, and as a picker otherwise (design section 4's "one
    consequence"); this is the response that decision reads.
    """

    standards: list[StandardCapabilityOut]


class FindingOut(CamelModel):
    """One validator finding, flattened to one exported occurrence.

    `services/finding_json.py` already stores these camelCased, because that
    column is served verbatim. CamelModel's `populate_by_name` accepts either
    spelling, so this validates straight off the stored JSONB.
    """

    rule_id: str
    severity: str
    title: str
    locator: str
    # How many times the rule fired, which is NOT how many findings carry this
    # rule id: the validator exports a sample per rule and reports the total
    # separately. Every finding split from one notice repeats that notice's
    # total, so a surface can say "1 of 40" instead of showing one and implying
    # one.
    #
    # Defaulted, because attempts recorded before this field existed are stored
    # JSONB without it and are read back through this model. Zero rather than
    # one: it is the value that reads as "this attempt does not know", and a
    # default of 1 would be a plausible lie about historical data.
    occurrence_count: int = 0


class PublishAttemptOut(CamelModel):
    """One attempt, without the bytes it produced.

    `feed_bytes` is absent on purpose rather than by omission. It is the served
    artifact, and a list endpoint that carried it would move megabytes per row
    to render a status word.
    """

    attempt_id: int
    binding_revision: int
    query_result_id: int
    # published | blocked | failed
    decision: str
    # Empty on a published attempt. A count on a blocked one, so the findings
    # are the actionable half. A sentence on a failed one, where there is no
    # finding to blame.
    reason: str
    findings: list[FindingOut]
    # What the verdict covered. A rule that never ran is not a rule that passed.
    enabled_rules: list[str]
    is_current: bool
    # ISO 8601 with a Z, matching every other timestamp this service serves.
    created_at: str
