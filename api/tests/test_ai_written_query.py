"""The whole pipeline for one written query: sql, shape, options, binding."""

from collections.abc import Iterator
from typing import Any

import pytest

from tests.test_dataset_profile import dataset  # the DatasetOut builder
from veodyn_api.services.ai_converse_grounding import Grounding
from veodyn_api.services.ai_written_query import as_new_query, written_query
from veodyn_api.services.dataset_profile_cache import clear_profile_cache


@pytest.fixture(autouse=True)
def _clear_profiles() -> Iterator[None]:
    """The profile cache is keyed by table and outlives a test, so without this
    the second test to ask about regional_bikes is served the first one's fake
    warehouse and never touches its own."""
    clear_profile_cache()
    yield
    clear_profile_cache()


class StubLlm:
    """Answers the SQL call, then the options call, in that order."""

    def __init__(self, answers: list[dict[str, Any]]) -> None:
        self.answers = answers
        self.tools: list[str] = []

    def structured(self, *, system: str, prompt: str, schema: dict[str, Any], tool_name: str) -> dict[str, Any]:
        self.tools.append(tool_name)
        return self.answers.pop(0)


class FakeWarehouse:
    def __init__(self, describe: list[dict[str, Any]]) -> None:
        self.describe = describe
        self.statements: list[str] = []

    def query(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        self.statements.append(sql)
        if sql.startswith("DESCRIBE"):
            return self.describe
        # the profile's two statements
        return [
            {
                "rows": 10,
                "snapshots": 2,
                "first_at": "2026-07-30 00:00:00.000",
                "last_at": "2026-07-30 01:00:00.000",
                "latest_rows": 5,
                "n": 5,
            }
        ]


def grounding_for(one: Any) -> Grounding:
    return Grounding(kind="query", queries=(), datasets=(one,))


def bikes() -> Any:
    return dataset([("captured_at", "DateTime64(3, 'UTC')"), ("bikes", "Nullable(Int64)")])


def two_columns() -> list[dict[str, Any]]:
    return [{"name": "bucket", "type": "DateTime"}, {"name": "bikes", "type": "Float64"}]


SQL = "SELECT toStartOfHour(captured_at) AS bucket, avg(bikes) AS bikes FROM regional_bikes GROUP BY bucket"


def test_the_options_call_sees_the_described_columns_and_the_result_is_bound() -> None:
    llm = StubLlm(
        [
            {"sql": SQL, "rationale": "bikes per hour"},
            # onClick is not on the allowlist. It rides along so the equality
            # below fails if the answer reaches the card unsanitized.
            {"options": {"columnMapping": {"bucket": "x", "bikes": "y"}, "swappedAxes": True, "onClick": "alert(1)"}},
        ]
    )
    warehouse = FakeWarehouse(two_columns())

    proposal = written_query(
        llm,
        {"datasetTable": "regional_bikes", "intent": "bikes per hour", "vizChoiceId": "chart-line"},
        grounding_for(bikes()),
        warehouse=warehouse,
    )

    assert not isinstance(proposal, str)
    assert proposal.viz_options == {"columnMapping": {"bucket": "x", "bikes": "y"}, "swappedAxes": True}
    assert llm.tools == ["write_sql", "shape_result"]
    assert any(statement.startswith("DESCRIBE") for statement in warehouse.statements)


def test_a_mapping_naming_a_column_the_statement_does_not_return_is_dropped() -> None:
    llm = StubLlm(
        [
            {"sql": SQL, "rationale": "bikes per hour"},
            {"options": {"columnMapping": {"ghost": "x"}}},
        ]
    )
    warehouse = FakeWarehouse(two_columns())

    proposal = written_query(
        llm,
        {"datasetTable": "regional_bikes", "intent": "x", "vizChoiceId": "chart-line"},
        grounding_for(bikes()),
        warehouse=warehouse,
    )

    assert not isinstance(proposal, str)
    # "ghost" is gone and the binder supplied the mapping the shape implies.
    assert proposal.viz_options["columnMapping"] == {"bucket": "x", "bikes": "y"}


def test_describe_is_only_ever_given_sql_the_validator_accepted() -> None:
    """The ordering this module exists to keep.

    DESCRIBE plans whatever it is handed, so it may only see a statement
    generate_sql has already passed through validate_sql. Here the model's first
    answer reads a system table and is refused, and its second arrives with the
    trailing semicolon the validator strips: what reaches the warehouse is the
    accepted text, once, and neither raw answer.
    """
    refused = "SELECT count() FROM system.tables"
    llm = StubLlm(
        [
            {"sql": refused, "rationale": "no"},
            {"sql": f"{SQL};", "rationale": "bikes per hour"},
            {"options": {}},
        ]
    )
    warehouse = FakeWarehouse(two_columns())

    proposal = written_query(
        llm,
        {"datasetTable": "regional_bikes", "intent": "bikes per hour", "vizChoiceId": "chart-line"},
        grounding_for(bikes()),
        warehouse=warehouse,
    )

    assert not isinstance(proposal, str)
    described = [statement for statement in warehouse.statements if statement.startswith("DESCRIBE")]
    assert len(described) == 1
    assert SQL in described[0]
    assert refused not in described[0]
    assert ";" not in described[0]
    # And it is the LAST thing the warehouse was asked, after the profile reads
    # that fed the generation.
    assert warehouse.statements[-1] == described[0]


def test_a_statement_the_warehouse_cannot_describe_is_never_offered_for_options() -> None:
    """Without a result shape there is nothing to name, so asking the model for
    options would spend a call on a guess about columns nobody has seen. The
    stub carries one answer, so a second call raises rather than passing."""
    llm = StubLlm([{"sql": SQL, "rationale": "bikes per hour"}])
    warehouse = FakeWarehouse([])

    proposal = written_query(
        llm,
        {"datasetTable": "regional_bikes", "intent": "x", "vizChoiceId": "chart-line"},
        grounding_for(bikes()),
        warehouse=warehouse,
    )

    assert not isinstance(proposal, str)
    assert proposal.viz_options == {}
    assert llm.tools == ["write_sql"]


def test_no_warehouse_means_no_options_and_no_second_call() -> None:
    llm = StubLlm([{"sql": SQL, "rationale": "bikes per hour"}])

    proposal = written_query(
        llm,
        {"datasetTable": "regional_bikes", "intent": "x", "vizChoiceId": "chart-line"},
        grounding_for(bikes()),
    )

    assert not isinstance(proposal, str)
    assert proposal.viz_options == {}
    assert llm.tools == ["write_sql"]


def test_a_written_query_keeps_its_options_when_it_is_hung_off_a_container() -> None:
    """A dashboard widget, a KPI and a report section all carry the query
    through as_new_query, so options dropped there are options no container
    ever shows."""
    llm = StubLlm(
        [
            {"sql": SQL, "rationale": "bikes per hour"},
            {"options": {"columnMapping": {"bucket": "x", "bikes": "y"}}},
        ]
    )
    warehouse = FakeWarehouse(two_columns())

    proposal = written_query(
        llm,
        {"datasetTable": "regional_bikes", "intent": "x", "vizChoiceId": "chart-line"},
        grounding_for(bikes()),
        warehouse=warehouse,
    )

    assert not isinstance(proposal, str)
    assert as_new_query(proposal).viz_options == {"columnMapping": {"bucket": "x", "bikes": "y"}}
