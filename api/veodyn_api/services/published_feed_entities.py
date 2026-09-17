from dataclasses import dataclass
from typing import Any

import httpx

from veodyn_api.services.published_feed_validator import ValidatorUnavailable
from veodyn_api.settings import Settings

STATIC_ENTITY_TIMEOUT_SECONDS = 30.0

MIN_ENTITY_LIMIT = 1
MAX_ENTITY_LIMIT = 50
DEFAULT_ENTITY_LIMIT = 20


def clamped_entity_limit(limit: int) -> int:
    return max(MIN_ENTITY_LIMIT, min(limit, MAX_ENTITY_LIMIT))


@dataclass(frozen=True)
class StaticEntity:
    kind: str
    id: str
    label: str


@dataclass(frozen=True)
class StaticEntities:
    feed_version: str
    entities: tuple[StaticEntity, ...]


def _entity_at(index: int, item: Any, requested_kind: str) -> StaticEntity:
    if not isinstance(item, dict):
        raise ValidatorUnavailable(f"entity {index} is a {type(item).__name__}, not an object")
    kind = str(item.get("kind") or "").strip()
    entity_id = str(item.get("id") or "").strip()
    if not kind or not entity_id:
        raise ValidatorUnavailable(f"entity {index} carries no kind and id, so nothing could be picked from it")
    if kind != requested_kind:
        raise ValidatorUnavailable(
            f"entity {index} is a {kind}, not the {requested_kind} that was asked for, so the listing "
            "describes some other search than this one"
        )
    return StaticEntity(kind=kind, id=entity_id, label=str(item.get("label") or entity_id))


def read_static_entities(payload: Any, requested_kind: str) -> StaticEntities:
    if not isinstance(payload, dict):
        raise ValidatorUnavailable(f"the feed validator returned a {type(payload).__name__}, not an entity listing")
    entities = payload.get("entities")
    if not isinstance(entities, list):
        raise ValidatorUnavailable(
            f"the feed validator returned no entities list (entities is a {type(entities).__name__}); "
            "an absent listing is not an empty one"
        )
    feed_version = payload.get("feedVersion")
    if not isinstance(feed_version, str):
        raise ValidatorUnavailable("the feed validator did not say which version of the static dataset it read")
    return StaticEntities(
        feed_version=feed_version,
        entities=tuple(_entity_at(index, item, requested_kind) for index, item in enumerate(entities)),
    )


def fetch_static_entities(
    client: httpx.Client,
    base_url: str,
    static_gtfs_ref: str,
    kind: str,
    q: str | None,
    limit: int,
) -> StaticEntities:
    params: dict[str, str] = {"gtfs": static_gtfs_ref, "kind": kind, "limit": str(limit)}
    if q:
        params["q"] = q
    try:
        response = client.get(
            f"{base_url.rstrip('/')}/static-entities",
            params=params,
            timeout=STATIC_ENTITY_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise ValidatorUnavailable(f"the feed validator could not be reached: {exc}") from exc
    if response.status_code != 200:
        raise ValidatorUnavailable(refusal_of(response))
    try:
        payload = response.json()
    except ValueError as exc:
        raise ValidatorUnavailable(f"the feed validator did not return a listing: {exc}") from exc
    return read_static_entities(payload, kind)


def refusal_of(response: httpx.Response) -> str:
    try:
        body: Any = response.json()
    except ValueError:
        body = None
    stated = body.get("error") if isinstance(body, dict) else None
    if isinstance(stated, str) and stated.strip():
        return stated.strip()
    return f"the feed validator answered {response.status_code} without saying why"


def static_entities_of(
    settings: Settings,
    static_gtfs_ref: str,
    kind: str,
    q: str | None,
    limit: int,
) -> StaticEntities:
    base_url = settings.feed_validator_url
    if not base_url:
        raise ValidatorUnavailable(
            "no feed validator is configured for this deployment, so the static dataset cannot be read"
        )
    with httpx.Client(timeout=STATIC_ENTITY_TIMEOUT_SECONDS) as client:
        return fetch_static_entities(client, base_url, static_gtfs_ref, kind, q, limit)
