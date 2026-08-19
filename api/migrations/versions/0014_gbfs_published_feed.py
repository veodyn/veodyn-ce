"""gbfs published feeds: optional static ref, system_info, feed_files artifact

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-18

`static_gtfs_ref` is what a GTFS-RT feed is validated against, and a GBFS feed
has no schedule to validate against, so it drops NOT NULL. What replaces it for
GBFS is `system_info`, the system-level declaration that is not query output.
Neither column is merely optional: each is required by exactly one standard and
refused by the other, so a binding cannot carry the wrong half.

`publish_attempt` gains `feed_files`, the parsed JSON file set a GBFS publish
serves; GTFS-RT keeps `feed_bytes`. The bytes CHECK is replaced by two, because
"published if and only if bytes exist" would refuse every GBFS publish. The
pair keeps both halves of what it said: an artifact exists if and only if the
attempt published, and an attempt holds one kind of artifact, never both.

Existing rows satisfy all four: every one is `gtfs-rt` with a non-null ref, and
`feed_files` starts NULL everywhere.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("published_feed", "static_gtfs_ref", existing_type=sa.Text(), nullable=True)
    op.add_column("published_feed", sa.Column("system_info", postgresql.JSONB(), nullable=True))
    op.create_check_constraint(
        "ck_published_feed_static_ref_matches_standard",
        "published_feed",
        "(standard = 'gtfs-rt') = (static_gtfs_ref IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_published_feed_system_info_matches_standard",
        "published_feed",
        "(standard = 'gbfs') = (system_info IS NOT NULL)",
    )

    op.add_column("publish_attempt", sa.Column("feed_files", postgresql.JSONB(), nullable=True))
    op.drop_constraint("ck_publish_attempt_bytes_match_decision", "publish_attempt", type_="check")
    op.create_check_constraint(
        "ck_publish_attempt_artifact_matches_decision",
        "publish_attempt",
        "(decision = 'published') = (feed_bytes IS NOT NULL OR feed_files IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_publish_attempt_one_artifact_kind",
        "publish_attempt",
        "NOT (feed_bytes IS NOT NULL AND feed_files IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_publish_attempt_one_artifact_kind", "publish_attempt", type_="check")
    op.drop_constraint("ck_publish_attempt_artifact_matches_decision", "publish_attempt", type_="check")
    op.create_check_constraint(
        "ck_publish_attempt_bytes_match_decision",
        "publish_attempt",
        "(decision = 'published') = (feed_bytes IS NOT NULL)",
    )
    op.drop_column("publish_attempt", "feed_files")
    op.drop_constraint("ck_published_feed_system_info_matches_standard", "published_feed", type_="check")
    op.drop_constraint("ck_published_feed_static_ref_matches_standard", "published_feed", type_="check")
    op.drop_column("published_feed", "system_info")
    op.alter_column("published_feed", "static_gtfs_ref", existing_type=sa.Text(), nullable=False)
