#!/usr/bin/env python3
"""Bring an empty Redash database up to a usable instance, without a browser.

Three things happen here, in this order, and each is idempotent so that a
second `docker compose up` is a no-op rather than a failure:

1. The schema. `manage.py database create_tables` is the fork's own entry
   point (bin/docker-entrypoint exposes it as `create_db`, node/Makefile calls
   it as `make create_database`). It creates the tables and stamps the Alembic
   revision, and it checks for itself that the database is empty first, so
   running it against a seeded database does nothing.

2. An admin and a service account. `users create_root` creates the default
   organization, its builtin admin and default groups, and the first user, all
   of which the web setup page would otherwise be responsible for.

   The service account lands in a dedicated group holding only the permissions
   veodyn-api actually uses, listed in SERVICE_GROUP_PERMISSIONS below. Not the
   builtin default group: that one carries create_dashboard, edit_dashboard,
   edit_query, list_users, list_alerts, schedule_query and view_source as well,
   none of which the service key ever exercises, so a leaked key could rewrite
   dashboards and enumerate users. "Not an admin", which is what
   docs/docs/operations/deployment.md step 5 asks for, was never the whole bar.

   Data source access in Redash is separate from group permissions: it is a
   data_source_groups row, and upstream attaches a new data source to the
   default group and nothing else. So moving the account out of the default
   group would silently cost it every data source, and query execution would
   start answering 403. Two things close that. This script attaches the group
   to the data sources that already exist, and REDASH_ADDITIONAL_DATA_SOURCE_GROUPS
   (set for every Redash service in compose.yaml) makes the fork attach it to
   each new one at creation, so an operator adding a data source later does not
   have to remember a step in the groups UI.

3. The two API keys the rest of the stack runs on. Redash generates a user's
   api_key when the row is created and exposes no CLI to print it, so this is
   the one place that reads the column directly.

   Each key goes into its own volume, not into one shared volume with a file
   per consumer. That distinction is the whole point: with a shared volume,
   "one file per consumer" describes the filenames and nothing else, because
   every service mounted the whole volume and every service runs as root, so
   the frontend could read the service account's key and vice versa. Each
   serving container now mounts only its own volume, read-only. compose.yaml's
   volume section says which, and what the boundary does not cover.

Nothing here is ever written to disk in the repository, and no credential in
this file is a literal: the passwords are generated per install.
"""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
from pathlib import Path

# Sibling module, importable because compose/ is mounted whole and is sys.path[0]
# when this runs. It holds the pure decisions so they can be tested without a
# database; see its docstring for why this file cannot be imported directly.
from seed_redash_groups import SERVICE_GROUP_PERMISSIONS, group_refusal

APP_DIR = "/app"
MANAGE = f"{APP_DIR}/manage.py"
SECRETS_DIR = Path(os.environ.get("VEODYN_SECRETS_DIR", "/run/veodyn"))
# One subdirectory per consumer, each a separate volume. This container is one of the
# two that mount all of them; nothing that serves a request mounts more than one.
FRONTEND_SECRETS_DIR = SECRETS_DIR / "frontend"
SERVICE_SECRETS_DIR = SECRETS_DIR / "service"

# This script is bind-mounted outside the image's WORKDIR, so sys.path[0] is
# the mount directory and not /app; without this the `redash` package is not
# importable even though the container is built around it.
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

ADMIN_EMAIL = os.environ.get("VEODYN_ADMIN_EMAIL", "admin@example.com")
ADMIN_NAME = os.environ.get("VEODYN_ADMIN_NAME", "Veodyn Admin")
SERVICE_EMAIL = os.environ.get("VEODYN_SERVICE_EMAIL", "kpi-service@example.com")
SERVICE_NAME = os.environ.get("VEODYN_SERVICE_NAME", "KPI Service Account")
SERVICE_GROUP = os.environ.get("VEODYN_SERVICE_GROUP", "veodyn-service")
APP_URL = os.environ.get("VEODYN_APP_URL", "http://localhost:3000")



def manage(*args: str) -> None:
    """Run a fork CLI command, failing loudly, with the password kept out of the log."""
    printable: list[str] = []
    redact_next = False
    for arg in args:
        if redact_next:
            printable.append("***")
            redact_next = False
            continue
        printable.append(arg)
        redact_next = arg == "--password"
    print(f"seed-redash: manage.py {' '.join(printable)}", flush=True)
    subprocess.run([MANAGE, *args], check=True)


def new_password() -> str:
    return secrets.token_urlsafe(18)


def write_secret_file(directory: Path, name: str, body: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(body)
    path.chmod(0o600)
    return path


def ensure_service_group(models, org):
    """Create the dedicated group, or correct its permissions if it drifted.

    Idempotent, and it repairs as well as creates: a stack seeded before this group
    existed, or one whose group was widened by hand in the UI, is brought back to
    SERVICE_GROUP_PERMISSIONS on the next `docker compose up`.

    Refuses outright rather than guessing; see group_refusal in
    compose/seed_redash_groups.py for the two cases and why neither is a thing to
    resolve silently.
    """
    matches = models.Group.query.filter(
        models.Group.org == org,
        models.Group.name == SERVICE_GROUP,
    ).all()
    refusal = group_refusal([match.type for match in matches], SERVICE_GROUP, models.Group.BUILTIN_GROUP)
    if refusal is not None:
        raise SystemExit(f"seed-redash: refusing to seed, {refusal}")
    group = matches[0] if matches else None
    if group is None:
        group = models.Group(
            name=SERVICE_GROUP,
            org=org,
            # Explicitly regular. A builtin group would collide with the name+type
            # lookups behind Organization.default_group and admin_group.
            type=models.Group.REGULAR_GROUP,
            # Passed explicitly because the column defaults to Group.DEFAULT_PERMISSIONS,
            # which is the whole point of this group not being the default one.
            permissions=list(SERVICE_GROUP_PERMISSIONS),
        )
        models.db.session.add(group)
        print(f"seed-redash: created group {SERVICE_GROUP}", flush=True)
    elif sorted(group.permissions or []) != SERVICE_GROUP_PERMISSIONS:
        # Rebound rather than mutated in place: permissions is a plain postgres ARRAY
        # with no mutation tracking, so an .append() is not flushed.
        group.permissions = list(SERVICE_GROUP_PERMISSIONS)
        models.db.session.add(group)
        print(f"seed-redash: reset {SERVICE_GROUP} to its expected permissions", flush=True)
    models.db.session.commit()
    return group


def bind_to_service_group(models, service, group) -> None:
    """Put the service account in that group and no other."""
    if list(service.group_ids or []) == [group.id]:
        return
    # group_ids is the same untracked ARRAY, so rebind here too.
    service.group_ids = [group.id]
    models.db.session.add(service)
    models.db.session.commit()
    print(f"seed-redash: moved {SERVICE_EMAIL} into {SERVICE_GROUP} only", flush=True)


def attach_to_data_sources(models, org, group) -> None:
    """Give the group access to data sources that already exist.

    New ones are handled by the fork at creation time, through
    REDASH_ADDITIONAL_DATA_SOURCE_GROUPS. This covers the ones created before that was
    configured, and it is why a stack seeded by an older version of this script recovers
    on the next boot rather than losing query execution.

    view_only is left at its default of False on purpose: POST /api/queries checks for
    non-view-only access, so a view-only row would still break the feed probe.
    """
    attached = 0
    for data_source in models.DataSource.query.filter(models.DataSource.org == org):
        if group.id not in data_source.groups:
            data_source.add_group(group)
            attached += 1
    if attached:
        models.db.session.commit()
        print(f"seed-redash: attached {SERVICE_GROUP} to {attached} existing data source(s)", flush=True)


def announce(admin_password: str) -> None:
    """Print the generated sign-in once, because nothing else can.

    A password nobody is told is a stack nobody can log into. It goes to this
    one-shot container's log rather than into any file in the repository, and
    it is only generated at all when VEODYN_ADMIN_PASSWORD was not supplied.
    """
    line = "=" * 70
    print(f"\n{line}\n  Veodyn is seeded. Sign in at {APP_URL}\n")
    print(f"    email:    {ADMIN_EMAIL}")
    print(f"    password: {admin_password}\n")
    print("  Generated on first boot and shown only here. Set VEODYN_ADMIN_PASSWORD")
    print(f"  before the first `docker compose up` to choose your own.\n{line}\n", flush=True)


def main() -> int:
    SECRETS_DIR.mkdir(parents=True, exist_ok=True)

    manage("database", "create_tables")

    # Imported after the schema exists; importing the app does not touch the
    # database, but there is no reason for the ordering to be subtle.
    from redash import create_app, models

    app = create_app()
    with app.app_context():
        existing = {user.email for user in models.User.query.all()}

    if ADMIN_EMAIL in existing:
        print(f"seed-redash: admin {ADMIN_EMAIL} already exists", flush=True)
    else:
        # The password reaches the CLI on argv, which is visible to anything
        # already inside this short-lived container. The alternative is the
        # CLI's interactive prompt, and a bootstrap that can block on stdin is
        # a worse failure than a process listing nobody can see.
        password = os.environ.get("VEODYN_ADMIN_PASSWORD") or new_password()
        manage("users", "create_root", ADMIN_EMAIL, ADMIN_NAME, "--password", password)
        if not os.environ.get("VEODYN_ADMIN_PASSWORD"):
            announce(password)

    # After create_root, so the organization and its builtin groups exist.
    with app.app_context():
        org = models.Organization.get_by_slug("default")
        service_group_id = ensure_service_group(models, org).id

    if SERVICE_EMAIL in existing:
        print(f"seed-redash: service account {SERVICE_EMAIL} already exists", flush=True)
    else:
        # Still a plain `users create`, which lands the account in the builtin default
        # group; bind_to_service_group below moves it. Not `--groups`, even though the
        # option exists and takes ids: build_groups in redash/cli/users.py runs
        # `groups.split(",")` then an unconditional `groups.remove("")`, so a single id
        # raises ValueError before it reaches the int() cast. `--groups 3,` is the shape
        # that works, and a bootstrap should not depend on a trailing comma.
        #
        # Nothing can use the wider grant in the meantime: this is a one-shot container
        # and compose holds `server` back until it exits 0, so Redash is not answering.
        manage("users", "create", SERVICE_EMAIL, SERVICE_NAME, "--password", new_password())

    with app.app_context():
        org = models.Organization.get_by_slug("default")
        group = models.Group.query.filter(models.Group.id == service_group_id).one()
        admin = models.User.query.filter(models.User.email == ADMIN_EMAIL).one()
        service = models.User.query.filter(models.User.email == SERVICE_EMAIL).one()
        bind_to_service_group(models, service, group)
        attach_to_data_sources(models, org, group)
        frontend = write_secret_file(
            FRONTEND_SECRETS_DIR, "frontend.env", f"REDASH_INTERNAL_API_KEY={admin.api_key}\n"
        )
        worker = write_secret_file(
            SERVICE_SECRETS_DIR, "service-account.env", f"VEODYN_REDASH_SERVICE_API_KEY={service.api_key}\n"
        )

    print(f"seed-redash: wrote {frontend} and {worker}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
