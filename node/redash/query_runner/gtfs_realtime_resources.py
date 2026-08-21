"""Schema-browser metadata for the GTFS-Realtime resources: params, returns and examples."""

DEFAULT_SAMPLE_SECONDS = 8
MAX_SAMPLE_SECONDS = 30
DEFAULT_EARLY_SECONDS = 60
DEFAULT_LATE_SECONDS = 300

RESOURCES = {
    "vehicle_positions": {
        "doc_params": [
            "routes (optional): string - comma separated route ids to subscribe to, "
            "substituted into {routes} in the feed URL",
            "sample_seconds (optional): number - websocket feeds only, how long to sample before "
            f"returning (default {DEFAULT_SAMPLE_SECONDS}, capped at {MAX_SAMPLE_SECONDS}); "
            "HTTP protobuf feeds are a single snapshot and ignore this",
        ],
        "doc_returns": [
            "vehicle_id: string",
            "route_id: string",
            "line: string",
            "latitude: float",
            "longitude: float",
            "bearing: float",
            "speed: float",
            "direction_id: integer",
            "timestamp: string (UTC, from the vehicle feed)",
        ],
        "example": '{"resource": "vehicle_positions", "params": {"routes": "1,2"}}',
    },
    "trip_updates": {
        "doc_params": [
            "routes (optional): string - comma separated route ids, substituted into {routes} "
            "in the Trip updates URL",
            f"early_seconds (optional): number >= 0 - on-time window, negative delay side (default {DEFAULT_EARLY_SECONDS})",
            f"late_seconds (optional): number >= 0 - on-time window, positive delay side (default {DEFAULT_LATE_SECONDS})",
        ],
        "doc_returns": [
            "trip_id: string",
            "route_id: string",
            "line: string",
            "direction_id: integer, or null when unset",
            "vehicle_id: string",
            "stop_id: string",
            "stop_sequence: integer, or null when unset",
            "arrival_delay: integer seconds, or null when not reported",
            "departure_delay: integer seconds, or null when not reported",
            "arrival_time: string (UTC), or null when not reported",
            "departure_time: string (UTC), or null when not reported",
            "trip_schedule_relationship: string (enum name, e.g. SCHEDULED, CANCELED)",
            "stop_schedule_relationship: string (enum name, e.g. SCHEDULED, SKIPPED, NO_DATA, UNSCHEDULED)",
            "timestamp: string (UTC, from the trip update), or null when unset",
            "on_time: boolean, or null when neither delay is reported, when stop_schedule_relationship is "
            "not SCHEDULED, or when trip_schedule_relationship is CANCELED",
        ],
        "example": (
            '{"resource": "trip_updates", "params": {"routes": "1,2", "early_seconds": 60, "late_seconds": 300}}'
        ),
    },
    "service_alerts": {
        "doc_params": [
            "routes (optional): string - comma separated route ids, substituted into {routes} "
            "in the Service alerts URL",
        ],
        "doc_returns": [
            "alert_id: string",
            "cause: string (enum name, e.g. UNKNOWN_CAUSE, ACCIDENT)",
            "effect: string (enum name, e.g. UNKNOWN_EFFECT, DETOUR)",
            "severity_level: string (enum name, or null when unset)",
            "header: string",
            "description: string",
            "url: string",
            "active_from: string (UTC, earliest active period start, or null)",
            "active_to: string (UTC, latest active period end, or null if any period is open-ended)",
            "informed_route_ids: string (comma joined, sorted, unique)",
            "informed_stop_ids: string (comma joined, sorted, unique)",
        ],
        "example": '{"resource": "service_alerts"}',
    },
}
