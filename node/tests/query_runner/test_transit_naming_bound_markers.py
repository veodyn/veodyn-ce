from unittest import TestCase

from redash.transit_naming.directions import split_bound
from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set
from redash.transit_naming.stops import name_stop

PARTNER = build_profile_set([CORE_PROFILE_DIR]).for_carrier("DA", "Partner")


def named(raw):
    name = name_stop(
        {"stop_id": "x", "stop_name": raw, "transit_modes": "BUS", "prediction_count": 1},
        PARTNER,
    )
    return name.public_name, name.direction


class TestTravelDirectionLeavesTheName(TestCase):
    def test_a_spelled_out_bound_after_the_name(self):
        self.assertEqual(named("Van Nuys Bl/Lanark St Northbound"), ("Van Nuys Bl/Lanark St", "Northbound"))

    def test_a_bound_before_the_name(self):
        self.assertEqual(split_bound("WB Camino Real @ 2nd"), ("Camino Real @ 2nd", "Westbound"))
        self.assertEqual(split_bound("Westbound Access Rd/Emergency Room"), ("Access Rd/Emergency Room", "Westbound"))

    def test_a_bound_before_a_closing_note_keeps_the_note(self):
        self.assertEqual(
            split_bound("Santa Clara/Oak EB (Downtown Ventura)"), ("Santa Clara/Oak (Downtown Ventura)", "Eastbound")
        )

    def test_a_street_named_for_a_compass_point_is_not_a_bound(self):
        self.assertEqual(split_bound("West Main at Peking"), ("West Main at Peking", ""))
        self.assertEqual(split_bound("Northbound"), ("Northbound", ""))


class TestParkwayAbbreviations(TestCase):
    def test_carrier_spellings_of_parkway_read_pkwy(self):
        self.assertEqual(named("Centre Point Pky/Golden Valley Rd")[0], "Centre Point Pkwy/Golden Valley Rd")
        self.assertEqual(named("West Covina Prkwy/Fashion Plaza Way")[0], "West Covina Pkwy/Fashion Plaza Way")
