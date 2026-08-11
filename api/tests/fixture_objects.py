"""A taggable, favoritable kind contributed the way a pack contributes one.

Tags, favorites, the domain hub and the object-type registry are community
surfaces, and every one of them was tested through `kpi` and `report` because
those were the only kinds in the tree. They are not in it any more. Rewriting
those tests to assert on nothing would have quietly deleted the coverage; this
supplies a kind of their own instead, registered through exactly the seam the
enterprise pack registers through, so the community suite tests the seam rather
than a built-in.

**Its own declarative base, not the product one.** `widget` must never enter
`veodyn_api.models.base.Base.metadata`: the Alembic ownership tests compare that
metadata against a database built by the migrations, and a table in one and not
the other reads as a missing migration. The session engine fixture creates both
metadatas and the truncate sweeps both, which is the only place the two meet.

The authorization rule is owner-or-admin, the KPI rule rather than the dataset
one, because that is the branch worth keeping under test: a kind whose guard
does nothing cannot show that `routers/tags.py` still asks the descriptor.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Float, Text, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from veodyn_api.auth import Identity
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.registry import (
    ObjectType,
    register_counter_provider,
    register_domain_key_provider,
    register_object_type,
    restored_registries,
)
from veodyn_api.schemas.catalog import HubCounterOut

FIXTURE_KIND = "widget"
"""The kind name. Deliberately not `kpi` or `report`: a community build has
neither, and a test that named one would be asserting against a kind the code
under test could only have got from a pack."""

SECOND_FIXTURE_KIND = "gadget"
"""A second kind, on the same table.

Not decoration: the tag vocabulary is shared ACROSS kinds, and one kind cannot
tell a global vocabulary from a per-kind one. `kpi` and `report` were the two
that made that assertion mean something and both left, so there have to be two
here as well. One table serves both, because a tag row is keyed
(org, object_type, object_id) and nothing about the vocabulary reads the object.
"""


class FixtureBase(DeclarativeBase):
    """A metadata of its own, so nothing here reaches the product one."""


class Widget(FixtureBase):
    """The smallest row a taggable, favoritable object needs.

    (org_slug, id) is the key, because that is the shape `routers/tags.py` and
    `routers/favorites.py` build their existence SELECT from, and `owner_user_id`
    is what the guard below compares. `domain` is here for the hub tests: the
    counter provider they register reads it.
    """

    __tablename__ = "fixture_widget"

    org_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False, default="A Widget")
    owner_user_id: Mapped[int] = mapped_column(nullable=False, default=7)
    # The hub half. `domain` is the key a counter provider files this row under,
    # and a null `reading` is the "never evaluated" case: the provider leaves it
    # out rather than reporting a zero it invented.
    domain: Mapped[str | None] = mapped_column(Text, nullable=True)
    reading: Mapped[float | None] = mapped_column(Float, nullable=True)


def load_widget(db: Session, identity: Identity, object_id: str) -> Widget:
    """404 before any ownership check, so a cross-org id never confirms a row
    exists in another tenant. The rule the KPI guard applies, kept because the
    tag tests assert the order it produces."""
    widget = db.get(Widget, (identity.org_slug, object_id))
    if widget is None:
        raise ApiError(ErrorId.UNKNOWN_OBJECT_TYPE, f"no widget {object_id}", status_code=404)
    return widget


def authorize_widget_tag_write(db: Session, identity: Identity, object_id: str) -> None:
    widget = load_widget(db, identity, object_id)
    if widget.owner_user_id != identity.user_id and not identity.is_admin:
        raise ApiError(ErrorId.FORBIDDEN, "only the owner or an admin may tag this widget", status_code=403)


WIDGET_OBJECT_TYPE = ObjectType(
    kind=FIXTURE_KIND,
    not_found=ErrorId.UNKNOWN_OBJECT_TYPE,
    taggable=True,
    favoritable=True,
    model=Widget,
    authorize_tag_write=authorize_widget_tag_write,
)


GADGET_OBJECT_TYPE = ObjectType(
    kind=SECOND_FIXTURE_KIND,
    not_found=ErrorId.UNKNOWN_OBJECT_TYPE,
    taggable=True,
    favoritable=True,
    model=Widget,
    authorize_tag_write=authorize_widget_tag_write,
)


@contextmanager
def registered_fixture_kinds() -> Iterator[tuple[ObjectType, ObjectType]]:
    """Register both kinds for the duration of a block, then put the registries
    back. Not registered at import: a community build has three object kinds and
    two more appearing because a test module was collected would be a fixture
    changing the thing it measures."""
    with restored_registries():
        register_object_type(WIDGET_OBJECT_TYPE)
        register_object_type(GADGET_OBJECT_TYPE)
        yield WIDGET_OBJECT_TYPE, GADGET_OBJECT_TYPE


def make_widget(
    db: Session,
    *,
    object_id: str = "w-1",
    org_slug: str = "default",
    owner_user_id: int = 7,
    name: str = "A Widget",
    domain: str | None = None,
    reading: float | None = None,
) -> Widget:
    widget = Widget(
        org_slug=org_slug,
        id=object_id,
        name=name,
        owner_user_id=owner_user_id,
        domain=domain,
        reading=reading,
    )
    db.add(widget)
    db.commit()
    return widget


def widget_counters(db: Session, org_slug: str, key: str) -> list[HubCounterOut]:
    """A hub counter per widget filed under one domain key.

    The community half of what the KPI provider does, and deliberately keeping
    the one behaviour a hub test can get wrong on its own: a row with no reading
    is left out rather than shown as zero, because a confident zero is a number
    the service invented.
    """
    rows = db.execute(select(Widget).where(Widget.org_slug == org_slug, Widget.domain == key)).scalars().all()
    return [HubCounterOut(label=row.name, value=row.reading, kpi_id=row.id) for row in rows if row.reading is not None]


def widget_domain_keys(db: Session, org_slug: str) -> set[str]:
    """Domains the widgets themselves are filed under, so a domain with one
    widget and no tagged query is still discovered."""
    rows = db.execute(select(Widget.domain).where(Widget.org_slug == org_slug)).scalars().all()
    return {domain for domain in rows if domain}


@contextmanager
def registered_fixture_hub() -> Iterator[None]:
    """The two hub seams, filled by the fixture kind rather than by KPIs."""
    with restored_registries():
        register_counter_provider(widget_counters)
        register_domain_key_provider(widget_domain_keys)
        yield
