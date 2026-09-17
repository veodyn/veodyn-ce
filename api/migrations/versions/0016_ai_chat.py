from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamp(name: str, nullable: bool = False) -> sa.Column[sa.DateTime]:
    if nullable:
        return sa.Column(name, sa.DateTime(timezone=True), nullable=True)
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False)


def upgrade() -> None:
    op.create_table(
        "ai_chat_thread",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_subject", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), server_default="", nullable=False),
        sa.Column("pinned", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        _timestamp("last_turn_at"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_chat_thread_owner", "ai_chat_thread", ["owner_subject", "pinned", "last_turn_at"])
    op.create_table(
        "ai_chat_turn",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("thread_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("user_text", sa.Text(), nullable=False),
        sa.Column("blocks", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("usage", postgresql.JSONB(), nullable=True),
        sa.Column("stop_reason", sa.Text(), nullable=True),
        sa.Column("error_id", sa.Text(), nullable=True),
        _timestamp("created_at"),
        _timestamp("finished_at", nullable=True),
        sa.ForeignKeyConstraint(["thread_id"], ["ai_chat_thread.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("thread_id", "seq", name="uq_ai_chat_turn_seq"),
    )
    op.create_table(
        "ai_chat_draft",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("thread_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        _timestamp("created_at"),
        sa.ForeignKeyConstraint(["thread_id"], ["ai_chat_thread.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "ai_chat_draft_version",
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("turn_id", sa.Uuid(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        _timestamp("created_at"),
        sa.ForeignKeyConstraint(["draft_id"], ["ai_chat_draft.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["turn_id"], ["ai_chat_turn.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("draft_id", "version"),
    )
    op.create_table(
        "ai_chat_draft_promotion",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("target_type", sa.Text(), nullable=False),
        sa.Column("target_id", sa.Text(), nullable=False),
        sa.Column("promoted_version", sa.Integer(), nullable=False),
        sa.Column("target_version_at_promote", sa.Integer(), nullable=True),
        _timestamp("created_at"),
        sa.ForeignKeyConstraint(["draft_id"], ["ai_chat_draft.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("ai_chat_draft_promotion")
    op.drop_table("ai_chat_draft_version")
    op.drop_table("ai_chat_draft")
    op.drop_table("ai_chat_turn")
    op.drop_index("ix_ai_chat_thread_owner", table_name="ai_chat_thread")
    op.drop_table("ai_chat_thread")
