"""The warehouse profile: what one statement asks for, and what it makes of it."""

from typing import Any

from veodyn_api.schemas.catalog import (
    DatasetColumnOut,
    DatasetCoverageOut,
    DatasetFreshnessOut,
    DatasetOut,
)
from veodyn_api.services.dataset_profile import profile_dataset, unwrap


class FakeClickHouse:
    """Answers each statement in order and records what it was asked."""

    def __init__(self, answers: list[list[dict[str, Any]]]) -> None:
        self.answers = answers
        self.statements: list[str] = []

    def query(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        self.statements.append(sql)
        return self.answers.pop(0) if self.answers else []


def dataset(columns: list[tuple[str, str]]) -> DatasetOut:
    return DatasetOut(
        id="regional_bikes",
        name="Bike availability",
        description="Captured from Redash query 7 on every scheduled run.",
        domain=None,
        schema=[DatasetColumnOut(name=name, type=type_) for name, type_ in columns],
        freshness=DatasetFreshnessOut(last_updated_at="2026-07-30T14:05:00Z", status="fresh"),
        coverage=DatasetCoverageOut(start="2026-04-02T00:00:00Z", end="2026-07-30T14:05:00Z"),
        row_count=1_200_000,
        sources=["Bike availability"],
        tags=[],
        sample_query_id=7,
    )


TABLE_FACTS = [
    {
        "rows": 1_200_000,
        "snapshots": 4_112,
        "first_at": "2026-04-02 00:00:00.000",
        "last_at": "2026-07-30 14:05:00.000",
        "latest_rows": 317,
    }
]


def test_table_facts_come_from_one_statement():
    client = FakeClickHouse([TABLE_FACTS, [{"n": 317}]])

    profile = profile_dataset(client, dataset([("captured_at", "DateTime64(3, 'UTC')")]))

    assert profile is not None
    assert (profile.rows, profile.snapshots, profile.latest_rows) == (1_200_000, 4_112, 317)
    # span / (snapshots - 1): 119 days and 14 hours over 4111 gaps is about 2513
    # seconds.
    assert profile.cadence_seconds is not None
    assert 2_500 < profile.cadence_seconds < 2_550


def test_column_facts_are_scoped_to_the_latest_snapshot():
    client = FakeClickHouse(
        [
            TABLE_FACTS,
            [
                {
                    "n": 317,
                    "station_id__nulls": 0,
                    "station_id__distinct": 317,
                    "station_id__top": ["3005", "3012", "3018"],
                    "bikes__nulls": 1,
                    "bikes__distinct": 42,
                    "bikes__low": "0",
                    "bikes__high": "41",
                }
            ],
        ]
    )

    profile = profile_dataset(client, dataset([("station_id", "Nullable(String)"), ("bikes", "Nullable(Int64)")]))

    assert profile is not None
    column_statement = client.statements[1]
    # The value facts describe the current state, so they read one snapshot and
    # not the whole append-only history.
    assert "WHERE captured_at =" in column_statement
    station, bikes = profile.columns
    assert station.examples == ("3005", "3012", "3018")
    assert (bikes.low, bikes.high) == ("0", "41")
    assert round(bikes.nulls, 4) == round(1 / 317, 4)


def test_storage_wrappers_are_removed_whatever_order_they_nest_in():
    """Peeling one wrapper can reveal another, so the walk has to repeat rather
    than visit each wrapper name once. `LowCardinality(Nullable(DateTime))` came
    out as `Nullable(DateTime)`, which does not read as a time, so the column was
    profiled with topK instead of a range and handed over with the wrong role.

    `SimpleAggregateFunction` is left alone deliberately: its first argument is a
    function name, so stripping it would yield "sum, UInt64".
    """
    assert unwrap("LowCardinality(Nullable(DateTime))") == "DateTime"
    assert unwrap("Nullable(LowCardinality(String))") == "String"
    assert unwrap("Nullable(Int64)") == "Int64"
    assert unwrap("Int64") == "Int64"
    assert unwrap("SimpleAggregateFunction(sum, UInt64)") == "SimpleAggregateFunction(sum, UInt64)"


def test_a_doubly_wrapped_time_column_is_still_a_time_column():
    client = FakeClickHouse(
        [
            TABLE_FACTS,
            [{"n": 10, "seen__nulls": 0, "seen__distinct": 10, "seen__low": "2026-07-30", "seen__high": "2026-07-31"}],
        ]
    )

    profile = profile_dataset(client, dataset([("seen", "LowCardinality(Nullable(DateTime))")]))

    assert profile is not None
    assert profile.columns[0].role == "time"
    # A time column is asked for its range, not for its three most common values.
    assert "topK" not in client.statements[1]


def test_roles_are_derived_from_type_name_and_cardinality():
    client = FakeClickHouse(
        [
            TABLE_FACTS,
            [
                {
                    "n": 100,
                    "captured_at__nulls": 0,
                    "captured_at__distinct": 1,
                    "captured_at__low": "2026-07-30 14:05:00.000",
                    "captured_at__high": "2026-07-30 14:05:00.000",
                    "station_id__nulls": 0,
                    "station_id__distinct": 95,
                    "station_id__top": ["a"],
                    "borough__nulls": 0,
                    "borough__distinct": 5,
                    "borough__top": ["District A", "District B"],
                    "bikes__nulls": 0,
                    "bikes__distinct": 30,
                    "bikes__low": "0",
                    "bikes__high": "41",
                    "lat__nulls": 0,
                    "lat__distinct": 95,
                    "lat__low": "10.4",
                    "lat__high": "10.6",
                }
            ],
        ]
    )

    profile = profile_dataset(
        client,
        dataset(
            [
                ("captured_at", "DateTime64(3, 'UTC')"),
                ("station_id", "Nullable(String)"),
                ("borough", "Nullable(String)"),
                ("bikes", "Nullable(Int64)"),
                ("lat", "Nullable(Float64)"),
            ]
        ),
    )

    assert profile is not None
    assert {column.name: column.role for column in profile.columns} == {
        "captured_at": "time",
        # 95 distinct in 100 rows is an identifier however it is typed.
        "station_id": "identifier",
        "borough": "category",
        "bikes": "measure",
        "lat": "geo",
    }


def test_a_column_name_that_is_not_an_identifier_never_reaches_a_statement():
    client = FakeClickHouse([TABLE_FACTS, [{"n": 1}]])

    profile = profile_dataset(client, dataset([("ok", "Nullable(Int64)"), ("drop table x", "Nullable(String)")]))

    assert profile is not None
    assert [column.name for column in profile.columns] == ["ok"]
    assert "drop table x" not in client.statements[1]


def test_a_warehouse_failure_is_no_profile_rather_than_an_error():
    class Broken:
        def query(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
            raise RuntimeError("clickhouse is down")

    assert profile_dataset(Broken(), dataset([("bikes", "Nullable(Int64)")])) is None


def test_the_prompt_block_states_the_snapshot_shape():
    client = FakeClickHouse(
        [
            TABLE_FACTS,
            [
                {
                    "n": 317,
                    "bikes__nulls": 0,
                    "bikes__distinct": 30,
                    "bikes__low": "0",
                    "bikes__high": "41",
                }
            ],
        ]
    )

    profile = profile_dataset(client, dataset([("bikes", "Nullable(Int64)")]))

    assert profile is not None
    block = profile.as_prompt_block()
    assert block["table"] == "regional_bikes"
    assert block["snapshots"] == 4_112
    assert block["latestSnapshotRows"] == 317
    assert block["columns"][0] == {
        "name": "bikes",
        "type": "Int64",
        "role": "measure",
        "distinct": 30,
        "min": "0",
        "max": "41",
    }
