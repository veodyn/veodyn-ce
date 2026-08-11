"""
OpenWeatherMap query runner.

Current weather conditions by latitude/longitude. The familiar
temp/pressure/humidity/conditions columns are lifted to the top level, with
the full nested payload preserved as JSON.

The App ID (API key) must be entered when creating the data source; it is
not shipped as a default. Latitude and longitude are per-query params with
no built-in location, since a default would bake one region into every
install.
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

DEFAULT_BASE_URL = "https://api.openweathermap.org/data/2.5/weather"

# Null Island: a syntactically valid, real-nowhere coordinate. OpenWeatherMap
# returns real (if uninteresting) data there, so test_connection exercises
# the request wiring without a customer's actual location baked into the
# connector.
NOOP_LAT = "0.0"
NOOP_LON = "0.0"


class OpenWeatherMap(BaseResourceRunner):
    resources = {
        "current": {
            "doc_params": [
                "lat (required): float, decimal degrees",
                "lon (required): float, decimal degrees",
                "units (optional): string - imperial|metric (default imperial)",
                "lang (optional): string - language code (default en)",
            ],
            "doc_returns": [
                "temp: float",
                "pressure: float",
                "humidity: float",
                "main: string (e.g. Clear, Clouds)",
                "description: string",
                "icon: string (icon code)",
                "dt: datetime (observation unix time)",
                "units: string",
                "name: string (place name)",
                "weather / wind / coord / sys: string (JSON)",
            ],
            "example": '{"resource": "current", "params": {"lat": "0.0", "lon": "0.0", "units": "metric"}}',
        },
    }
    default_resource = "current"
    noop_query = json.dumps({"resource": "current", "params": {"lat": NOOP_LAT, "lon": NOOP_LON}})

    @classmethod
    def name(cls):
        return "OpenWeatherMap"

    @classmethod
    def type(cls):
        return "openweathermap"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "base_url": {
                    "type": "string",
                    "title": "OpenWeatherMap API URL",
                    "default": DEFAULT_BASE_URL,
                },
                "app_id": {
                    "type": "string",
                    "title": "App ID (API Key)",
                },
            },
            required=["base_url", "app_id"],
            secret=["app_id"],
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        self.base_url = self.configuration.get("base_url", DEFAULT_BASE_URL)
        self.app_id = self.configuration.get("app_id", "")

    def run_query(self, query, user):
        error = require_configured(self.type(), base_url=self.base_url, app_id=self.app_id)
        if error:
            return None, error

        _config, params, error = parse_object_query(query)
        if error:
            return None, error
        error = require_params(self.type(), params, "lat", "lon")
        if error:
            return None, error

        return super().run_query(query, user)

    def _fetch(self, resource, params):
        units = params.get("units", "imperial")
        query_params = {
            "lat": params.get("lat", ""),
            "lon": params.get("lon", ""),
            "units": units,
            "lang": params.get("lang", "en"),
            "appId": self.app_id,
        }
        resp = requests.get(self.base_url, params=query_params, timeout=self.timeout)
        resp.raise_for_status()
        raw = resp.json()

        main = raw.get("main") or {}
        weather = (raw.get("weather") or [{}])[0]
        record = {
            "temp": main.get("temp"),
            "pressure": main.get("pressure"),
            "humidity": main.get("humidity"),
            "main": weather.get("main"),
            "description": weather.get("description"),
            "icon": weather.get("icon"),
            "dt": raw.get("dt"),
            "units": units,
            "name": raw.get("name"),
        }
        for key, value in raw.items():
            record.setdefault(key, value)
        return [record], raw


register(OpenWeatherMap)
