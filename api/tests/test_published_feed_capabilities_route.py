"""GET /published-feeds/capabilities: what this deployment's feed registry
actually holds, per standard, read at runtime.

Root CLAUDE.md records that an installed layer is inert until a deployment
names it, and the deploy succeeds either way -- a values file that looks
correct is not evidence. This endpoint is the evidence, for feeds.

`test_widening_the_registry_widens_what_this_endpoint_reports` doubles as the
regression guard for the routing order this module's own docstring describes:
`routers/__init__.py` registers `published_feed_capabilities_router` ahead of
`published_feeds_router` so `/published-feeds/{slug}` cannot swallow
`/published-feeds/capabilities` first. If that ordering ever regressed, this
request would come back as a 404 naming a feed called "capabilities" rather
than the standards list these tests assert on.
"""

import respx
from fastapi.testclient import TestClient

from tests.published_feed_route_stubs import ADMIN, MEMBER, as_user, auth
from veodyn_api.services import gbfs_vocabulary, published_feed_registry


@respx.mock
def test_capabilities_reports_what_is_registered(api: TestClient) -> None:
    as_user(ADMIN)

    response = api.get("/published-feeds/capabilities", headers=auth())

    assert response.status_code == 200
    # The literals, not the expressions the handler evaluates. Comparing the
    # response to `sorted(published_feed_registry.entities(...))` would make the two move
    # together: a community build that stopped seeding its own vocabulary would
    # answer empty lists and still pass. Pinned here, so this test says what
    # community ships rather than only that the handler reads the registry it
    # reads.
    body = response.json()
    # Dropped before the comparison and asserted on its own below: the gbfs
    # entry carries a 597-name enum, and inlining it here would bury what this
    # test pins.
    for entry in body["standards"]:
        entry.pop("timezones")
    assert body == {
        "standards": [
            {"standard": "gbfs", "versions": ["2.3", "3.0"], "entities": ["stations"]},
            {"standard": "gtfs-rt", "versions": ["2.0"], "entities": ["vehicle_positions"]},
        ]
    }


@respx.mock
def test_gbfs_timezones_come_from_the_schema_that_judges_a_publish(api: TestClient) -> None:
    """The names are the validator's own enum, so the picker cannot offer a
    value that publishing would then refuse."""
    as_user(ADMIN)

    response = api.get("/published-feeds/capabilities", headers=auth())

    by_standard = {entry["standard"]: entry for entry in response.json()["standards"]}
    timezones = by_standard["gbfs"]["timezones"]
    assert timezones == sorted(timezones)
    for name in ("UTC", "America/Los_Angeles", "Europe/Berlin", "Asia/Tokyo"):
        assert name in timezones
    assert "America/Nowhere" not in timezones
    # gtfs-rt binds no system declaration, so it names no timezone at all.
    assert by_standard["gtfs-rt"]["timezones"] == []


@respx.mock
def test_an_unreadable_schema_reports_no_timezones_rather_than_failing(api: TestClient) -> None:
    """The picker degrades to a text field. A capabilities read that 500s over
    one absent enum would take the entity and version answers down with it."""
    as_user(ADMIN)
    versions = published_feed_registry.VERSIONS_BY_STANDARD["gbfs"]
    published_feed_registry.VERSIONS_BY_STANDARD["gbfs"] = (*versions, "9.9")
    gbfs_vocabulary._gbfs_timezones.cache_clear()
    try:
        response = api.get("/published-feeds/capabilities", headers=auth())
    finally:
        published_feed_registry.VERSIONS_BY_STANDARD["gbfs"] = versions
        gbfs_vocabulary._gbfs_timezones.cache_clear()

    assert response.status_code == 200
    by_standard = {entry["standard"]: entry for entry in response.json()["standards"]}
    assert by_standard["gbfs"]["timezones"] == []
    assert by_standard["gbfs"]["entities"] == ["stations"]


@respx.mock
def test_widening_the_registry_widens_what_this_endpoint_reports(api: TestClient) -> None:
    as_user(ADMIN)

    with published_feed_registry.restored_entities():
        published_feed_registry.register_entity("trip_updates")
        response = api.get("/published-feeds/capabilities", headers=auth())

    by_standard = {entry["standard"]: entry for entry in response.json()["standards"]}
    assert by_standard["gtfs-rt"]["entities"] == ["trip_updates", "vehicle_positions"]
    # The widening is scoped to one standard, so the other must not move.
    assert by_standard["gbfs"]["entities"] == ["stations"]


@respx.mock
def test_a_standard_only_a_pack_registers_appears_with_no_declared_versions(api: TestClient) -> None:
    """`VERSIONS_BY_STANDARD` is community's declaration, so a standard a pack
    invents reports an empty version list rather than failing the read."""
    as_user(ADMIN)

    with published_feed_registry.restored_entities():
        published_feed_registry.register_entity("shapes", "gtfs-static")
        response = api.get("/published-feeds/capabilities", headers=auth())

    by_standard = {entry["standard"]: entry for entry in response.json()["standards"]}
    assert by_standard["gtfs-static"] == {
        "standard": "gtfs-static",
        "versions": [],
        "entities": ["shapes"],
        "timezones": [],
    }


@respx.mock
def test_any_org_member_may_read_capabilities(api: TestClient) -> None:
    """A read, not a write: it names what this build can bind a feed to, which
    changes neither data nor permissions, so it takes no admin gate."""
    as_user(MEMBER)

    response = api.get("/published-feeds/capabilities", headers=auth("mo"))

    assert response.status_code == 200
