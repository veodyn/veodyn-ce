import datetime
import json
from unittest import TestCase
from unittest.mock import MagicMock, patch

from redash.query_runner.geotab import Geotab

SAMPLE_STATUS = [
    {
        "device": {"id": "b1"},
        "latitude": 10.05,
        "longitude": 20.24,
        "bearing": 45.0,
        "speed": 30.0,
        "isDriving": True,
        "dateTime": datetime.datetime(2026, 7, 19, 10, 30, 0),
    }
]

CONFIG = {"username": "user@example.com", "password": "pw", "server": "gov.geotab.com", "database": "fleet"}


class TestGeotab(TestCase):
    def _patch_api(self, get_return):
        api = MagicMock()
        api.get.return_value = get_return
        mygeotab_mock = MagicMock()
        mygeotab_mock.API.return_value = api
        return patch("redash.query_runner.geotab.mygeotab", mygeotab_mock), api, mygeotab_mock

    def test_device_status_info(self):
        patcher, api, mygeotab_mock = self._patch_api(SAMPLE_STATUS)
        with patcher:
            runner = Geotab(CONFIG)
            data, error = runner.run_query('{"resource": "device_status_info"}', None)

        self.assertIsNone(error)
        rows = data["rows"]
        self.assertEqual(rows[0]["latitude"], 10.05)
        # datetimes serialize to ISO strings, nested dicts to JSON strings
        self.assertEqual(rows[0]["dateTime"], "2026-07-19T10:30:00")
        self.assertEqual(rows[0]["device"], json.dumps({"id": "b1"}))

        mygeotab_mock.API.assert_called_once_with(
            username="user@example.com", password="pw", database="fleet", server="gov.geotab.com"
        )
        api.authenticate.assert_called_once()
        api.get.assert_called_once_with("DeviceStatusInfo", resultsLimit=500)

    def test_results_limit_param(self):
        patcher, api, _ = self._patch_api([])
        with patcher:
            runner = Geotab(CONFIG)
            data, error = runner.run_query('{"resource": "devices", "params": {"results_limit": 7}}', None)

        self.assertIsNone(error)
        api.get.assert_called_once_with("Device", resultsLimit=7)

    def test_auth_failure_is_query_error(self):
        patcher, api, mygeotab_mock = self._patch_api([])
        api.authenticate.side_effect = Exception("InvalidUserException")
        with patcher:
            runner = Geotab(CONFIG)
            data, error = runner.run_query('{"resource": "devices"}', None)

        self.assertIsNone(data)
        self.assertIn("InvalidUserException", error)

    def test_missing_credentials_fail_before_any_request(self):
        # A pre-existing row saved before these became required can still
        # have any of them empty; each must fail as configuration, naming
        # the field, rather than authenticating to Geotab with an empty
        # value.
        for field in ("server", "database", "username", "password"):
            config = dict(CONFIG)
            config[field] = ""
            with self.subTest(field=field):
                patcher, api, mygeotab_mock = self._patch_api([])
                with patcher:
                    runner = Geotab(config)
                    data, error = runner.run_query('{"resource": "devices"}', None)

                self.assertIsNone(data)
                self.assertEqual(error, f"geotab: '{field}' is not configured")
                mygeotab_mock.API.assert_not_called()
