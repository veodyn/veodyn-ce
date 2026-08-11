from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner.gbfs import GBFS

DISCOVERY_URL = "https://gbfs.example.org/gbfs.json"

DISCOVERY = {
    "data": {
        "en": {
            "feeds": [
                {"name": "station_information", "url": "https://gbfs.example/station_information.json"},
                {"name": "station_status", "url": "https://gbfs.example/station_status.json"},
            ]
        }
    }
}

STATION_INFORMATION = {
    "data": {
        "stations": [
            {"station_id": "s1", "name": "Central Station", "lat": 10.05, "lon": 20.23},
            {"station_id": "s2", "name": "East Station", "lat": 10.06, "lon": 20.24},
        ]
    }
}

STATION_STATUS = {
    "data": {
        "stations": [
            {"station_id": "s1", "num_bikes_available": 5, "num_docks_available": 10},
            {"station_id": "s2", "num_bikes_available": 0, "num_docks_available": 15},
        ]
    }
}

URL_PAYLOADS = {
    DISCOVERY_URL: DISCOVERY,
    "https://gbfs.example/station_information.json": STATION_INFORMATION,
    "https://gbfs.example/station_status.json": STATION_STATUS,
}


def fake_get(url, timeout=None):
    response = Mock()
    response.json.return_value = URL_PAYLOADS[url]
    response.raise_for_status.return_value = None
    return response


def make_runner(**overrides):
    config = {"discovery_url": DISCOVERY_URL, "request_timeout": 5}
    config.update(overrides)
    return GBFS(config)


class TestGBFS(TestCase):
    def setUp(self):
        self.runner = make_runner()

    def test_feeds_listing(self):
        with patch("redash.query_runner.gbfs.requests.get", side_effect=fake_get):
            data, error = self.runner.run_query('{"resource": "feeds"}', None)

        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual([row["name"] for row in rows], ["station_information", "station_status"])

    def test_station_information(self):
        with patch("redash.query_runner.gbfs.requests.get", side_effect=fake_get):
            data, error = self.runner.run_query('{"resource": "station_information"}', None)

        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["name"], "Central Station")

    def test_stations_joined(self):
        with patch("redash.query_runner.gbfs.requests.get", side_effect=fake_get):
            data, error = self.runner.run_query('{"resource": "stations_joined"}', None)

        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["name"], "Central Station")
        self.assertEqual(rows[0]["num_bikes_available"], 5)
        self.assertEqual(rows[1]["num_bikes_available"], 0)

    def test_gbfs3_feeds_without_language_key(self):
        discovery_v3 = {"data": {"feeds": DISCOVERY["data"]["en"]["feeds"]}}
        payloads = dict(URL_PAYLOADS)
        payloads[DISCOVERY_URL] = discovery_v3

        def get_v3(url, timeout=None):
            response = Mock()
            response.json.return_value = payloads[url]
            response.raise_for_status.return_value = None
            return response

        with patch("redash.query_runner.gbfs.requests.get", side_effect=get_v3):
            data, error = self.runner.run_query('{"resource": "station_status"}', None)

        self.assertIsNone(error)
        self.assertEqual(len(data["rows"]), 2)

    def test_missing_feed_is_error(self):
        discovery_no_status = {"data": {"en": {"feeds": [DISCOVERY["data"]["en"]["feeds"][0]]}}}
        payloads = dict(URL_PAYLOADS)
        payloads[DISCOVERY_URL] = discovery_no_status

        def get_partial(url, timeout=None):
            response = Mock()
            response.json.return_value = payloads[url]
            response.raise_for_status.return_value = None
            return response

        with patch("redash.query_runner.gbfs.requests.get", side_effect=get_partial):
            data, error = self.runner.run_query('{"resource": "station_status"}', None)

        self.assertIsNone(data)
        self.assertIn("not published", error)
