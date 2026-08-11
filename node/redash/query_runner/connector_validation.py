"""
Pre-flight validation shared by the connector_base family.

`require_configured` and `require_params` return a clear, field-naming error
string, or None when the inputs are fine, and are meant to be called before
any network call so a missing required value fails as "this field is not
configured" rather than as a vendor request that carries an empty string.
`parse_object_query` sits one step earlier, proving the query text decoded
to the object shape the family's query format documents.
"""


def _is_missing(value):
    """
    True for None and for a string that is empty or whitespace-only.

    Deliberately NOT a plain falsy check: numeric 0 / 0.0 (a valid latitude,
    longitude, or other real zero value) and the string "0" are present
    values, not missing ones, even though `not 0` and `not 0.0` are True in
    Python.
    """
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    return False


def require_configured(name, **fields):
    """
    Return "<name>: '<field>' is not configured" for the first of the given
    persisted-configuration keyword values that is missing, or None if all
    are present.

    Guards a data source's own configuration: a field that is required today
    but had no default before it became required can still be empty on a
    pre-existing row, since the schema's `required` list is only checked when
    a row is saved, not on every run.
    """
    for field_name, value in fields.items():
        if _is_missing(value):
            return f"{name}: '{field_name}' is not configured"
    return None


def require_params(name, params, *field_names):
    """
    Return "<name>: '<field>' param is required" for the first of
    `field_names` missing from `params`, or None if all are present.

    Guards per-query params that the connector documents as required but
    does not enforce: a query omitting one silently sends an empty string to
    the vendor.
    """
    for field_name in field_names:
        if _is_missing(params.get(field_name)):
            return f"{name}: '{field_name}' param is required"
    return None


def parse_object_query(query):
    """
    Parse the runner's JSON query text and prove it decoded to an object.

    Returns (config, params, error). `parse_json_query` only proves the text
    is valid JSON: `[]`, `null` and a bare number all parse cleanly and then
    crash the caller's next `.get()`, which is what eleven of the twelve
    runners in this family did.

    `resource` is checked here too, for the same reason and against the same
    two failure modes. Every runner reads it as
    `config.get("resource") or self.default_resource`, so a falsy non-string
    (false, 0, [], {}) is indistinguishable from an omitted key and sends a
    real request against the DEFAULT resource; and every runner then looks
    the value up in a dict, so an unhashable one raises TypeError out of
    `run_query` past the exception handler. Only a PRESENT resource has to be
    a string: absent and null both keep the default-resource behaviour, which
    is how a runner carrying a default is meant to be queried.

    `params` is defaulted BEFORE the type check and only for None, never with
    `or {}`. `[] or {}` evaluates to `{}`, so the obvious spelling accepts
    exactly the malformed values it is supposed to reject, along with "", 0
    and false.

    The import is function-local on purpose: connector_base imports this
    module at module level, so a module-level import back into it would be a
    cycle that fails on whichever of the two is loaded first.
    """
    from redash.query_runner.connector_base import parse_json_query

    config, error = parse_json_query(query)
    if error:
        return None, None, error
    if not isinstance(config, dict):
        return None, None, f"Invalid query JSON: must be a JSON object, not {type(config).__name__}"
    resource = config.get("resource")
    if resource is not None and not isinstance(resource, str):
        return None, None, f"Invalid query JSON: 'resource' must be a string, not {type(resource).__name__}"
    params = config.get("params")
    if params is None:
        params = {}
    if not isinstance(params, dict):
        return None, None, f"Invalid query JSON: 'params' must be a JSON object, not {type(params).__name__}"
    return config, params, None
