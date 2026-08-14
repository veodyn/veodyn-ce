"""Wire models for the published-feed binding endpoints.

camelCase on the wire, snake_case in Python, the same rule as schemas/catalog.py.
Changing a field here obliges `pnpm gen:api-types` from `app/`, or the openapi
diff fails the pipeline.
"""

from typing import Literal

from pydantic import Field, model_validator

from veodyn_api.schemas.catalog import CamelModel

# PostgreSQL `INTEGER`, which is the column type behind both of the integer
# fields below. Without the bound a larger value passes request validation and
# then fails at COMMIT, inside psycopg, as an unhandled 500 that names no field.
# With it the refusal is the 422 every other bad field here already gets.
PG_INT_MAX = 2_147_483_647


class PublishedFeedIn(CamelModel):
    """A declaration that one query publishes one standard feed.

    The whole binding on every write, PUT rather than PATCH, because every field
    here is an input to the same question ("what will this feed contain, and
    what is it checked against"), and a partial edit would leave the caller
    guessing which of the untouched fields the revision bump now covers.
    """

    slug: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")
    query_id: int = Field(gt=0, le=PG_INT_MAX)
    standard: Literal["gtfs-rt"]
    # A Literal, not a non-empty string. `gtfs_rt_serializer` writes
    # `gtfs_realtime_version = "2.0"` unconditionally, so any other value here
    # was a binding claiming a version it does not publish -- accepted, stored,
    # and contradicted by the very bytes served under it. The set widens when a
    # serializer learns a second version, and the type is what will say so.
    version: Literal["2.0"]
    entity: Literal["vehicle_positions"]
    static_gtfs_ref: str = Field(min_length=1)
    source_column: str | None = None
    column_map: dict[str, str]
    on_error: Literal["block", "last_good"] = "block"
    last_good_max_age_seconds: int | None = Field(default=None, gt=0, le=PG_INT_MAX)
    visibility: Literal["private", "public"] = "private"

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
    static_gtfs_ref: str
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


class FindingOut(CamelModel):
    """One validator finding, flattened to one occurrence.

    `publish_engine._as_json` already stores these camelCased, because that
    column is served verbatim. CamelModel's `populate_by_name` accepts either
    spelling, so this validates straight off the stored JSONB.
    """

    rule_id: str
    severity: str
    title: str
    locator: str


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
