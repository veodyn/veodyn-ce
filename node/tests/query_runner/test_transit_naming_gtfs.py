import hashlib
import os
import tempfile
from unittest import TestCase

from redash.transit_naming import provenance
from redash.transit_naming.gtfs_cache import cached_archive
from redash.transit_naming.gtfs_routes import GtfsResolver, read_snapshot, resolve_route
from tests.query_runner.transit_naming_fixtures import metro_profile
from tests.query_runner.transit_naming_gtfs_fixtures import (
    BUS_MEMBERS,
    BUS_URL,
    RAIL_ROUTES_TXT,
    RAIL_URL,
    archive_fetcher,
    build_archive,
    metro_archives,
)

BUS_ZIP = build_archive(BUS_MEMBERS)
BUS_DIGEST = hashlib.sha256(BUS_ZIP).hexdigest()


class TestCachedArchive(TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.cache = self.dir.name

    def tearDown(self):
        self.dir.cleanup()

    def test_first_call_downloads_and_writes_the_cache(self):
        fetch = archive_fetcher({BUS_URL: BUS_ZIP})
        got = cached_archive(BUS_URL, self.cache, 24, 1000000, fetch, now=lambda: 1000.0)
        self.assertEqual((got.content, got.digest, got.stale, got.refresh_error), (BUS_ZIP, BUS_DIGEST, False, ""))
        self.assertEqual(fetch.calls, [BUS_URL])
        self.assertEqual(len([n for n in os.listdir(self.cache) if n.endswith(".zip")]), 1)

    def test_fresh_cache_is_not_refetched(self):
        fetch = archive_fetcher({BUS_URL: BUS_ZIP})
        cached_archive(BUS_URL, self.cache, 24, 1000000, fetch, now=lambda: 1000.0)
        got = cached_archive(BUS_URL, self.cache, 24, 1000000, fetch, now=lambda: 1000.0 + 3600)
        self.assertEqual((got.digest, fetch.calls), (BUS_DIGEST, [BUS_URL]))

    def test_old_cache_is_refreshed(self):
        fetch = archive_fetcher({BUS_URL: BUS_ZIP})
        cached_archive(BUS_URL, self.cache, 24, 1000000, fetch, now=lambda: 1000.0)
        cached_archive(BUS_URL, self.cache, 24, 1000000, fetch, now=lambda: 1000.0 + 25 * 3600)
        self.assertEqual(fetch.calls, [BUS_URL, BUS_URL])

    def test_failed_refresh_with_a_cached_copy_is_stale_not_fatal(self):
        cached_archive(BUS_URL, self.cache, 24, 1000000, archive_fetcher({BUS_URL: BUS_ZIP}), now=lambda: 1000.0)
        failing = archive_fetcher({BUS_URL: OSError("boom")})
        got = cached_archive(BUS_URL, self.cache, 24, 1000000, failing, now=lambda: 1000.0 + 25 * 3600)
        self.assertEqual((got.content, got.stale), (BUS_ZIP, True))
        self.assertIn("boom", got.refresh_error)

    def test_failed_refresh_with_no_cached_copy_raises_with_the_url(self):
        with self.assertRaises(ValueError) as raised:
            cached_archive(
                BUS_URL, self.cache, 24, 1000000, archive_fetcher({BUS_URL: OSError("boom")}), now=lambda: 1.0
            )
        self.assertIn(BUS_URL, str(raised.exception))
        self.assertIn("boom", str(raised.exception))

    def test_corrupt_cached_file_is_deleted_and_refetched(self):
        fetch = archive_fetcher({BUS_URL: BUS_ZIP})
        got = cached_archive(BUS_URL, self.cache, 24, 1000000, fetch, now=lambda: 1000.0)
        path = [os.path.join(self.cache, n) for n in os.listdir(self.cache) if n.endswith(".zip")][0]
        with open(path, "wb") as handle:
            handle.write(b"not a zip")
        again = cached_archive(BUS_URL, self.cache, 24, 1000000, fetch, now=lambda: 1000.0 + 60)
        self.assertEqual((again.digest, fetch.calls), (got.digest, [BUS_URL, BUS_URL]))

    def test_download_over_the_byte_cap_is_refused(self):
        with self.assertRaises(ValueError) as raised:
            cached_archive(BUS_URL, self.cache, 24, 10, archive_fetcher({BUS_URL: BUS_ZIP}), now=lambda: 1.0)
        self.assertIn("10", str(raised.exception))


class TestReadSnapshot(TestCase):
    def test_routes_only(self):
        snapshot = read_snapshot("bus", BUS_ZIP, "https://example/bus.zip")
        self.assertEqual(snapshot.source_name, "bus")
        self.assertEqual(snapshot.digest, BUS_DIGEST)
        self.assertEqual(snapshot.routes["94-13201"]["route_long_name"], "Metro Local Line")
        self.assertEqual(snapshot.trips, ())

    def test_with_patterns_reads_trips_stop_times_and_stops(self):
        snapshot = read_snapshot("bus", BUS_ZIP, "https://example/bus.zip", with_patterns=True)
        self.assertEqual(len(snapshot.trips), 6)
        self.assertEqual(
            snapshot.stop_times_by_trip["t30a"], [(1, "3000001"), (2, "13574"), (3, "19022"), (4, "1166")]
        )
        self.assertEqual(snapshot.stops["9002"]["stop_name"], "Wilshire / Normandie")

    def test_a_bad_zip_names_the_url(self):
        with self.assertRaises(ValueError) as raised:
            read_snapshot("bus", b"junk", "https://example/bus.zip")
        self.assertIn("https://example/bus.zip", str(raised.exception))


class TestResolveRoute(TestCase):
    def setUp(self):
        self.profile = metro_profile(with_overrides=False)
        self.snapshots = {
            "bus": read_snapshot("bus", BUS_ZIP, "u"),
            "rail": read_snapshot("rail", build_archive({"routes.txt": RAIL_ROUTES_TXT}), "u"),
        }

    def test_short_name_join(self):
        got = resolve_route("MT094", "94", self.profile, self.snapshots)
        self.assertEqual(
            (got.gtfs_route_id, got.route_long_name, got.provenance, got.source_name),
            ("94-13201", "Metro Local Line", provenance.GTFS, "bus"),
        )

    def test_combined_short_name_is_split(self):
        self.assertEqual(resolve_route("MT010", "10", self.profile, self.snapshots).gtfs_route_id, "10-13201")

    def test_route_id_prefix_join_for_dodger_and_busway(self):
        self.assertEqual(
            resolve_route("MT022", "22", self.profile, self.snapshots).route_short_name,
            "South Bay Dodger Stadium Express",
        )
        self.assertEqual(resolve_route("MT901", "901", self.profile, self.snapshots).gtfs_route_id, "901-13201")

    def test_rail_joins_on_the_rail_feed(self):
        got = resolve_route("MT801", "801", self.profile, self.snapshots)
        self.assertEqual((got.gtfs_route_id, got.source_name, got.route_type), ("801", "rail", "0"))

    def test_alias_is_checked_first(self):
        got = resolve_route("MT950", "950", self.profile, self.snapshots)
        self.assertEqual((got.gtfs_route_id, got.provenance), ("910-13201", provenance.ALIAS))

    def test_unmatched_returns_none(self):
        self.assertIsNone(resolve_route("MT999", "999", self.profile, self.snapshots))


class TestGtfsResolver(TestCase):
    def test_loads_every_source_and_combines_digests(self):
        with tempfile.TemporaryDirectory() as cache:
            resolver = GtfsResolver(metro_profile(with_overrides=False), cache, fetch=metro_archives())
            snapshots = resolver.snapshots()
        self.assertEqual(sorted(snapshots), ["bus", "rail"])
        self.assertEqual(len(resolver.digest), 64)
        self.assertEqual(resolver.refresh_errors, [])
        self.assertEqual(resolver.resolve("MT807", "807").route_long_name, "Metro K Line")

    def test_no_sources_means_empty_digest_and_no_resolution(self):
        profile = metro_profile(with_overrides=False)
        feedless = profile.__class__(**{**profile.__dict__, "gtfs_sources": (), "aliases": {}})
        with tempfile.TemporaryDirectory() as cache:
            resolver = GtfsResolver(feedless, cache, fetch=metro_archives())
            self.assertEqual((resolver.snapshots(), resolver.digest), ({}, ""))
            self.assertIsNone(resolver.resolve("MT094", "94"))

    def test_stale_source_is_reported(self):
        with tempfile.TemporaryDirectory() as cache:
            GtfsResolver(metro_profile(with_overrides=False), cache, fetch=metro_archives()).snapshots()
            failing = archive_fetcher({BUS_URL: OSError("down"), RAIL_URL: OSError("down")})
            resolver = GtfsResolver(metro_profile(with_overrides=False), cache, fetch=failing, now=lambda: 10**10)
            resolver.snapshots()
        self.assertEqual(len(resolver.refresh_errors), 2)
        self.assertIn("gtfs_refresh_failed", resolver.refresh_errors[0])
