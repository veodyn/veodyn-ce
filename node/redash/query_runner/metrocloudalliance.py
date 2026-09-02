"""
MetroCloudAlliance (MCA) query runner.

Real-time transit predictions, scheduled stop times, stop/network search,
carriers, lines/routes, vehicle locations, service alerts, the federated
realtime sources and the Analytics-module reports for whatever transit
network the account is provisioned against.

The API key must be entered when creating the data source; it is not
shipped as a default.
"""

import time
from functools import partial

import requests

from redash.query_runner import TYPE_STRING, register
from redash.query_runner import metrocloudalliance_public as public_naming
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
from redash.query_runner.metrocloudalliance_departures import flatten_departures
from redash.query_runner.metrocloudalliance_public import (
    PUBLIC_COLUMN_NAMES,
    PUBLIC_RESOURCES,
    run_public_resource,
)
from redash.query_runner.metrocloudalliance_resources import RESOURCES

DEFAULT_BASE_URL = "https://api.metrocloudalliance.com/"


class MetroCloudAlliance(BaseResourceRunner):
    resources = {**RESOURCES, **PUBLIC_RESOURCES}
    default_resource = "carriers"
    noop_query = '{"resource": "carriers"}'

    # Resources whose vendor endpoint 400s on a missing param rather than
    # treating it as unset - checked in _fetch before the request goes out,
    # so a missing one fails as "this field is required" instead of a vendor
    # "Bad Parameter" response.
    required_resource_params = {
        "reports": ("type",),
        "stoptimes": ("iline",),
        "public_routes": ("carrier_code",),
        "public_stops": ("carrier_code",),
        "public_route_stops": ("carrier_code",),
        "public_departures": ("carrier_code",),
    }

    @classmethod
    def name(cls):
        return "MetroCloudAlliance Transit"

    @classmethod
    def type(cls):
        return "metrocloudalliance"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "base_url": {
                    "type": "string",
                    "title": "MCA API Base URL",
                    "default": DEFAULT_BASE_URL,
                },
                "api_key": {
                    "type": "string",
                    "title": "API Key",
                },
            },
            required=["base_url", "api_key"],
            secret=["api_key"],
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        self.base_url = self.configuration.get("base_url", DEFAULT_BASE_URL).rstrip("/") + "/"
        self.api_key = self.configuration.get("api_key", "")

    def run_query(self, query, user):
        # self.base_url always ends in "/" (see __init__), so an empty
        # persisted value would not read as missing; check the raw
        # configuration value instead.
        error = require_configured(
            self.type(),
            base_url=self.configuration.get("base_url", DEFAULT_BASE_URL),
            api_key=self.api_key,
        )
        if error:
            return None, error

        data, error = super().run_query(query, user)
        if data is not None and not data["columns"]:
            config, _, _ = parse_object_query(query)
            names = PUBLIC_COLUMN_NAMES.get((config or {}).get("resource"))
            if names:
                data["columns"] = [{"name": name, "friendly_name": name, "type": TYPE_STRING} for name in names]
        return data, error

    def _archive_fetcher(self):
        return partial(public_naming.archive_fetch, timeout=self.timeout)

    def _fetch(self, resource, params):
        required = self.required_resource_params.get(resource)
        if required:
            error = require_params(self.type(), params, *required)
            if error:
                raise ValueError(error)

        if resource in PUBLIC_RESOURCES:
            records = run_public_resource(
                resource, params, self._fetch_raw, now=time.time(), archive_fetcher=self._archive_fetcher()
            )
            return records, {"status": "ok", "results": records}

        query_params = dict(params)
        query_params["api_key"] = self.api_key
        resp = requests.get(
            f"{self.base_url}{self.resources[resource]['path']}",
            params=query_params,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        raw = resp.json()

        if isinstance(raw, dict) and raw.get("status") not in (None, "ok"):
            detail = raw.get("request_parameters") or raw.get("resource_path") or ""
            raise Exception(f"MCA returned status {raw.get('status')!r} {detail}")

        records = extract_records(raw, ["results"])
        if resource == "departures":
            records = flatten_departures(records, now=time.time())
        return records, raw

    def _fetch_raw(self, resource, params):
        records, _ = self._fetch(resource, params)
        return records


register(MetroCloudAlliance)
