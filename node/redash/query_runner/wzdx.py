import requests

from redash.query_runner import register
from redash.query_runner.connector_base import (
    REQUEST_HEADERS,
    BaseResourceRunner,
    build_configuration_schema,
)
from redash.query_runner.gtfs_static_tables import MAX_ROWS_CEILING, parse_max_rows
from redash.query_runner.wzdx_records import (
    data_source_rows,
    device_record,
    feature_collection_cell,
    feed_document_error,
    feed_info_row,
    lane_records,
    road_event_record,
    select_features,
    select_records,
)

DEFAULT_MAX_ROWS = 5000
GEOMETRY_RETURNS = [
    "geometry_type: string",
    "geometry: string (GeoJSON geometry)",
    "properties: string (JSON, the properties not lifted into columns)",
    "bbox: string (JSON, [minLng, minLat, maxLng, maxLat])",
]
FILTER_PARAMS = [
    'filter: {column: value | [values]}, matched against the returned columns, e.g. {"event_type": "detour"}',
    "format: rows (default) | featurecollection (one geojson cell holding the matching features)",
]


class WZDx(BaseResourceRunner):
    resources = {
        "feed_info": {
            "doc_params": ["(no params)"],
            "doc_returns": [
                "one row: publisher, version, update_date, update_frequency, contact_name, contact_email, license, ...",
                "data_source_count: integer",
            ],
        },
        "data_sources": {
            "doc_params": ["(no params)"],
            "doc_returns": [
                "data_source_id: string",
                "organization_name: string",
                "contact_name, contact_email: string",
                "update_frequency: integer (seconds)",
                "update_date: string (ISO 8601)",
            ],
        },
        "road_events": {
            "doc_params": FILTER_PARAMS,
            "doc_returns": [
                "id: string",
                "event_type: string (work-zone | detour | restriction)",
                "data_source_id: string",
                "road_names: string (JSON array)",
                "direction: string",
                "name, description: string",
                "start_date, end_date, creation_date, update_date: string (ISO 8601)",
                "is_start_date_verified, is_end_date_verified, is_start_position_verified, is_end_position_verified: boolean",
                "vehicle_impact, work_zone_type, location_method: string",
                "beginning_cross_street, ending_cross_street: string",
                "beginning_milepost, ending_milepost, reduced_speed_limit_kph: number",
                "workers_present: boolean (worker_presence.are_workers_present)",
                "lane_count: integer",
                "types_of_work, restrictions, related_road_events: string (JSON array)",
                *GEOMETRY_RETURNS,
            ],
            "example": '{"resource": "road_events", "params": {"filter": {"event_type": "work-zone"}}}',
        },
        "lanes": {
            "doc_params": [FILTER_PARAMS[0]],
            "doc_returns": [
                "road_event_id: string",
                "order: integer (1 is the leftmost lane)",
                "type: string",
                "status: string (open | closed | shift-left | shift-right | merge-left | merge-right | alternating-flow)",
                "restrictions: string (JSON array)",
            ],
            "example": '{"resource": "lanes", "params": {"filter": {"status": "closed"}}}',
        },
        "devices": {
            "doc_params": ["(reads the configured device feed URL)", *FILTER_PARAMS],
            "doc_returns": [
                "id: string",
                "device_type: string (arrow-board | camera | dynamic-message-sign | flashing-beacon | ...)",
                "device_status: string (ok | warning | error | unknown)",
                "data_source_id: string",
                "road_names: string (JSON array)",
                "road_direction, name, description: string",
                "update_date: string (ISO 8601)",
                "has_automatic_location, is_moving: boolean",
                "road_event_ids: string (JSON array)",
                "milepost: number",
                "status_messages: string (JSON array)",
                *GEOMETRY_RETURNS,
            ],
        },
    }
    default_resource = "road_events"
    noop_query = '{"resource": "feed_info"}'

    @classmethod
    def name(cls):
        return "WZDx Work Zones"

    @classmethod
    def type(cls):
        return "wzdx"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "feed_url": {
                    "type": "string",
                    "title": "Work Zone Feed URL (WZDx 4.x GeoJSON)",
                },
                "device_feed_url": {
                    "type": "string",
                    "title": "Device Feed URL (optional)",
                },
                "max_rows": {
                    "type": "number",
                    "title": "Max rows per query",
                    "default": DEFAULT_MAX_ROWS,
                    "minimum": 1,
                    "maximum": MAX_ROWS_CEILING,
                    "multipleOf": 1,
                },
            },
            required=["feed_url"],
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        self.feed_url = self.configuration.get("feed_url", "")
        self.device_feed_url = self.configuration.get("device_feed_url", "")
        self._truncated = False

    def _max_rows(self):
        configured = self.configuration.get("max_rows")
        max_rows, error = parse_max_rows(DEFAULT_MAX_ROWS if configured in (None, "") else configured)
        if error:
            raise Exception(error)
        return max_rows

    def _get_feed(self, url, label):
        response = requests.get(url, timeout=self.timeout, headers=REQUEST_HEADERS)
        response.raise_for_status()
        document = response.json()
        error = feed_document_error(document)
        if error:
            raise Exception(f"{label}: {error}")
        return document

    def _features(self, document, to_record, params):
        selected, self._truncated = select_features(
            document["features"], to_record, params.get("filter") or {}, self._max_rows()
        )
        if (params.get("format") or "rows").lower() == "featurecollection":
            return feature_collection_cell([feature for feature, _record in selected])
        return [record for _feature, record in selected]

    def _fetch(self, resource, params):
        if resource == "devices":
            if not self.device_feed_url:
                raise Exception("no device feed URL is configured on this data source")
            document = self._get_feed(self.device_feed_url, "device feed")
            return self._features(document, device_record, params), document

        document = self._get_feed(self.feed_url, "work zone feed")
        if resource == "feed_info":
            return [feed_info_row(document["feed_info"])], document
        if resource == "data_sources":
            return data_source_rows(document["feed_info"]), document
        if resource == "lanes":
            lanes = [lane for feature in document["features"] for lane in lane_records(feature)]
            selected, self._truncated = select_records(lanes, params.get("filter") or {}, self._max_rows())
            return selected, document
        return self._features(document, road_event_record, params), document

    def run_query(self, query, user):
        self._truncated = False
        data, error = super().run_query(query, user)
        if data is not None and self._truncated:
            data["truncated"] = True
        return data, error


register(WZDx)
