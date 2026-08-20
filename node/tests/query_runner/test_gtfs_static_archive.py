"""Getting from a URL to a set of GTFS tables safely: transport, and archive bounds.

The 50 MB transport cap bounds only the compressed bytes on the wire, so the
declared expansion of the archive is checked separately before anything is
parsed.
"""

import io
import zipfile
from unittest import TestCase
from unittest.mock import MagicMock, patch

import requests

from redash.query_runner.gtfs_realtime_transport import MAX_FEED_BYTES
from redash.query_runner.gtfs_static import GtfsStatic
from redash.query_runner.gtfs_static_tables import (
    MAX_ARCHIVE_MEMBERS,
    MAX_COMPRESSION_RATIO,
    MAX_UNCOMPRESSED_BYTES,
    RATIO_FLOOR_BYTES,
    DecompressionBudget,
    open_table,
)
from tests.query_runner.gtfs_realtime_fixtures import fake_response
from tests.query_runner.gtfs_static_fixtures import (
    FEED_URL,
    ROUTES,
    STOPS,
    ZIP_STORED,
    build_archive,
    forge_declared_size,
    run_query,
)


class TestTransport(TestCase):
    def test_a_body_over_the_size_cap_is_rejected(self):
        data, error, _get = run_query('{"resource": "list"}', body=b"x" * (MAX_FEED_BYTES + 1))
        self.assertIsNone(data)
        self.assertIn(str(MAX_FEED_BYTES), error)

    def test_a_body_that_is_not_a_zip_is_rejected(self):
        data, error, _get = run_query('{"resource": "list"}', body=b"stop_id,stop_name\nS1,Union\n")
        self.assertIsNone(data)
        self.assertIn("not a readable zip", error)

    def test_an_http_error_status_is_reported_with_a_sanitized_url(self):
        http_error = requests.HTTPError("404 Client Error for url: ...?token=SECRET123")
        http_error.response = MagicMock(status_code=404)
        runner = GtfsStatic({"gtfs_url": FEED_URL + "?token=SECRET123#frag"})
        with patch("redash.query_runner.gtfs_static.requests.get") as get:
            get.return_value = fake_response(b"", raise_error=http_error)
            data, error = runner.run_query('{"resource": "list"}', None)
        self.assertIsNone(data)
        self.assertIn("404", error)
        self.assertIn(FEED_URL, error)
        self.assertNotIn("SECRET123", error)
        self.assertNotIn("frag", error)

    def test_a_transport_failure_is_reported_with_a_sanitized_url(self):
        runner = GtfsStatic({"gtfs_url": FEED_URL + "?token=SECRET123"})
        with patch("redash.query_runner.gtfs_static.requests.get") as get:
            get.side_effect = requests.ConnectionError("failed to connect to ...?token=SECRET123")
            data, error = runner.run_query('{"resource": "list"}', None)
        self.assertIsNone(data)
        self.assertIn("ConnectionError", error)
        self.assertNotIn("SECRET123", error)

    def test_a_bad_archive_error_sanitizes_the_url(self):
        runner = GtfsStatic({"gtfs_url": FEED_URL + "?token=SECRET123#frag"})
        with patch("redash.query_runner.gtfs_static.requests.get") as get:
            get.return_value = fake_response(b"not a zip at all")
            data, error = runner.run_query('{"resource": "list"}', None)
        self.assertIsNone(data)
        self.assertIn(FEED_URL, error)
        self.assertNotIn("SECRET123", error)
        self.assertNotIn("frag", error)

    def test_the_configured_request_timeout_is_passed_to_requests(self):
        _data, error, get = run_query('{"resource": "list"}', config={"request_timeout": 45})
        self.assertIsNone(error)
        self.assertEqual(get.call_args.kwargs.get("timeout"), 45)
        self.assertTrue(get.call_args.kwargs.get("stream"))

    def test_an_unconfigured_url_fails_before_any_request(self):
        runner = GtfsStatic({"gtfs_url": ""})
        with patch("redash.query_runner.gtfs_static.requests.get") as get:
            data, error = runner.run_query('{"resource": "list"}', None)
        self.assertIsNone(data)
        self.assertIn("'gtfs_url' is not configured", error)
        get.assert_not_called()


class TestDecompressionBounds(TestCase):
    def test_a_member_that_expands_absurdly_is_rejected_before_it_is_read(self):
        # 2 MB of one byte deflates to a few kilobytes, well past the ratio
        # limit: the classic small zip that costs a worker its memory.
        body = build_archive({"stops.txt": "x" * (2 * 1024 * 1024)})
        data, error, _get = run_query('{"resource": "list"}', body=body)
        self.assertIsNone(data)
        self.assertIn("stops.txt", error)
        self.assertIn(str(MAX_COMPRESSION_RATIO), error)

    def test_a_table_read_is_bounded_by_the_same_check(self):
        body = build_archive({"stops.txt": "x" * (2 * 1024 * 1024)})
        data, error, _get = run_query('{"table": "stops"}', body=body)
        self.assertIsNone(data)
        self.assertIn(str(MAX_COMPRESSION_RATIO), error)

    def test_the_declared_aggregate_is_checked_before_a_single_member_is_read(self):
        # Reading stops.txt alone stays inside the patched ceiling, so only the
        # central-directory sum can reject this. Without it the query succeeds
        # and the archive's declared expansion goes unexamined.
        body = build_archive({"stops.txt": STOPS, "huge.txt": "x" * 5000}, compression=ZIP_STORED)
        with patch("redash.query_runner.gtfs_static_tables.MAX_UNCOMPRESSED_BYTES", 1000):
            data, error, _get = run_query('{"table": "stops"}', body=body)
        self.assertIsNone(data)
        self.assertIn("1000", error)

    def test_the_aggregate_uncompressed_size_is_capped(self):
        body = build_archive({"stops.txt": STOPS, "routes.txt": STOPS}, compression=ZIP_STORED)
        with patch("redash.query_runner.gtfs_static_tables.MAX_UNCOMPRESSED_BYTES", 100):
            data, error, _get = run_query('{"resource": "list"}', body=body)
        self.assertIsNone(data)
        self.assertIn("100", error)
        self.assertIn(FEED_URL, error)

    def test_a_small_compressible_member_is_not_mistaken_for_a_bomb(self):
        # An ordinary calendar_dates.txt is thousands of near-identical rows and
        # deflates past 200:1 on its own, so the ratio test needs its size floor
        # or it rejects a real feed. The ratio is asserted here, so this test
        # cannot quietly stop exercising the floor.
        body = build_archive({"calendar_dates.txt": "date,exception_type\n" + "20260101,1\n" * 2000})
        info = zipfile.ZipFile(io.BytesIO(body)).infolist()[0]
        self.assertGreater(info.file_size // info.compress_size, MAX_COMPRESSION_RATIO)
        self.assertLess(info.compress_size, RATIO_FLOOR_BYTES)

        data, error, _get = run_query('{"resource": "list"}', body=body)
        self.assertIsNone(error)
        self.assertEqual(data["rows"][0]["row_count"], 2000)

    def test_an_ordinary_archive_stays_well_under_both_limits(self):
        data, error, _get = run_query('{"resource": "list"}')
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 3)
        self.assertGreater(MAX_UNCOMPRESSED_BYTES, MAX_FEED_BYTES)

    def test_a_single_pathological_field_is_a_query_error_not_a_traceback(self):
        # csv refuses a field past its own limit. Stored rather than deflated,
        # so this reaches the csv reader instead of tripping the ratio guard.
        giant = "stop_id,stop_name\nS1," + ("ab" * 100000) + "\n"
        body = build_archive({"stops.txt": giant}, compression=ZIP_STORED)
        data, error, _get = run_query('{"table": "stops"}', body=body)
        self.assertIsNone(data)
        self.assertIn("field larger than field limit", error)


class TestMemberCeiling(TestCase):
    def test_an_archive_with_more_members_than_the_ceiling_is_rejected(self):
        members = {f"t{i}.txt": "id\n1\n" for i in range(MAX_ARCHIVE_MEMBERS + 1)}
        data, error, _get = run_query('{"resource": "list"}', body=build_archive(members))
        self.assertIsNone(data)
        self.assertIn(str(MAX_ARCHIVE_MEMBERS), error)
        self.assertIn(FEED_URL, error)

    def test_an_archive_at_the_ceiling_is_still_read(self):
        members = {f"t{i}.txt": "id\n1\n" for i in range(MAX_ARCHIVE_MEMBERS)}
        data, error, _get = run_query('{"resource": "list"}', body=build_archive(members))
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), MAX_ARCHIVE_MEMBERS)


class TestDecompressionBudget(TestCase):
    """The bound that does not take the archive's word for anything."""

    def _archive(self, members):
        return zipfile.ZipFile(io.BytesIO(build_archive(members)))

    def test_reading_a_member_charges_the_budget(self):
        archive = self._archive({"stops.txt": STOPS})
        budget = DecompressionBudget(FEED_URL, limit=10)
        with self.assertRaises(ValueError) as caught:
            with open_table(archive, "stops.txt", budget) as text:
                text.read()
        self.assertIn("expands to more than 10 bytes", str(caught.exception))
        self.assertIn(FEED_URL, str(caught.exception))

    def test_a_member_inside_the_budget_reads_normally(self):
        archive = self._archive({"stops.txt": STOPS})
        budget = DecompressionBudget(FEED_URL, limit=len(STOPS) + 10)
        with open_table(archive, "stops.txt", budget) as text:
            self.assertEqual(text.read(), STOPS)
        self.assertEqual(budget.used, len(STOPS))

    def test_the_counter_is_aggregate_so_a_bomb_split_across_members_is_caught(self):
        archive = self._archive({"stops.txt": STOPS, "routes.txt": ROUTES})
        budget = DecompressionBudget(FEED_URL, limit=len(STOPS) + 10)
        with open_table(archive, "stops.txt", budget) as text:
            text.read()
        with self.assertRaises(ValueError):
            with open_table(archive, "routes.txt", budget) as text:
                text.read()

    def test_one_query_opens_every_member_against_a_single_budget(self):
        seen = []

        def spy(archive, member, budget):
            seen.append(budget)
            return open_table(archive, member, budget)

        with patch("redash.query_runner.gtfs_static.open_table", side_effect=spy):
            data, error, _get = run_query('{"resource": "list"}')
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 3)
        self.assertEqual(len(seen), 3)
        self.assertEqual(len({id(budget) for budget in seen}), 1)

    def test_the_budget_defaults_to_the_archive_ceiling(self):
        self.assertEqual(DecompressionBudget(FEED_URL).limit, MAX_UNCOMPRESSED_BYTES)

    def test_a_member_that_under_declares_its_size_cannot_read_past_the_declaration(self):
        # Probed rather than assumed: CPython's ZipExtFile stops at the size the
        # central directory declares, so a member lying low is truncated, not
        # expanded, even with the CRC forged to match. If that ever changes,
        # this test fails and the counting reader above becomes the load
        # bearing bound rather than the second one.
        payload = ("stop_id,stop_name\n" + "S1,Union\n" * 2000).encode("utf-8")
        body = build_archive({"stops.txt": payload.decode("utf-8")})
        data, error, _get = run_query('{"table": "stops"}', body=forge_declared_size(body, 40, payload))
        self.assertIsNone(error)
        self.assertLess(len(data["rows"]), 10)


class TestDuplicateTableNames(TestCase):
    def test_two_members_with_the_same_table_name_are_rejected_on_discovery(self):
        body = build_archive({"stops.txt": STOPS, "feed/stops.txt": STOPS})
        data, error, _get = run_query('{"resource": "list"}', body=body)
        self.assertIsNone(data)
        self.assertIn("stops.txt", error)
        self.assertIn("feed/stops.txt", error)

    def test_two_members_with_the_same_table_name_are_rejected_on_a_table_read(self):
        body = build_archive({"stops.txt": STOPS, "feed/stops.txt": STOPS})
        data, error, _get = run_query('{"table": "stops"}', body=body)
        self.assertIsNone(data)
        self.assertIn("feed/stops.txt", error)

    def test_a_nested_member_alone_is_still_fine(self):
        body = build_archive({"feed/stops.txt": STOPS})
        data, error, _get = run_query('{"table": "stops"}', body=body)
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 2)
