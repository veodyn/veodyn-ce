"""
AirNow query runner.

Current air-quality observations (AQI) by latitude/longitude from
airnowapi.org.

The API key must be entered when creating the data source; it is not shipped
as a default. Latitude and longitude are per-query params with no built-in
location, since a default would bake one region into every install.
"""

import json

import requests

from redash.query_runner import register
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
)
from redash.query_runner.connector_validation import (
    parse_object_query,
    require_configured,
    require_params,
)

DEFAULT_BASE_URL = "https://www.airnowapi.org/aq/observation/latLong/current/"

# Null Island: a syntactically valid, real-nowhere coordinate. AirNow has no
# station there, so test_connection exercises the request wiring without a
# customer's actual monitoring location baked into the connector.
NOOP_LATITUDE = "0.0"
NOOP_LONGITUDE = "0.0"


class AirNow(BaseResourceRunner):
    resources = {
        "observations": {
            "doc_params": [
                "latitude (required): float, decimal degrees",
                "longitude (required): float, decimal degrees",
                "distance (optional): float - search radius in miles (default 5)",
            ],
            "doc_returns": [
                "DateObserved: string",
                "HourObserved: integer",
                "LocalTimeZone: string",
                "ReportingArea: string",
                "StateCode: string",
                "Latitude: float",
                "Longitude: float",
                "ParameterName: string (PM2.5, O3, ...)",
                "AQI: integer",
                "Category: string (JSON, {Number, Name})",
            ],
            "example": '{"resource": "observations", "params": {"latitude": "0.0", "longitude": "0.0", "distance": "10"}}',
        },
    }
    default_resource = "observations"
    noop_query = json.dumps(
        {"resource": "observations", "params": {"latitude": NOOP_LATITUDE, "longitude": NOOP_LONGITUDE}}
    )

    @classmethod
    def name(cls):
        return "AirNow Air Quality"

    @classmethod
    def type(cls):
        return "airnow"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "base_url": {
                    "type": "string",
                    "title": "AirNow Observation URL",
                    "default": DEFAULT_BASE_URL,
                },
                "api_key": {
                    "type": "string",
                    "title": "API Key",
                },
            },
            required=["base_url", "api_key"],
            secret=["api_key"],
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        self.base_url = self.configuration.get("base_url", DEFAULT_BASE_URL)
        self.api_key = self.configuration.get("api_key", "")

    def run_query(self, query, user):
        error = require_configured(self.type(), base_url=self.base_url, api_key=self.api_key)
        if error:
            return None, error

        _config, params, error = parse_object_query(query)
        if error:
            return None, error
        error = require_params(self.type(), params, "latitude", "longitude")
        if error:
            return None, error

        return super().run_query(query, user)

    def _fetch(self, resource, params):
        query_params = {
            "format": "application/json",
            "latitude": params.get("latitude", ""),
            "longitude": params.get("longitude", ""),
            "distance": params.get("distance", "5"),
            "API_KEY": self.api_key,
        }
        resp = requests.get(self.base_url, params=query_params, timeout=self.timeout)
        resp.raise_for_status()
        raw = resp.json()
        records = raw if isinstance(raw, list) else [raw]
        return records, raw


register(AirNow)
