"""
MetroCloudAlliance (MCA) query runner.

Real-time transit predictions, scheduled stop times, stop/network search,
carriers, lines/routes and vehicle locations for whatever transit network the
account is provisioned against.

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
from redash.query_runner.connector_validation import require_configured, require_params
from redash.query_runner.metrocloudalliance_departures import (
    DEPARTURE_COLUMNS,
    flatten_departures,
)

DEFAULT_BASE_URL = "https://api.metrocloudalliance.com/"

# MCA's own transit_mode vocabulary for the lines/routes/patterns resources,
# quoted from the vendor's OpenAPI description. The realtime resources (stops,
# predictions, vehiclelocations) only ever report "bus" or "rail" - use these
# finer values here to split light rail from commuter rail from heavy rail.
TRANSIT_MODES = "rail, commuter rail, light rail, bus, express bus, rapid bus, local bus, transitway, ferry"


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
                "carrier_id: integer",
                "stop_id: string",
                "stop_name: string",
                "uuid: string",
                "lat: float",
                "lng: float",
                "dist: integer (meters from search_point; only with search_point)",
                "prediction_available: boolean",
                "routes: string (JSON, routes with predictions.times_minutes and predictions.routes[].iline "
                "- feed iline into the stoptimes resource for the full schedule)",
            ],
            "example": '{"resource": "predictions", "params": {"search_point": "<lat>,<lon>", "search_radius": 500, "carrier_code": "<code>"}}',
        },
        "departures": {
            # The predictions endpoint, reshaped: one row per departure rather
            # than one per stop with the timetable folded into a JSON cell.
            # What a departure board or a schedules table reads. Dropped once
            # already by a branch rewrite of this file (80efb184) while its
            # module and tests survived; if it is ever removed on purpose,
            # remove metrocloudalliance_departures.py and its tests with it.
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
        "stoptimes": {
            "path": "v2/tripplanner/stoptimes",
            "doc_params": [
                "iline (required): integer - line identifier; read one off a stop's predictions "
                "resource, at routes[].iline",
                "location_idx (optional): integer - stop position along the line, default 0",
                "line_distance (optional): number - feet",
                "line_name (optional): string",
                "route_name (optional): string",
                "date (optional): string",
                "time (optional): string",
                "number_of_results (optional): integer - caps entries in the returned list",
            ],
            "doc_returns": [
                "location_idx: integer",
                "on_time: string, off_time: string - board/alight time at this stop",
                "headsign: string",
                "start_location_name, end_location_name: string",
                "start_location_lat, start_location_lng, end_location_lat, end_location_lng: float",
                "list: string (JSON array of scheduled trips - short_name, board, alight, leaving, "
                "arriving, hdsgn, day, route, duration)",
            ],
            "example": '{"resource": "stoptimes", "params": {"iline": "<iline>"}}',
        },
        "stops": {
            "path": "v2/transitnetwork/stops",
            "doc_params": [
                "stop_id (optional): string",
                'search_point (optional): string - "lat,lon"',
                "search_radius (optional): number - meters",
                "carrier_code (optional): string",
                "leaving all of the above unset returns every stop on the account's network "
                "(tens of thousands of rows) - scope with carrier_code and/or search_point",
            ],
            "doc_returns": [
                "stop_id: string",
                "stop_name: string",
                "uuid: string",
                "carrier_code: string",
                "lat: float",
                "lng: float",
                "transit_modes: string (BUS or RAIL; MCA does not distinguish light rail from heavy rail "
                "here - use the lines/routes resource's transit_mode filter for that)",
                "lines_served: string (JSON; populated only when search_point is used, not on a "
                "carrier_code-only call)",
                "address, city, state, zip: string",
                "dist: integer (meters from search_point; only with search_point)",
            ],
        },
        "carriers": {
            "path": "v2/transitnetwork/carriers",
            "doc_params": ["carrier_code (optional): string - filter to one carrier"],
            "doc_returns": [
                "carrier_code: string",
                "carrier_id: integer",
                "carrier_name: string",
                "carrier_url: string",
                "carrier_contact: string",
                "stops_available: boolean",
                "realtime_vehicle_locations_available: boolean",
                "realtime_predictions_available: boolean",
            ],
        },
        "lines": {
            "path": "v2/transitnetwork/lines",
            "doc_params": [
                "carrier_code (optional): string",
                "carrier_id (optional): integer",
                "line_id (optional): string",
                "line_code (optional): string",
                f"transit_mode (optional): string - one of: {TRANSIT_MODES}",
            ],
            "doc_returns": [
                "carrier_name: string",
                "carrier_code: string",
                "carrier_id: integer",
                "line_id: integer",
                "line_name: string",
                "line_code: string",
                "line_color: string",
            ],
            "example": '{"resource": "lines", "params": {"carrier_code": "<code>", "transit_mode": "light rail"}}',
        },
        "routes": {
            "path": "v2/transitnetwork/routes",
            "doc_params": [
                "carrier_code (optional): string",
                "carrier_id (optional): integer",
                "line_id (optional): string",
                "line_code (optional): string",
                "route_id (optional): string",
                "route_code (optional): string",
                f"transit_mode (optional): string - one of: {TRANSIT_MODES}",
                "include_geometry (optional): boolean - include route geometry and simple stop info",
            ],
            "doc_returns": [
                "carrier_name: string",
                "carrier_code: string",
                "carrier_id: integer",
                "line_id: integer",
                "line_name: string",
                "line_code: string",
                "line_color: string",
                "route_id: integer",
                "route_name: string",
                "route_code: string",
            ],
            "example": '{"resource": "routes", "params": {"carrier_code": "<code>", "transit_mode": "commuter rail"}}',
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

    # Resources whose vendor endpoint 400s on a missing param rather than
    # treating it as unset - checked in _fetch before the request goes out,
    # so a missing one fails as "this field is required" instead of a vendor
    # "Bad Parameter" response.
    required_resource_params = {
        "stoptimes": ("iline",),
    }

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
        required = self.required_resource_params.get(resource)
        if required:
            error = require_params(self.type(), params, *required)
            if error:
                raise ValueError(error)

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
