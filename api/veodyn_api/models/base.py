from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for every table this service owns.

    Redash's schema is never mapped here. This metadata is what alembic
    autogenerates against, so anything registered on it is ours.
    """
