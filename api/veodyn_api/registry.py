"""The six seams the enterprise half registers through.

Each registry is a list or a mapping that something else fills in at import
time, and a build with nothing installed finds them empty. The six, and the
community surface that resolves through each:

- **Routers**, read by `main.create_app`, in registration order.
- **Jobs**, read by `worker.schedule.enqueue_due`. The community edition
  registers none, which is why it ships no worker at all.
- **Object types**, read by `routers/tags.py` and `routers/favorites.py`. The
  only mapping here, because both address a kind by name in the URL.
- **Counter providers** and **domain-key providers**, read by
  `services/domains.py`. Two registries because a hub's counters are built per
  domain key and the list of keys is discovered separately.
- **Dataset sources**, read by `services/catalog.build_catalog`.

Registration happens at import, so there is no `unregister`.
`restored_registries()` is the undo, and it has to know every registry: one
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
from veodyn_api.services.clickhouse import ClickHouseClient

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

    `model` is None for a kind with no row in this database (`dataset` is a
    ClickHouse registry table name). Such a kind can be tagged and listed among
    the favorites keys, but cannot be starred: a star is written as
    INSERT..SELECT against the object's own table.

    `authorize_tag_write` either returns quietly or raises an ApiError, and is
    given the object id rather than a loaded object because loading is per-kind
    too. The rule differs per kind (owner-or-admin for a KPI, the report's own
    edit guard, the warehouse registry for a dataset), which is why it rides on
    the descriptor rather than the descriptor being a `{kind: model}` dict.

    `not_found` is the cause the favorites write reports for a missing object. It
    is a member of this package's ErrorId, so a pack-registered kind reuses one
    rather than inventing a wire contract the frontend has never seen.
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
    shared by every job. `run` is enqueued BY REFERENCE, so it has to be
    importable in the worker process; `job_id` derives a stable id from the same
    tuple, which is what makes re-enqueuing an in-flight job a no-op.
    """

    name: str
    due: DueQuery
    run: Callable[..., None]
    job_id: Callable[..., str]


@dataclass(frozen=True)
class DatasetSource:
    """One dataset a provider contributes to the catalog.

    The defaults describe a captured table: a row in the warehouse registry,
    counted and described by the warehouse itself.

    `shadows` is the name of a physical table this entry replaces, for when a
    pack renames a captured table and puts a view in its place. The community
    registry read still returns a row for the renamed table, so without
    shadowing the catalog lists one dataset twice under two names.

    `row_count` is None for "ask system.tables", which is useless for a view: a
    view stores no rows, so its total_rows is null and the catalog would report
    the dataset as empty.
    """

    table: str
    database: str
    name: str
    query_id: int = 0
    query_name: str = ""
    origin: str = "capture"
    shadows: str | None = None
    row_count: int | None = None
    description: str | None = None
    writable: bool = False


DatasetSourceProvider = Callable[[ClickHouseClient, str], Sequence[DatasetSource]]
"""(warehouse, default_database) -> the datasets this provider contributes."""


_ROUTERS: list[APIRouter] = []
_JOBS: list[ScheduledJob] = []
_OBJECT_TYPES: dict[str, ObjectType] = {}
_COUNTER_PROVIDERS: list[CounterProvider] = []
_DOMAIN_KEY_PROVIDERS: list[DomainKeyProvider] = []
_DATASET_SOURCE_PROVIDERS: list[DatasetSourceProvider] = []


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
    first, so a pack loaded after a built-in can override it and the kind is
    still listed once."""
    _OBJECT_TYPES[descriptor.kind] = descriptor


def object_kinds() -> tuple[str, ...]:
    """Every registered kind, in registration order."""
    return tuple(_OBJECT_TYPES)


def object_type(kind: str) -> ObjectType:
    """The descriptor for one kind, or a refusal.

    A 404 rather than a 422: a 422 listing the kinds this build accepts would
    tell an unauthenticated caller which packs are installed.
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

    Empty with no provider, so a hub renders no counter row at all: the concept
    does not exist in this build, rather than existing and reading zero.
    """
    return [counter for provider in _COUNTER_PROVIDERS for counter in provider(db, org_slug, key)]


def register_domain_key_provider(provider: DomainKeyProvider) -> None:
    _DOMAIN_KEY_PROVIDERS.append(provider)


def domain_keys(db: Session, org_slug: str) -> set[str]:
    """Domain keys the providers know about, unioned.

    Separate from the counters because discovery and assembly are separate
    reads: `discover_keys` unions this with the keys it finds on Redash tags.
    """
    keys: set[str] = set()
    for provider in _DOMAIN_KEY_PROVIDERS:
        keys.update(provider(db, org_slug))
    return keys


def register_dataset_source_provider(provider: DatasetSourceProvider) -> None:
    _DATASET_SOURCE_PROVIDERS.append(provider)


def dataset_sources(client: ClickHouseClient, default_database: str) -> list[DatasetSource]:
    """Every provider's datasets, concatenated in registration order.

    Order is the catalog's order, so the community registry read staying first
    keeps a no-pack build's output in its existing sequence.
    """
    return [source for provider in _DATASET_SOURCE_PROVIDERS for source in provider(client, default_database)]


@contextmanager
def restored_registries() -> Iterator[None]:
    """Put every registry back exactly as it was when the block ends."""
    saved_routers = list(_ROUTERS)
    saved_jobs = list(_JOBS)
    saved_object_types = dict(_OBJECT_TYPES)
    saved_counters = list(_COUNTER_PROVIDERS)
    saved_domain_keys = list(_DOMAIN_KEY_PROVIDERS)
    saved_dataset_sources = list(_DATASET_SOURCE_PROVIDERS)
    try:
        yield
    finally:
        _ROUTERS[:] = saved_routers
        _JOBS[:] = saved_jobs
        _OBJECT_TYPES.clear()
        _OBJECT_TYPES.update(saved_object_types)
        _COUNTER_PROVIDERS[:] = saved_counters
        _DOMAIN_KEY_PROVIDERS[:] = saved_domain_keys
        _DATASET_SOURCE_PROVIDERS[:] = saved_dataset_sources


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
        _DATASET_SOURCE_PROVIDERS.clear()
        yield
