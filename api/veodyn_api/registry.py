"""The five seams the enterprise half registers through.

Nothing in this file knows what a KPI is. Each registry is a list or a mapping
that something else fills in at import time, and a build with nothing installed
simply finds them empty. That is the point: the community edition's behaviour
with no packs is the default rather than a special case, so "the pack is not
installed" and "the pack is broken" cannot end up looking alike.

The five, and the community surface that resolves through each:

- **Routers**, read by `main.create_app`. An endpoint group arrives by being
  imported, in registration order.
- **Jobs**, read by `worker.schedule.enqueue_due`. The tick asks each registered
  job what is due and enqueues it. The community edition registers none, which
  is why it ships no worker at all.
- **Object types**, read by `routers/tags.py` and `routers/favorites.py`. The
  only mapping here rather than a list, because both address a kind by name in
  the URL.
- **Counter providers** and **domain-key providers**, read by
  `services/domains.py`. Two registries rather than one, because a hub's
  counters are built per domain key and the list of keys is discovered
  separately; see the two call sites there.

**The object-type descriptor carries authorization, not just a model class.** A
`{kind: model}` dict was the first design and it does not work. `routers/tags.py`
applies a different rule per kind: owner-or-admin for a KPI, the report's own
edit guard for a report, and the warehouse registry for a dataset. Collapsing
those into one rule to fit a smaller descriptor would silently weaken
authorization, which is a worse outcome than never splitting the package.

Registration happens at import and an import happens once per process, so there
is no `unregister`. `restored_registries()` is the undo, and it lives here
rather than in the tests because it has to know every registry: a sixth one
added without a line in it would leak between tests.
"""

from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import APIRouter
from sqlalchemy.orm import Session

from veodyn_api.auth import Identity
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.catalog import HubCounterOut

CounterProvider = Callable[[Session, str, str], list[HubCounterOut]]
"""(db, org_slug, domain_key) -> the counters this provider contributes."""

DomainKeyProvider = Callable[[Session, str], set[str]]
"""(db, org_slug) -> domain keys this provider knows about."""

DueQuery = Callable[[Session, datetime], Sequence[tuple[Any, ...]]]
"""(db, now) -> one argument tuple per piece of work that is due."""

TagWriteGuard = Callable[[Session, Identity, str], None]
"""(db, identity, object_id) -> nothing, or raises. See ObjectType."""


@dataclass(frozen=True)
class ObjectType:
    """One taggable, favoritable kind, contributed by whoever owns it.

    `model` is None for a kind with no row in this database: `dataset` is a
    ClickHouse registry table name, which is why the existence check is a
    callable rather than a SELECT the registry builds. A kind with no model can
    be tagged (the tag write simply has no gate to hand the statement) and can
    be listed among the favorites keys, but cannot be starred, because a star is
    written as INSERT..SELECT against the object's own table.

    `authorize_tag_write` either returns quietly or raises an ApiError. It is
    given the object id rather than a loaded object, because loading is
    per-kind too: the KPI rule loads a KPI and compares owners, the report rule
    loads a report and applies its edit lock, and the dataset rule reads a
    warehouse registry and loads nothing at all.

    `not_found` is the cause the favorites write reports when the object turns
    out not to exist. It is a member of this package's ErrorId, so a
    pack-registered kind reuses one rather than inventing a wire contract the
    frontend has never seen.
    """

    kind: str
    not_found: ErrorId
    taggable: bool
    favoritable: bool
    model: type[Any] | None
    authorize_tag_write: TagWriteGuard


@dataclass(frozen=True)
class ScheduledJob:
    """One recurring unit of work the tick knows how to enqueue.

    `due` is asked once per tick, with a read-only session and a single instant
    shared by every job, and returns the argument tuple for each piece of work.
    `run` is enqueued BY REFERENCE, so it has to be importable in the worker
    process; `job_id` derives a stable id from the same tuple, which is what
    makes re-enqueuing a job that is still in flight a no-op rather than a
    second write.
    """

    name: str
    due: DueQuery
    run: Callable[..., None]
    job_id: Callable[..., str]


_ROUTERS: list[APIRouter] = []
_JOBS: list[ScheduledJob] = []
_OBJECT_TYPES: dict[str, ObjectType] = {}
_COUNTER_PROVIDERS: list[CounterProvider] = []
_DOMAIN_KEY_PROVIDERS: list[DomainKeyProvider] = []


def register_router(router: APIRouter) -> None:
    _ROUTERS.append(router)


def routers() -> tuple[APIRouter, ...]:
    return tuple(_ROUTERS)


def register_job(job: ScheduledJob) -> None:
    _JOBS.append(job)


def jobs() -> tuple[ScheduledJob, ...]:
    return tuple(_JOBS)


def register_object_type(descriptor: ObjectType) -> None:
    """Contribute a kind. A second registration of the same kind replaces the
    first rather than being ignored, so a pack loaded after a built-in can
    override it and the kind is still listed once."""
    _OBJECT_TYPES[descriptor.kind] = descriptor


def object_kinds() -> tuple[str, ...]:
    """Every registered kind, in registration order."""
    return tuple(_OBJECT_TYPES)


def object_type(kind: str) -> ObjectType:
    """The descriptor for one kind, or a refusal.

    A 404 rather than a 422, and the two are not interchangeable here. "This
    build has no such kind" is the same answer as "no such object", and a 422
    listing the kinds this build accepts would tell an unauthenticated caller
    which packs are installed.
    """
    descriptor = _OBJECT_TYPES.get(kind)
    if descriptor is None:
        raise ApiError(ErrorId.UNKNOWN_OBJECT_TYPE, f"there is no object type '{kind}' here", status_code=404)
    return descriptor


def taggable_type(kind: str) -> ObjectType:
    descriptor = object_type(kind)
    if not descriptor.taggable:
        raise ApiError(ErrorId.UNKNOWN_OBJECT_TYPE, f"'{kind}' does not carry tags here", status_code=404)
    return descriptor


def favoritable_type(kind: str) -> ObjectType:
    descriptor = object_type(kind)
    if not descriptor.favoritable:
        raise ApiError(ErrorId.UNKNOWN_OBJECT_TYPE, f"'{kind}' cannot be starred here", status_code=404)
    return descriptor


def favoritable_kinds() -> tuple[str, ...]:
    """The keys the favorites response carries, in registration order."""
    return tuple(kind for kind, descriptor in _OBJECT_TYPES.items() if descriptor.favoritable)


def register_counter_provider(provider: CounterProvider) -> None:
    _COUNTER_PROVIDERS.append(provider)


def counters(db: Session, org_slug: str, key: str) -> list[HubCounterOut]:
    """Every registered provider's counters for one domain, concatenated.

    With no provider this is an empty list, and a hub then renders its tagged
    queries and dashboards with no counter row. That is the intended
    degradation: the concept does not exist in this build, rather than existing
    and reading zero.
    """
    return [counter for provider in _COUNTER_PROVIDERS for counter in provider(db, org_slug, key)]


def register_domain_key_provider(provider: DomainKeyProvider) -> None:
    _DOMAIN_KEY_PROVIDERS.append(provider)


def domain_keys(db: Session, org_slug: str) -> set[str]:
    """Domain keys the providers know about, unioned.

    Separate from the counters because discovery and assembly are separate
    reads: `discover_keys` unions this with the keys it finds on Redash tags,
    and a domain that only a provider knows about still gets a hub.
    """
    keys: set[str] = set()
    for provider in _DOMAIN_KEY_PROVIDERS:
        keys.update(provider(db, org_slug))
    return keys


@contextmanager
def restored_registries() -> Iterator[None]:
    """Put every registry back exactly as it was when the block ends."""
    saved_routers = list(_ROUTERS)
    saved_jobs = list(_JOBS)
    saved_object_types = dict(_OBJECT_TYPES)
    saved_counters = list(_COUNTER_PROVIDERS)
    saved_domain_keys = list(_DOMAIN_KEY_PROVIDERS)
    try:
        yield
    finally:
        _ROUTERS[:] = saved_routers
        _JOBS[:] = saved_jobs
        _OBJECT_TYPES.clear()
        _OBJECT_TYPES.update(saved_object_types)
        _COUNTER_PROVIDERS[:] = saved_counters
        _DOMAIN_KEY_PROVIDERS[:] = saved_domain_keys


@contextmanager
def empty_registries() -> Iterator[None]:
    """What a build with no packs installed looks like, in a process where the
    built-ins have already registered themselves at import."""
    with restored_registries():
        _ROUTERS.clear()
        _JOBS.clear()
        _OBJECT_TYPES.clear()
        _COUNTER_PROVIDERS.clear()
        _DOMAIN_KEY_PROVIDERS.clear()
        yield
