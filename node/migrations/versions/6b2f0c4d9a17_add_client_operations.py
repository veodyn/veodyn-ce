import sqlalchemy as sa
from alembic import op

revision = "6b2f0c4d9a17"
down_revision = "29f3e1144ec5"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "client_operations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("key", sa.String(length=200), nullable=False),
        sa.Column("object_type", sa.String(length=32), nullable=False),
        sa.Column("object_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("org_id", "user_id", "key", name="client_operations_org_user_key"),
    )


def downgrade():
    op.drop_table("client_operations")
