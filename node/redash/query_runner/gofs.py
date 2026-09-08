import json

import requests

from redash.query_runner import register
from redash.query_runner.connector_base import (
    REQUEST_HEADERS,
    BaseResourceRunner,
    build_configuration_schema,
    extract_records,
)
from redash.query_runner.static_geojson import geometry_bbox

ARRAY_FEEDS = ("service_brands", "vehicle_types", "operating_rules", "calendars", "booking_rules")


def zone_record(feature):
    properties = feature.get("properties") or {}
    geometry = feature.get("geometry") or {}
    extra = {key: value for key, value in properties.items() if key != "name"}
    return {
        "zone_id": feature.get("zone_id"),
        "name": properties.get("name"),
        "geometry_type": geometry.get("type"),
        "geometry": json.dumps(geometry),
        "properties": json.dumps(extra) if extra else "",
        "bbox": json.dumps(geometry_bbox(geometry)) if geometry else "",
    }


class GOFS(BaseResourceRunner):
    resources = {
        "feeds": {
            "doc_params": ["(no params, lists feeds from the gofs.json discovery document)"],
            "doc_returns": ["name: string", "url: string"],
        },
        "system_information": {
            "doc_params": ["(no params)"],
            "doc_returns": ["one row: language, name, timezone, url, phone_number, email, ..."],
        },
        "service_brands": {
            "doc_params": ["(no params)"],
            "doc_returns": [
                "brand_id: string",
                "brand_name: string",
                "brand_color: string",
                "brand_text_color: string",
            ],
        },
        "vehicle_types": {
            "doc_params": ["(no params)"],
            "doc_returns": ["vehicle_type_id: string", "wheelchair_accessible: boolean", "..."],
        },
        "zones": {
            "doc_params": ["format: rows (default) | featurecollection"],
            "doc_returns": [
                "zone_id: string",
                "name: string",
                "geometry_type: string",
                "geometry: string (GeoJSON geometry)",
                "properties: string (JSON, properties other than name)",
                "bbox: string (JSON, [minLng, minLat, maxLng, maxLat])",
                "featurecollection: a single geojson column holding the zones FeatureCollection",
            ],
        },
        "operating_rules": {
            "doc_params": ["(no params)"],
            "doc_returns": [
                "from_zone_id: string",
                "to_zone_id: string",
                "start_pickup_window, end_pickup_window, end_dropoff_window: string (HH:MM:SS)",
                "calendars: string (JSON array of calendar_id)",
                "brand_id: string",
                "vehicle_type_id: string (JSON array)",
                "fare_id: string",
            ],
        },
        "calendars": {
            "doc_params": ["(no params)"],
            "doc_returns": [
                "calendar_id: string",
                "days: string (JSON array of mon..sun)",
                "start_date: string",
                "end_date: string",
                "excepted_dates: string (JSON array)",
            ],
        },
        "booking_rules": {
            "doc_params": ["(no params)"],
            "doc_returns": ["from_zone_ids: string (JSON array)", "to_zone_ids: string (JSON array)", "..."],
        },
    }
    default_resource = "system_information"
    noop_query = '{"resource": "feeds"}'

    @classmethod
    def name(cls):
        return "GOFS On-Demand"

    @classmethod
    def type(cls):
        return "gofs"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "discovery_url": {
                    "type": "string",
                    "title": "GOFS Discovery URL (gofs.json)",
                },
                "language": {
                    "type": "string",
                    "title": "Feed Language",
                    "default": "en",
                },
            },
            required=["discovery_url"],
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        self.discovery_url = self.configuration.get("discovery_url", "")
        self.language = self.configuration.get("language", "en")

    def _get_json(self, url):
        response = requests.get(url, timeout=self.timeout, headers=REQUEST_HEADERS)
        response.raise_for_status()
        return response.json()

    def _discover_feeds(self):
        data = self._get_json(self.discovery_url).get("data") or {}
        feeds = (data.get(self.language) or {}).get("feeds") or data.get("feeds") or []
        return {feed.get("name"): feed.get("url") for feed in feeds if feed.get("url")}

    def _fetch_feed(self, feeds, name):
        if name not in feeds:
            available = ", ".join(sorted(feeds)) or "none"
            raise Exception(f"Feed {name!r} not published by this system (available: {available})")
        return self._get_json(feeds[name])

    def _fetch(self, resource, params):
        feeds = self._discover_feeds()

        if resource == "feeds":
            return [{"name": name, "url": url} for name, url in sorted(feeds.items())], feeds

        raw = self._fetch_feed(feeds, resource)

        if resource == "system_information":
            return extract_records(raw, ["data"]), raw

        if resource in ARRAY_FEEDS:
            return extract_records(raw, ["data", resource]), raw

        features = extract_records(raw, ["data", "zones", "features"])
        if (params.get("format") or "rows").lower() == "featurecollection":
            collection = {"type": "FeatureCollection", "features": features}
            return [{"geojson": json.dumps(collection)}], raw
        return [zone_record(feature) for feature in features], raw


register(GOFS)
