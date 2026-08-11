"""What the model knows about data sources, which until now was nothing.

Asked whether one dashboard can draw on several data sources, the assistant had
no grounding to answer from: the query list carried an id, a name, tags and a
description, and no rule mentioned sources at all. So it answered from its own
priors about Redash rather than from this instance, where the answer is yes and
always has been. A data source belongs to the QUERY, a dashboard has no data
source of its own, and a widget resolves its source through the query behind it.

Two halves, one test group each: the label on every query row, and the rule that
says what the labels mean.
"""

import httpx
import pytest
import respx

from tests.conftest import REDASH_TEST_URL
from tests.converse_stubs import grounding_settings, mock_data_sources
from veodyn_api.services.ai_converse_grounding import build_grounding, clear_grounding_cache
from veodyn_api.services.ai_converse_prompt import system_prompt
from veodyn_api.services.ai_data_sources import DATA_SOURCE_RULES
from veodyn_api.services.ai_grounding import GroundedQuery
from veodyn_api.services.redash import RedashClient
from veodyn_api.services.redash_lookups import data_source_names


@pytest.fixture(autouse=True)
def _clear_grounding() -> None:
    clear_grounding_cache()


def mock_query_listing() -> None:
    """Two queries on two different data sources, which is the whole point."""
    respx.get(f"{REDASH_TEST_URL}/api/queries").mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    {"id": 11, "name": "Speeds by corridor", "updated_at": "2026-07-20", "data_source_id": 1},
                    {"id": 12, "name": "Boardings by stop", "updated_at": "2026-07-19", "data_source_id": 2},
                ]
            },
        )
    )


def test_a_query_row_says_what_it_reads() -> None:
    query = GroundedQuery(id=11, name="Speeds", description="", tags=[], updated_at="", source="Warehouse")

    assert query.as_prompt_row()["reads"] == "Warehouse"


def test_a_query_with_no_known_source_says_nothing_rather_than_guessing() -> None:
    """An unlabelled query is one whose source lookup did not answer. `reads:
    ""` would read as a source called nothing, and the model would repeat it."""
    query = GroundedQuery(id=11, name="Speeds", description="", tags=[], updated_at="")

    assert "reads" not in query.as_prompt_row()


@respx.mock
def test_the_names_come_from_redash_and_junk_rows_are_skipped() -> None:
    respx.get(f"{REDASH_TEST_URL}/api/data_sources").mock(
        return_value=httpx.Response(
            200,
            json=[
                {"id": 1, "name": "Warehouse", "type": "clickhouse"},
                {"id": 2, "name": "Ops Postgres", "type": "pg"},
                # Neither of these is a source anything can be labelled with.
                {"id": 3, "name": ""},
                {"name": "no id at all"},
            ],
        )
    )

    assert data_source_names(RedashClient(REDASH_TEST_URL), api_key="k") == {1: "Warehouse", 2: "Ops Postgres"}


@respx.mock
def test_a_source_lookup_that_fails_costs_the_labels_and_not_the_queries() -> None:
    """The trade this is worth stating. Losing the whole grounding, and with it
    the conversation, because a side lookup failed would be far worse than a
    prompt that says less than it could."""
    respx.get(f"{REDASH_TEST_URL}/api/data_sources").mock(return_value=httpx.Response(500))
    mock_query_listing()

    grounding = build_grounding(
        "dashboard", redash=RedashClient(REDASH_TEST_URL), api_key="k", settings=grounding_settings()
    )

    assert [one.id for one in grounding.queries] == [11, 12]
    assert [one.source for one in grounding.queries] == ["", ""]


@respx.mock
def test_the_listed_queries_arrive_labelled_with_what_each_one_reads() -> None:
    mock_data_sources((1, "Warehouse"), (2, "Ops Postgres"))
    mock_query_listing()

    grounding = build_grounding(
        "dashboard", redash=RedashClient(REDASH_TEST_URL), api_key="k", settings=grounding_settings()
    )

    # Two queries, two different sources: a version that labelled everything
    # with the first source it found would pass a one-source fixture.
    assert {one.id: one.source for one in grounding.queries} == {11: "Warehouse", 12: "Ops Postgres"}


def test_the_model_is_told_a_dashboard_may_mix_data_sources() -> None:
    queries = (GroundedQuery(id=11, name="Speeds", description="", tags=[], updated_at="", source="Warehouse"),)

    system = system_prompt("dashboard", queries=queries)

    assert DATA_SOURCE_RULES in system
    # The claim itself, not just that some paragraph arrived. This is the
    # sentence the analyst's question turns on.
    assert "one dashboard can hold widgets reading different systems" in system


def test_the_rule_is_not_sent_to_a_kind_that_was_given_no_queries() -> None:
    """It is a rule about the rows in the query list, exactly as
    CAPTURE_SEMANTICS is a rule about the rows in the catalog. Sent to a `query`
    conversation it describes a list that is not there."""
    assert DATA_SOURCE_RULES not in system_prompt("query")
