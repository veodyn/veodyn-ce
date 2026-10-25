from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ai_chat_draft_promotion", sa.Column("status", sa.Text(), server_default="done", nullable=False))
    op.add_column(
        "ai_chat_draft_promotion",
        sa.Column(
            "receipts", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
    )
    op.add_column(
        "ai_chat_draft_promotion",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.alter_column("ai_chat_draft_promotion", "target_id", existing_type=sa.Text(), nullable=True)
    op.add_column("ai_chat_thread", sa.Column("applied_reported_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ai_chat_turn", sa.Column("applied_cutoff", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    unrepresentable = (
        op.get_bind()
        .execute(sa.text("SELECT count(*) FROM ai_chat_draft_promotion WHERE target_id IS NULL"))
        .scalar_one()
    )
    if unrepresentable:
        raise RuntimeError(
            f"0019 cannot be reversed while {unrepresentable} ai_chat_draft_promotion row(s) have no target_id, "
            "because the schema at 0018 declares it NOT NULL. Delete those promotions, then run this downgrade again."
        )
    op.drop_column("ai_chat_turn", "applied_cutoff")
    op.drop_column("ai_chat_thread", "applied_reported_at")
    op.alter_column("ai_chat_draft_promotion", "target_id", existing_type=sa.Text(), nullable=False)
    op.drop_column("ai_chat_draft_promotion", "updated_at")
    op.drop_column("ai_chat_draft_promotion", "receipts")
    op.drop_column("ai_chat_draft_promotion", "status")
