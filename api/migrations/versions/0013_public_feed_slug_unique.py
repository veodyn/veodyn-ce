"""one public feed per slug, across every org

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-14

`published_feed` is keyed `(org_slug, slug)`, so a slug is unique only inside
one org. That was fine while every read carried an org. The anonymous serving
endpoint added in this change does not: `GET /public/feeds/<slug>` has no org
segment, so two orgs each publishing a `public` feed at the same slug leaves it
with no way to tell which one a caller meant.

Refusing that case at read time (the endpoint answers its ordinary 404 when the
slug matches more than one row) keeps it from serving the wrong org's bytes,
but it makes the collision itself a weapon: an administrator of any other org
can create a `public` binding at a victim's known slug, publish nothing at all,
and the victim's live feed goes dark. This index removes the collision instead
of arbitrating it, so that attack has nowhere to land.

Partial, on `visibility = 'public'` only. A private feed is not addressable
anonymously and never collides, so private slugs stay per-org exactly as they
were, and an org keeps its freedom to name a private feed whatever it likes.

It also gives the anonymous lookup an index it can actually use. That query
filters on `slug`, which is the PRIMARY KEY's second column and therefore not
usable as a leading key, so without this every request from the internet cost a
sequential scan of the whole table.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEX_NAME = "uq_published_feed_public_slug"


def upgrade() -> None:
    op.create_index(
        INDEX_NAME,
        "published_feed",
        ["slug"],
        unique=True,
        postgresql_where=sa.text("visibility = 'public'"),
    )


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name="published_feed")
