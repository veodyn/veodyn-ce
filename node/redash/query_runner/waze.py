"""
Waze CCP query runner.

Crowd-sourced traffic alerts and irregularities from a Waze Connected
Citizens Program GeoRSS feed.

The feed URL already embeds the partner token, format and coverage polygon:
it is requested as-is, never re-encoded. Waze issues a distinct feed URL per
partner, so there is no shared default; it must be entered when creating the
data source.
"""

import requests

from redash.query_runner import register
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
    extract_records,
)

FILTER_PARAMS_DOC = [
    "type (optional): string, e.g. ACCIDENT, ROAD_CLOSED, WEATHERHAZARD, JAM",
    "min_reliability (optional): integer, keep items with reliability greater than N",
]


class Waze(BaseResourceRunner):
    resources = {
        "alerts": {
            "doc_params": FILTER_PARAMS_DOC,
            "doc_returns": [
                "type: string (ACCIDENT, ROAD_CLOSED, WEATHERHAZARD, JAM, ...)",
                "subtype: string",
                "reliability: integer",
                "street: string",
                "city: string",
                "location: string (JSON, {x: lon, y: lat})",
                "pubMillis: integer (epoch millis)",
            ],
            "example": '{"resource": "alerts", "params": {"type": "ACCIDENT", "min_reliability": 5}}',
        },
        "irregularities": {
            "doc_params": FILTER_PARAMS_DOC,
            "doc_returns": [
                "type: string",
                "street: string",
                "city: string",
                "speed: float",
                "regularSpeed: float",
                "delaySeconds: integer",
                "line: string (JSON, polyline points)",
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
                    "title": "Waze CCP Feed URL (token + polygon embedded)",
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
        resp = requests.get(self.feed_url, timeout=self.timeout)
        resp.raise_for_status()
        raw = resp.json()
        records = extract_records(raw, [resource])

        wanted_type = params.get("type")
        if wanted_type:
            records = [record for record in records if record.get("type") == wanted_type]

        min_reliability = params.get("min_reliability")
        if min_reliability is not None:
            threshold = int(min_reliability)
            records = [record for record in records if record.get("reliability", 0) > threshold]

        return records, raw


register(Waze)
