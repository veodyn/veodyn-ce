"""veodyn-api's real client against this service, over real HTTP.

**Why this exists and is not in the suite.** The service's tests fake the
client and the client's tests (`api/tests/test_published_feed_validator*.py`)
fake the service, so a mismatch between the two shapes passes both suites.
Nothing else crosses the boundary. This does, using the real
`gtfs_rt_validator` underneath and a real archive fetched over HTTP.

It is a script rather than a test because it needs two listening ports and a
served archive, which the pack's CI image is not set up for and which would
make the gate flaky for reasons that are not about the code.

Run it from `validator/` after changing either side's shape:

    python3 scripts/build-fixture-archive.py /tmp/mini-gtfs.zip
    python3 -m http.server 8731 --directory /tmp &
    .venv/bin/python -m uvicorn validator_service.main:app --port 8732 &
    .venv/bin/python scripts/contract-check.py

Measured on 2026-08-16: six findings, all E/W titles enriched from the
manifest, 121 rules reported as run, and an unfetchable archive turning into
`ValidatorUnavailable` on the client rather than a clean pass.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys
from types import ModuleType

HERE = pathlib.Path(__file__).resolve().parent
API = HERE.parent.parent / "api"
sys.path.insert(0, str(API))

import httpx  # noqa: E402

# veodyn-api is a sibling repository reached through the sys.path line above,
# not a dependency of this project, so there is nothing for mypy to resolve
# here and nothing it could resolve without making that repo a dependency,
# which is the coupling this service exists to avoid.
from veodyn_api.services.published_feed_validator import (  # type: ignore[import-not-found]  # noqa: E402
    ValidatorUnavailable,
    validate_feed,
)

ARCHIVE = "http://127.0.0.1:8731/mini-gtfs.zip"
SERVICE = "http://127.0.0.1:8732"


def _fixtures() -> ModuleType:
    """Loaded by path: this project and veodyn-api both have a `tests` package,
    so an ordinary import resolves to whichever is first on sys.path."""
    spec = importlib.util.spec_from_file_location("vsfixtures", HERE.parent / "tests" / "fixtures.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    fixtures = _fixtures()
    message = fixtures.vehicle_position_bytes(entity_id="v1", trip_id="GHOST")

    with httpx.Client() as client:
        outcome = validate_feed(client, SERVICE, message, ARCHIVE, None)

    print(f"findings: {len(outcome.findings)}")
    for finding in outcome.findings:
        print(
            f"  {finding.rule_id} | {finding.severity} | count={finding.occurrence_count} "
            f"| title={finding.title!r} | locator={finding.locator!r}"
        )
    print(f"rules reported as run: {len(outcome.enabled_rules)}")
    print(f"has_error: {outcome.has_error}")

    assert outcome.enabled_rules, "the client accepted a verdict carrying no rule inventory"
    assert len(outcome.enabled_rules) > 50, "the modern registry should be large; got a suspiciously short one"
    assert any(f.rule_id == "E003" for f in outcome.findings), "expected E003 for a trip_id absent from the archive"
    assert all(f.occurrence_count >= 1 for f in outcome.findings), "a finding reported zero occurrences"
    titled = [f for f in outcome.findings if f.rule_id[0] in "EW"]
    assert titled and all(f.title for f in titled), "an E/W rule arrived with no title, so enrichment did not happen"

    # An archive the service cannot fetch must reach the client as no verdict,
    # never as a clean pass. This is the half that decides whether a broken
    # validator publishes unvalidated bytes.
    with httpx.Client() as client:
        try:
            validate_feed(client, SERVICE, message, "http://127.0.0.1:8731/does-not-exist.zip", None)
        except ValidatorUnavailable as exc:
            print(f"\nunfetchable archive -> {type(exc).__name__}: {str(exc)[:80]}")
        else:
            raise AssertionError("an unfetchable archive produced a verdict")

    print("\nOK: real client, real service, real package, over real HTTP.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
