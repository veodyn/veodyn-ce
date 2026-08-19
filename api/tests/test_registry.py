"""The object-type seam, proved at the endpoints that resolve through it.

A registry test that registers something and then reads it back is a tautology:
it asserts that a dict is a dict. What has to be true is that the real tag and
favorites endpoints resolve a kind through this registry rather than through a
Literal on the route, so nearly everything here goes over HTTP, and every
positive assertion has a negative one beside it: an unregistered kind must be
REFUSED, not defaulted.

The 422 in `test_an_unregistered_kind_is_refused_by_the_tag_route_as_a_404` is
the whole reason the descriptor is not a `{kind: model}` dict. FastAPI validated
the path against `Literal["kpi", "report", "dataset"]` before any handler code
ran, so a registered kind was rejected with a 422 no matter what a registry
said. Restore that annotation and this file goes red in four places.

A community build registers exactly one kind, `dataset`, from
`routers/catalog.py`. `kpi` and `report` come from the enterprise pack, and the
assertions that used to name them are in the pack's copy of this file, where
there is something to name.

The other seams (routers, jobs, counters, domain keys) are in
test_registry_providers.py, which keeps both files inside the 300-line block.
"""

from dataclasses import replace

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.tag_stubs import JANE, as_user, auth
from veodyn_api.auth import Identity
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.registry import ObjectType, object_kinds, object_type, register_object_type, restored_registries
from veodyn_api.services import tags as tag_service


@pytest.fixture(autouse=True)
def _registries() -> object:
    """Put every registry back after each test, so a fake kind cannot leak into
    the next one and make it pass for the wrong reason."""
    with restored_registries():
        yield


def _allow(db: Session, identity: Identity, object_id: str) -> None:
    """A kind whose tag write nobody gates. Datasets are already the real case."""


def _always_refuse(db: Session, identity: Identity, object_id: str) -> None:
    raise ApiError(ErrorId.FORBIDDEN, "gizmos are not yours to label", status_code=403)


def _refuse_as_missing(db: Session, identity: Identity, object_id: str) -> None:
    raise ApiError(ErrorId.CAPTURE_NOT_WATCHABLE, "no such gadget", status_code=404)


# A kind no build actually ships, which is the point: it stands in for whatever
# a pack contributes. `not_found` borrows a real id because ErrorId is a closed
# enum in this package, which is also true of a pack.
GIZMO = ObjectType(
    kind="gizmo",
    not_found=ErrorId.DATASET_NOT_FOUND,
    taggable=True,
    favoritable=True,
    model=None,
    authorize_tag_write=_allow,
)


def test_an_object_type_is_resolved_through_the_registry_not_a_literal() -> None:
    register_object_type(GIZMO)

    assert object_type("gizmo") is GIZMO
    # The built-in kind comes through the same door the fake one does, and it is
    # the only one a community build has.
    assert object_type("dataset").model is None
    assert object_kinds() == ("dataset", "gizmo")


def test_an_unknown_object_type_is_rejected_rather_than_defaulting() -> None:
    with pytest.raises(ApiError) as raised:
        object_type("nope")

    assert raised.value.error_id is ErrorId.UNKNOWN_OBJECT_TYPE
    # 404 rather than 422: "this build has no such kind" is the same answer as
    # "no such object", and CE must not advertise which kinds an EE build has.
    assert raised.value.status_code == 404


def test_registering_a_kind_twice_is_the_later_definition() -> None:
    """A pack loaded over a built-in replaces it rather than being ignored, and
    the kind is listed once either way."""
    register_object_type(GIZMO)
    replacement = replace(GIZMO, taggable=False)
    register_object_type(replacement)

    assert object_type("gizmo") is replacement
    assert object_kinds().count("gizmo") == 1


@respx.mock
def test_a_registered_kind_reaches_the_tag_handler_rather_than_a_422(api: TestClient) -> None:
    as_user(JANE)
    register_object_type(GIZMO)

    response = api.put("/tags/gizmo/w-1", json={"tags": ["x"]}, headers=auth())

    assert response.status_code == 200
    assert response.json() == {"tags": ["x"]}


@respx.mock
def test_an_unregistered_kind_is_refused_by_the_tag_route_as_a_404(api: TestClient) -> None:
    """Not registered, so refused. The status is the interesting half: 422 here
    means the Literal is back and the registry is decorative."""
    as_user(JANE)

    response = api.put("/tags/gizmo/w-1", json={"tags": ["x"]}, headers=auth())

    assert response.status_code == 404
    assert response.json()["error"]["id"] == "VEODYN_UNKNOWN_OBJECT_TYPE"


@respx.mock
def test_a_kind_registered_as_untaggable_cannot_be_tagged(api: TestClient) -> None:
    """`taggable` is read, not assumed from being registered: `dataset` is the
    real case in the other direction, favoritable=False and taggable=True."""
    as_user(JANE)
    register_object_type(replace(GIZMO, taggable=False))

    response = api.put("/tags/gizmo/w-1", json={"tags": ["x"]}, headers=auth())

    assert response.status_code == 404
    assert response.json()["error"]["id"] == "VEODYN_UNKNOWN_OBJECT_TYPE"


@respx.mock
def test_tag_write_authorization_comes_from_the_descriptor(api: TestClient) -> None:
    """Not "a guard ran": the guard the descriptor names ran, with the object's
    own id, which is what a per-kind rule has to be to be worth anything."""
    as_user(JANE)
    seen: list[str] = []
    register_object_type(replace(GIZMO, authorize_tag_write=lambda db, identity, object_id: seen.append(object_id)))

    api.put("/tags/gizmo/w-1", json={"tags": ["x"]}, headers=auth())

    assert seen == ["w-1"]


@respx.mock
def test_a_kind_whose_authorization_raises_does_not_write(api: TestClient, db: Session) -> None:
    as_user(JANE)
    register_object_type(replace(GIZMO, authorize_tag_write=_always_refuse))

    response = api.put("/tags/gizmo/w-1", json={"tags": ["x"]}, headers=auth())

    assert response.status_code == 403
    assert tag_service.tags_for(db, "default", "gizmo", "w-1") == []


@respx.mock
def test_two_registered_kinds_keep_their_own_authorization(api: TestClient) -> None:
    """The refactor's real risk is flattening the rules into one. Two kinds whose
    guards refuse for different reasons must answer differently, which only holds
    if the router asked each descriptor rather than applying a shared rule.

    Named `gizmo` and `gadget` here. This was `kpi` and `report` until both went
    to the pack, and the property does not depend on which kinds they are: what
    it depends on is there being two with different guards.
    """
    as_user(JANE)
    register_object_type(GIZMO)
    register_object_type(replace(GIZMO, kind="gadget", authorize_tag_write=_refuse_as_missing))

    refused = api.put("/tags/gizmo/nope", json={"tags": ["x"]}, headers=auth())
    missing = api.put("/tags/gadget/nope", json={"tags": ["x"]}, headers=auth())

    assert refused.status_code == 200
    assert missing.status_code == 404
    assert missing.json()["error"]["id"] == "VEODYN_CAPTURE_NOT_WATCHABLE"


@respx.mock
def test_favorites_lists_one_key_per_registered_favoritable_kind(api: TestClient) -> None:
    as_user(JANE)

    # `dataset` is registered and taggable, and it is absent here, so the
    # `favoritable` flag is read rather than the kind list being echoed. It is
    # also the only kind a community build has, so the response is empty: not a
    # degraded state, just the honest answer of a build with no packs.
    assert api.get("/favorites", headers=auth()).json() == {}

    register_object_type(GIZMO)

    assert api.get("/favorites", headers=auth()).json() == {"gizmo": []}


@respx.mock
def test_a_kind_that_is_not_favoritable_cannot_be_starred(api: TestClient) -> None:
    as_user(JANE)

    response = api.post("/favorites/dataset/anything", headers=auth())

    assert response.status_code == 404
    assert response.json()["error"]["id"] == "VEODYN_UNKNOWN_OBJECT_TYPE"


@respx.mock
def test_a_favoritable_kind_with_no_row_here_cannot_be_starred(api: TestClient) -> None:
    """A star is written as INSERT..SELECT against the object's own table, so a
    kind with no table has nothing to gate the insert on. It can be listed and
    unstarred; it cannot be starred."""
    as_user(JANE)
    register_object_type(GIZMO)

    response = api.post("/favorites/gizmo/w-1", headers=auth())

    assert response.status_code == 404
    assert response.json()["error"]["id"] == "VEODYN_UNKNOWN_OBJECT_TYPE"
