import datetime
import hashlib
import time
from inspect import isclass

from dateutil.parser import isoparse
from flask import Blueprint, current_app, request
from flask_login import current_user, login_required
from flask_restful import Resource, abort
from sqlalchemy import cast
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm.exc import NoResultFound

from redash import settings
from redash.authentication import current_org
from redash.models import CLIENT_SUBMITTED_KEY, db
from redash.tasks import record_event as record_event_task
from redash.utils import json_dumps, utcnow
from redash.utils.query_order import sort_query

routes = Blueprint("redash", __name__, template_folder=settings.fix_assets_path("templates"))


class BaseResource(Resource):
    decorators = [login_required]

    def __init__(self, *args, **kwargs):
        super(BaseResource, self).__init__(*args, **kwargs)
        self._user = None

    def dispatch_request(self, *args, **kwargs):
        kwargs.pop("org_slug", None)

        return super(BaseResource, self).dispatch_request(*args, **kwargs)

    @property
    def current_user(self):
        return current_user._get_current_object()

    @property
    def current_org(self):
        return current_org._get_current_object()

    def record_event(self, options):
        record_event(self.current_org, self.current_user, options)

    # TODO: this should probably be somewhere else
    def update_model(self, model, updates):
        for k, v in updates.items():
            setattr(model, k, v)


def record_event(org, user, options):
    if user.is_api_user():
        options.update({"api_key": user.name, "org_id": org.id})
    else:
        options.update({"user_id": user.id, "user_name": user.name, "org_id": org.id})

    options.update({"user_agent": request.user_agent.string, "ip": request.remote_addr})

    if "timestamp" not in options:
        options["timestamp"] = int(time.time())

    # setdefault rather than assignment, because one caller is not a server
    # write: EventsResource.post stamps the batch the browser sent as client
    # submitted and then hands each event here, and that claim has to survive.
    # Every other caller (BaseResource.record_event and so every handler,
    # record_public_read below, handlers/embed.py, handlers/query_results.py,
    # handlers/admin.py) builds its options dict in server code, where the key
    # never appears, so they all take the stamp. The one writer that does not
    # pass through here at all is authentication.log_user_logged_in, which
    # enqueues the task directly and stamps itself.
    options.setdefault(CLIENT_SUBMITTED_KEY, False)

    record_event_task.delay(options)


def token_fingerprint(token):
    """Return the sha256 hex digest of a share token.

    Public read events are the audit trail for links that leave the product, so
    they get grouped by token. Storing the token itself would turn the events
    table into a list of working credentials, so only the digest is recorded.
    """
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def record_public_read(org, user, object_type, object_id, outcome, token):
    """Record an anonymous read of a public link, including a refused one.

    Redash is reachable on its own ingress, so this event is the only record
    that a public read happened, not a backstop behind the frontend. Every
    refusal answers an identical 404, which makes the outcome recorded here the
    one place the reason survives.
    """
    record_event(
        org,
        user,
        {
            "action": "view",
            "object_type": object_type,
            "object_id": object_id,
            "public": True,
            "outcome": outcome,
            "token_fingerprint": token_fingerprint(token),
            "referer": request.headers.get("Referer"),
        },
    )


def parse_expires_at(body):
    """Read an optional ISO 8601 'expires_at' out of a request body.

    Absent or null means the link never expires, which is the behavior every
    link minted before this existed already has.
    """
    value = (body or {}).get("expires_at")

    if value is None:
        return None

    try:
        expires_at = isoparse(value)
    except (TypeError, ValueError):
        abort(400, message="expires_at must be an ISO 8601 timestamp.")

    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)

    if expires_at <= utcnow():
        abort(400, message="expires_at must be in the future.")

    return expires_at


def require_fields(req, fields):
    for f in fields:
        if f not in req:
            abort(400)


def get_object_or_404(fn, *args, **kwargs):
    try:
        rv = fn(*args, **kwargs)
        if rv is None:
            abort(404)
    except NoResultFound:
        abort(404)
    return rv


def paginate(query_set, page, page_size, serializer, **kwargs):
    count = query_set.count()

    if page < 1:
        abort(400, message="Page must be positive integer.")

    if (page - 1) * page_size + 1 > count > 0:
        abort(400, message="Page is out of range.")

    if page_size > 250 or page_size < 1:
        abort(400, message="Page size is out of range (1-250).")

    results = query_set.paginate(page, page_size)

    # support for old function based serializers
    if isclass(serializer):
        items = serializer(results.items, **kwargs).serialize()
    else:
        items = [serializer(result) for result in results.items]

    return {"count": count, "page": page, "page_size": page_size, "results": items}


def org_scoped_rule(rule):
    if settings.MULTI_ORG:
        return "/<org_slug>{}".format(rule)

    return rule


def json_response(response):
    return current_app.response_class(json_dumps(response), mimetype="application/json")


def filter_by_tags(result_set, column):
    if request.args.getlist("tags"):
        tags = request.args.getlist("tags")
        result_set = result_set.filter(cast(column, ARRAY(db.Text)).contains(tags))
    return result_set


def order_results(results, default_order, allowed_orders, fallback=True):
    """
    Orders the given results with the sort order as requested in the
    "order" request query parameter or the given default order.
    """
    # See if a particular order has been requested
    requested_order = request.args.get("order", "").strip()

    # and if not (and no fallback is wanted) return results as is
    if not requested_order and not fallback:
        return results

    # and if it matches a long-form for related fields, falling
    # back to the default order
    selected_order = allowed_orders.get(requested_order, None)
    if selected_order is None and fallback:
        selected_order = default_order
    # The query may already have an ORDER BY statement attached
    # so we clear it here and apply the selected order
    return sort_query(results.order_by(None), selected_order)
