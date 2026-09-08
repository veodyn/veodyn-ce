import json
from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner.gofs import GOFS

DISCOVERY_URL = "https://gofs.example.org/gofs.json"
BASE = "https://gofs.example.org/en/"

FEED_NAMES = [
    "system_information",
    "service_brands",
    "vehicle_types",
    "zones",
    "operating_rules",
    "calendars",
    "booking_rules",
]

DISCOVERY = {
    "last_updated": 1609866247,
    "ttl": 0,
    "version": "1.0",
    "data": {"en": {"feeds": [{"name": name, "url": BASE + name} for name in FEED_NAMES]}},
}

ZONE = {
    "type": "Feature",
    "zone_id": "zoneA",
    "properties": {"name": "Downtown"},
    "geometry": {"type": "Polygon", "coordinates": [[[-74.1, 45.35], [-73.5, 45.35], [-73.5, 45.7], [-74.1, 45.35]]]},
}

PAYLOADS = {
    DISCOVERY_URL: DISCOVERY,
    BASE
    + "system_information": {
        "data": {
            "language": "en",
            "name": "Ride Now",
            "timezone": "America/Montreal",
            "url": "https://ridenow.example",
        }
    },
    BASE
    + "service_brands": {
        "data": {"service_brands": [{"brand_id": "b1", "brand_name": "Taxi", "brand_color": "FF0000"}]}
    },
    BASE + "vehicle_types": {"data": {"vehicle_types": [{"vehicle_type_id": "van", "wheelchair_accessible": True}]}},
    BASE + "zones": {"data": {"zones": {"type": "FeatureCollection", "features": [ZONE]}}},
    BASE
    + "operating_rules": {
        "data": {
            "operating_rules": [
                {
                    "from_zone_id": "zoneA",
                    "to_zone_id": "zoneA",
                    "start_pickup_window": "06:00:00",
                    "end_pickup_window": "22:00:00",
                    "calendars": ["weekdays"],
                    "vehicle_type_id": ["van"],
                }
            ]
        }
    },
    BASE
    + "calendars": {
        "data": {
            "calendars": [
                {
                    "calendar_id": "weekdays",
                    "days": ["mon", "tue"],
                    "start_date": "2026-01-01",
                    "end_date": "2026-12-31",
                }
            ]
        }
    },
    BASE + "booking_rules": {"data": {"booking_rules": [{"from_zone_ids": ["zoneA"], "booking_type": 1}]}},
}


def fake_get(url, timeout=None, headers=None):
    response = Mock()
    response.json.return_value = PAYLOADS[url]
    response.raise_for_status.return_value = None
    return response


def run(query, get=fake_get, **config):
    runner = GOFS({"discovery_url": DISCOVERY_URL, "request_timeout": 5, **config})
    with patch("redash.query_runner.gofs.requests.get", side_effect=get) as mocked:
        data, error = runner.run_query(query, None)
    return data, error, mocked


class TestGOFS(TestCase):
    def test_feeds_lists_the_discovery_document(self):
        data, error, _get = run('{"resource": "feeds"}')
        self.assertIsNone(error)
        self.assertEqual([row["name"] for row in data["rows"]], sorted(FEED_NAMES))
        self.assertEqual(data["rows"][0]["url"], BASE + "booking_rules")

    def test_system_information_is_the_default_and_a_single_row(self):
        data, error, _get = run("{}")
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 1)
        self.assertEqual(data["rows"][0]["name"], "Ride Now")
        self.assertEqual(data["rows"][0]["timezone"], "America/Montreal")

    def test_array_resources_serve_one_row_per_record(self):
        for resource, key, value in [
            ("service_brands", "brand_id", "b1"),
            ("vehicle_types", "vehicle_type_id", "van"),
            ("calendars", "calendar_id", "weekdays"),
            ("booking_rules", "booking_type", 1),
        ]:
            data, error, _get = run(json.dumps({"resource": resource}))
            self.assertIsNone(error, resource)
            self.assertEqual(data["rows"][0][key], value, resource)

    def test_array_valued_fields_are_json_strings(self):
        data, error, _get = run('{"resource": "operating_rules"}')
        self.assertIsNone(error)
        row = data["rows"][0]
        self.assertEqual(json.loads(row["calendars"]), ["weekdays"])
        self.assertEqual(json.loads(row["vehicle_type_id"]), ["van"])
        self.assertEqual(row["start_pickup_window"], "06:00:00")

    def test_zones_rows_lift_the_feature_id_and_name(self):
        data, error, _get = run('{"resource": "zones"}')
        self.assertIsNone(error)
        row = data["rows"][0]
        self.assertEqual(row["zone_id"], "zoneA")
        self.assertEqual(row["name"], "Downtown")
        self.assertEqual(row["geometry_type"], "Polygon")
        self.assertEqual(json.loads(row["geometry"]), ZONE["geometry"])
        self.assertEqual(json.loads(row["bbox"]), [-74.1, 45.35, -73.5, 45.7])

    def test_zones_as_a_featurecollection_is_one_geojson_cell(self):
        data, error, _get = run('{"resource": "zones", "params": {"format": "featurecollection"}}')
        self.assertIsNone(error)
        self.assertEqual([column["name"] for column in data["columns"]], ["geojson"])
        collection = json.loads(data["rows"][0]["geojson"])
        self.assertEqual(collection["type"], "FeatureCollection")
        self.assertEqual(collection["features"][0]["zone_id"], "zoneA")

    def test_feeds_without_a_language_key_are_still_discovered(self):
        payloads = dict(PAYLOADS)
        payloads[DISCOVERY_URL] = {"data": {"feeds": DISCOVERY["data"]["en"]["feeds"]}}

        def get(url, timeout=None, headers=None):
            response = Mock()
            response.json.return_value = payloads[url]
            response.raise_for_status.return_value = None
            return response

        data, error, _get = run('{"resource": "calendars"}', get=get)
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 1)

    def test_a_configured_language_selects_its_feed_set(self):
        payloads = dict(PAYLOADS)
        payloads[DISCOVERY_URL] = {
            "data": {
                "en": {"feeds": []},
                "fr": {"feeds": [{"name": "calendars", "url": BASE + "calendars"}]},
            }
        }

        def get(url, timeout=None, headers=None):
            response = Mock()
            response.json.return_value = payloads[url]
            response.raise_for_status.return_value = None
            return response

        data, error, _get = run('{"resource": "calendars"}', get=get, language="fr")
        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 1)

    def test_a_feed_the_system_does_not_publish_is_an_error(self):
        payloads = dict(PAYLOADS)
        payloads[DISCOVERY_URL] = {"data": {"en": {"feeds": [{"name": "zones", "url": BASE + "zones"}]}}}

        def get(url, timeout=None, headers=None):
            response = Mock()
            response.json.return_value = payloads[url]
            response.raise_for_status.return_value = None
            return response

        data, error, _get = run('{"resource": "booking_rules"}', get=get)
        self.assertIsNone(data)
        self.assertIn("not published", error)
        self.assertIn("zones", error)

    def test_an_unknown_resource_is_rejected(self):
        data, error, _get = run('{"resource": "trips"}')
        self.assertIsNone(data)
        self.assertIn("Unknown resource", error)

    def test_requests_carry_the_timeout_and_connector_user_agent(self):
        _data, _error, get = run('{"resource": "feeds"}')
        _args, kwargs = get.call_args
        self.assertEqual(kwargs["timeout"], 5)
        self.assertIn("Veodyn", kwargs["headers"]["User-Agent"])
