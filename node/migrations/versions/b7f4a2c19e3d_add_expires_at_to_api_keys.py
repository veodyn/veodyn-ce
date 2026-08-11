"""add expires_at to api_keys

Revision ID: b7f4a2c19e3d
Revises: db0aca1ebd32
Create Date: 2026-07-28 10:14:02.883104

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b7f4a2c19e3d"
down_revision = "db0aca1ebd32"
branch_labels = None
depends_on = None


def upgrade():
    # Nullable, so every key already in the wild keeps working forever.
    op.add_column("api_keys", sa.Column("expires_at", sa.DateTime(True), nullable=True))


def downgrade():
    op.drop_column("api_keys", "expires_at")
