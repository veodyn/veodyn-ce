"""GET /published-feeds/capabilities: what this deployment's entity registry
actually holds, read at runtime.

Root CLAUDE.md records that an installed layer is inert until a deployment
names it, and the deploy succeeds either way -- a values file that looks
correct is not evidence. This endpoint is the evidence, for feeds.

`test_widening_the_registry_widens_what_this_endpoint_reports` doubles as the
regression guard for the routing order this module's own docstring describes:
`routers/__init__.py` registers `feed_capabilities_router` ahead of
`published_feeds_router` so `/published-feeds/{slug}` cannot swallow
`/published-feeds/capabilities` first. If that ordering ever regressed, this
request would come back as a 404 naming a feed called "capabilities" rather
than the entities list these tests assert on.
"""

import respx
from fastapi.testclient import TestClient

from tests.published_feed_route_stubs import ADMIN, MEMBER, as_user, auth
from veodyn_api.services import feed_registry


@respx.mock
def test_capabilities_reports_what_is_registered(api: TestClient) -> None:
    as_user(ADMIN)

    response = api.get("/published-feeds/capabilities", headers=auth())

    assert response.status_code == 200
    # The literal, not `sorted(feed_registry.entities())`. Comparing the
    # response to the same expression the handler evaluates makes the two move
    # together: a community build that stopped seeding its own vocabulary would
    # answer `[]` and still pass. Pinned here, so this test says what community
    # ships rather than only that the handler reads the registry it reads.
    assert response.json() == {"entities": ["vehicle_positions"]}


@respx.mock
def test_widening_the_registry_widens_what_this_endpoint_reports(api: TestClient) -> None:
    as_user(ADMIN)

    with feed_registry.restored_entities():
        feed_registry.register_entity("trip_updates")
        response = api.get("/published-feeds/capabilities", headers=auth())

    assert response.json() == {"entities": ["trip_updates", "vehicle_positions"]}


@respx.mock
def test_any_org_member_may_read_capabilities(api: TestClient) -> None:
    """A read, not a write: it names what this build can bind a feed to, which
    changes neither data nor permissions, so it takes no admin gate."""
    as_user(MEMBER)

    response = api.get("/published-feeds/capabilities", headers=auth("mo"))

    assert response.status_code == 200
