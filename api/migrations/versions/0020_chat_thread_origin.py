from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ai_chat_thread", sa.Column("origin", sa.Text(), server_default="chat", nullable=False))


def downgrade() -> None:
    op.drop_column("ai_chat_thread", "origin")
