import requests

from redash.query_runner import TYPE_FLOAT, TYPE_INTEGER, TYPE_STRING, register
from redash.query_runner.connector_base import (
    REQUEST_HEADERS,
    BaseResourceRunner,
    build_configuration_schema,
)
from redash.query_runner.connector_validation import require_configured

DEFAULT_BASE_URL = "https://developer.nrel.gov/api/alt-fuel-stations/v1"
DEFAULT_FILTERS = {"fuel_type": "ELEC", "status": "E", "access": "public", "limit": "all"}
FILTER_PARAMS = (
    "state",
    "zip",
    "fuel_type",
    "status",
    "access",
    "ev_network",
    "ev_charging_level",
    "ev_connector_type",
    "limit",
)
NEAREST_PARAMS = ("latitude", "longitude", "radius")

STATION_COLUMNS = {
    "id": TYPE_INTEGER,
    "station_name": TYPE_STRING,
    "street_address": TYPE_STRING,
    "city": TYPE_STRING,
    "state": TYPE_STRING,
    "zip": TYPE_STRING,
    "latitude": TYPE_FLOAT,
    "longitude": TYPE_FLOAT,
    "ev_network": TYPE_STRING,
    "ev_level1_evse_num": TYPE_INTEGER,
    "ev_level2_evse_num": TYPE_INTEGER,
    "ev_dc_fast_num": TYPE_INTEGER,
    "ev_connector_types": TYPE_STRING,
    "access_days_time": TYPE_STRING,
    "station_phone": TYPE_STRING,
    "updated_at": TYPE_STRING,
    "distance": TYPE_FLOAT,
}


def station_row(station):
    row = {name: station.get(name) for name in STATION_COLUMNS}
    connectors = station.get("ev_connector_types")
    row["ev_connector_types"] = ", ".join(connectors) if isinstance(connectors, list) else connectors
    return row


class NrelAfdc(BaseResourceRunner):
    resources = {
        "stations": {
            "doc_params": [
                "state (optional): two-letter state, e.g. CA",
                "zip (optional): ZIP code",
                "latitude, longitude, radius (optional, together): nearest stations within radius miles",
                "fuel_type (default ELEC), status (default E), access (default public), limit (default all)",
                "ev_network, ev_charging_level, ev_connector_type (optional): AFDC filter values",
            ],
            "doc_returns": [f"{name}: {kind}" for name, kind in STATION_COLUMNS.items()],
            "example": '{"resource": "stations", "params": {"state": "CA", "zip": "90012"}}',
        },
    }
    empty_columns = {"stations": STATION_COLUMNS}
    default_resource = "stations"
    noop_query = '{"resource": "stations", "params": {"zip": "90012", "limit": "1"}}'

    @classmethod
    def name(cls):
        return "NREL Alternative Fuel Stations"

    @classmethod
    def type(cls):
        return "nrel_afdc"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "base_url": {
                    "type": "string",
                    "title": "AFDC API Base URL",
                    "default": DEFAULT_BASE_URL,
                },
                "api_key": {
                    "type": "string",
                    "title": "NREL API Key",
                },
            },
            required=["base_url", "api_key"],
            secret=["api_key"],
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        self.base_url = self.configuration.get("base_url", DEFAULT_BASE_URL).rstrip("/")
        self.api_key = self.configuration.get("api_key", "")

    def run_query(self, query, user):
        error = require_configured(self.type(), base_url=self.base_url, api_key=self.api_key)
        if error:
            return None, error
        return super().run_query(query, user)

    def _fetch(self, resource, params):
        nearest = {name: params[name] for name in NEAREST_PARAMS if params.get(name) not in (None, "")}
        if nearest and set(nearest) != {"latitude", "longitude"} and set(nearest) != set(NEAREST_PARAMS):
            raise ValueError("latitude and longitude go together, with an optional radius")
        query = dict(DEFAULT_FILTERS)
        query.update({name: params[name] for name in FILTER_PARAMS if params.get(name) not in (None, "")})
        query.update(nearest)
        query["api_key"] = self.api_key
        url = f"{self.base_url}/nearest.json" if nearest else f"{self.base_url}.json"
        resp = requests.get(url, params=query, headers=REQUEST_HEADERS, timeout=self.timeout)
        resp.raise_for_status()
        raw = resp.json()
        stations = raw.get("fuel_stations", []) if isinstance(raw, dict) else []
        return [station_row(station) for station in stations], raw


register(NrelAfdc)
