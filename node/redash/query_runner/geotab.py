"""
Geotab query runner.

Real-time vehicle fleet data from Geotab (gov.geotab.com) via
the mygeotab SDK, without the singleton/background-thread machinery: each
query authenticates and fetches fresh.

Geotab credentials are not stored anywhere in this repo; database,
username and password must all be entered when creating the data source.
"""

from redash.query_runner import register
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
)
from redash.query_runner.connector_validation import require_configured

try:
    import mygeotab

    geotab_available = True
except ImportError:
    mygeotab = None
    geotab_available = False

DEFAULT_SERVER = "gov.geotab.com"
DEFAULT_RESULTS_LIMIT = 500


class Geotab(BaseResourceRunner):
    resources = {
        "device_status_info": {
            "entity": "DeviceStatusInfo",
            "doc_params": ["results_limit (optional): integer - default from data source config"],
            "doc_returns": [
                "device: string (JSON, {id})",
                "latitude: float",
                "longitude: float",
                "bearing: float",
                "speed: float",
                "isDriving: boolean",
                "dateTime: datetime",
            ],
            "example": '{"resource": "device_status_info", "params": {"results_limit": 100}}',
        },
        "devices": {
            "entity": "Device",
            "doc_params": ["results_limit (optional): integer - default from data source config"],
            "doc_returns": ["device objects with id, name, serialNumber, vehicleIdentificationNumber, ..."],
        },
    }
    default_resource = "device_status_info"
    noop_query = '{"resource": "devices", "params": {"results_limit": 1}}'

    @classmethod
    def name(cls):
        return "Geotab Fleet"

    @classmethod
    def type(cls):
        return "geotab"

    @classmethod
    def enabled(cls):
        return geotab_available

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "server": {
                    "type": "string",
                    "title": "Geotab Server",
                    "default": DEFAULT_SERVER,
                },
                "database": {
                    "type": "string",
                    "title": "Database",
                    "description": "Geotab calls this the database name; the customer is told theirs at provisioning.",
                },
                "username": {
                    "type": "string",
                    "title": "Username",
                },
                "password": {
                    "type": "string",
                    "title": "Password",
                },
                "results_limit": {
                    "type": "number",
                    "title": "Default Results Limit",
                    "default": DEFAULT_RESULTS_LIMIT,
                },
            },
            required=["server", "database", "username", "password"],
            secret=["password"],
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        self.server = self.configuration.get("server", DEFAULT_SERVER)
        self.database = self.configuration.get("database", "")
        self.username = self.configuration.get("username", "")
        self.password = self.configuration.get("password", "")
        self.results_limit = self.configuration.get("results_limit", DEFAULT_RESULTS_LIMIT)

    def run_query(self, query, user):
        error = require_configured(
            self.type(),
            server=self.server,
            database=self.database,
            username=self.username,
            password=self.password,
        )
        if error:
            return None, error

        return super().run_query(query, user)

    def _api(self):
        api = mygeotab.API(
            username=self.username,
            password=self.password,
            database=self.database,
            server=self.server,
        )
        api.authenticate()
        return api

    def _fetch(self, resource, params):
        limit = int(params.get("results_limit", self.results_limit))
        records = self._api().get(self.resources[resource]["entity"], resultsLimit=limit)
        return records, records

    def test_connection(self):
        self._api().get("Device", resultsLimit=1)


register(Geotab)
