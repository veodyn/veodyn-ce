"""Domain hubs, assembled from facts that already exist.

A domain is not a thing this service stores. It is a label three other systems
already carry, and a hub is the join across them:

    Redash tag `domain:<key>` on a query      -> the datasets it captures into
    Redash tag `domain:<key>` on a dashboard  -> the dashboards to link
    whatever registered a counter provider    -> the counters along the top

Redash applies the caller's permissions to both tag lookups, so a hub never
names a query or dashboard its reader could not open.

The counters come from two provider registries, asked two different questions:
`registry.counters` builds the tiles for one key (a list per provider, so a
provider can batch its own reads), and `registry.domain_keys` contributes keys
to discovery, so a domain nothing in Redash is tagged with still gets a hub.
With no provider registered a hub carries no counter row at all.
"""

from sqlalchemy.orm import Session

from veodyn_api import registry
from veodyn_api.schemas.catalog import DomainHubOut
from veodyn_api.services.clickhouse import ClickHouseClient, WarehouseDatabaseMissing, WarehouseTableMissing
from veodyn_api.services.redash import RedashClient

TAG_PREFIX = "domain:"


def domain_tag(key: str) -> str:
    return f"{TAG_PREFIX}{key}"


def humanize(key: str) -> str:
    """A readable label for a key, when nothing else supplies one.

    The tenant's own label lives in veodyn-de's config YAML, which this service
    does not read, so this turns the key back into words: `air-quality` reads as
    `Air Quality`. The frontend has the configured label and may prefer it.
    """
    words = key.replace("_", " ").replace("-", " ").split()
    return " ".join(word[:1].upper() + word[1:] for word in words) or key


def _tagged_ids(
    client: RedashClient, collection: str, key: str, *, api_key: str | None, cookie: str | None
) -> list[int]:
    rows = client.list_tagged(collection, domain_tag(key), api_key=api_key, cookie=cookie)
    ids = []
    for row in rows:
        row_id = row.get("id")
        # Checked rather than coerced in a try: a row without a usable id means
        # Redash changed shape, and that surfaces as a hub missing its members.
        if isinstance(row_id, int) and not isinstance(row_id, bool):
            ids.append(row_id)
        elif isinstance(row_id, str) and row_id.isdigit():
            ids.append(int(row_id))
    return ids


def _resolve_shadow_chain(replacements: dict[str, str], name: str) -> str:
    """Follow a chain of shadow declarations to its fixed point.

    A shadowed table keeps its own real name, so it can itself be shadowed by a
    later pack, and one hop lands on the middle name instead of the one /catalog
    serves. `seen` is a cycle guard: two declarations pointing at each other
    resolve to the last name reached rather than hanging the endpoint.
    """
    seen = {name}
    while name in replacements and replacements[name] not in seen:
        name = replacements[name]
        seen.add(name)
    return name


def _dataset_ids(warehouse: ClickHouseClient, query_ids: list[int], default_database: str) -> list[str]:
    """The captured tables belonging to a set of queries.

    Ids match the ones /catalog emits (the bare table name), because the domain
    page resolves them against that list.

    The registry table does not exist until Redash's first capture creates it, so
    a missing table and a missing database are both swallowed as "fresh install,
    no datasets", matching services/capture_sources.capture_sources.
    """
    if not query_ids:
        return []
    wanted = ",".join(str(int(query_id)) for query_id in query_ids)
    try:
        rows = warehouse.query(
            f"SELECT table_name FROM historical._catalog FINAL WHERE query_id IN ({wanted}) ORDER BY table_name"
        )
    except (WarehouseTableMissing, WarehouseDatabaseMissing):
        return []
    names = []
    for row in rows:
        qualified = str(row.get("table_name") or "")
        names.append(qualified.rpartition(".")[2] or qualified)
    # A pack can rename a captured table and put a view in its place under the
    # original name, so the registry names the renamed table while /catalog names
    # the view. The hub page resolves these ids against /catalog by exact match.
    replacements = {
        source.shadows: source.table
        for source in registry.dataset_sources(warehouse, default_database)
        if source.shadows
    }
    return [_resolve_shadow_chain(replacements, name) for name in names if name]


def build_domain_hub(
    key: str,
    *,
    redash: RedashClient,
    warehouse: ClickHouseClient,
    db: Session,
    org_slug: str,
    api_key: str | None,
    cookie: str | None,
    default_database: str,
) -> DomainHubOut:
    query_ids = _tagged_ids(redash, "queries", key, api_key=api_key, cookie=cookie)
    dashboard_ids = _tagged_ids(redash, "dashboards", key, api_key=api_key, cookie=cookie)
    return DomainHubOut(
        key=key,
        label=humanize(key),
        icon=None,
        dataset_ids=_dataset_ids(warehouse, query_ids, default_database),
        dashboard_ids=dashboard_ids,
        counters=registry.counters(db, org_slug, key),
    )


def discover_keys(
    redash: RedashClient, db: Session, org_slug: str, *, api_key: str | None, cookie: str | None
) -> list[str]:
    """Every domain that anything is actually filed under.

    Redash has no "list distinct tags" endpoint, so the tag half is read off the
    queries and dashboards carrying any domain tag. The provider half is a union,
    never a filter: a key nothing is tagged with still gets a hub.
    """
    keys: set[str] = set()
    for collection in ("queries", "dashboards"):
        for row in redash.list_tagged(collection, "", api_key=api_key, cookie=cookie):
            tags = row.get("tags")
            if not isinstance(tags, list):
                continue
            for tag in tags:
                if isinstance(tag, str) and tag.startswith(TAG_PREFIX):
                    trimmed = tag[len(TAG_PREFIX) :].strip()
                    if trimmed:
                        keys.add(trimmed)
    keys.update(registry.domain_keys(db, org_slug))
    return sorted(keys)
