from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from veodyn_api.settings import get_settings

_engine = create_engine(get_settings().database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a request-scoped session.

    Kept a plain generator with no commit or rollback of its own: routers own
    their transaction boundaries, and tests replace this whole function through
    app.dependency_overrides.
    """
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
