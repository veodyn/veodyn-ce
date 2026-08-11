"""
GBFS (bikeshare) query runner.

Generic GBFS consumer: resolves station_information / station_status feed
URLs from a system's gbfs.json discovery document.

Discovery URL example, per the GBFS spec: https://gbfs.example.org/gbfs.json
"""

import requests

from redash.query_runner import register
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
    extract_records,
)


class GBFS(BaseResourceRunner):
    resources = {
        "feeds": {
            "doc_params": ["(no params, lists feeds from the discovery document)"],
            "doc_returns": ["name: string", "url: string"],
        },
        "station_information": {
            "doc_params": ["(no params)"],
            "doc_returns": [
                "station_id: string",
                "name: string",
                "lat: float",
                "lon: float",
                "address: string",
                "capacity: integer",
            ],
        },
        "station_status": {
            "doc_params": ["(no params)"],
            "doc_returns": [
                "station_id: string",
                "num_bikes_available: integer",
                "num_docks_available: integer",
                "num_bikes_available_types: string (JSON, {electric, classic})",
                "is_renting: integer",
                "last_reported: integer",
            ],
        },
        "stations_joined": {
            "doc_params": ["(no params, station_information merged with station_status by station_id)"],
            "doc_returns": [
                "all station_information columns",
                "all station_status columns (prefixed status_ on name collisions)",
            ],
        },
    }
    default_resource = "stations_joined"
    noop_query = '{"resource": "feeds"}'

    @classmethod
    def name(cls):
        return "GBFS Bikeshare"

    @classmethod
    def type(cls):
        return "gbfs"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "discovery_url": {
                    "type": "string",
                    "title": "GBFS Discovery URL (gbfs.json)",
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
        resp = requests.get(url, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def _discover_feeds(self):
        discovery = self._get_json(self.discovery_url)
        data = discovery.get("data") or {}
        # GBFS 1.x/2.x nest feeds under a language key; GBFS 3.x puts them
        # directly under data.
        feeds = (data.get(self.language) or {}).get("feeds") or data.get("feeds") or []
        return {feed.get("name"): feed.get("url") for feed in feeds if feed.get("url")}

    def _fetch_feed_stations(self, feeds, name):
        if name not in feeds:
            available = ", ".join(sorted(feeds)) or "none"
            raise Exception(f"Feed {name!r} not published by this system (available: {available})")
        raw = self._get_json(feeds[name])
        return extract_records(raw, ["data", "stations"]), raw

    def _fetch(self, resource, params):
        feeds = self._discover_feeds()

        if resource == "feeds":
            records = [{"name": name, "url": url} for name, url in sorted(feeds.items())]
            return records, feeds

        if resource in ("station_information", "station_status"):
            return self._fetch_feed_stations(feeds, resource)

        # stations_joined
        info_records, info_raw = self._fetch_feed_stations(feeds, "station_information")
        status_records, status_raw = self._fetch_feed_stations(feeds, "station_status")

        merged = {}
        for info in info_records:
            merged[str(info.get("station_id"))] = dict(info)
        for status in status_records:
            station = merged.setdefault(str(status.get("station_id")), {"station_id": status.get("station_id")})
            for key, value in status.items():
                if key != "station_id" and key in station:
                    station[f"status_{key}"] = value
                else:
                    station[key] = value

        return list(merged.values()), {"station_information": info_raw, "station_status": status_raw}


register(GBFS)
