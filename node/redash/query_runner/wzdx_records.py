import json

from redash.query_runner.static_geojson import geometry_bbox

CORE_DETAIL_FIELDS = (
    "event_type",
    "data_source_id",
    "road_names",
    "direction",
    "name",
    "description",
    "creation_date",
    "update_date",
    "related_road_events",
)
ROAD_EVENT_FIELDS = (
    "start_date",
    "end_date",
    "is_start_date_verified",
    "is_end_date_verified",
    "is_start_position_verified",
    "is_end_position_verified",
    "vehicle_impact",
    "work_zone_type",
    "location_method",
    "beginning_cross_street",
    "ending_cross_street",
    "beginning_milepost",
    "ending_milepost",
    "reduced_speed_limit_kph",
    "types_of_work",
    "restrictions",
)
DEVICE_CORE_FIELDS = (
    "device_type",
    "device_status",
    "data_source_id",
    "road_names",
    "road_direction",
    "name",
    "description",
    "update_date",
    "has_automatic_location",
    "is_moving",
    "road_event_ids",
    "milepost",
    "status_messages",
)
LANE_FIELDS = ("order", "type", "status", "restrictions")
LEGACY_FEED_INFO_KEY = "road_event_feed_info"


def feed_document_error(document):
    if not isinstance(document, dict):
        return "the feed is not a JSON object"
    if LEGACY_FEED_INFO_KEY in document and "feed_info" not in document:
        return "the feed is WZDx 3.x (root road_event_feed_info); this connector reads WZDx 4.x feeds"
    if not isinstance(document.get("feed_info"), dict):
        return "the feed has no feed_info object, so it is not a WZDx 4.x feed"
    if document.get("type") != "FeatureCollection" or not isinstance(document.get("features"), list):
        return "the feed is not a GeoJSON FeatureCollection"
    return None


def feed_info_row(feed_info):
    row = {key: value for key, value in feed_info.items() if key != "data_sources"}
    row["data_source_count"] = len(feed_info.get("data_sources") or [])
    return row


def data_source_rows(feed_info):
    return list(feed_info.get("data_sources") or [])


def _geometry_columns(feature):
    geometry = feature.get("geometry") or {}
    return {
        "geometry_type": geometry.get("type"),
        "geometry": json.dumps(geometry),
        "bbox": json.dumps(geometry_bbox(geometry)) if geometry else "",
    }


def _remaining(properties, core_details, lifted_core, lifted_own):
    extra = {key: value for key, value in core_details.items() if key not in lifted_core}
    extra.update({key: value for key, value in properties.items() if key not in lifted_own and key != "core_details"})
    return json.dumps(extra) if extra else ""


def road_event_record(feature):
    properties = feature.get("properties") or {}
    core = properties.get("core_details") or {}
    worker_presence = properties.get("worker_presence") or {}
    record = {"id": feature.get("id")}
    record.update({field: core.get(field) for field in CORE_DETAIL_FIELDS})
    record.update({field: properties.get(field) for field in ROAD_EVENT_FIELDS})
    record["workers_present"] = worker_presence.get("are_workers_present")
    record["lane_count"] = len(properties.get("lanes") or [])
    record.update(_geometry_columns(feature))
    record["properties"] = _remaining(properties, core, CORE_DETAIL_FIELDS, ROAD_EVENT_FIELDS)
    return record


def lane_records(feature):
    properties = feature.get("properties") or {}
    return [
        {"road_event_id": feature.get("id"), **{field: lane.get(field) for field in LANE_FIELDS}}
        for lane in properties.get("lanes") or []
    ]


def device_record(feature):
    properties = feature.get("properties") or {}
    core = properties.get("core_details") or {}
    record = {"id": feature.get("id")}
    record.update({field: core.get(field) for field in DEVICE_CORE_FIELDS})
    record.update(_geometry_columns(feature))
    record["properties"] = _remaining(properties, core, DEVICE_CORE_FIELDS, ())
    return record


def _text(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def record_matches(record, filters):
    for field, wanted in filters.items():
        if field not in record:
            return False
        accepted = {_text(value) for value in (wanted if isinstance(wanted, list) else [wanted])}
        held = record[field]
        values = held if isinstance(held, list) else [held]
        if not any(_text(value) in accepted for value in values):
            return False
    return True


def select_records(records, filters, max_rows):
    selected = []
    for record in records:
        if filters and not record_matches(record, filters):
            continue
        if len(selected) >= max_rows:
            return selected, True
        selected.append(record)
    return selected, False


def select_features(features, to_record, filters, max_rows):
    selected = []
    for feature in features:
        record = to_record(feature)
        if filters and not record_matches(record, filters):
            continue
        if len(selected) >= max_rows:
            return selected, True
        selected.append((feature, record))
    return selected, False


def feature_collection_cell(features):
    return [{"geojson": json.dumps({"type": "FeatureCollection", "features": features})}]
