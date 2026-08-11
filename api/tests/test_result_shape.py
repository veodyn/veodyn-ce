"""What a generated SELECT will return, without running it."""

from typing import Any

from veodyn_api.services.result_shape import ResultColumn, describe_result


class FakeClickHouse:
    def __init__(self, rows: list[dict[str, Any]] | None = None, error: Exception | None = None) -> None:
        self.rows = rows or []
        self.error = error
        self.statements: list[str] = []

    def query(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        self.statements.append(sql)
        if self.error:
            raise self.error
        return self.rows


def test_describe_wraps_the_statement_rather_than_running_it():
    client = FakeClickHouse([{"name": "bucket", "type": "DateTime"}])

    describe_result(client, "SELECT toStartOfHour(captured_at) AS bucket FROM regional_bikes")

    assert client.statements[0].startswith("DESCRIBE (")
    assert client.statements[0].rstrip().endswith(")")


def test_storage_wrappers_are_removed_and_kinds_derived():
    client = FakeClickHouse(
        [
            {"name": "bucket", "type": "DateTime64(3, 'UTC')"},
            {"name": "station", "type": "LowCardinality(Nullable(String))"},
            {"name": "bikes", "type": "Nullable(Float64)"},
            {"name": "is_open", "type": "Bool"},
        ]
    )

    columns = describe_result(client, "SELECT 1")

    assert columns == (
        ResultColumn(name="bucket", type="DateTime64(3, 'UTC')", kind="time"),
        ResultColumn(name="station", type="String", kind="text"),
        ResultColumn(name="bikes", type="Float64", kind="number"),
        ResultColumn(name="is_open", type="Bool", kind="bool"),
    )


def test_a_failure_is_an_empty_shape_rather_than_an_error():
    assert describe_result(FakeClickHouse(error=RuntimeError("syntax error")), "SELECT oops") == ()


def test_a_row_without_a_name_is_skipped():
    client = FakeClickHouse([{"type": "String"}, {"name": "ok", "type": "String"}])

    assert [column.name for column in describe_result(client, "SELECT 1")] == ["ok"]
