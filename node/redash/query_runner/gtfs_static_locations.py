import json

from redash.query_runner import TYPE_STRING
from redash.query_runner.gtfs_static_tables import matches, open_table
from redash.query_runner.static_geojson import geometry_bbox

LOCATIONS_TABLE = "locations"
LOCATIONS_MEMBER = "locations.geojson"
LOCATION_COLUMNS = ["location_id", "stop_name", "stop_desc", "geometry_type", "geometry", "properties", "bbox"]
LIFTED_PROPERTIES = ("stop_name", "stop_desc")


def locations_member(archive):
    for info in archive.infolist():
        if info.is_dir():
            continue
        if info.filename.split("/")[-1].lower() == LOCATIONS_MEMBER:
            return info.filename
    return None


def read_features(archive, member, budget):
    with open_table(archive, member, budget) as text:
        try:
            document = json.load(text)
        except ValueError as exc:
            raise ValueError(f"{LOCATIONS_MEMBER} is not valid JSON: {exc}") from exc
    is_collection = isinstance(document, dict) and document.get("type") == "FeatureCollection"
    if not is_collection or not isinstance(document.get("features"), list):
        raise ValueError(f"{LOCATIONS_MEMBER} is not a GeoJSON FeatureCollection")
    return document["features"]


def select_features(features, filters, max_rows):
    selected = []
    truncated = False
    for feature in features:
        candidate = {"location_id": feature.get("id"), **(feature.get("properties") or {})}
        if filters and not matches(candidate, filters, list(candidate)):
            continue
        if len(selected) >= max_rows:
            truncated = True
            break
        selected.append(feature)
    return selected, truncated


def _text(value):
    return None if value is None else str(value)


def feature_record(feature):
    properties = feature.get("properties") or {}
    geometry = feature.get("geometry") or {}
    extra = {key: value for key, value in properties.items() if key not in LIFTED_PROPERTIES}
    return {
        "location_id": _text(feature.get("id")),
        "stop_name": _text(properties.get("stop_name")),
        "stop_desc": _text(properties.get("stop_desc")),
        "geometry_type": geometry.get("type"),
        "geometry": json.dumps(geometry),
        "properties": json.dumps(extra) if extra else "",
        "bbox": json.dumps(geometry_bbox(geometry)) if geometry else "",
    }


def _string_columns(names):
    return [{"name": name, "friendly_name": name, "type": TYPE_STRING} for name in names]


def location_rows(features, fields):
    records = [feature_record(feature) for feature in features]
    return _string_columns(fields), [{field: record[field] for field in fields} for record in records]


def feature_collection_result(features):
    collection = {"type": "FeatureCollection", "features": features}
    return _string_columns(["geojson"]), [{"geojson": json.dumps(collection)}]
