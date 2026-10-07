"""
Waze for Cities query runner.

Crowd-sourced traffic alerts, jams and irregularities from a Waze partner
feed, the JSON flavor (format=1) of the Partner Hub feed URL.

The feed URL already embeds the partner id, feed id, format and coverage:
it is requested as-is, never re-encoded. Waze issues a distinct feed URL per
partner, so there is no shared default; it must be entered when creating the
data source.
"""

import json

import requests

from redash.query_runner import TYPE_FLOAT, TYPE_INTEGER, TYPE_STRING, register
from redash.query_runner.connector_base import (
    REQUEST_HEADERS,
    BaseResourceRunner,
    build_configuration_schema,
    extract_records,
)
from redash.query_runner.connector_tables import to_fixed_table

FILTER_PARAMS_DOC = [
    "type (optional): string, e.g. ACCIDENT, ROAD_CLOSED, WEATHERHAZARD, JAM",
    "min_reliability (optional): integer, keep items with reliability greater than N",
]

ALERT_COLUMN_TYPES = {
    "uuid": TYPE_STRING,
    "type": TYPE_STRING,
    "subtype": TYPE_STRING,
    "pubMillis": TYPE_INTEGER,
    "fromNodeId": TYPE_INTEGER,
    "toNodeId": TYPE_INTEGER,
    "reportByMunicipalityUser": TYPE_STRING,
    "reportRating": TYPE_INTEGER,
    "confidence": TYPE_INTEGER,
    "reliability": TYPE_INTEGER,
    "location": TYPE_STRING,
    "street": TYPE_STRING,
    "city": TYPE_STRING,
    "country": TYPE_STRING,
    "roadType": TYPE_INTEGER,
    "reportDescription": TYPE_STRING,
    "nThumbsUp": TYPE_INTEGER,
    "magvar": TYPE_INTEGER,
}

JAM_COLUMN_TYPES = {
    "id": TYPE_INTEGER,
    "uuid": TYPE_INTEGER,
    "pubMillis": TYPE_INTEGER,
    "street": TYPE_STRING,
    "city": TYPE_STRING,
    "country": TYPE_STRING,
    "roadType": TYPE_INTEGER,
    "startNode": TYPE_STRING,
    "endNode": TYPE_STRING,
    "speed": TYPE_FLOAT,
    "speedKMH": TYPE_FLOAT,
    "length": TYPE_INTEGER,
    "delay": TYPE_INTEGER,
    "level": TYPE_INTEGER,
    "turnType": TYPE_STRING,
    "blockingAlertUuid": TYPE_STRING,
    "line": TYPE_STRING,
    "geometry": TYPE_STRING,
    "segments": TYPE_STRING,
}

IRREGULARITY_COLUMN_TYPES = {
    "id": TYPE_INTEGER,
    "detectionDate": TYPE_STRING,
    "detectionDateMillis": TYPE_STRING,
    "updateDate": TYPE_STRING,
    "updateDateMillis": TYPE_STRING,
    "line": TYPE_STRING,
    "geometry": TYPE_STRING,
    "speed": TYPE_FLOAT,
    "regularSpeed": TYPE_FLOAT,
    "delaySeconds": TYPE_INTEGER,
    "seconds": TYPE_INTEGER,
    "length": TYPE_INTEGER,
    "trend": TYPE_INTEGER,
    "endNode": TYPE_STRING,
    "street": TYPE_STRING,
    "city": TYPE_STRING,
    "country": TYPE_STRING,
    "severity": TYPE_INTEGER,
    "jamLevel": TYPE_INTEGER,
    "driversCount": TYPE_INTEGER,
    "alertCount": TYPE_INTEGER,
    "alerts": TYPE_STRING,
    "nComments": TYPE_INTEGER,
    "nImages": TYPE_INTEGER,
    "nThumbsUp": TYPE_INTEGER,
    "highway": TYPE_STRING,
    "type": TYPE_STRING,
    "causeType": TYPE_STRING,
    "causeAlert": TYPE_STRING,
}

LINE_RESOURCES = ("jams", "irregularities")

FILTERS = {
    "type": lambda record, wanted: record.get("type") == wanted,
    "min_reliability": lambda record, wanted: (record.get("reliability") or 0) > int(wanted),
    "min_level": lambda record, wanted: (record.get("level") or 0) >= int(wanted),
}

RESOURCE_FILTERS = {
    "alerts": ("type", "min_reliability"),
    "jams": ("min_level",),
    "irregularities": ("type",),
}

RESOURCE_COLUMN_TYPES = {
    "alerts": ALERT_COLUMN_TYPES,
    "jams": JAM_COLUMN_TYPES,
    "irregularities": IRREGULARITY_COLUMN_TYPES,
}


def is_coordinate(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_point(point):
    return isinstance(point, dict) and is_coordinate(point.get("x")) and is_coordinate(point.get("y"))


def line_geometry(line):
    if not isinstance(line, list):
        return None
    coordinates = [[point["x"], point["y"]] for point in line if is_point(point)]
    if len(coordinates) < 2:
        return None
    return json.dumps({"type": "LineString", "coordinates": coordinates})


class Waze(BaseResourceRunner):
    resources = {
        "alerts": {
            "doc_params": FILTER_PARAMS_DOC,
            "doc_returns": [
                "type: string (ACCIDENT, ROAD_CLOSED, WEATHERHAZARD, JAM, HAZARD, ...)",
                "subtype: string",
                "reliability: integer",
                "street: string",
                "city: string",
                "reportDescription: string",
                "location: string (JSON, {x: lon, y: lat})",
                "pubMillis: integer (epoch millis)",
            ],
            "example": '{"resource": "alerts", "params": {"type": "ACCIDENT", "min_reliability": 5}}',
        },
        "jams": {
            "doc_params": [
                "min_level (optional): integer, keep jams with level of at least N (0 free flow, 5 blocked)"
            ],
            "doc_returns": [
                "street: string",
                "city: string",
                "level: integer (0-5)",
                "speedKMH: float",
                "delay: integer (seconds, -1 when blocked)",
                "length: integer (meters)",
                "line: string (JSON, polyline points)",
                "geometry: string (GeoJSON LineString of line)",
                "pubMillis: integer (epoch millis)",
            ],
            "example": '{"resource": "jams", "params": {"min_level": 3}}',
        },
        "irregularities": {
            "doc_params": ["type (optional): string, e.g. SMALL, MEDIUM, LARGE, HUGE"],
            "doc_returns": [
                "type: string",
                "street: string",
                "city: string",
                "speed: float (km/h)",
                "regularSpeed: float (km/h)",
                "delaySeconds: integer",
                "line: string (JSON, polyline points)",
                "geometry: string (GeoJSON LineString of line)",
            ],
        },
    }
    default_resource = "alerts"
    noop_query = '{"resource": "alerts"}'

    @classmethod
    def name(cls):
        return "Waze Traffic Alerts"

    @classmethod
    def type(cls):
        return "waze"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "feed_url": {
                    "type": "string",
                    "title": "Waze Feed URL (JSON, format=1)",
                    "description": "Waze issues this URL per partner; there is no shared default.",
                },
            },
            required=["feed_url"],
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        self.feed_url = self.configuration.get("feed_url", "")

    def _fetch(self, resource, params):
        # The URL already carries its own query string, request verbatim.
        resp = requests.get(self.feed_url, headers=REQUEST_HEADERS, timeout=self.timeout)
        resp.raise_for_status()
        try:
            raw = resp.json()
        except ValueError:
            raise ValueError("the feed did not return JSON; use the format=1 feed URL (format=2 is GeoRSS XML)")
        records = extract_records(raw, [resource])

        for name in RESOURCE_FILTERS[resource]:
            wanted = params.get(name)
            if wanted not in (None, ""):
                records = [record for record in records if FILTERS[name](record, wanted)]

        if resource in LINE_RESOURCES:
            records = [dict(record, geometry=line_geometry(record.get("line"))) for record in records]

        return records, raw

    def _table(self, resource, records):
        column_types = RESOURCE_COLUMN_TYPES[resource]
        return to_fixed_table(list(column_types), column_types, records)


register(Waze)
