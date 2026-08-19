"""The two group decisions compose/seed-redash.py makes, and nothing else.

Split out of that script for two reasons. It has to stay under this repo's
file-size limit, and more usefully, `seed-redash.py` cannot be imported by a
test: the hyphen in its name is not a Python identifier, and importing it runs
module-level environment reads meant for a container. Everything here is pure
and importable, which is what lets compose/seed_redash_test.py drive the
refusal logic with plain strings and no database.

The whole `compose/` directory is bind-mounted into the bootstrap container at
/opt/veodyn (see compose.yaml), and sys.path[0] is that directory when the
seeder runs, so this module is importable there with no path handling.
"""

from __future__ import annotations

# Exactly what veodyn-api's service key exercises, and nothing else. Sorted, because
# compose/verify-seed.py compares the account's effective permissions against this same
# list and an ordering difference there would be a false failure.
#
# Derived by reading the call sites rather than by picking plausible-looking strings:
#
#   view_query         GET /api/queries, GET /api/queries/<id>, and it satisfies the
#                      any-of on both result endpoints
#   create_query       POST /api/queries, the feed probe in services/capture_alert.py
#   execute_query      POST /api/queries/<id>/results, the KPI runner
#   list_data_sources  GET /api/data_sources, the AI grounding labels
#   list_dashboards    GET /api/dashboards/<id>, also AI grounding
#
# Alert create, update and delete need no group permission at all: those handlers gate on
# require_access to the query's data source and on owning the alert. Archiving a query is
# the same, require_admin_or_owner. So edit_query is not needed either, because
# POST /api/queries/<id> is never called.
SERVICE_GROUP_PERMISSIONS = sorted(
    [
        "create_query",
        "execute_query",
        "list_dashboards",
        "list_data_sources",
        "view_query",
    ]
)


def group_refusal(match_types: list[str], name: str, builtin_type: str) -> str | None:
    """Why the named group must not be written to, or None if it may be.

    Pure, taking the matched rows' `type` column rather than the rows, so
    compose/seed_redash_test.py can drive it with plain strings and no database.

    Two refusals, and both were reachable with a supported configuration:

    - A BUILTIN group. ensure_service_group's reset replaces the whole list, so
      VEODYN_SERVICE_GROUP=admin made an ordinary `docker compose up` overwrite
      the builtin admin group's permissions with the service account's five,
      taking admin away from the organisation. VEODYN_SERVICE_GROUP=default did
      the same to the group every new user and data source lands in.
    - An AMBIGUOUS name. groups.name has no unique constraint and
      POST /api/groups accepts a name that already exists, so two groups can
      share one and .first() picked whichever was inserted first. Rewriting an
      arbitrary group's permissions is worse than not seeding, so it stops.
    """
    if len(match_types) > 1:
        return (
            f"{len(match_types)} groups in this organisation are named {name!r}. Group names are "
            "not unique in Redash, so there is no way to tell which one VEODYN_SERVICE_GROUP "
            "meant, and this step rewrites the group's whole permission list. Rename or delete "
            "the duplicates, or set VEODYN_SERVICE_GROUP to a name that is free, then seed again."
        )
    if match_types and match_types[0] == builtin_type:
        return (
            f"the group named {name!r} is one of Redash's BUILTIN groups. This step would replace "
            "its permissions with the service account's five, which on the admin group leaves the "
            "organisation with nobody able to administer it and on the default group strips every "
            "ordinary user. Set VEODYN_SERVICE_GROUP to a name of its own (the default is "
            "veodyn-service) and seed again."
        )
    return None
