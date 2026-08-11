"""What the interview is told about the tables it may use."""

from veodyn_api.schemas.ai_create import CreateKind
from veodyn_api.schemas.catalog import (
    DatasetColumnOut,
    DatasetCoverageOut,
    DatasetFreshnessOut,
    DatasetOut,
)
from veodyn_api.services.ai_capture_semantics import CAPTURE_SEMANTICS
from veodyn_api.services.ai_converse_prompt import system_prompt
from veodyn_api.services.dataset_profile import ColumnProfile, DatasetProfile

# The row count is deliberately absent from the description: with it there, an
# assertion on 1200000 passes off the prose alone and stops pinning row_count.
DESCRIPTION = "Captured from Redash query 7 on every scheduled run."

# Not one of the column names either, for the same reason: a tag that repeats a
# column is a tag assertion that cannot fail.
TAG = "mobility"


def dataset() -> DatasetOut:
    return DatasetOut(
        id="regional_bikes",
        name="Bike availability",
        description=DESCRIPTION,
        domain=None,
        schema=[DatasetColumnOut(name="bikes", type="Nullable(Int64)", description=None)],
        freshness=DatasetFreshnessOut(last_updated_at="2026-07-30T14:05:00Z", status="fresh"),
        coverage=DatasetCoverageOut(start="2026-04-02T00:00:00Z", end="2026-07-30T14:05:00Z"),
        row_count=1_200_000,
        sources=["Bike availability"],
        tags=[TAG],
        sample_query_id=7,
    )


def test_the_row_carries_what_the_catalog_already_knew() -> None:
    # Every one of these was computed by build_catalog and thrown away before it
    # reached the model, which then had no way to know a table was stale, empty,
    # or covering the wrong months.
    prompt = system_prompt("query", datasets=(dataset(),))

    assert "2026-04-02" in prompt
    assert "1200000" in prompt.replace(",", "").replace(" ", "")
    assert "fresh" in prompt
    assert TAG in prompt
    assert DESCRIPTION in prompt


def test_every_kind_is_told_how_a_capture_reads() -> None:
    kinds: tuple[CreateKind, ...] = ("query", "dashboard", "kpi", "report", "snippet")
    for kind in kinds:
        assert CAPTURE_SEMANTICS in system_prompt(kind, datasets=(dataset(),))


def test_the_capture_contract_is_not_sent_to_a_kind_with_no_tables() -> None:
    """It is a rule about the rows in the tables, and there are none to read."""
    assert CAPTURE_SEMANTICS not in system_prompt("query")


def test_the_profile_appears_only_when_there_is_one() -> None:
    profile = DatasetProfile(
        table="regional_bikes",
        rows=1_200_000,
        snapshots=4_112,
        latest_at="2026-07-30 14:05:00.000",
        latest_rows=317,
        cadence_seconds=2_480.0,
        columns=(
            ColumnProfile(
                name="bikes",
                type="Int64",
                role="measure",
                nulls=0.0,
                distinct=30,
                low="0",
                high="41",
                examples=(),
            ),
        ),
    )

    with_profile = system_prompt("query", datasets=(dataset(),), profile=profile)
    without = system_prompt("query", datasets=(dataset(),))

    assert "317" in with_profile
    assert "What regional_bikes currently holds" in with_profile
    assert "317" not in without
    assert "currently holds" not in without
