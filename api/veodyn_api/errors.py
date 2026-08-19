import logging
from enum import StrEnum
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class ErrorId(StrEnum):
    """Stable, greppable causes. Mirrors the frontend's ErrorIds convention.

    Never renumber or reuse an id: they end up in logs and in support threads.
    """

    UNAUTHENTICATED = "VEODYN_UNAUTHENTICATED"
    FORBIDDEN = "VEODYN_FORBIDDEN"
    INVALID_REQUEST = "VEODYN_INVALID_REQUEST"
    # Nothing handled it. Its own cause so a log reader can tell "this service
    # broke" apart from any of the deliberate refusals below.
    INTERNAL_ERROR = "VEODYN_INTERNAL_ERROR"
    KPI_NOT_FOUND = "VEODYN_KPI_NOT_FOUND"
    KPI_SLUG_TAKEN = "VEODYN_KPI_SLUG_TAKEN"
    KPI_SOURCE_UNRESOLVABLE = "VEODYN_KPI_SOURCE_UNRESOLVABLE"
    KPI_SOURCE_NOT_SUPPORTED = "VEODYN_KPI_SOURCE_NOT_SUPPORTED"
    # The source query returns more than one row, so the latest-row rule would
    # report one arbitrary row of a breakdown as the whole metric. Its own cause
    # rather than a reuse of KPI_SOURCE_NOT_SUPPORTED: that one means "this
    # source can never work", while this is a query that works perfectly and
    # answers a different question than the KPI claims to.
    KPI_SOURCE_NOT_SCALAR = "VEODYN_KPI_SOURCE_NOT_SCALAR"
    KPI_THRESHOLDS_INCONSISTENT = "VEODYN_KPI_THRESHOLDS_INCONSISTENT"
    KPI_VALUE_COLUMN_MISSING = "VEODYN_KPI_VALUE_COLUMN_MISSING"
    KPI_VALUE_NOT_NUMERIC = "VEODYN_KPI_VALUE_NOT_NUMERIC"
    KPI_RESULT_EMPTY = "VEODYN_KPI_RESULT_EMPTY"
    KPI_EVALUATION_TIMED_OUT = "VEODYN_KPI_EVALUATION_TIMED_OUT"
    # The KPI wrote, or failed to write, its derived Redash alert. Its own cause
    # rather than a reuse of QUERY_EXECUTION_FAILED: the query is fine, the
    # alert write is not, and the two need different fixes.
    KPI_ALERT_SYNC_FAILED = "VEODYN_KPI_ALERT_SYNC_FAILED"
    REPORT_NOT_FOUND = "VEODYN_REPORT_NOT_FOUND"
    REPORT_ID_TAKEN = "VEODYN_REPORT_ID_TAKEN"
    # The document is in review, so authoring is closed until it comes back out.
    REPORT_EDIT_LOCKED = "VEODYN_REPORT_EDIT_LOCKED"
    # The write was built from a document that has since moved. Distinct from a
    # refusal, because the caller's fix is to re-read and retry rather than to
    # change what they asked for.
    REPORT_REVISION_STALE = "VEODYN_REPORT_REVISION_STALE"
    # A governance rule said no: four-eyes, a missing approval, an unsourced
    # number, a rejection with no note.
    REPORT_TRANSITION_REFUSED = "VEODYN_REPORT_TRANSITION_REFUSED"
    # A block naming a query had nothing to freeze, so the snapshot was not
    # taken at all. Distinct from a failed execution (that is
    # QUERY_EXECUTION_FAILED): the query answered, and its answer was not a
    # result. Either way the stamp is what a partial freeze would corrupt, so
    # nothing is written.
    REPORT_SNAPSHOT_INCOMPLETE = "VEODYN_REPORT_SNAPSHOT_INCOMPLETE"
    # The catalog registry does not list this table, so there is nothing to
    # hang a tag on. A dataset has no row in this database at all: its id is a
    # ClickHouse registry table name, which is why this is its own cause rather
    # than a reuse of one of the *_NOT_FOUND ids above.
    DATASET_NOT_FOUND = "VEODYN_DATASET_NOT_FOUND"
    # The URL named a kind this build does not have, or has but does not tag or
    # star. A 404 rather than a 422, and deliberately the same answer as "no
    # such object": which kinds exist depends on what is installed, and an
    # enumeration in the refusal would tell an unauthenticated caller which
    # packs a deployment is running.
    UNKNOWN_OBJECT_TYPE = "VEODYN_UNKNOWN_OBJECT_TYPE"
    # An expected interval was refused. Its own cause rather than
    # INVALID_REQUEST so a caller can tell "you sent a nonsense interval" from
    # "you sent a nonsense body": the first is a number to correct in a field
    # the user is looking at, the second is a bug in the client.
    FEED_INTERVAL_INVALID = "VEODYN_FEED_INTERVAL_INVALID"
    # The feed's staleness probe or its derived alert would not write. Its own
    # cause rather than a reuse of KPI_ALERT_SYNC_FAILED: the two derive from
    # different objects and a person reading a log needs to know which board to
    # look at.
    FEED_ALERT_SYNC_FAILED = "VEODYN_FEED_ALERT_SYNC_FAILED"
    # Nothing to watch: the feed has no capture query, so there is no data
    # source to author the probe against.
    FEED_NOT_WATCHABLE = "VEODYN_FEED_NOT_WATCHABLE"
    # A tag was refused for starting with `domain:`. Named rather than dropped:
    # domain membership is a real feature driven by those tags, and a person who
    # types one, sees it vanish and concludes tagging is broken is worse served
    # than one who is told the prefix is taken.
    TAG_PREFIX_RESERVED = "VEODYN_TAG_PREFIX_RESERVED"
    # One label was longer than the column's bound allows. Its own cause rather
    # than INVALID_REQUEST because every refusal the tag endpoint makes answers
    # 422, so the status cannot tell these apart and a caller branching on it
    # showed "that prefix is reserved" to somebody who had simply typed too
    # much. Separate from TOO_MANY_TAGS as well: one says shorten this label,
    # the other says remove one, and they are not the same instruction.
    TAG_TOO_LONG = "VEODYN_TAG_TOO_LONG"
    # More labels on one object than the cap allows.
    TOO_MANY_TAGS = "VEODYN_TOO_MANY_TAGS"
    QUERY_EXECUTION_FAILED = "VEODYN_QUERY_EXECUTION_FAILED"
    REDASH_UNREACHABLE = "VEODYN_REDASH_UNREACHABLE"
    WAREHOUSE_UNREACHABLE = "VEODYN_WAREHOUSE_UNREACHABLE"
    WAREHOUSE_NOT_CONFIGURED = "VEODYN_WAREHOUSE_NOT_CONFIGURED"
    AI_NOT_CONFIGURED = "VEODYN_AI_NOT_CONFIGURED"
    AI_PROVIDER_FAILED = "VEODYN_AI_PROVIDER_FAILED"
    # The model answered, and the answer named something that does not exist:
    # a query id outside the grounding set, SQL over a table nobody asked
    # about. Distinct from a provider failure because the fault is the
    # generation, not the transport, and only this one is worth a retry.
    AI_UNGROUNDED = "VEODYN_AI_UNGROUNDED"
    # The REQUEST named something no SQL statement can read: a dataset whose
    # "table" is a documentation heading rather than a table. Separate from
    # AI_UNGROUNDED because nothing was generated and nothing is worth
    # retrying, and separate from a provider failure because the provider was
    # never called.
    AI_DATASET_NOT_QUERYABLE = "VEODYN_AI_DATASET_NOT_QUERYABLE"
    # Appended, never inserted: these ids reach logs and support threads, so
    # their spelling is the contract and the enum's order is not.
    PUBLISHED_FEED_NOT_FOUND = "VEODYN_PUBLISHED_FEED_NOT_FOUND"
    # The slug is the feed's public URL path as well as half its key, so a
    # second binding on it is a collision over an address rather than a
    # malformed request.
    PUBLISHED_FEED_SLUG_TAKEN = "VEODYN_PUBLISHED_FEED_SLUG_TAKEN"
    # The column map cannot produce this entity. Its own cause rather than
    # INVALID_REQUEST, because the frontend renders the per-field problems and
    # INVALID_REQUEST already carries pydantic's own message shape.
    PUBLISHED_FEED_BINDING_INVALID = "VEODYN_PUBLISHED_FEED_BINDING_INVALID"
    # The binding names a query this service cannot read: no such query, or one
    # the service credential has no permission on. Its own cause rather than
    # BINDING_INVALID, because the column map may be perfect and the instruction
    # to the operator is different ("fix the query id" against "fix the map").
    # Not KPI_SOURCE_UNRESOLVABLE either: that one is the KPI source gate's, and
    # a caller branching on it would show a KPI message on a feed screen.
    PUBLISHED_FEED_QUERY_UNREADABLE = "VEODYN_PUBLISHED_FEED_QUERY_UNREADABLE"
    # The bound query has never run, so its result cache holds nothing yet.
    # Refused before an attempt is recorded: there were no rows to judge, which
    # is not the same fact as an attempt that judged some rows and failed.
    PUBLISHED_FEED_NO_RESULT = "VEODYN_PUBLISHED_FEED_NO_RESULT"
    # `routers/public_feeds.py`'s one refusal for an unknown slug, a private
    # feed, and a feed that has never published a clean attempt. Its own cause
    # rather than a reuse of PUBLISHED_FEED_NOT_FOUND, because that one is an
    # authenticated 404 whose message may say more: the anonymous route is the
    # one place in this service where the three causes are deliberately
    # indistinguishable, and giving it PUBLISHED_FEED_NOT_FOUND's id would tempt
    # a future edit into giving it that id's message too.
    PUBLIC_FEED_NOT_FOUND = "VEODYN_PUBLIC_FEED_NOT_FOUND"
    # A public feed's address has no org segment, so `public` slugs are unique
    # across every org, not just within one. Distinct from
    # PUBLISHED_FEED_SLUG_TAKEN, which reports the per-org primary key: this one
    # is refused by a name that is not visible to the caller and not theirs to
    # free, so the message has to say the address is taken without saying who
    # holds it.
    PUBLISHED_FEED_PUBLIC_ADDRESS_TAKEN = "VEODYN_PUBLISHED_FEED_PUBLIC_ADDRESS_TAKEN"
    # `last_good` mode, past the cap. Distinct from PUBLIC_FEED_NOT_FOUND
    # because it is the opposite claim: the feed exists, is public, and has
    # published: what it does not have is anything fresh enough to serve. It
    # rides a 503 rather than a 404 for the same reason, so a consumer can tell
    # "come back" from "there is nothing here".
    PUBLIC_FEED_TOO_STALE = "VEODYN_PUBLIC_FEED_TOO_STALE"
    # Redash has no single ClickHouse data source, so a query generated against
    # the historical warehouse has nothing to run on. Its own cause rather than
    # the binding gates' (FEED_NOT_WATCHABLE, KPI_SOURCE_UNRESOLVABLE): those
    # tell the author to pick a different feed, and here no feed on the instance
    # would work, so the fix is the deployment's rather than theirs.
    WAREHOUSE_SOURCE_UNRESOLVABLE = "VEODYN_WAREHOUSE_SOURCE_UNRESOLVABLE"


class ApiError(Exception):
    def __init__(self, error_id: ErrorId, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.error_id = error_id
        self.message = message
        self.status_code = status_code


def _envelope(error_id: ErrorId, message: str, status_code: int) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": {"id": error_id.value, "message": message}})


def _actor_id(request: Request) -> int | None:
    """Best effort. These handlers run outside the dependency graph, so there is
    no resolved Identity to inject; routers that have one stash it on
    request.state, and an unattributed event is better than none."""
    identity = getattr(request.state, "identity", None)
    user_id = getattr(identity, "user_id", None)
    return user_id if isinstance(user_id, int) else None


def register_error_handlers(app: FastAPI) -> None:
    # Imported here rather than at module scope: telemetry imports ApiError from
    # this module, and a top-level import would close the cycle.
    from veodyn_api.telemetry import capture_api_error

    @app.exception_handler(ApiError)
    def handle_api_error(request: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, ApiError)
        # 4xx is a deliberate refusal and not worth an event. 5xx means this
        # service could not do its job, which is.
        if exc.status_code >= 500:
            capture_api_error(_actor_id(request), exc, {"route": request.url.path})
        return _envelope(exc.error_id, exc.message, exc.status_code)

    @app.exception_handler(Exception)
    def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        # Nothing above handled it, so this is a bug in the service. Before this
        # handler existed such a failure went to stdout and nowhere else, which
        # is why an unhandled 500 was invisible to everyone but whoever happened
        # to be tailing the pod.
        capture_api_error(_actor_id(request), exc, {"route": request.url.path})
        logger.exception("unhandled error on %s", request.url.path)
        return _envelope(ErrorId.INTERNAL_ERROR, "internal error", 500)

    @app.exception_handler(RequestValidationError)
    def handle_validation_error(_: Request, exc: Exception) -> JSONResponse:
        # One envelope for every failure the caller sees, so the frontend has a
        # single shape to parse rather than FastAPI's default detail list.
        assert isinstance(exc, RequestValidationError)
        detail: Any = exc.errors()
        first = detail[0] if detail else {}
        location = ".".join(str(part) for part in first.get("loc", ()))
        message = f"{location}: {first.get('msg', 'invalid request')}" if location else "invalid request"
        return _envelope(ErrorId.INVALID_REQUEST, message, 422)
