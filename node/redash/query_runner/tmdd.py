"""
TMDD v3.03d Center-to-Center query runner.

Read-only polling of a traffic management center over the TMDD C2C SOAP
interface: active events, DMS inventory and DMS status. Every operation this
runner can reach is a request; the bundle's control and command operations
are deliberately not implemented.

This module owns the runner. Sibling modules hold the rest, split out to
keep every file under the repo's 300-line limit: `tmdd_config` is the
configuration surface as data, and the request builder, the response
decoder and the HTTP transport land beside it.

**Where errors come from.** The connector family's error contract,
`f"{self.name()} request failed: {e}"`, governs genuine request failures and
is inherited unchanged from `BaseResourceRunner.run_query`. It does **not**
govern configuration or validation errors, because those are not requests.
Nothing here raises one from `_fetch`: the base wraps whatever `_fetch`
raises in that string, so a missing endpoint would be reported as a failed
request that was never made, with the runner's name in it twice.
Configuration is validated in `__init__` and returned from `run_query`;
params are validated in `run_query` as well, before the transport is
reached. `ntcip_dms.py:163-171` established the same pattern.

**The base's table shaping is overridden, not inherited.**
`BaseResourceRunner.run_query` ends in `connector_base.to_redash_table`,
which derives the column set AND every column's type from record one. A TMDD
response commonly leads with its sparsest device, so inference would drop
`route-designator` and `link-direction` for the whole table, which is the
thing `tmdd_rows`' fixed column set exists to prevent. The tail of the base's
`run_query` is therefore reimplemented below over `to_fixed_table`, the same
way `ntcip_dms.py` does it. `_fetch` still returns `(records, raw)` so the
optional Redis publish keeps getting the center's own response text.
"""

import json

from redash.query_runner import register, tmdd_decode
from redash.query_runner.connector_base import (
    BaseResourceRunner,
    build_configuration_schema,
    serialize_result,
)
from redash.query_runner.connector_tables import to_fixed_table
from redash.query_runner.connector_validation import (
    parse_object_query,
    require_configured,
)
from redash.query_runner.tmdd_config import (
    ALLOWED_PARAMS,
    CONFIGURATION_PROPERTIES,
    DEFAULT_MAX_RECORDS,
    DEFAULT_MAX_RESPONSE_MB,
    DEFAULT_MESSAGE_TYPE_ID,
    DEFAULT_MESSAGE_TYPE_VERSION,
    NOOP_RESOURCE,
    PARAM_DOCS,
    REQUIRED_FIELDS,
    RESOURCE_RETURNS,
    SECRET_FIELDS,
    SUPPORTED_VERSION,
    positive_number,
    validate_params,
)
from redash.query_runner.tmdd_request import build_request, unsigned_byte
from redash.query_runner.tmdd_rows import RESOURCE_COLUMN_TYPES, RESOURCE_COLUMNS
from redash.query_runner.tmdd_transport import apply_record_limits, post_soap

__all__ = ["TMDD", "ALLOWED_PARAMS", "SUPPORTED_VERSION", "validate_params"]

# Every numeric configuration field, with the guard that knows its range and
# the default an empty value falls back to. All four are typed "number" by
# the form, which cannot express a range or a floor, so this table is the
# only thing standing between a mistyped field and a ValueError raised inside
# _fetch, where the base would report it as a request that failed against a
# center it never contacted.
NUMBER_FIELDS = (
    (unsigned_byte, "message_type_id", DEFAULT_MESSAGE_TYPE_ID),
    (unsigned_byte, "message_type_version", DEFAULT_MESSAGE_TYPE_VERSION),
    (positive_number, "max_response_mb", DEFAULT_MAX_RESPONSE_MB),
    (positive_number, "max_records", DEFAULT_MAX_RECORDS),
)


class TMDD(BaseResourceRunner):
    resources = {
        name: {
            "doc_params": [PARAM_DOCS[param] for param in sorted(ALLOWED_PARAMS.get(name, ()))],
            "doc_returns": returns,
            "example": json.dumps({"resource": name}),
        }
        for name, returns in RESOURCE_RETURNS.items()
    }

    noop_query = json.dumps({"resource": NOOP_RESOURCE, "params": {"limit": 1}})

    @classmethod
    def name(cls):
        return "TMDD Center-to-Center"

    @classmethod
    def type(cls):
        return "tmdd"

    @classmethod
    def enabled(cls):
        # Imported here rather than at module scope on purpose. A module
        # level flag answers from whatever was true when this file was first
        # imported and then keeps answering that for the life of the
        # process, which is not a gate. defusedxml rather than the stdlib
        # parser because a TMDD response is XML from an external center.
        try:
            import defusedxml.ElementTree  # noqa: F401
        except ImportError:
            return False
        return True

    @classmethod
    def configuration_schema(cls):
        return build_configuration_schema(
            CONFIGURATION_PROPERTIES,
            required=REQUIRED_FIELDS,
            secret=SECRET_FIELDS,
        )

    def __init__(self, configuration):
        super().__init__(configuration)
        # Computed here and returned from run_query, never raised, for the
        # reason ntcip_dms.py:153-161 gives: a data source saved before a
        # field became required still holds an empty value, and the moment
        # to say so is the moment someone runs a query.
        self.config_error = (
            require_configured(
                self.name(),
                endpoint_url=self.configuration.get("endpoint_url"),
                organization_id=self.configuration.get("organization_id"),
            )
            or self._credential_error()
            or self._version_error()
            or self._number_error()
        )

    def _credential_error(self):
        username = (self.configuration.get("username") or "").strip()
        password = self.configuration.get("password") or ""
        if bool(username) == bool(password):
            return None
        return (
            f"{self.name()}: 'username' and 'password' must be configured together. "
            "The authentication block is optional, but user-id and password are both "
            "mandatory once it is present, so half a credential can only build a request "
            "the center's own schema rejects. Leave both empty for a center that wants none."
        )

    def _version_error(self):
        version = (self.configuration.get("tmdd_version") or SUPPORTED_VERSION).strip()
        if version == SUPPORTED_VERSION:
            return None
        return (
            f"{self.name()}: unsupported TMDD version {version!r}. "
            f"This connector implements v{SUPPORTED_VERSION} only."
        )

    def _number_error(self):
        for check, field, default in NUMBER_FIELDS:
            try:
                check(field, self.configuration.get(field), default)
            except ValueError as e:
                return f"{self.name()}: {e}"
        return None

    def run_query(self, query, user):
        if self.config_error:
            return None, self.config_error

        # Parsed here rather than deferred to the base. Deliberate: the query
        # shape contract belongs to parse_object_query, and reimplementing it
        # to save one json.loads is how this family's runners drifted apart
        # in the first place. The alternative, validating params inside
        # _fetch, would have the base report a validation error as a failed
        # request, which the module docstring rules out.
        config, params, error = parse_object_query(query)
        if error:
            return None, error

        resource = config.get("resource")
        error = validate_params(self.name(), resource, params)
        if error:
            return None, error

        # From here down is the base's run_query, reimplemented over
        # to_fixed_table for the reason the module docstring gives. The
        # unknown-resource wording is the base's, verbatim, because a
        # connector that answers that one differently from its siblings is a
        # second thing for a user to learn.
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

        columns, rows = to_fixed_table(RESOURCE_COLUMNS[resource], RESOURCE_COLUMN_TYPES[resource], records)
        return serialize_result(columns, rows), None

    def _fetch(self, resource, params):
        body = build_request(resource, self.configuration, params)
        raw, text = post_soap(self.configuration, body, self.timeout)
        # Through the module, not `from tmdd_decode import decode`. A
        # from-import binds a local alias that a test patching
        # redash.query_runner.tmdd_decode.decode cannot reach, so the size-cap
        # ordering test would pass while the real decoder ran. And the BYTES,
        # not the text: a center that declares an encoding of its own has to
        # be decoded by the parser reading that declaration, and text handed
        # over here has already been through a decode that cannot be undone.
        records = tmdd_decode.decode(resource, raw)
        return apply_record_limits(resource, records, self.configuration, params), text


# Without this the type is unknown to the registry however complete the
# runner is, and adding the module to settings.default_query_runners only
# imports a file that registers nothing.
register(TMDD)
