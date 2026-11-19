from typing import Generator, Optional

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings
from app.core.errors import ServiceUnavailableError


class Base(DeclarativeBase):
    """Declarative base for all VisionX AI SQLAlchemy models."""


_engine: Optional[Engine] = None
_session_factory: Optional[sessionmaker[Session]] = None


def get_engine() -> Optional[Engine]:
    global _engine, _session_factory
    settings = get_settings()
    if not settings.database_configured:
        return None
    if _engine is None:
        _engine = create_engine(
            settings.database_url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
        )
        _session_factory = sessionmaker(bind=_engine, autocommit=False, autoflush=False)
    return _engine


def get_db() -> Generator[Session, None, None]:
    engine = get_engine()
    if engine is None or _session_factory is None:
        raise ServiceUnavailableError(
            "Database connection is not configured. Set DATABASE_URL in .env."
        )
    db = _session_factory()
    try:
        yield db
    finally:
        db.close()


def check_database_health() -> bool:
    engine = get_engine()
    if engine is None:
        return False
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return True
