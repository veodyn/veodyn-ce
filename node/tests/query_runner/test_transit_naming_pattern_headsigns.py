from unittest import TestCase

from redash.transit_naming.mca_patterns import pattern_headsign


class TestPatternNamesBecomeDestinations(TestCase):
    def test_the_route_designation_in_front_is_dropped(self):
        self.assertEqual(
            pattern_headsign("THOUSAND OAKS BUS 40 Newbury Park", "TH040", "Thousand Oaks Transit"), "Newbury Park"
        )
        self.assertEqual(pattern_headsign("Sunbus LINE 1 East Valley", "ST001", "SunLine"), "East Valley")
        self.assertEqual(
            pattern_headsign("2 Avalon - Central to CSUDH", "LB002", "Long Beach Transit"), "Avalon - Central to CSUDH"
        )

    def test_the_travel_direction_and_its_to_are_dropped(self):
        self.assertEqual(
            pattern_headsign("Route 9 Northbound to Perris Station Transit Center", "RA009", "RTA"),
            "Perris Station Transit Center",
        )
        self.assertEqual(
            pattern_headsign("11 Eastbound to Lancaster City Park", "AV011", "AVTA"), "Lancaster City Park"
        )
        self.assertEqual(
            pattern_headsign("Route 30 to  Simi Valley Civic Center", "SV030", "Simi Valley"),
            "Simi Valley Civic Center",
        )

    def test_a_name_that_is_only_a_direction_says_nothing(self):
        self.assertEqual(pattern_headsign("Northbound", "BC102", "Big Blue Bus"), "")
        self.assertEqual(pattern_headsign("BC102", "BC102", "Big Blue Bus"), "")

    def test_the_carrier_name_in_front_is_dropped_and_dashes_are_spaced(self):
        self.assertEqual(
            pattern_headsign("Burbank Bus Orange Noho--Airport", "BUORA", "Burbank Bus"), "Orange Noho - Airport"
        )

    def test_stray_spacing_is_collapsed(self):
        self.assertEqual(
            pattern_headsign("Esplanade - El Rio -  St Johns Center", "GC015", "GCTD"),
            "Esplanade - El Rio - St Johns Center",
        )
        self.assertEqual(
            pattern_headsign("Norwalk Square-Pioneer-Studebaker  (Clockwise Loop)", "NT002", "Norwalk Transit"),
            "Norwalk Square-Pioneer-Studebaker (Clockwise Loop)",
        )

    def test_a_route_mentioned_inside_the_destination_stays(self):
        self.assertEqual(pattern_headsign("Downtown via Route 9", "RA009", "RTA"), "Downtown via Route 9")
        self.assertEqual(pattern_headsign("Route 9", "RA009", "RTA"), "Route 9")

    def test_a_destination_starts_with_a_capital_once_its_prefix_is_dropped(self):
        self.assertEqual(pattern_headsign("Route 30 to los Lagos & Elm", "SV030", "Valley"), "Los Lagos & Elm")
