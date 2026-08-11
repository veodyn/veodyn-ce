"""
TrafficLand query runner.

Traffic camera video feed metadata for a TrafficLand system.

The API key and the system name must be entered when creating the data
source; neither is shipped as a default, since both are specific to the
customer's TrafficLand account.
"""

import requests

from redash.query_runner import register
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
)
from redash.query_runner.connector_validation import require_configured

DEFAULT_BASE_URL = "https://api.trafficland.com"


class TrafficLand(BaseResourceRunner):
    resources = {
        "video_feeds": {
            "doc_params": [
                "ids (optional): string - comma-separated camera publicIds (all if omitted)",
            ],
            "doc_returns": [
                "publicId: string",
                "name: string",
                "location: string (JSON, lat/lon)",
                "content: string (JSON, image/video URLs)",
            ],
            "example": '{"resource": "video_feeds", "params": {"ids": "40011,40012"}}',
        },
    }
    default_resource = "video_feeds"
    noop_query = '{"resource": "video_feeds"}'

    @classmethod
    def name(cls):
        return "TrafficLand Cameras"

    @classmethod
    def type(cls):
        return "trafficland"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "base_url": {
                    "type": "string",
                    "title": "TrafficLand API Base URL",
                    "default": DEFAULT_BASE_URL,
                },
                "api_key": {
                    "type": "string",
                    "title": "API Key",
                },
                "system": {
                    "type": "string",
                    "title": "System",
                },
            },
            required=["base_url", "api_key", "system"],
            secret=["api_key"],
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        self.base_url = self.configuration.get("base_url", DEFAULT_BASE_URL).rstrip("/")
        self.api_key = self.configuration.get("api_key", "")
        self.system = self.configuration.get("system", "")

    def run_query(self, query, user):
        error = require_configured(self.type(), base_url=self.base_url, api_key=self.api_key, system=self.system)
        if error:
            return None, error

        return super().run_query(query, user)

    def _fetch(self, resource, params):
        query_params = {
            "regionType": "city",
            "includeWeather": "false",
            "system": self.system,
            "key": self.api_key,
        }
        resp = requests.get(
            f"{self.base_url}/v2.2/json/video_feeds",
            params=query_params,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        raw = resp.json()
        records = raw if isinstance(raw, list) else []
        ids = params.get("ids")
        if ids:
            wanted = {part.strip() for part in str(ids).split(",") if part.strip()}
            records = [record for record in records if str(record.get("publicId")) in wanted]
        return records, raw


register(TrafficLand)
