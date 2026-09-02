from unittest import TestCase

from redash.transit_naming import provenance
from redash.transit_naming.headsigns import normalize_headsign
from redash.transit_naming.profiles import HeadsignRules
from redash.transit_naming.stops import name_stop, normalize_part, stop_row
from tests.query_runner.transit_naming_fixtures import MT_STOPS_BY_ID, metro_profile

PROFILE = metro_profile()


class TestNormalizePart(TestCase):
    def test_maps_suffix_words_and_abbreviations(self):
        rules = PROFILE.stop_name
        self.assertEqual(normalize_part("Paramount Blvd", rules), "Paramount Bl")
        self.assertEqual(normalize_part("Slauson Ave", rules), "Slauson Av")
        self.assertEqual(normalize_part("Pacific Avenue", rules), "Pacific Av")
        self.assertEqual(normalize_part("1st Street", rules), "1st St")
        self.assertEqual(normalize_part("Imperial Hwy", rules), "Imperial Hwy")

    def test_keeps_whole_words_and_trailing_periods(self):
        rules = PROFILE.stop_name
        self.assertEqual(normalize_part("Broadway", rules), "Broadway")
        self.assertEqual(normalize_part("Anaheim St.", rules), "Anaheim St")
        self.assertEqual(normalize_part("  Main   St ", rules), "Main St")


class TestNameStop(TestCase):
    def test_intersection_from_parts(self):
        name = name_stop(MT_STOPS_BY_ID["1"], PROFILE)
        self.assertEqual(
            (name.public_name, name.stop_kind, name.mode), ("Paramount Bl/Slauson Av", "intersection", "bus")
        )
        self.assertEqual((name.on_street, name.cross_street), ("Paramount Bl", "Slauson Av"))
        self.assertEqual(name.public_name_source, provenance.RULE)
        self.assertFalse(name.retired)

    def test_direction_is_kept_beside_the_name(self):
        name = name_stop(MT_STOPS_BY_ID["1166"], PROFILE)
        self.assertEqual((name.public_name, name.direction), ("1st St/Main St", "East"))

    def test_intersection_parsed_from_the_raw_name_with_a_direction_parenthetical(self):
        name = name_stop(MT_STOPS_BY_ID["7001"], PROFILE)
        self.assertEqual(
            (name.public_name, name.direction, name.stop_kind),
            ("Imperial Hwy/Central Av", "Westbound", "intersection"),
        )

    def test_station_drops_the_trailing_line_reference(self):
        name = name_stop(MT_STOPS_BY_ID["80122"], PROFILE)
        self.assertEqual(
            (name.public_name, name.stop_kind, name.mode), ("Riverbrook - Park Station", "station", "rail")
        )
        self.assertEqual(name.public_name_source, provenance.RULE)

    def test_station_ignores_its_street_parts(self):
        name = name_stop(MT_STOPS_BY_ID["80101"], PROFILE)
        self.assertEqual(
            (name.public_name, name.public_name_source), ("Downtown Long Beach Station", provenance.PASSTHROUGH)
        )
        self.assertEqual((name.on_street, name.cross_street), ("", ""))

    def test_named_place_passes_through(self):
        name = name_stop(MT_STOPS_BY_ID["7002"], PROFILE)
        self.assertEqual(
            (name.public_name, name.stop_kind, name.public_name_source),
            ("Fullerton Park & Ride Dock 14", "named_place", provenance.PASSTHROUGH),
        )

    def test_unparsed_passes_through_and_an_override_fixes_it(self):
        name = name_stop(bare_stop("Hungtington Dr and Golden West Ave W"), metro_profile(with_overrides=False))
        self.assertEqual(
            (name.public_name, name.stop_kind, name.public_name_source),
            ("Hungtington Dr and Golden West Ave W", "unparsed", provenance.PASSTHROUGH),
        )
        name = name_stop(MT_STOPS_BY_ID["3000001"], PROFILE)
        self.assertEqual((name.public_name, name.public_name_source), ("Pico/Rimpau", provenance.OVERRIDE))

    def test_retired_is_empty_modes_and_no_predictions(self):
        name = name_stop(MT_STOPS_BY_ID["10270"], PROFILE)
        self.assertTrue(name.retired)
        self.assertEqual((name.public_name, name.mode), ("Collis Av/Cudahy St", ""))

    def test_row_columns(self):
        row = stop_row(MT_STOPS_BY_ID["1166"], name_stop(MT_STOPS_BY_ID["1166"], PROFILE), "rev", "")
        self.assertEqual(
            list(row),
            [
                "carrier_code",
                "stop_id",
                "uuid",
                "511_id",
                "public_name",
                "raw_name",
                "on_street",
                "cross_street",
                "direction",
                "relation_to_cross_street",
                "stop_kind",
                "mode",
                "retired",
                "lat",
                "lng",
                "city",
                "accessible",
                "public_name_source",
                "normalization_revision",
                "gtfs_digest",
            ],
        )
        self.assertEqual((row["raw_name"], row["511_id"], row["retired"]), ("1st St/Main St", "1001166", False))


class TestNormalizeHeadsign(TestCase):
    def test_expands_and_spaces_hyphens(self):
        self.assertEqual(
            normalize_headsign("Downtown LA- Little Tokyo-Arts Dist Sta.", PROFILE.headsign),
            "Downtown LA - Little Tokyo - Arts Dist Station",
        )

    def test_title_cases_but_keeps_short_caps_and_expands_phrases(self):
        self.assertEqual(
            normalize_headsign("DTWN LA - HILL - VENICE", PROFILE.headsign), "Downtown LA - Hill - Venice"
        )
        self.assertEqual(normalize_headsign("HARBOR GTWY TRANS CTR", PROFILE.headsign), "Harbor Gtwy Transit Center")
        self.assertEqual(normalize_headsign("SOMEWHERE VIA DTLA.", PROFILE.headsign), "Somewhere Via Downtown LA")

    def test_empty_and_none(self):
        self.assertEqual(normalize_headsign("", PROFILE.headsign), "")
        self.assertEqual(normalize_headsign(None, PROFILE.headsign), "")


def bare_stop(name, modes="BUS", on="", cross=""):
    return {
        "stop_id": "x",
        "stop_name": name,
        "on_street": on,
        "cross_street": cross,
        "street_direction": "",
        "transit_modes": modes,
        "prediction_count": 1,
    }


class TestReviewFindings(TestCase):
    def test_station_drops_a_direction_parenthetical_into_direction(self):
        name = name_stop(bare_stop("Central Station (Northbound)", modes="RAIL"), PROFILE)
        self.assertEqual(
            (name.public_name, name.direction, name.stop_kind), ("Central Station", "Northbound", "station")
        )

    def test_rail_stop_without_the_word_gets_the_configured_suffix(self):
        name = name_stop(bare_stop("Central", modes="RAIL"), PROFILE)
        self.assertEqual((name.public_name, name.public_name_source), ("Central Station", provenance.RULE))

    def test_a_street_pair_beats_a_place_keyword(self):
        name = name_stop(bare_stop("Station Rd/Main St"), PROFILE)
        self.assertEqual((name.public_name, name.stop_kind), ("Station Rd/Main St", "intersection"))
        name = name_stop(bare_stop("Bay St/Main St"), PROFILE)
        self.assertEqual((name.public_name, name.stop_kind), ("Bay St/Main St", "intersection"))
        name = name_stop(bare_stop("Station Rd/Main St", on="Station Rd", cross="Main St"), PROFILE)
        self.assertEqual(name.stop_kind, "intersection")

    def test_uppercase_street_suffixes_still_parse(self):
        name = name_stop(bare_stop("MAIN ST/FIRST AVE"), PROFILE)
        self.assertEqual((name.public_name, name.stop_kind), ("MAIN St/FIRST Av", "intersection"))

    def test_structured_parts_drop_a_direction_parenthetical(self):
        stop = bare_stop("Imperial Hwy/Central Ave (Westbound)", on="Imperial Hwy", cross="Central Ave (Westbound)")
        name = name_stop(stop, PROFILE)
        self.assertEqual((name.public_name, name.direction), ("Imperial Hwy/Central Av", "Westbound"))

    def test_ampersand_with_non_street_tokens_is_a_named_place(self):
        name = name_stop(bare_stop("Museum & Library"), PROFILE)
        self.assertEqual((name.stop_kind, name.public_name), ("named_place", "Museum & Library"))

    def test_headsign_keeps_internal_periods(self):
        self.assertEqual(
            normalize_headsign("Via St. Louis.", HeadsignRules(title_case=False, expand={})), "Via St. Louis"
        )
        self.assertEqual(normalize_headsign("LA. AIRPORT VIA LA.", PROFILE.headsign), "LA. Airport Via LA")

    def test_named_place_with_a_stripped_direction_is_rule_derived(self):
        name = name_stop(bare_stop("Harbor Transit Center (Northbound)"), PROFILE)
        self.assertEqual(
            (name.public_name, name.direction, name.stop_kind, name.public_name_source),
            ("Harbor Transit Center", "Northbound", "named_place", provenance.RULE),
        )


class TestLiveDataFindings(TestCase):
    def test_html_entities_in_parts_are_decoded(self):
        stop = bare_stop("Florence Ave/Orr & Day Rd", on="Florence Ave", cross="Orr &amp; Day Rd")
        self.assertEqual(name_stop(stop, PROFILE).public_name, "Florence Av/Orr & Day Rd")

    def test_a_backslash_pair_is_an_intersection(self):
        name = name_stop(bare_stop("Pico \\ Rimpau"), metro_profile(with_overrides=False))
        self.assertEqual(
            (name.public_name, name.stop_kind, name.public_name_source),
            ("Pico/Rimpau", "intersection", provenance.RULE),
        )

    def test_identical_parts_fall_back_to_the_raw_name(self):
        stop = bare_stop(
            "Harbor Transitway \\ Rosecrans", on="Harbor Frwy & Transit Wy", cross="Harbor Frwy & Transit Wy"
        )
        self.assertEqual(name_stop(stop, PROFILE).public_name, "Harbor Transitway/Rosecrans")

    def test_park_and_ride_spelled_out_is_a_named_place(self):
        stop = bare_stop("Fullerton Park and Ride", on="Fullerton Park & Ride", cross="Fullerton Park & Ride")
        name = name_stop(stop, PROFILE)
        self.assertEqual((name.public_name, name.stop_kind), ("Fullerton Park and Ride", "named_place"))

    def test_multi_line_station_references_are_stripped(self):
        cases = {
            "7th Street / City Center Station - Metro A & E Lines": "7th Street / City Center Station",
            "Central Station - Metro B & D Lines": "Central Station",
            "Riverbrook - Park Station - Metro C-Line": "Riverbrook - Park Station",
        }
        for raw, expected in cases.items():
            self.assertEqual(name_stop(bare_stop(raw, modes="RAIL"), PROFILE).public_name, expected, raw)
