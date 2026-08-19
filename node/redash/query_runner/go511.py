"""
GO511 (Motorist Aid / api.go511.com) query runner.

Traffic incidents, roadwork, park-and-ride lots, cameras and
mainline route speeds for the LA region.

The API key must be entered when creating the data source; it is not
shipped as a default.
"""

import requests

from redash.query_runner import register
from redash.query_runner.connector_base import (
    REQUEST_HEADERS,
    BaseResourceRunner,
    build_configuration_schema,
    extract_records,
)
from redash.query_runner.connector_validation import require_configured

DEFAULT_BASE_URL = "https://api.go511.com/api"

ALERT_RETURNS = [
    "ID: string",
    "Description: string",
    "Location: string",
    "RoadwayName: string",
    "DirectionOfTravel: string",
    "Latitude: float",
    "Longitude: float",
    "Severity: string",
    "CountyName: string",
    "StartDate: datetime",
    "PlannedEndDate: datetime",
    "Reported: string",
    "LastUpdated: datetime",
    "LanesAffected: string",
]


class Go511(BaseResourceRunner):
    resources = {
        "incidents": {
            "doc_params": ["(no params: full region feed)"],
            "doc_returns": ALERT_RETURNS,
        },
        "roadwork": {
            "doc_params": ["(no params: full region feed)"],
            "doc_returns": ALERT_RETURNS,
        },
        "parkandridelots": {
            "doc_params": ["(no params: full region feed)"],
            "doc_returns": [
                "ID: integer",
                "Spaces: integer",
                "Latitude: float",
                "Longitude: float",
                "CityName: string",
                "CountyName: string",
                "CostDescription: string",
                "Location: string",
            ],
        },
        "cameras": {
            "doc_params": ["(no params: full region feed)"],
            "doc_returns": ["camera objects with location metadata"],
        },
        "mainlineroutes": {
            "doc_params": ["(no params: full region feed)"],
            "doc_returns": [
                "Links: string (JSON: route segments with Start/End lat/lon)",
                "SpeedMetersPerHour: float",
                "DirectionOfTravel: string",
            ],
        },
    }
    default_resource = "incidents"
    noop_query = '{"resource": "parkandridelots"}'

    @classmethod
    def name(cls):
        return "GO511 Traffic"

    @classmethod
    def type(cls):
        return "go511"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "base_url": {
                    "type": "string",
                    "title": "GO511 API Base URL",
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
        self.base_url = self.configuration.get("base_url", DEFAULT_BASE_URL).rstrip("/")
        self.api_key = self.configuration.get("api_key", "")

    def run_query(self, query, user):
        error = require_configured(self.type(), base_url=self.base_url, api_key=self.api_key)
        if error:
            return None, error

        return super().run_query(query, user)

    def _fetch(self, resource, params):
        query_params = dict(params)
        query_params.update({"version": "0.0", "format": "json", "key": self.api_key})
        resp = requests.get(
            f"{self.base_url}/{resource}",
            params=query_params,
            headers=REQUEST_HEADERS,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        raw = resp.json()
        return extract_records(raw), raw


register(Go511)
