"""Domain hubs, assembled from facts that already exist.

A domain is not a thing this service stores. It is a label three other systems
already carry, and a hub is the join across them:

    Redash tag `domain:<key>` on a query      -> the datasets it captures into
    Redash tag `domain:<key>` on a dashboard  -> the dashboards to link
    whatever registered a counter provider    -> the counters along the top

Membership therefore lives where the thing itself lives: an analyst tags a
query in Redash and it appears in the hub, with no second registry to keep in
step. Redash applies the caller's permissions to both tag lookups, so a hub
never names a query or dashboard its reader could not open.

The counters are the third source and this module owns none of it. It asks the
registry twice, for two different questions, which is why there are two
provider registries rather than one:

- `registry.counters` builds the tiles for one key. It is a list per provider,
  not one tile, because the provider that owns a concept is the only thing that
  can batch its own reads: the KPI provider enumerates a domain's KPIs and
  fetches their history in one statement.
- `registry.domain_keys` contributes keys to discovery. A concept can know
  about a domain that nothing in Redash is tagged with, and that domain still
  gets a hub.

With no provider registered a hub is its tagged queries and dashboards and no
counter row at all, which is the honest answer: the concept does not exist in
this build, rather than existing and reading zero.
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

    The tenant's own label for a domain lives in veodyn-de's config YAML, which
    this service does not read. Rather than guess at a different name, this
    turns the key back into words: `air-quality` reads as `Air Quality`. The
    frontend still has the configured label and may prefer it.
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
        # Redash changed shape, and that should surface as a hub missing its
        # members, not as a swallowed exception per row.
        if isinstance(row_id, int) and not isinstance(row_id, bool):
            ids.append(row_id)
        elif isinstance(row_id, str) and row_id.isdigit():
            ids.append(int(row_id))
    return ids


def _resolve_shadow_chain(replacements: dict[str, str], name: str) -> str:
    """Follow a chain of shadow declarations to its fixed point.

    A shadowed table keeps its own real name, so it can itself be shadowed by
    a later pack: one hop resolves the common case but stops short once that
    happens, landing on the middle name instead of the one /catalog actually
    serves. apply_shadowing does not have this problem because it removes
    every declared target in one pass over the whole list; this walks the same
    chain hop by hop to reach the same answer.

    The `seen` set is a cycle guard. Two shadow declarations pointing at each
    other would otherwise spin forever; a malformed pair like that should
    resolve to whatever name it last reached rather than hang the endpoint.
    """
    seen = {name}
    while name in replacements and replacements[name] not in seen:
        name = replacements[name]
        seen.add(name)
    return name


def _dataset_ids(warehouse: ClickHouseClient, query_ids: list[int], default_database: str) -> list[str]:
    """The captured tables belonging to a set of queries.

    Ids match the ones /catalog emits (the bare table name), because the domain
    page resolves them against that list. A tagged query with no capture yet is
    simply not a dataset, so it does not appear.

    The same goes for a warehouse where nothing has been captured at all, or
    where the `historical` database itself has never been created: the
    registry table does not exist until Redash's first capture creates it, and
    a hub on a fresh install is a hub with no datasets, not a failed read. Both
    the missing table and the missing database are swallowed here, matching
    services/capture_sources.capture_sources, which reads the same table and
    makes the same distinction.
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
    # original name. The registry then names the renamed table and /catalog
    # names the view, and the hub page resolves these ids against /catalog by
    # exact match, so without this the dataset drops out of its own hub while
    # sitting in the catalog the whole time.
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

    Read off the tags themselves plus whatever the key providers contribute, so
    the list is whatever the org has actually filed rather than a registry of
    domains that can go stale. Redash has no "list distinct tags" endpoint, so
    the tag half comes from the one it does have: the queries and dashboards
    carrying any domain tag.

    The provider half is a union, never a filter. A key nothing is tagged with
    still gets a hub if a provider knows about it, which is the case a plain
    counter lookup keyed off the tag-derived list would silently drop.
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
