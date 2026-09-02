from redash.query_runner.metrocloudalliance_departures import DEPARTURE_COLUMNS

TRANSIT_MODES = "rail, commuter rail, light rail, bus, express bus, rapid bus, local bus, transitway, ferry"


RESOURCES = {
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
    "servicealerts": {
        "path": "v2/realtime/servicealerts",
        "doc_params": [
            "status (optional): string - active (default), upcoming, or all. The vendor's all "
            "handler is broken as of 2026-08 (returns a MariaDB error page, not JSON); "
            "query active and upcoming separately instead",
            "carrier_code (optional): string - carrier code, as defined by the account's transit network",
            "carrier_id (optional): integer - carrier database id",
            'search_point (optional): string - "lat,lon"',
            "search_radius (optional): number - meters around search_point",
            "map_extent (optional): string - two lat/lng pairs marking the south/west and "
            "north/east corners of a rectangle",
        ],
        "doc_returns": [
            "alert/event fields as MCA reports them. The vendor documents no row shape and the "
            "account's network had no active alerts while this was written; run "
            '{"resource": "servicealerts"} and read the columns off the result',
        ],
        "example": '{"resource": "servicealerts", "params": {"status": "active"}}',
    },
    "sources": {
        "path": "v2/realtime/sources",
        "doc_params": [
            "status (optional): string - filter sources by status",
        ],
        "doc_returns": [
            "realtime_source_id: string",
            "realtime_source_priority: string - 1 is the preferred source for its carrier",
            "carrier_id: string",
            "carrier_code: string",
            "predictions: boolean - source currently delivers predictions",
            "prediction_source_type: string - e.g. Swiftly, MCA Realtime, GTFS-RT Compliant",
            "vehicle_locations: boolean - source currently delivers vehicle locations",
            "vehicle_locations_source_type: string",
            "description: string - e.g. 'CT -Swiftly GTFS-RT'",
        ],
        "example": '{"resource": "sources"}',
    },
    "reports": {
        "path": "v2/reports",
        "doc_params": [
            "type (required): string - which report to fetch; type=list_types lists every "
            "report the account can read",
            'start_datetime (optional): string - "2021/01/15 15:30"',
        ],
        "doc_returns": [
            "columns vary by report type - the vendor's Analytics-module processed data as-is. "
            "The shared demo key cannot read this resource (HTTP 405 requires authentication); "
            "it needs the account's own key",
        ],
        "example": '{"resource": "reports", "params": {"type": "list_types"}}',
    },
    "vehiclelocations": {
        "path": "v2/realtime/vehiclelocations",
        "doc_params": [
            "transit_mode (optional): string - rail|bus",
            "carrier_code (optional): string - carrier code, as defined by the account's transit network",
            "carrier_id (optional): integer - carrier database id",
            "realtime_source_id (optional): integer - limit to one federated realtime source; "
            "ids come from the sources resource",
            "query_type (optional): string - all, allactive, buswifiactive or buswifiall",
            "vehicles (optional): string - comma separated vehicle ids",
            "route_code (optional): string",
            "line_code (optional): string",
            "map_extent (optional): string - two lat/lng pairs marking the south/west and "
            "north/east corners of a rectangle",
            "number_of_results (optional): integer - unset or -1 returns all rows",
            'start_datetime (optional): string - "2021/01/15 15:30"',
            'end_datetime (optional): string - "2021/01/15 15:30"',
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
