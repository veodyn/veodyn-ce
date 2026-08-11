"""The other four seams: routers, worker jobs, hub counters and domain keys.

Split from test_registry.py, which holds the object-type seam, so both files
stay inside the 300-line block.

The shape of every test here is the same as there: register a fake, then assert
the real CE surface (create_app, jobs, build_domain_hub, discover_keys) resolved
through the registry, and assert that with nothing registered the surface
degrades to "this concept does not exist here" rather than to a built-in
default.

The tick itself is not here. `worker/schedule.py` went to the pack with the only
job there was, so what a community build can say about the job registry is that
a registration lands in it and that a build with no packs has none. What the
tick DOES with those jobs is asserted in the pack's copy of this file, against a
real `enqueue_due`.
"""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from veodyn_api.main import create_app
from veodyn_api.registry import (
    ScheduledJob,
    counters,
    domain_keys,
    empty_registries,
    jobs,
    register_counter_provider,
    register_domain_key_provider,
    register_job,
    register_router,
    restored_registries,
)
from veodyn_api.schemas.catalog import HubCounterOut
from veodyn_api.services.domains import discover_keys


@pytest.fixture(autouse=True)
def _registries() -> Iterator[None]:
    with restored_registries():
        yield


class _FakeRedash:
    """Redash's tag-filtered list, with one query carrying one domain tag."""

    def __init__(self, tag: str) -> None:
        self._tag = tag

    def list_tagged(self, collection: str, tag: str, **kwargs: Any) -> list[dict[str, Any]]:
        return [{"id": 1, "tags": [self._tag]}]


def _counter(label: str) -> HubCounterOut:
    return HubCounterOut(label=label, value=1.0)


def _noop_job(org_slug: str, object_id: str) -> None:
    """A registered job's `run` is enqueued by reference, never called here."""


def _paths(app: Any) -> list[str]:
    """What the app actually serves.

    Read off the generated schema rather than `app.routes`. FastAPI 0.139
    records an `include_router` call as a single `_IncludedRouter` placeholder
    with no `path` at all, so walking `app.routes` finds `/health` and nothing
    else, and an assertion that `/kpis` is absent would pass on an app serving
    every KPI endpoint.
    """
    return list(app.openapi()["paths"])


def test_ce_renders_with_every_registry_empty() -> None:
    """The CE claim in one assertion: nothing in the five registries, and the
    app still builds, mounts and answers."""
    with empty_registries():
        app = create_app()

        assert [path for path in _paths(app) if path.startswith("/kpis")] == []
        assert [path for path in _paths(app) if path.startswith("/tags")] == []
        assert TestClient(app).get("/health").status_code == 200


def test_a_router_is_mounted_because_it_is_registered() -> None:
    """create_app reads the router registry rather than a hard-coded list, which
    is what lets a pack contribute an endpoint group by being imported."""
    probe = APIRouter(prefix="/probe", tags=["probe"])

    @probe.get("")
    def _probe() -> dict[str, str]:
        return {"status": "ok"}

    with empty_registries():
        register_router(probe)

        assert TestClient(create_app()).get("/probe").json() == {"status": "ok"}


def test_the_built_in_routers_come_through_the_same_registry() -> None:
    """Not a separate path for CE and a registry for packs: one list, and the
    built-ins are on it."""
    assert "/tags/{object_type}/{object_id}" in _paths(create_app())


def test_a_registered_job_is_readable_from_the_registry() -> None:
    """The community half of the job seam. A pack contributes work by calling
    register_job, and whatever consumes it (the pack's own tick) reads this
    list; nothing in a community build hard-wires a job into it."""
    widgets = ScheduledJob(
        name="widgets",
        due=lambda session, now: [("default", "w-1"), ("default", "w-2")],
        run=_noop_job,
        job_id=lambda org_slug, object_id: f"widget-{org_slug}-{object_id}",
    )

    with empty_registries():
        register_job(widgets)

        registered = jobs()

        assert registered == (widgets,)
        assert [registered[0].job_id(*args) for args in registered[0].due(None, None)] == [  # type: ignore[arg-type]
            "widget-default-w-1",
            "widget-default-w-2",
        ]
        assert registered[0].run is _noop_job


def test_a_community_build_registers_no_job_at_all() -> None:
    """The reason a community image ships no worker process. This is measured
    against the real built-in registrations rather than inside
    empty_registries(), or it would assert that clearing a list clears it."""
    assert jobs() == ()


def test_counters_come_from_every_registered_provider_in_registration_order(db: Session) -> None:
    with empty_registries():
        register_counter_provider(lambda session, org_slug, key: [_counter("a")])
        register_counter_provider(lambda session, org_slug, key: [_counter("b"), _counter("c")])

        assert [counter.label for counter in counters(db, "default", "k")] == ["a", "b", "c"]


def test_the_counter_seam_returns_nothing_with_no_provider(db: Session) -> None:
    """The degradation the spec asks for: a hub renders its tags and no
    counters, because in CE the concept does not exist."""
    with empty_registries():
        assert counters(db, "default", "any-key") == []


def test_a_hub_shows_the_counters_a_provider_contributed(db: Session) -> None:
    """Through build_domain_hub rather than through counters() directly, because
    what matters is that the hub reads the registry."""
    from veodyn_api.services.domains import build_domain_hub

    class _FakeWarehouse:
        def query(self, sql: str) -> list[dict[str, Any]]:
            return []

    with empty_registries():
        register_counter_provider(lambda session, org_slug, key: [_counter("from the pack")])

        hub = build_domain_hub(
            "transit",
            redash=_FakeRedash("domain:transit"),  # type: ignore[arg-type]
            warehouse=_FakeWarehouse(),  # type: ignore[arg-type]
            db=db,
            org_slug="default",
            api_key=None,
            cookie=None,
        )

    assert [counter.label for counter in hub.counters] == ["from the pack"]


def test_domain_keys_union_the_providers_with_the_tag_derived_keys(db: Session) -> None:
    """The second coupling, and the one only this assertion catches: delete the
    domain_keys() call from discover_keys and the tag-derived key still comes
    back, so every other domains test stays green."""
    with empty_registries():
        register_domain_key_provider(lambda session, org_slug: {"logistics"})

        keys = discover_keys(
            _FakeRedash("domain:air-quality"),  # type: ignore[arg-type]
            db,
            "default",
            api_key=None,
            cookie=None,
        )

    assert keys == ["air-quality", "logistics"]


def test_domain_keys_are_only_the_tag_derived_ones_with_no_provider(db: Session) -> None:
    with empty_registries():
        assert domain_keys(db, "default") == set()

        keys = discover_keys(
            _FakeRedash("domain:air-quality"),  # type: ignore[arg-type]
            db,
            "default",
            api_key=None,
            cookie=None,
        )

    assert keys == ["air-quality"]
