#!/usr/bin/env python3
"""Prove the two seeded API keys are real, and that they carry exactly the rights they should.

Run it as its own one-shot container on the stack's network:

    docker compose run --rm --no-deps verify-seed

Not `compose exec api`, which is what this used to be. Checking both keys means
holding both, and no container that serves a request is allowed to hold both any
more: each mounts only its own volume. The verify-seed service exists to be the
one place that mounts both, read-only, behind a compose profile so nothing starts
it by accident.

A file existing is not evidence that a key works, and a key working is not
evidence that the service account was created with the rights it should have,
which is the part of docs/docs/operations/deployment.md step 5 that is easy to
get silently wrong. Redash resolves a user API key through the same request
loader as a session cookie, so GET /api/session answers with the owning user
and its effective permissions.

This script used to check the service account for two things: that it was not
an admin, and that it could execute queries. Both passed while the account sat
in the builtin default group holding create_dashboard, edit_dashboard,
edit_query, list_users, list_alerts, schedule_query and view_source on top of
what it uses, and the PASS line said so to two reviewers in a row. A check that
looks for the absence of one known-bad thing reports the absence of that one
thing, and gets read as "this is fine".

So the service account is now compared against an exact set. Anything missing
fails, and anything extra fails just as loudly, because an unexpected
permission is the failure that was actually shipped. The admin key is a
required-subset check instead: its permissions are the union of Redash's own
builtin admin and default groups, so pinning them exactly here would turn a
routine fork update into a confusing verifier failure, and the risk for that
account runs the other way, toward having too little.

Prints outcomes only. No key, and no fragment of one, ever reaches stdout:
this output is meant to be pasted into a report.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

REDASH_URL = os.environ.get("VEODYN_REDASH_URL", "http://server:5000").rstrip("/")
FRONTEND_SECRETS_DIR = Path(os.environ.get("VEODYN_FRONTEND_SECRETS_DIR", "/run/veodyn/frontend"))
SERVICE_SECRETS_DIR = Path(os.environ.get("VEODYN_SERVICE_SECRETS_DIR", "/run/veodyn/service"))
ADMIN_EMAIL = os.environ.get("VEODYN_ADMIN_EMAIL", "admin@example.com")
SERVICE_EMAIL = os.environ.get("VEODYN_SERVICE_EMAIL", "kpi-service@example.com")
API_URL = os.environ.get("VEODYN_API_URL", "http://api:8000").rstrip("/")
# "ce", "ee", or unset to skip the edition check. scripts/dev-stack.sh sets it from
# what is actually running.
EXPECT_EDITION = os.environ.get("VEODYN_EXPECT_EDITION", "")
# Opt-in, and it has to be. compose/smoke-test.sh brings a stack up WITHOUT the
# `seed` profile and then runs this, so an unconditional catalog check would fail
# the repository's own smoke test on a stack that is behaving exactly as intended.
# scripts/dev-stack.sh sets it, because there seeding is part of the workflow.
EXPECT_CATALOG = os.environ.get("VEODYN_EXPECT_CATALOG", "") not in ("", "0", "false")

# One enterprise path, used as the probe. Any of the pack's routers would do; this
# one is picked because it is the oldest and the least likely to be renamed.
ENTERPRISE_PROBE_PATH = "/kpis"

# Must stay identical to SERVICE_GROUP_PERMISSIONS in compose/seed-redash.py, which
# carries the derivation of why each string is on the list. Kept as a literal rather
# than imported: this runs in the veodyn-api container, which has no copy of the seed
# script's imports, and a verifier that reads its expectation from the thing it verifies
# cannot catch the thing being wrong.
EXPECTED_SERVICE_PERMISSIONS = {
    "create_query",
    "execute_query",
    "list_dashboards",
    "list_data_sources",
    "view_query",
}

# What the frontend's admin proxy routes need from the admin key. Not an exact set; see
# the module docstring.
REQUIRED_ADMIN_PERMISSIONS = {"admin", "super_admin"}


def read_key(directory: Path, filename: str, var: str) -> str:
    path = directory / filename
    if not path.is_file():
        raise SystemExit(f"verify-seed: FAIL {path} does not exist; the seed step never ran")
    for line in path.read_text().splitlines():
        name, _, value = line.partition("=")
        if name == var and value:
            return value
    raise SystemExit(f"verify-seed: FAIL {path} carries no non-empty {var}")


def session(key: str) -> dict:
    request = urllib.request.Request(f"{REDASH_URL}/api/session", headers={"Authorization": f"Key {key}"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"verify-seed: FAIL /api/session rejected a seeded key with HTTP {exc.code}") from exc


def describe(permissions: set[str]) -> str:
    return ", ".join(sorted(permissions)) or "(none)"


def check_admin(label: str, key: str) -> list[str]:
    user = session(key).get("user", {})
    email = user.get("email")
    permissions = set(user.get("permissions") or [])
    failures = []
    if email != ADMIN_EMAIL:
        failures.append(f"{label}: key belongs to {email!r}, expected {ADMIN_EMAIL!r}")
    missing = REQUIRED_ADMIN_PERMISSIONS - permissions
    if missing:
        failures.append(f"{label}: is missing {describe(missing)}, so the admin proxy routes would 403")
    if not failures:
        print(f"verify-seed: PASS {label} authenticates as {email} and holds {describe(REQUIRED_ADMIN_PERMISSIONS)}")
    return failures


def check_service(label: str, key: str) -> list[str]:
    user = session(key).get("user", {})
    email = user.get("email")
    permissions = set(user.get("permissions") or [])
    failures = []
    if email != SERVICE_EMAIL:
        failures.append(f"{label}: key belongs to {email!r}, expected {SERVICE_EMAIL!r}")
    missing = EXPECTED_SERVICE_PERMISSIONS - permissions
    if missing:
        failures.append(f"{label}: is missing {describe(missing)}, so veodyn-api would 403 on those calls")
    unexpected = permissions - EXPECTED_SERVICE_PERMISSIONS
    if unexpected:
        # The whole point of this check. An extra permission is not a harmless surplus:
        # it is what a leaked service key can do that nothing in this product needs.
        failures.append(
            f"{label}: holds {describe(unexpected)}, which veodyn-api never uses. "
            f"Expected exactly {describe(EXPECTED_SERVICE_PERMISSIONS)}. "
            "This usually means the account is in Redash's builtin default group."
        )
    if not failures:
        print(f"verify-seed: PASS {label} authenticates as {email} with exactly {describe(permissions)}")
    return failures


def get_json(url: str, key: str | None = None) -> dict:
    headers = {"Authorization": f"Key {key}"} if key else {}
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def check_catalog(key: str) -> list[str]:
    """That the stack has CONTENT, not just users.

    Separate from the key checks above because it fails for a different reason and
    has a different fix: those mean the bootstrap is broken, this one means nobody
    ran the seed profile. An instance with valid keys and nothing in it is a
    perfectly healthy stack showing empty screens, which is the state this check
    exists to name.
    """
    counts = {}
    for what in ("data_sources", "queries", "dashboards"):
        try:
            payload = get_json(f"{REDASH_URL}/api/{what}", key)
        except (urllib.error.HTTPError, urllib.error.URLError) as exc:
            return [f"catalog: GET /api/{what} failed: {exc}"]
        # /api/data_sources answers a bare list; the other two paginate.
        counts[what] = len(payload) if isinstance(payload, list) else payload.get("count", 0)

    empty = [what for what, count in counts.items() if not count]
    if empty:
        return [
            "catalog: no " + ", ".join(empty) + ". "
            "Run `scripts/dev-stack.sh seed`, or "
            "`docker compose --profile seed run --rm seed-catalog`."
        ]
    print(
        "verify-seed: PASS catalog holds "
        + ", ".join(f"{count} {what.replace('_', ' ')}" for what, count in counts.items())
    )
    return []


def check_edition(expected: str) -> list[str]:
    """That the api serves the edition that was asked for.

    Read off the live /openapi.json rather than by asking the container what it was
    configured with. An enterprise image whose VEODYN_EXTRA_MODULES never got set
    serves the community API, passes every health check, and shows an empty KPI
    page, which reads as "no KPIs yet" rather than as a broken stack. Enumerating
    app.routes would not catch it either: _IncludedRouter objects are not expanded,
    so that under-reports.
    """
    try:
        schema = get_json(f"{API_URL}/openapi.json")
    except (urllib.error.HTTPError, urllib.error.URLError) as exc:
        return [f"edition: GET {API_URL}/openapi.json failed: {exc}"]

    paths = schema.get("paths") or {}
    has_enterprise = any(path.startswith(ENTERPRISE_PROBE_PATH) for path in paths)
    if expected == "ee" and not has_enterprise:
        return [
            f"edition: expected ee, but {ENTERPRISE_PROBE_PATH} is not in the served schema. "
            "The image carries the pack and nothing registered it: check VEODYN_EXTRA_MODULES."
        ]
    if expected == "ce" and has_enterprise:
        return [
            f"edition: expected ce, but {ENTERPRISE_PROBE_PATH} is served. "
            "This stack is running an enterprise image."
        ]
    print(f"verify-seed: PASS the api serves the {expected} surface ({len(paths)} paths)")
    return []


def main() -> int:
    admin_key = read_key(FRONTEND_SECRETS_DIR, "frontend.env", "REDASH_INTERNAL_API_KEY")
    failures = check_admin("REDASH_INTERNAL_API_KEY", admin_key)
    failures += check_service(
        "VEODYN_REDASH_SERVICE_API_KEY",
        read_key(SERVICE_SECRETS_DIR, "service-account.env", "VEODYN_REDASH_SERVICE_API_KEY"),
    )
    if EXPECT_CATALOG:
        failures += check_catalog(admin_key)
    if EXPECT_EDITION:
        failures += check_edition(EXPECT_EDITION)
    for failure in failures:
        print(f"verify-seed: FAIL {failure}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
