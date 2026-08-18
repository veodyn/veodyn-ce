#!/usr/bin/env python3
"""Seed the Tier 1 feed-health KPIs into a Veodyn environment.

    ./scripts/seed-dev-kpis.py --redash-url URL --api-url URL          # plan
    ./scripts/seed-dev-kpis.py --redash-url URL --api-url URL --apply  # write

Both URLs are required (or supplied as REDASH_URL and VEODYN_API_URL); there is no
default target.

Written in this order, because the second depends on the first:

  1. Redash gets one saved query per KPI (definitions and thresholds: kpi_specs.py).
  2. veodyn-api gets one KPI per query, bound to that query id and column.

Both halves are idempotent, matched on name: a second run updates the query text
and leaves an existing KPI alone rather than creating duplicates.

`schedule` is never sent. The KPI worker runs these itself on the KPI's own cadence,
and setting one here would re-arm that instance's scheduler against the upstream API.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from kpi_specs import DATA_SOURCE_NAME, QUERY_PREFIX, SPECS, kpi_payload

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_ROOT / "app" / ".env.local"


class SeedError(RuntimeError):
    """A failure with a message worth showing the operator verbatim."""


def read_api_key() -> str:
    """The write credential. Called only on the --apply path, never on a plan."""
    key = os.environ.get("REDASH_INTERNAL_API_KEY")
    if key:
        return key
    if not ENV_FILE.exists():
        raise SeedError(f"set REDASH_INTERNAL_API_KEY, or put it in {ENV_FILE}")
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith("REDASH_INTERNAL_API_KEY="):
            value = line.split("=", 1)[1].strip()
            if value:
                return value
    raise SeedError(f"REDASH_INTERNAL_API_KEY is missing or empty in {ENV_FILE}")


class Http:
    """Just enough HTTP for two JSON APIs, on the stdlib.

    Redash wants `Authorization: Key <token>`; veodyn-api strips whatever scheme
    it is given and re-adds Redash's, so the bare token is what it wants.
    """

    def __init__(self, base: str, auth: str, timeout: int = 120) -> None:
        self.base = base.rstrip("/")
        self.auth = auth
        self.timeout = timeout

    def __call__(self, method: str, path: str, payload: Any = None) -> Any:
        request = urllib.request.Request(
            f"{self.base}{path}",
            method=method,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={"Authorization": self.auth, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:600]
            raise SeedError(f"{method} {path} -> {error.code}: {detail}") from error


def resolve_data_source(redash: Http) -> int:
    for source in redash("GET", "/api/data_sources"):
        if source["name"] == DATA_SOURCE_NAME:
            return int(source["id"])
    raise SeedError(f"no data source named {DATA_SOURCE_NAME!r}; is this pointed at the right Redash?")


def existing_queries(redash: Http) -> dict[str, dict[str, Any]]:
    """Saved queries keyed by name. Paged through, since the cap is per page."""
    found: dict[str, dict[str, Any]] = {}
    page = 1
    while True:
        result = redash("GET", f"/api/queries?page={page}&page_size=100")
        for query in result["results"]:
            found[query["name"]] = query
        if page * result["page_size"] >= result["count"]:
            return found
        page += 1


def upsert_query(redash: Http, spec: dict[str, Any], data_source_id: int, existing: dict[str, Any] | None) -> int:
    """Create or update the saved query and return its id.

    `schedule` is never sent: see the module docstring.
    """
    body = {
        "name": QUERY_PREFIX + spec["name"],
        "query": spec["sql"],
        "data_source_id": data_source_id,
        "description": spec["description"],
        "options": {"parameters": []},
    }
    if existing is None:
        created = redash("POST", "/api/queries", body)
        # A new query is a draft, and a draft is invisible on the queries list
        # to everyone but its author.
        redash("POST", f"/api/queries/{created['id']}", {"is_draft": False})
        return int(created["id"])
    redash("POST", f"/api/queries/{existing['id']}", body | {"is_draft": False})
    return int(existing["id"])


def run_query(redash: Http, query_id: int) -> Any:
    """Execute once so the KPI's first evaluation has a warm cache to read."""
    result = redash("POST", f"/api/queries/{query_id}/results", {"max_age": 0})
    job = result.get("job")
    if job is not None:
        for _ in range(60):
            if job.get("status") in (3, 4):
                break
            time.sleep(2)
            job = redash("GET", f"/api/jobs/{job['id']}")["job"]
        if job.get("status") != 3:
            raise SeedError(f"query {query_id} failed to run: {job.get('error')}")
        result = redash("GET", f"/api/query_results/{job['query_result_id']}")
    return result["query_result"]["data"]


def check_shape(data: Any, spec: dict[str, Any]) -> Any:
    """The evaluator's contract, checked here where the message can be useful."""
    rows = data["rows"]
    if not rows:
        raise SeedError(f"{spec['name']}: the query returned no rows, so the KPI would never evaluate")
    if len(rows) != 1:
        # Not fatal for the evaluator, which reads the last row, but a
        # multi-row result almost always means the query is not what was meant.
        print(f"    warning: {len(rows)} rows returned; the KPI will read only the last one")
    value = rows[-1].get(spec["value_column"])
    if value is None or isinstance(value, bool):
        available = ", ".join(sorted(str(column["name"]) for column in data["columns"]))
        raise SeedError(f"{spec['name']}: column {spec['value_column']!r} is not a number; available: {available}")
    return value


def kpi_summary(spec: dict[str, Any]) -> str:
    return (
        f"[{spec['value_column']} {spec['unit']}, {spec['direction']},"
        f" target {spec['target']}, at-risk {spec['at_risk']}, breached {spec['breached']}]"
    )


def describe(spec: dict[str, Any], found: dict[str, Any] | None, kpi: dict[str, Any] | None, source_id: int) -> None:
    """What this run will do, against a target whose contents have been read."""
    print(f"  {spec['name']}")
    print(f"    query: {'update' if found else 'create'} {QUERY_PREFIX + spec['name']!r} on data source {source_id}")
    print(f"    kpi:   {'exists, left alone' if kpi else 'create'} {kpi_summary(spec)}")


def describe_planned(spec: dict[str, Any]) -> None:
    """The same plan without having contacted anything.

    A dry run holds no credential, so whether each of these already exists is unknown
    here. --apply prints the resolved form above before it writes.
    """
    print(f"  {spec['name']}")
    print(f"    query: {QUERY_PREFIX + spec['name']!r} on data source {DATA_SOURCE_NAME!r}")
    print(f"    kpi:   {kpi_summary(spec)}")


def seed_one(redash: Http, api: Http, spec: dict[str, Any], source_id: int, found: Any, kpi: Any) -> None:
    query_id = upsert_query(redash, spec, source_id, found)
    value = check_shape(run_query(redash, query_id), spec)
    print(f"    ran query {query_id}: {spec['value_column']} = {value}")

    if kpi is None:
        created = api("POST", "/kpis", kpi_payload(spec, query_id))
        print(f"    created KPI {created['id']}")
    elif kpi["source"].get("queryId") != query_id:
        # Repointing a KPI deletes its history, so say it rather than doing it.
        print(f"    NOTE: KPI points at query {kpi['source'].get('queryId')}, not {query_id}. Left as-is.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write; without it the script only prints the plan")
    parser.add_argument(
        "--redash-url", default=os.environ.get("REDASH_URL", ""), help="Redash base URL, or set REDASH_URL"
    )
    parser.add_argument(
        "--api-url", default=os.environ.get("VEODYN_API_URL", ""), help="veodyn-api base URL, or set VEODYN_API_URL"
    )
    args = parser.parse_args()

    for flag, value in (("--redash-url", args.redash_url), ("--api-url", args.api_url)):
        if not value:
            raise SeedError(f"{flag} is required; see --help for the environment variable that also sets it")

    print(f"redash:     {args.redash_url}")
    print(f"veodyn-api: {args.api_url}")
    print(f"mode:       {'APPLY' if args.apply else 'dry run (pass --apply to write)'}\n")

    if not args.apply:
        for spec in SPECS:
            describe_planned(spec)
            print()
        print("Nothing was written, no credential was read, and nothing was contacted. Re-run with --apply.")
        return 0

    key = read_api_key()
    redash = Http(args.redash_url, f"Key {key}")
    api = Http(args.api_url, key)

    source_id = resolve_data_source(redash)
    saved = existing_queries(redash)
    kpis_by_name = {kpi["name"]: kpi for kpi in api("GET", "/kpis")}

    for spec in SPECS:
        found = saved.get(QUERY_PREFIX + spec["name"])
        kpi = kpis_by_name.get(spec["name"])
        describe(spec, found, kpi, source_id)
        seed_one(redash, api, spec, source_id, found, kpi)
        print()

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SeedError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
