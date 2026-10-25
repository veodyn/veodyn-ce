from sqlalchemy import UniqueConstraint

from .base import Column, db, key_type, primary_key


class ClientOperation(db.Model):
    id = primary_key("ClientOperation")
    org_id = Column(key_type("Organization"), db.ForeignKey("organizations.id"), nullable=False)
    user_id = Column(key_type("User"), db.ForeignKey("users.id"), nullable=False)
    key = Column(db.String(200), nullable=False)
    object_type = Column(db.String(32), nullable=False)
    object_id = Column(db.Integer, nullable=False)
    created_at = Column(db.DateTime(True), default=db.func.now(), nullable=False)

    __tablename__ = "client_operations"
    __table_args__ = (UniqueConstraint("org_id", "user_id", "key", name="client_operations_org_user_key"),)
