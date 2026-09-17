from collections.abc import Iterator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from veodyn_api.settings import get_settings


def build_engine(database_url: str) -> Engine:
    return create_engine(database_url, pool_pre_ping=True, hide_parameters=True)


_engine = build_engine(get_settings().database_url)
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
