import geolite2
import maxminddb
from flask import request
from flask_restful import abort
from user_agents import parse as parse_ua

from redash.handlers.base import BaseResource, paginate
from redash.models import CLIENT_SUBMITTED_KEY
from redash.permissions import require_admin

# Actions this product records for itself when a privilege changes hands:
# "change_permissions" from handlers/groups.py, the api_key pair from
# handlers/dashboards.py and handlers/visualizations.py. Nothing in
# client/app/services/recordEvent.js posts any of them, so refusing them on the
# client route costs the product nothing and removes the highest-value forgery
# outright, rather than leaving it to whoever reads the trail to notice.
SERVER_ONLY_ACTIONS = frozenset(
    {
        "change_permissions",
        "activate_api_key",
        "deactivate_api_key",
    }
)


def event_provenance(event):
    """Who wrote this row: the client (True), the server (False), or unknown.

    CLIENT_SUBMITTED_KEY (see redash.models) is stamped True on everything that
    arrives through POST /api/events and False on every server-side write. Where
    that matters most is the public-read events
    (handlers/base.record_public_read): they are action "view" on a dashboard or
    a visualization, which is also an ordinary client page view, so nothing in
    the action and object_type separates them.

    None is returned for anything else, which is the honest answer for two kinds
    of row. Every event written before the stamp existed carries no marker at
    all. And a legacy row can carry ANY value under this key, because whatever
    the browser posted used to land in additional_properties verbatim, so a
    value that is not one of the two booleans the server writes is not
    provenance either. Neither is ever reported as server recorded, which is the
    direction that matters: an unknown row must not borrow the credibility of
    one the server vouches for.
    """
    marker = (event.additional_properties or {}).get(CLIENT_SUBMITTED_KEY)

    if marker is True or marker is False:
        return marker

    return None


def get_location(ip):
    if ip is None:
        return "Unknown"

    with maxminddb.open_database(geolite2.geolite2_database()) as reader:
        try:
            match = reader.get(ip)
            return match["country"]["names"]["en"]
        except Exception:
            return "Unknown"


def event_details(event):
    details = {}
    if event.object_type == "data_source" and event.action == "execute_query":
        details["query"] = event.additional_properties["query"]
        details["data_source"] = event.object_id
    elif event.object_type == "page" and event.action == "view":
        details["page"] = event.object_id
    else:
        details["object_id"] = event.object_id
        details["object_type"] = event.object_type

    return details


def serialize_event(event):
    d = {
        "org_id": event.org_id,
        "user_id": event.user_id,
        "action": event.action,
        "object_type": event.object_type,
        "object_id": event.object_id,
        "created_at": event.created_at,
        # Surfaced next to the event rather than left buried in
        # additional_properties, which this serializer does not return at all.
        # A marker a reader cannot see is not a marker. Null means unknown and
        # has to reach the reader as null rather than as either boolean.
        CLIENT_SUBMITTED_KEY: event_provenance(event),
    }

    if event.user_id:
        d["user_name"] = event.additional_properties.get("user_name", "User {}".format(event.user_id))

    if not event.user_id:
        d["user_name"] = event.additional_properties.get("api_key", "Unknown")

    d["browser"] = str(parse_ua(event.additional_properties.get("user_agent", "")))
    d["location"] = get_location(event.additional_properties.get("ip"))
    d["details"] = event_details(event)

    return d


class EventsResource(BaseResource):
    def post(self):
        """Record the events the browser batches up, without trusting them.

        Deliberately left open to any authenticated user, as upstream has it:
        client/app/services/recordEvent.js posts here on every page view, so a
        permission decorator would end the product's own analytics. What is not
        left open is writing a row an auditor would read as the server's own.

        The whole batch is validated before any of it is recorded. Recording as
        we go would let a forged action ride in behind a legitimate page view
        and still be stored before the request failed.

        Not attempted here: rate limiting. A per-request cap on batch size does
        not stop anyone from burying a real entry under a loop of small
        requests, so it would buy a new way to break a legitimate burst of page
        views and no actual protection. Throttling this route belongs with the
        other limiter.limit decorators or at the ingress, as a separate
        decision.
        """
        events_list = request.get_json(force=True)

        if not isinstance(events_list, list) or not all(isinstance(event, dict) for event in events_list):
            abort(400, message="Expected a list of events.")

        if any(event.get("action") in SERVER_ONLY_ACTIONS for event in events_list):
            abort(400, message="Can't record a server-generated action.")

        for event in events_list:
            # Plain assignment, so a submitted value for this key is discarded
            # rather than merged. Claiming the server wrote your event is the
            # thing the marker exists to prevent.
            event[CLIENT_SUBMITTED_KEY] = True
            self.record_event(event)

    @require_admin
    def get(self):
        page = request.args.get("page", 1, type=int)
        page_size = request.args.get("page_size", 25, type=int)
        return paginate(self.current_org.events, page, page_size, serialize_event)
