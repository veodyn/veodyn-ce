from redash.transit_naming.departures import PUBLIC_DEPARTURE_COLUMNS

PUBLIC_RESOURCES = {
    "public_routes": {
        "path": "v2/transitnetwork/routes",
        "doc_params": ["carrier_code (required): string", "route_code (optional): string - one route"],
        "doc_returns": [
            "carrier_code, carrier_id, carrier_name, route_code, route_id, line_code, line_id: from MCA routes",
            "route_number, brand, public_name, short_name, long_name, mode, color, text_color, gtfs_route_id",
            "public_name_source, brand_source, color_source: gtfs | alias | mca_side_channel | rule | override | passthrough",
            "normalization_revision, gtfs_digest: lineage",
        ],
        "example": '{"resource": "public_routes", "params": {"carrier_code": "MT"}}',
    },
    "public_stops": {
        "path": "v2/transitnetwork/stops",
        "doc_params": [
            "carrier_code (optional): string - omit for every carrier on the account's network "
            "(tens of thousands of rows), each named under its own carrier's profile",
            "stop_id (optional): string",
        ],
        "doc_returns": [
            "carrier_code, stop_id, uuid, 511_id, public_name, raw_name, on_street, cross_street, direction, relation_to_cross_street",
            "stop_kind: intersection | station | named_place | unparsed",
            "mode: bus | rail | empty; retired: boolean (empty transit_modes and no predictions)",
            "lat, lng, city, accessible, public_name_source, normalization_revision, gtfs_digest",
            "original_public_name: the name before suffix completion; suffix_completion: street_reference | same_intersection | unique_street | empty",
        ],
        "example": '{"resource": "public_stops", "params": {"carrier_code": "MT"}}',
    },
    "public_route_stops": {
        "path": "v2/transitnetwork/routes",
        "doc_params": [
            "carrier_code (required): string",
            "route_code (optional): string - one route; default every route of the carrier",
            "canonical_only (optional): boolean - rows of canonical patterns only",
        ],
        "doc_returns": [
            "carrier_code, route_code, direction, pattern_id, is_canonical, sequence, stop_id, gtfs_stop_id, public_name",
            "stop_match: id | coordinate | unmatched; sequence_source: gtfs_stop_times | mca_pattern (sequence null)",
            "normalization_revision, gtfs_digest",
            "direction_id: integer, GTFS's; lat, lng: float from stops.txt by gtfs_stop_id, null when unmatched",
        ],
        "example": '{"resource": "public_route_stops", "params": {"carrier_code": "MT", "route_code": "MT030"}}',
    },
    "public_route_paths": {
        "path": "v2/transitnetwork/routes",
        "doc_params": ["carrier_code (required): string"],
        "doc_returns": [
            "carrier_code, route_code, pattern_id, is_canonical: as on public_route_stops",
            "direction_id: integer, GTFS's; direction: the profile's letter",
            "headsign: most common trip headsign of the pattern, else empty",
            "shape_id: most common shape of the pattern's trips, null when none",
            "trip_count, point_count: integer (points in the simplified geometry)",
            "geometry: GeoJSON LineString string, [lon, lat], null when the shape is missing or has under 2 points",
            "gtfs_digest",
        ],
        "example": '{"resource": "public_route_paths", "params": {"carrier_code": "MT"}}',
    },
    "public_trip_routes": {
        "path": "v2/transitnetwork/routes",
        "doc_params": ["carrier_code (required): string"],
        "doc_returns": [
            "carrier_code: string",
            "trip_id: string, every trip in the carrier's GTFS archives that resolves to one route code",
            "route_code: string, resolved as on public_route_paths, plus the profile's extra_trip_routes",
            "direction_id: integer, GTFS's, null when the trip has none",
            "gtfs_digest",
        ],
        "example": '{"resource": "public_trip_routes", "params": {"carrier_code": "MT"}}',
    },
    "public_departures": {
        "path": "v2/realtime/predictions",
        "doc_params": [
            "carrier_code (required unless stop is given): string",
            "stop_id (optional): string",
            'stop (optional): string - "<carrier_code>:<stop_id>", one value for a stop picker',
            'search_point (optional): string - "lat,lon"',
            "search_radius (optional): number - meters",
            "number_of_results (optional): integer",
        ],
        "doc_returns": PUBLIC_DEPARTURE_COLUMNS,
        "example": '{"resource": "public_departures", "params": {"carrier_code": "MT", "stop_id": "1166"}}',
    },
    "public_stop_locations": {
        "path": "v2/transitnetwork/stops",
        "doc_params": [
            "stop_511_id (optional): string - one 511 stop id; default every location on the account's network",
        ],
        "doc_returns": [
            "511_id, public_name, public_name_source: consensus | tiebreak | override",
            "chosen_carrier, chosen_stop_id, agreeing_stops, source_stops, carriers",
            "source_stop_ids: '<carrier> <stop_id>, ...'; names: every distinct public name, '; ' separated",
            "stop_kind, retired_stops, lat, lng (mean of the active members), normalization_revision",
        ],
        "example": '{"resource": "public_stop_locations", "params": {"stop_511_id": "1000997"}}',
    },
    "naming_profiles": {
        "path": "",
        "doc_params": ["none - reads the loaded profile set"],
        "doc_returns": ["carrier_code, source_file, is_default, gtfs_sources, overrides, revision"],
        "example": '{"resource": "naming_profiles"}',
    },
}
