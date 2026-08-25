"""
Shared helpers for connectors that expose a fixed set of named resources.

These runners wrap upstream data sources that speak REST/JSON rather than SQL,
so Redash can query them directly: transit positions, weather, traffic
incidents, and similar resource-oriented feeds.

All connectors of this family share the same JSON query format:

    {
        "resource": "<resource name>",
        "params": {...},
        "pubsub_channel": "feed:something"   # optional Redis PubSub publish
    }
"""

import json
import logging
import time
from datetime import date, datetime

from redash import __version__
from redash.query_runner import (
    TYPE_FLOAT,
    TYPE_INTEGER,
    TYPE_STRING,
    BaseQueryRunner,
)
from redash.query_runner.connector_validation import parse_object_query

logger = logging.getLogger(__name__)

# At least one connector's upstream edge answers 403 to requests' default
# `python-requests/*` User-Agent and 200 to every other (its own test file
# carries the specifics), so connectors send an identifying one instead.
REQUEST_HEADERS = {"User-Agent": "Redash/{} (Veodyn connectors)".format(__version__.split("-")[0])}


def infer_type(value):
    if isinstance(value, bool):
        return TYPE_STRING
    if isinstance(value, int):
        return TYPE_INTEGER
    if isinstance(value, float):
        return TYPE_FLOAT
    return TYPE_STRING


def parse_json_query(query):
    """Parse the runner's JSON query text. Returns (config_dict, error)."""
    try:
        return json.loads(query), None
    except json.JSONDecodeError as e:
        return None, f"Invalid query JSON: {e}"


def extract_records(payload, record_path=None):
    """
    Pull the list of records out of an API response.

    With record_path (a list of keys), walk the payload down that path;
    a missing key yields []. Without record_path, apply the legacy envelope
    behavior: a dict with a "data" key uses it, a list is taken as-is,
    anything else becomes a single record.
    """
    if record_path is not None:
        current = payload
        for key in record_path:
            if not isinstance(current, dict) or key not in current:
                return []
            current = current[key]
        if not isinstance(current, list):
            return [current] if current else []
        return current

    if isinstance(payload, dict) and "data" in payload:
        raw_rows = payload["data"]
        if not isinstance(raw_rows, list):
            raw_rows = [raw_rows] if raw_rows else []
    elif isinstance(payload, list):
        raw_rows = payload
    else:
        raw_rows = [payload]
    return raw_rows


def to_redash_table(records):
    """
    Convert a list of records into Redash (columns, rows).

    Columns are derived from the first record; nested dict/list values are
    flattened to JSON strings, datetimes to ISO strings.
    """
    if not records:
        return [], []

    sample = records[0] if isinstance(records[0], dict) else {"value": records[0]}
    columns = []
    for key, value in sample.items():
        columns.append({"name": key, "friendly_name": key, "type": infer_type(value)})

    rows = []
    for item in records:
        if not isinstance(item, dict):
            item = {"value": item}
        row = {}
        for col in columns:
            val = item.get(col["name"])
            if isinstance(val, (dict, list)):
                val = json.dumps(val, default=str)
            elif isinstance(val, (datetime, date)):
                val = val.isoformat()
            row[col["name"]] = val
        rows.append(row)

    return columns, rows


def serialize_result(columns, rows):
    # Modern Redash contract: run_query returns the data as a dict; the
    # QueryResult JSONText column handles serialization. Returning a JSON
    # string here would double-encode and render an empty table in the UI.
    return {"columns": columns, "rows": rows}


def build_configuration_schema(properties, required=(), secret=(), include_redis=True):
    """
    Build a configuration_schema dict, appending the common request_timeout
    and (optionally) redis_url fields every connector of this family shares.

    Required string properties get `minLength: 1` so an API client cannot
    save a data source with e.g. `feed_url: ""`: JSON Schema's `required`
    only checks the key is present, not that its value is non-empty, and
    with the vendor defaults removed an empty required string reaches the
    vendor as a bad request rather than failing at save time as bad config.
    Optional fields, and required fields of other types (numbers, booleans),
    are left alone.
    """
    props = dict(properties)
    props["request_timeout"] = {
        "type": "number",
        "title": "Request Timeout (seconds)",
        "default": 30,
    }
    if include_redis:
        props["redis_url"] = {
            "type": "string",
            "title": "Redis URL for PubSub (optional)",
            "default": "",
        }
    for name in required:
        prop = props.get(name)
        if isinstance(prop, dict) and prop.get("type") == "string" and "minLength" not in prop:
            prop["minLength"] = 1
    schema = {"type": "object", "properties": props, "required": list(required)}
    if secret:
        schema["secret"] = list(secret)
    return schema


class RedisPublisherMixin:
    """Optional fire-and-forget publishing of raw API responses to Redis PubSub."""

    _redis_client = None

    @property
    def redis_client(self):
        if self._redis_client is None and getattr(self, "redis_url", ""):
            try:
                import redis

                self._redis_client = redis.Redis.from_url(
                    self.redis_url,
                    decode_responses=True,
                    socket_connect_timeout=5,
                )
            except Exception as e:
                logger.warning("Failed to initialize Redis client: %s", e)
        return self._redis_client

    def _publish_to_redis(self, channel, endpoint, params, data):
        client = self.redis_client
        if client is None:
            return

        message = json.dumps(
            {
                "timestamp": int(time.time() * 1000),
                "endpoint": endpoint,
                "params": params,
                "data": data,
            },
            default=str,
        )

        try:
            client.publish(channel, message)
        except Exception as e:
            logger.warning("Redis publish to %s failed: %s", channel, e)


class BaseResourceRunner(RedisPublisherMixin, BaseQueryRunner):
    """
    Base for connectors that expose a fixed set of named resources rather than
    a query language.

    Subclasses declare a `resources` dict:

        resources = {
            "<name>": {
                "doc_params": [...],   # strings shown in the schema browser
                "doc_returns": [...],  # strings shown in the schema browser
                "example": '{"resource": "<name>"}',
            },
        }

    and implement `_fetch(resource, params) -> (records, raw_response)`.
    """

    should_annotate_query = False
    resources = {}
    default_resource = None

    def __init__(self, configuration):
        super().__init__(configuration)
        # Every connector of this family takes the JSON query format documented
        # at the top of this module. BaseQueryRunner defaults syntax to "sql", and
        # clients believe it: they pick a SQL editor mode and let a SQL builder
        # aim queries here, which arrive as "Invalid query JSON".
        self.syntax = "json"
        self.timeout = self.configuration.get("request_timeout", 30)
        self.redis_url = self.configuration.get("redis_url", "")

    def _fetch(self, resource, params):
        raise NotImplementedError

    def run_query(self, query, user):
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

        columns, rows = to_redash_table(records)
        return serialize_result(columns, rows), None

    def get_schema(self, get_stats=False):
        schema = []
        examples = []
        for i, (name, meta) in enumerate(self.resources.items(), start=1):
            schema.append(
                {
                    "name": f"{i}. {name} > params",
                    "columns": list(meta.get("doc_params", [])),
                }
            )
            if meta.get("doc_returns"):
                schema.append(
                    {
                        "name": f"{i}. {name} > returns",
                        "columns": list(meta["doc_returns"]),
                    }
                )
            example = meta.get("example", json.dumps({"resource": name}))
            # The query alone: clicking it in the schema browser inserts a
            # working starter, and it names its own resource.
            examples.append(example)
        if examples:
            schema.append({"name": "__ Query Examples __", "columns": examples})
        return schema
