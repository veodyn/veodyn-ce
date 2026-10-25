from unittest import TestCase
from unittest.mock import Mock, patch

from redash.query_runner.nrel_afdc import NrelAfdc, station_row

STATION = {
    "id": 1517,
    "station_name": "Central Station Garage",
    "street_address": "800 N Alameda St",
    "city": "Elmwood",
    "state": "CA",
    "zip": "90012",
    "latitude": 34.0562,
    "longitude": -118.2365,
    "ev_network": "ChargePoint Network",
    "ev_level1_evse_num": None,
    "ev_level2_evse_num": 12,
    "ev_dc_fast_num": 2,
    "ev_connector_types": ["J1772", "J1772COMBO"],
    "access_days_time": "24 hours daily",
    "station_phone": "888-758-4389",
    "updated_at": "2026-10-01T12:00:00Z",
    "fuel_type_code": "ELEC",
}


def response(payload):
    mock = Mock()
    mock.json.return_value = payload
    mock.raise_for_status.return_value = None
    return mock


class TestNrelAfdc(TestCase):
    def setUp(self):
        self.runner = NrelAfdc({"api_key": "k"})

    def run_stations(self, params, payload=None):
        text = '{"resource": "stations", "params": %s}' % params
        with patch(
            "redash.query_runner.nrel_afdc.requests.get",
            return_value=response(payload or {"fuel_stations": [STATION]}),
        ) as get:
            data, error = self.runner.run_query(text, None)
        return data, error, get

    def test_lists_public_electric_stations_in_a_state_by_default(self):
        data, error, get = self.run_stations('{"state": "CA"}')
        self.assertIsNone(error)
        url = get.call_args[0][0]
        query = get.call_args[1]["params"]
        self.assertEqual(url, "https://developer.nrel.gov/api/alt-fuel-stations/v1.json")
        self.assertEqual(query["fuel_type"], "ELEC")
        self.assertEqual(query["access"], "public")
        self.assertEqual(query["status"], "E")
        self.assertEqual(query["state"], "CA")
        self.assertEqual(query["api_key"], "k")
        row = data["rows"][0]
        self.assertEqual(row["station_name"], "Central Station Garage")
        self.assertEqual(row["ev_connector_types"], "J1772, J1772COMBO")
        self.assertNotIn("fuel_type_code", row)

    def test_nearest_stations_use_the_nearest_endpoint(self):
        _data, error, get = self.run_stations('{"latitude": 34.05, "longitude": -118.25, "radius": 5}')
        self.assertIsNone(error)
        self.assertEqual(get.call_args[0][0], "https://developer.nrel.gov/api/alt-fuel-stations/v1/nearest.json")
        self.assertEqual(get.call_args[1]["params"]["radius"], 5)

    def test_a_radius_without_a_point_is_refused(self):
        data, error, get = self.run_stations('{"radius": 5}')
        self.assertIsNone(data)
        self.assertIn("latitude and longitude go together", error)
        get.assert_not_called()

    def test_an_empty_result_keeps_its_columns(self):
        data, error, _get = self.run_stations('{"zip": "00000"}', {"fuel_stations": []})
        self.assertIsNone(error)
        self.assertEqual(data["rows"], [])
        self.assertIn("station_name", [column["name"] for column in data["columns"]])

    def test_requires_an_api_key(self):
        data, error = NrelAfdc({"api_key": ""}).run_query('{"resource": "stations"}', None)
        self.assertIsNone(data)
        self.assertIsNotNone(error)

    def test_never_puts_the_key_in_an_error(self):
        with patch("redash.query_runner.nrel_afdc.requests.get", side_effect=RuntimeError("boom")):
            data, error = self.runner.run_query('{"resource": "stations"}', None)
        self.assertIsNone(data)
        self.assertNotIn("api_key=k", error)

    def test_station_row_projects_the_declared_columns_only(self):
        row = station_row({**STATION, "ev_connector_types": None})
        self.assertIsNone(row["ev_connector_types"])
        self.assertEqual(set(row), set(NrelAfdc.empty_columns["stations"]))
