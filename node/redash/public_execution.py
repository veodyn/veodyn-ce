import logging
import re
import uuid
from time import time

from werkzeug.exceptions import NotFound

from redash import models, redis_connection
from redash.models.parameterized_query import (
    InvalidParameterError,
    QueryDetachedFromDataSourceError,
)
from redash.serializers import public_visualization
from redash.tasks.queries import enqueue_query
from redash.utils import gen_query_hash

logger = logging.getLogger(__name__)

PREFIX = "p_"
MAX_KEYS = 10
KEY_PATTERN = re.compile(r"p_[A-Za-z0-9_]{1,64}")
MAX_VALUE_LENGTH = 200
ALLOWED_TYPES = ("enum", "query")

QUEUED_TTL = 20
JOB_TIMEOUT = 40
HARD_KILL_GRACE = 15
RETRY_PENDING = "2"
RETRY_UNAVAILABLE = "30"

ADMIT_SCRIPT = """
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[2])
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then
  return 2
end
if not redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[4]) then
  return 1
end
redis.call('ZADD', KEYS[2], tonumber(ARGV[2]) + tonumber(ARGV[4]), KEYS[1])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 0
"""

ADMISSION_OUTCOMES = {0: "admitted", 1: "held", 2: "capacity"}
_admit_script = redis_connection.register_script(ADMIT_SCRIPT)


class Rejected(Exception):
    pass


class Unavailable(Exception):
    pass


def admit(connection, lease_key, window_key, now, lease_seconds, capacity, request_id):
    outcome = _admit_script(
        keys=[lease_key, window_key],
        args=[request_id, repr(float(now)), int(capacity), int(lease_seconds)],
        client=connection,
    )
    return ADMISSION_OUTCOMES[int(outcome)]


def supplied_parameters(args):
    keys = [key for key in args if key.startswith(PREFIX)]
    if not keys:
        return None
    return {key: args.getlist(key) for key in keys}


def _bounded_int(options, key, default, low, high):
    value = options.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        value = default
    return max(low, min(high, int(value)))


def max_age_seconds(vis):
    return _bounded_int(vis.options or {}, "publicMaxAgeSeconds", 60, 15, 3600)


def max_runs_per_window(vis):
    return _bounded_int(vis.options or {}, "publicMaxRunsPerWindow", 32, 1, 512)


def lease_seconds(max_age):
    return max(max_age, QUEUED_TTL + JOB_TIMEOUT + HARD_KILL_GRACE)


def _matches(pattern, value):
    try:
        return isinstance(value, str) and re.fullmatch(pattern, value) is not None
    except (re.error, TypeError):
        return False


def validate_request(vis, raw):
    if vis.query_rel.data_source is None:
        raise Rejected()
    patterns = (vis.options or {}).get("publicParameters")
    if not isinstance(patterns, dict) or not patterns:
        raise Rejected()
    if len(raw) > MAX_KEYS:
        raise Rejected()
    definitions = {p.get("name"): p for p in vis.query_rel.parameters}
    supplied = {}
    for key, values in raw.items():
        name = key[len(PREFIX) :]
        if len(values) != 1 or KEY_PATTERN.fullmatch(key) is None or len(values[0]) > MAX_VALUE_LENGTH:
            raise Rejected()
        if name not in patterns or not _matches(patterns[name], values[0]):
            raise Rejected()
        definition = definitions.get(name)
        if definition is None or definition.get("type") not in ALLOWED_TYPES:
            raise Rejected()
        if isinstance(definition.get("multiValuesOptions"), dict):
            raise Rejected()
        supplied[name] = values[0]
    return supplied, patterns


def _check_dropdown(definition, org):
    try:
        dropdown = models.Query.get_by_id_and_org(definition.get("queryId"), org)
    except (NotFound, models.NoResultFound):
        raise Rejected()
    if dropdown.latest_query_data_id is None:
        raise Unavailable()


def render_text(vis, supplied, patterns):
    query = vis.query_rel
    merged = {}
    for definition in query.parameters:
        name = definition.get("name")
        if name in supplied:
            merged[name] = supplied[name]
            continue
        default = definition.get("value")
        if name in patterns and not _matches(patterns[name], default):
            raise Rejected()
        if default is not None:
            merged[name] = default
    for definition in query.parameters:
        if definition.get("type") == "query" and definition.get("name") in merged:
            _check_dropdown(definition, query.org)
    try:
        parameterized = query.parameterized.apply(merged)
    except (InvalidParameterError, QueryDetachedFromDataSourceError):
        raise Rejected()
    if parameterized.missing_params:
        raise Rejected()
    return parameterized.text


def _enqueue(text, data_source, token, query_id):
    try:
        enqueue_query(
            text,
            data_source,
            token,
            is_api_key=True,
            metadata={"query_id": query_id, "Username": "public-visualization"},
            job_timeout=JOB_TIMEOUT,
            queued_ttl=QUEUED_TTL,
        )
    except Exception:
        logger.exception("public visualization enqueue failed; the lease stands until it expires")


def resolve(vis, token, text):
    data_source = vis.query_rel.data_source
    max_age = max_age_seconds(vis)
    fresh = models.QueryResult.get_latest(data_source, text, max_age)
    if fresh is not None:
        return 200, {}, fresh, "fresh"
    stale = models.QueryResult.get_latest(data_source, text, -1)
    if data_source.paused:
        if stale is not None:
            return 200, {}, stale, "stale"
        return 503, {"Retry-After": RETRY_UNAVAILABLE}, None, "unavailable"
    lease_key = "public-exec:{}:{}".format(data_source.id, gen_query_hash(text))
    window_key = "public-exec-window:{}".format(vis.id)
    outcome = admit(
        redis_connection,
        lease_key,
        window_key,
        time(),
        lease_seconds(max_age),
        max_runs_per_window(vis),
        uuid.uuid4().hex,
    )
    if outcome == "admitted":
        _enqueue(text, data_source, token, vis.query_rel.id)
    if outcome == "capacity" and stale is not None:
        return 200, {}, stale, "stale"
    return 202, {"Retry-After": RETRY_PENDING}, stale, "pending"


def respond(vis, token, raw):
    try:
        supplied, patterns = validate_request(vis, raw)
        text = render_text(vis, supplied, patterns)
    except Unavailable:
        body = public_visualization(vis, result=None, status="unavailable", parameters=_plain(raw))
        return body, 503, {"Retry-After": RETRY_UNAVAILABLE}
    code, headers, result, status = resolve(vis, token, text)
    return public_visualization(vis, result=result, status=status, parameters=supplied), code, headers


def _plain(raw):
    return {key[len(PREFIX) :]: values[0] for key, values in raw.items()}
