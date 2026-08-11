from datetime import date, datetime, timedelta, timezone
from unittest import TestCase

from redash.historical import schema


class TestMapColumnType(TestCase):
    def test_maps_every_redash_type(self):
        self.assertEqual(schema.map_column_type("integer"), "Nullable(Int64)")
        self.assertEqual(schema.map_column_type("float"), "Nullable(Float64)")
        self.assertEqual(schema.map_column_type("boolean"), "Nullable(Bool)")
        self.assertEqual(schema.map_column_type("datetime"), "Nullable(DateTime64(3, 'UTC'))")
        self.assertEqual(schema.map_column_type("date"), "Nullable(Date32)")
        self.assertEqual(schema.map_column_type("string"), "Nullable(String)")

    def test_unknown_type_falls_back_to_string(self):
        self.assertEqual(schema.map_column_type("something-unrecognized"), "Nullable(String)")

    def test_untyped_column_sniffs_sample_value(self):
        self.assertEqual(schema.map_column_type(None, sample_value=1), "Nullable(Int64)")
        self.assertEqual(schema.map_column_type(None, sample_value=1.5), "Nullable(Float64)")
        self.assertEqual(schema.map_column_type(None, sample_value=True), "Nullable(Bool)")
        self.assertEqual(schema.map_column_type(None, sample_value="hello"), "Nullable(String)")

    def test_untyped_column_with_no_sample_defaults_to_string(self):
        self.assertEqual(schema.map_column_type(None, sample_value=None), "Nullable(String)")


class TestSanitizeIdentifier(TestCase):
    def test_lowercases_and_strips_invalid_chars(self):
        self.assertEqual(schema.sanitize_identifier("Vehicle Speed (mph)"), "vehicle_speed_mph")

    def test_leading_digit_gets_prefixed(self):
        self.assertEqual(schema.sanitize_identifier("123abc"), "_123abc")

    def test_empty_name_falls_back(self):
        self.assertEqual(schema.sanitize_identifier(""), "col")

    def test_reserved_column_name_is_suffixed(self):
        self.assertEqual(schema.sanitize_identifier("captured_at"), "captured_at_field")
        self.assertEqual(schema.sanitize_identifier("query_id"), "query_id_field")

    def test_collision_suffixing(self):
        seen = set()
        first = schema.sanitize_identifier("Speed!", seen)
        second = schema.sanitize_identifier("Speed?", seen)
        self.assertEqual(first, "speed")
        self.assertEqual(second, "speed_2")


class TestSlugifyQueryName(TestCase):
    def test_generates_readable_stable_slug(self):
        self.assertEqual(schema.slugify_query_name("GTFS Vehicle Positions", 142), "q_gtfs_vehicle_positions_142")

    def test_survives_empty_name(self):
        self.assertEqual(schema.slugify_query_name("", 7), "q_col_7")


class TestFormatClickhouseDatetime(TestCase):
    def test_naive_datetime_gets_millisecond_precision(self):
        value = datetime(2026, 7, 22, 14, 51, 34, 520000)
        self.assertEqual(schema.format_clickhouse_datetime(value), "2026-07-22 14:51:34.520")

    def test_tz_aware_datetime_is_normalized_to_utc_and_stripped(self):
        # ClickHouse's JSONEachRow parser rejects the 'T' separator and any
        # '+00:00'-style offset that Python's isoformat() would produce —
        # the column's timezone is already fixed by its type.
        value = datetime(2026, 7, 22, 9, 51, 34, 520000, tzinfo=timezone(timedelta(hours=-5)))
        self.assertEqual(schema.format_clickhouse_datetime(value), "2026-07-22 14:51:34.520")
        self.assertNotIn("T", schema.format_clickhouse_datetime(value))
        self.assertNotIn("+", schema.format_clickhouse_datetime(value))


class TestSerializeValue(TestCase):
    def test_dict_and_list_become_json_strings(self):
        self.assertEqual(schema.serialize_value({"a": 1}), '{"a": 1}')
        self.assertEqual(schema.serialize_value([1, 2]), "[1, 2]")

    def test_datetime_uses_clickhouse_format_not_isoformat(self):
        value = datetime(2026, 7, 21, 12, 0, 0, 250000, tzinfo=timezone.utc)
        self.assertEqual(schema.serialize_value(value), "2026-07-21 12:00:00.250")

    def test_date_uses_plain_isoformat(self):
        value = date(2026, 7, 21)
        self.assertEqual(schema.serialize_value(value), "2026-07-21")

    def test_plain_values_pass_through(self):
        self.assertEqual(schema.serialize_value(42), 42)
        self.assertIsNone(schema.serialize_value(None))


class TestBuildDdl(TestCase):
    def test_create_table_sql_shape(self):
        sql = schema.build_create_table_sql(
            "historical.q_foo_1",
            [("speed", "Nullable(Float64)"), ("vehicle_id", "Nullable(String)")],
        )
        self.assertIn("CREATE TABLE IF NOT EXISTS historical.q_foo_1", sql)
        self.assertIn("captured_at DateTime64(3, 'UTC')", sql)
        self.assertIn("query_id UInt32", sql)
        self.assertIn("`speed` Nullable(Float64)", sql)
        self.assertIn("`vehicle_id` Nullable(String)", sql)
        self.assertIn("ORDER BY captured_at", sql)
        self.assertNotIn("TTL", sql)

    def test_create_table_sql_includes_ttl_when_retention_set(self):
        sql = schema.build_create_table_sql("historical.q_foo_1", [("speed", "Nullable(Float64)")], retention_days=30)
        self.assertIn("TTL captured_at + INTERVAL 30 DAY", sql)

    def test_add_column_sql_shape(self):
        sql = schema.build_add_column_sql("historical.q_foo_1", "new_field", "Nullable(Int64)")
        self.assertEqual(sql, "ALTER TABLE historical.q_foo_1 ADD COLUMN IF NOT EXISTS `new_field` Nullable(Int64)")


class TestDiffColumns(TestCase):
    def test_detects_new_columns(self):
        new_columns, conflicts = schema.diff_columns(
            existing_columns={"speed": "Nullable(Float64)"},
            incoming_columns={"speed": "Nullable(Float64)", "heading": "Nullable(Int64)"},
        )
        self.assertEqual(new_columns, {"heading": "Nullable(Int64)"})
        self.assertEqual(conflicts, {})

    def test_detects_type_conflicts_and_widens(self):
        new_columns, conflicts = schema.diff_columns(
            existing_columns={"speed": "Nullable(Int64)"},
            incoming_columns={"speed": "Nullable(String)"},
        )
        self.assertEqual(new_columns, {})
        self.assertEqual(conflicts, {"speed": "speed_str"})

    def test_no_changes_yields_empty_results(self):
        new_columns, conflicts = schema.diff_columns(
            existing_columns={"speed": "Nullable(Float64)"},
            incoming_columns={"speed": "Nullable(Float64)"},
        )
        self.assertEqual(new_columns, {})
        self.assertEqual(conflicts, {})
