"""
SoCalTransport query runner.

Scheduled arrival/departure times by transit node from socaltransport.org
(Metrolink/Amtrak regional rail + buses).

There is no default transit node: which node to query is agency-specific,
so it must be passed as a query param rather than baked in.
"""

import json

import requests

from redash.query_runner import register
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
    extract_records,
)
from redash.query_runner.connector_validation import (
    parse_object_query,
    require_configured,
    require_params,
)

DEFAULT_BASE_URL = "http://socaltransport.org/"

# A syntactically valid, real-nowhere node id: no SoCalTransport node is
# numbered 0. test_connection exercises the request wiring without a real
# agency node baked into the connector.
NOOP_NODE_ID = "0"


class SoCalTransport(BaseResourceRunner):
    resources = {
        "node_time": {
            "doc_params": [
                "node_id (required): string - transit node id",
            ],
            "doc_returns": [
                "scheduled_times: string",
                "abbrev_rte: string",
                "location: string",
                "sign: string",
                "title: string",
                "carrier_name: string",
                "carrier_id: string",
                "route: string",
                "direction: string",
            ],
            "example": '{"resource": "node_time", "params": {"node_id": "12345"}}',
        },
    }
    default_resource = "node_time"
    noop_query = json.dumps({"resource": "node_time", "params": {"node_id": NOOP_NODE_ID}})

    @classmethod
    def name(cls):
        return "SoCalTransport"

    @classmethod
    def type(cls):
        return "socaltransport"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "base_url": {
                    "type": "string",
                    "title": "SoCalTransport Base URL",
                    "default": DEFAULT_BASE_URL,
                },
            },
            required=["base_url"],
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        self.base_url = self.configuration.get("base_url", DEFAULT_BASE_URL).rstrip("/")

    def run_query(self, query, user):
        error = require_configured(self.type(), base_url=self.base_url)
        if error:
            return None, error

        _config, params, error = parse_object_query(query)
        if error:
            return None, error
        error = require_params(self.type(), params, "node_id")
        if error:
            return None, error

        return super().run_query(query, user)

    def _fetch(self, resource, params):
        query_params = {
            "format": "json",
            "node_id": params.get("node_id", ""),
        }
        resp = requests.get(
            f"{self.base_url}/tm/node_time_v2.php",
            params=query_params,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        raw = resp.json()
        # The feed pads its list with false/empty entries: drop them,
        # matching the Django client's behavior.
        records = [record for record in extract_records(raw, ["node_time"]) if record]
        return records, raw


register(SoCalTransport)
