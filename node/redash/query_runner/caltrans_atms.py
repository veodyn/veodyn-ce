"""
Caltrans District ATMS query runner.

Reads a Caltrans district's plain-text ATMS feeds — station inventory
(`webinit.txt`) and live readings (`webupdate.txt`) — for the district's
Vehicle Detector Stations (VDS). `base_url` is a configuration field, not a
hardcoded agency, so a second data source instance targets a different
district by URL alone, the same way `go511.py`/`socaltransport.py` are
generalized by base URL rather than one hardcoded region.

This connector makes no routing/geocoding calls and returns no `geometry`
column: a prior, unfinished experiment (`riits_tiles` repo,
`otv2-platform/caltrans-ingest`) called a routing engine per station on
every poll and produced fabricated 2-point "segments". Real inter-station
segment geometry is built offline, once, by
`bin/build_caltrans_segment_geometry.py` against Caltrans' own State Highway
Network Lines, and joined to this connector's `readings` at query time by
`vds_id` (see docs/docs/connectors.md and the design spec this ships from,
`docs/superpowers/specs/2026-09-23-freeway-speed-segments-design.md`).

Two resources, columns and parsing split out for the repo's 300-line limit:
`caltrans_atms_rows.py` holds the fixed column set per resource and the
record -> row shaping (`status` derivation included); `caltrans_atms_parse.py`
holds the two text parsers.

- `stations`: vds_id, name, route, direction, postmile, lon, lat — parsed
  from `webinit.txt`. VDS rows only.
- `readings`: vds_id, status, color_code, speed_mph, volume_per_30s,
  good_lanes_pct, observed_at — parsed from `webupdate.txt`. Fixed-schema
  output (`connector_tables.to_fixed_table`, the same override `tmdd.py`
  and `ntcip_dms.py` use): every row carries every column, `no_data` rows
  included, so a table whose first row happens to be a healthy station
  doesn't silently drop columns for the whole result the way first-record
  inference would.

`status` is derived from `color_code`: the documented legend (`13`/`1`/`3`/
`2`) maps to `"ok"`; any other value, including the undocumented `0` and `9`
that make up the large majority of a district's stations at any given
moment, maps to `"no_data"`. `color_code` is kept alongside, raw, in both
cases — undocumented codes are surfaced, never guessed at, because guessing
here would fabricate a "quiet freeway" reading for most of the network.
`observed_at` is this connector's own fetch time: the upstream feed carries
no per-row timestamp of its own, so this must not be read, documented or
mapped as if Caltrans reported it.
"""

from datetime import datetime, timezone

import requests

from redash.query_runner import register
from redash.query_runner.caltrans_atms_parse import parse_webinit, parse_webupdate
from redash.query_runner.caltrans_atms_rows import (
    RESOURCE_COLUMN_TYPES,
    RESOURCE_COLUMNS,
    reading_row,
)
from redash.query_runner.connector_base import (
    REQUEST_HEADERS,
    BaseResourceRunner,
    build_configuration_schema,
    serialize_result,
)
from redash.query_runner.connector_tables import to_fixed_table
from redash.query_runner.connector_validation import (
    parse_object_query,
    require_configured,
)

DEFAULT_BASE_URL = "https://cwwp2.dot.ca.gov/data/d7/atms"


class CaltransATMS(BaseResourceRunner):
    resources = {
        "stations": {
            "doc_params": ["limit (optional integer): truncate the returned station list"],
            "doc_returns": [
                "vds_id: string",
                "name: string",
                "route: string",
                "direction: string",
                "postmile: float",
                "lon: float",
                "lat: float",
            ],
            "example": '{"resource": "stations"}',
        },
        "readings": {
            "doc_params": ["(no params: full district feed)"],
            "doc_returns": [
                "vds_id: string",
                'status: string ("ok" | "no_data")',
                "color_code: string (raw Caltrans code; undocumented values surface as no_data, never guessed)",
                "speed_mph: float (Caltrans' own value, verbatim)",
                "volume_per_30s: integer",
                "good_lanes_pct: float",
                "observed_at: datetime (this connector's own fetch time, not an upstream timestamp)",
            ],
            "example": '{"resource": "readings"}',
        },
    }
    default_resource = "stations"
    noop_query = '{"resource": "stations", "params": {"limit": 1}}'

    @classmethod
    def name(cls):
        return "Caltrans ATMS"

    @classmethod
    def type(cls):
        return "caltrans_atms"

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            {
                "base_url": {
                    "type": "string",
                    "title": "Caltrans District ATMS Base URL",
                    "description": "The directory serving webinit.txt/webupdate.txt for one district.",
                    "default": DEFAULT_BASE_URL,
                },
            },
            required=["base_url"],
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        self.base_url = self.configuration.get("base_url", DEFAULT_BASE_URL).rstrip("/")

    def run_query(self, query, user):
        # Configuration is validated here and returned, never raised: a data
        # source saved before base_url became required can still hold an
        # empty value, and the moment to say so is the moment someone runs a
        # query — tmdd.py and ntcip_dms.py establish the same pattern.
        error = require_configured(self.type(), base_url=self.base_url)
        if error:
            return None, error

        config, params, error = parse_object_query(query)
        if error:
            return None, error

        resource = config.get("resource") or self.default_resource
        if resource not in self.resources:
            available = ", ".join(sorted(self.resources))
            return None, f"Unknown resource {resource!r}. Available resources: {available}"

        try:
            records, raw = self._fetch(resource, params)
        except Exception as e:
            return None, f"{self.name()} request failed: {e}"

        pubsub_channel = config.get("pubsub_channel", "")
        if pubsub_channel:
            self._publish_to_redis(pubsub_channel, resource, params, raw)

        # The base's to_redash_table infers columns and types from record
        # one, which would drop columns for the whole readings table the
        # moment it leads with a no_data station missing a value the way a
        # healthy one carries it. Reimplemented over to_fixed_table for the
        # same reason tmdd.py and ntcip_dms.py are.
        columns, rows = to_fixed_table(RESOURCE_COLUMNS[resource], RESOURCE_COLUMN_TYPES[resource], records)
        return serialize_result(columns, rows), None

    def _get(self, filename):
        resp = requests.get(
            f"{self.base_url}/{filename}",
            headers=REQUEST_HEADERS,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.text

    def _fetch(self, resource, params):
        if resource == "stations":
            text = self._get("webinit.txt")
            records = parse_webinit(text)
            limit = params.get("limit")
            if isinstance(limit, int) and limit >= 0:
                records = records[:limit]
            return records, text

        text = self._get("webupdate.txt")
        observed_at = datetime.now(timezone.utc)
        records = [reading_row(raw, observed_at) for raw in parse_webupdate(text)]
        return records, text


register(CaltransATMS)
