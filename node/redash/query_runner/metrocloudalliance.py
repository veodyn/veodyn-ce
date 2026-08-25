"""
MetroCloudAlliance (MCA) query runner.

Real-time transit predictions, stop/network search, carriers and vehicle
locations for whatever transit network the account is provisioned against.

The API key must be entered when creating the data source; it is not
shipped as a default.
"""

import time

import requests

from redash.query_runner import register
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
    extract_records,
)
from redash.query_runner.connector_validation import require_configured
from redash.query_runner.metrocloudalliance_departures import (
    DEPARTURE_COLUMNS,
    flatten_departures,
)

DEFAULT_BASE_URL = "https://api.metrocloudalliance.com/"


class MetroCloudAlliance(BaseResourceRunner):
    resources = {
        "predictions": {
            "path": "v2/realtime/predictions",
            "doc_params": [
                "stop_id (optional): string - predictions for one stop",
                'search_point (optional): string - "lat,lon"',
                "search_radius (optional): number - meters around search_point",
                "carrier_code (optional): string - carrier code, as defined by the account's transit network",
                "number_of_results (optional): integer - default 100 with search_point",
            ],
            "doc_returns": [
                "carrier_code: string",
                "carrier_id: string",
                "stop_id: string",
                "stop_name: string",
                "lat: float",
                "lng: float",
                "transit_modes: string (JSON)",
                "routes: string (JSON, routes with predictions.times_minutes)",
            ],
            "example": '{"resource": "predictions", "params": {"search_point": "<lat>,<lon>", "search_radius": 500, "carrier_code": "<code>"}}',
        },
        "departures": {
            # The predictions endpoint, reshaped: one row per departure rather
            # than one per stop with the timetable folded into a JSON cell.
            # What a departure board or a schedules table reads.
            "path": "v2/realtime/predictions",
            "doc_params": [
                "stop_id (optional): string - departures from one stop",
                'search_point (optional): string - "lat,lon"',
                "search_radius (optional): number - meters around search_point",
                "carrier_code (optional): string - carrier code, as defined by the account's transit network",
                "number_of_results (optional): integer - stops, default 100 with search_point",
            ],
            "doc_returns": DEPARTURE_COLUMNS,
            "example": '{"resource": "departures", "params": {"stop_id": "<stop>", "carrier_code": "<code>"}}',
        },
        "stops": {
            "path": "v2/transitnetwork/stops",
            "doc_params": [
                "stop_id (optional): string",
                'search_point (optional): string - "lat,lon"',
                "search_radius (optional): number - meters",
                "carrier_code (optional): string",
            ],
            "doc_returns": ["stop objects with id, name, lat, lng, carrier and transit modes"],
        },
        "carriers": {
            "path": "v2/transitnetwork/carriers",
            "doc_params": ["carrier_code (optional): string - filter to one carrier"],
            "doc_returns": ["carrier objects with carrier_code, carrier_id, name"],
        },
        "vehiclelocations": {
            "path": "v2/realtime/vehiclelocations",
            "doc_params": [
                "transit_mode (optional): string - rail|bus",
                "carrier_code (optional): string - carrier code, as defined by the account's transit network",
            ],
            "doc_returns": [
                "vehicle_id: string",
                "lat: float",
                "lng: float",
                "heading: float",
                "route: string",
                "source: string (whatever sources the center federates)",
                "last_update: datetime",
            ],
            "example": '{"resource": "vehiclelocations", "params": {"transit_mode": "rail", "carrier_code": "<code>"}}',
        },
    }
    default_resource = "carriers"
    noop_query = '{"resource": "carriers"}'

    @classmethod
    def name(cls):
        return "MetroCloudAlliance Transit"

    @classmethod
    def type(cls):
        return "metrocloudalliance"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "base_url": {
                    "type": "string",
                    "title": "MCA API Base URL",
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
        self.base_url = self.configuration.get("base_url", DEFAULT_BASE_URL).rstrip("/") + "/"
        self.api_key = self.configuration.get("api_key", "")

    def run_query(self, query, user):
        # self.base_url always ends in "/" (see __init__), so an empty
        # persisted value would not read as missing; check the raw
        # configuration value instead.
        error = require_configured(
            self.type(),
            base_url=self.configuration.get("base_url", DEFAULT_BASE_URL),
            api_key=self.api_key,
        )
        if error:
            return None, error

        return super().run_query(query, user)

    def _fetch(self, resource, params):
        query_params = dict(params)
        query_params["api_key"] = self.api_key
        resp = requests.get(
            f"{self.base_url}{self.resources[resource]['path']}",
            params=query_params,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        raw = resp.json()

        if isinstance(raw, dict) and raw.get("status") not in (None, "ok"):
            detail = raw.get("request_parameters") or raw.get("resource_path") or ""
            raise Exception(f"MCA returned status {raw.get('status')!r} {detail}")

        records = extract_records(raw, ["results"])
        if resource == "departures":
            records = flatten_departures(records, now=time.time())
        return records, raw


register(MetroCloudAlliance)
