"""Every live external share link in one organization, in one response.

The api_keys table is the only place that knows what has been published. A
dashboard's token reaches the API in the dashboard's own detail response and a
visualization's reaches it inside its query's, so answering "what is exposed
right now" without this endpoint means a request per dashboard and a request per
query, and even then it comes back short: query detail withholds visualization
tokens from anyone who is neither the owner nor an admin, and list endpoints
filter archived rows out. An inventory that silently omits rows is worse than no
inventory when the thing being decided is what to revoke.

Read-only on purpose. Revoking still goes through DashboardShareResource and
VisualizationShareResource, so a revoke from the admin console takes the same
permission check and writes the same event as a revoke from the object's own
share dialog. There is no bulk write path here to keep in step with them.
"""

import datetime

from flask_login import current_user, login_required
from sqlalchemy import and_, func, or_

from redash import models
from redash.authentication import current_org
from redash.handlers import routes
from redash.handlers.base import json_response, org_scoped_rule, record_event
from redash.permissions import require_admin
from redash.utils import utcnow

# api_keys.object_type holds the target's table name, while the event log holds
# the singular noun record_public_read was called with. Neither is derivable
# from the other, so the pairing is written down once, here.
SHARE_TYPES = {
    models.Dashboard.__tablename__: "dashboard",
    models.Visualization.__tablename__: "visualization",
}

# How far back reads are counted. Long enough that a monthly report still looks
# used, short enough that a link retired last year does not.
READ_WINDOW = datetime.timedelta(days=30)


def read_boundary(created_at):
    """A key's creation time, floored to the second the event log records in.

    The two sides of that comparison are stored at different precisions.
    ApiKey.created_at is a database timestamp and keeps microseconds, while an
    event's created_at is rebuilt by Event.record from int(time.time()), which
    truncates. So a link minted at 12:00:00.700 and opened at 12:00:00.900 has a
    read stored as 12:00:00.000, which sorts before the key and is dropped.

    Flooring the boundary rather than rounding the event: the whole second a
    link was minted in counts as inside its lifetime. The alternative loses a
    genuine first read, and "never opened" on a link somebody is using right now
    is the reading that gets it revoked.
    """
    return created_at.replace(microsecond=0)


def public_read_filters(event_object_type, boundaries):
    """The conditions that make an events row a genuine read of a live link.

    Four separate rules, each closing a different way the count goes wrong.

    **Server recorded only.** POST /api/events accepts an arbitrary action,
    object_type, object_id and additional_properties from any signed-in user,
    and EventsResource stamps the batch client_submitted=True. Without this rule
    anyone with an account can post view/public/ok rows for a shared object and
    make a link an admin was about to revoke look busy. Explicitly false rather
    than "not true", which is the stance handlers/events.event_provenance takes
    and for its reason: a row carrying no marker is unattributed, and an
    unattributed row must not borrow the credibility of one the server vouches
    for. The cost is that reads recorded before the marker existed are not
    counted.

    **One read per read.** Only rows carrying outcome "ok", which is exactly the
    set handlers/base.record_public_read writes. Opening the /public/dashboards
    URL produces two events, not one: handlers/embed.public_dashboard records the
    page shell loading, and then PublicDashboardPage fetches
    /api/dashboards/public/<token>, which is the request that actually serves the
    dashboard and the one that carries an outcome. Counting both would double
    every open, and would count a shell load whose data fetch was then refused
    because public URLs are disabled.

    **This token's lifetime.** api_keys rows accumulate, so a dashboard revoked
    and shared again has a new row and a new token while the old key's events
    still carry the same org, type and object id. Counting from the current key's
    created_at stops a link minted this morning from inheriting the traffic of
    the one it replaced.
    """
    return [
        models.Event.org_id == current_org.id,
        models.Event.action == "view",
        models.Event.object_type == event_object_type,
        models.Event.additional_properties["public"].astext == "true",
        models.Event.additional_properties[models.CLIENT_SUBMITTED_KEY].astext == "false",
        models.Event.additional_properties["outcome"].astext == "ok",
        or_(
            *[
                # events.object_id is text and api_keys.object_id is not.
                and_(models.Event.object_id == str(object_id), models.Event.created_at >= minted_at)
                for object_id, minted_at in boundaries.items()
            ]
        ),
    ]


def public_reads(event_object_type, boundaries):
    """Last successful read and 30 day read count, keyed by object id.

    `boundaries` maps an object id to the moment its current token was minted.

    Restricted to the ids already known to be shared rather than grouping the
    whole table: events is unbounded and has no index of its own past the
    primary key. The partial index this query is written for is in migration
    a41d2c8f9b07.
    """
    if not boundaries:
        return {}

    since = utcnow() - READ_WINDOW
    rows = (
        models.db.session.query(
            models.Event.object_id,
            func.max(models.Event.created_at),
            func.count().filter(models.Event.created_at >= since),
        )
        .filter(*public_read_filters(event_object_type, boundaries))
        .group_by(models.Event.object_id)
        .all()
    )

    return {int(object_id): (last_read, reads) for object_id, last_read, reads in rows}


def dashboard_targets(org, object_ids):
    """Shared dashboards by id, org scoped so a stray key cannot leak one."""
    if not object_ids:
        return {}

    rows = models.Dashboard.query.filter(
        models.Dashboard.id.in_(object_ids),
        models.Dashboard.org_id == org.id,
    ).all()
    return {dashboard.id: dashboard for dashboard in rows}


def visualization_targets(org, object_ids):
    """Shared visualizations by id, paired with the query that owns them.

    The query comes back too because it carries three things the row needs and
    the visualization does not: the org that scopes this read, the archive flag
    that decides whether the target still exists as far as the product is
    concerned, and the id the console links to.
    """
    if not object_ids:
        return {}

    rows = (
        models.db.session.query(models.Visualization, models.Query)
        .join(models.Query, models.Visualization.query_id == models.Query.id)
        .filter(
            models.Visualization.id.in_(object_ids),
            models.Query.org_id == org.id,
        )
        .all()
    )
    return {visualization.id: (visualization, query) for visualization, query in rows}


def serialize_key(key, name, query_id, target_archived, access):
    """One row. `access` is the (last_read, reads) pair, or None for never read.

    created_by is null for any key minted before the column existed, so the
    console has to render an unknown author rather than assume the field is
    there.
    """
    last_read, reads = access or (None, 0)

    return {
        "type": SHARE_TYPES[key.object_type],
        "object_id": key.object_id,
        "name": name,
        "query_id": query_id,
        "token": key.api_key,
        "created_at": key.created_at,
        "expires_at": key.expires_at,
        "created_by": ({"id": key.created_by.id, "name": key.created_by.name} if key.created_by else None),
        # The key outlived what it points at. resolve_share_token already
        # refuses these, so the row is cleanup rather than exposure, but it is
        # still a live credential and the console says so.
        "target_missing": name is None,
        "target_archived": target_archived,
        "last_accessed_at": last_read,
        "reads_last_30_days": reads,
    }


def visualization_label(visualization, query):
    """What to call a shared visualization in a list of shared things.

    A visualization's own name is routinely blank, or "Table", or whatever the
    editor defaulted to, so a column of them tells an admin nothing about what
    is published. The query name is the recognisable part. The visualization
    name is appended only when it exists, where its job is telling two shares of
    one query apart.

    None when the query is gone, which is what marks the row as pointing at
    nothing.
    """
    if query is None:
        return None

    if not visualization.name:
        return query.name

    return "{}: {}".format(query.name, visualization.name)


# Org scoped, unlike the /api/admin/queries/* routes beside it, because every
# row this returns belongs to one tenant and the slug is how the request says
# which. org_scoped_rule collapses to the bare path when MULTI_ORG is off, which
# is how this deployment runs, so the URL the frontend calls is unchanged.
@routes.route(org_scoped_rule("/api/admin/shared_links"), methods=["GET"])
@login_required
@require_admin
def shared_links(org_slug=None):
    # org_slug is bound by the route and ignored here, the way every org scoped
    # view in this blueprint ignores it: current_org is already resolved from
    # it, and reading the raw slug back would skip that resolution.
    keys = models.ApiKey.query.filter(
        models.ApiKey.org_id == current_org.id,
        models.ApiKey.active.is_(True),
        models.ApiKey.object_type.in_(SHARE_TYPES),
    ).all()

    # One active key per object is a database rule (api_keys_one_active_key_per
    # _object), so a dict rather than a list loses nothing.
    minted_at = {object_type: {} for object_type in SHARE_TYPES}
    for key in keys:
        minted_at[key.object_type][key.object_id] = read_boundary(key.created_at)

    dashboards = dashboard_targets(current_org, list(minted_at[models.Dashboard.__tablename__]))
    visualizations = visualization_targets(
        current_org, list(minted_at[models.Visualization.__tablename__])
    )
    reads = {
        object_type: public_reads(SHARE_TYPES[object_type], boundaries)
        for object_type, boundaries in minted_at.items()
    }

    rows = []
    for key in keys:
        access = reads[key.object_type].get(key.object_id)

        if key.object_type == models.Dashboard.__tablename__:
            dashboard = dashboards.get(key.object_id)
            rows.append(
                serialize_key(
                    key,
                    dashboard.name if dashboard else None,
                    None,
                    bool(dashboard and dashboard.is_archived),
                    access,
                )
            )
            continue

        target = visualizations.get(key.object_id)
        visualization, query = target if target else (None, None)
        rows.append(
            serialize_key(
                key,
                visualization_label(visualization, query),
                query.id if query else None,
                bool(query and query.is_archived),
                access,
            )
        )

    rows.sort(key=lambda row: row["created_at"], reverse=True)

    record_event(
        current_org,
        current_user._get_current_object(),
        {"action": "list", "object_type": "shared_links"},
    )

    return json_response(
        {
            "shared_links": rows,
            # Every link below is dead while this is on, whatever its own status
            # says, and it is an org setting rather than anything the console can
            # read off a key. See PublicDashboardResource.
            "public_urls_disabled": bool(current_org.get_setting("disable_public_urls")),
        }
    )
