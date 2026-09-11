"""Database lifecycle and request-scoped transactions."""

from contextlib import contextmanager
from typing import Generator

from fastapi import Request
from sqlalchemy import Engine, create_engine, event, make_url, text
from sqlalchemy.exc import ArgumentError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.platform.errors import ApiError
from app.platform.models import Base
from app.platform.settings import Settings


class DatabaseUrlConfigurationError(ValueError):
    """Raised without echoing a malformed database credential."""


def normalize_database_url(url: str) -> str:
    candidate = url.strip()
    if candidate.startswith("postgres://"):
        candidate = "postgresql+psycopg://" + candidate[len("postgres://") :]
    elif (
        candidate.startswith("postgresql://")
        and "+" not in candidate.split("://", 1)[0]
    ):
        candidate = "postgresql+psycopg://" + candidate[len("postgresql://") :]

    try:
        make_url(candidate)
    except ArgumentError as exc:
        raise DatabaseUrlConfigurationError(
            "DATABASE_URL_INVALID: The database URI is malformed. Percent-encode "
            "special characters in the password (for example, @ as %40) and do "
            "not include placeholder brackets."
        ) from exc
    return candidate


class Database:
    def __init__(self, settings: Settings):
        url = normalize_database_url(settings.database_url)
        is_sqlite = url.startswith("sqlite")
        self.engine: Engine = create_engine(url, **self._engine_options(is_sqlite))
        if is_sqlite:
            event.listen(self.engine, "connect", self._enable_sqlite_foreign_keys)
        self.session_factory = sessionmaker(
            bind=self.engine,
            class_=Session,
            autoflush=False,
            expire_on_commit=False,
        )

    @staticmethod
    def _engine_options(is_sqlite: bool) -> dict:
        """Pool settings, which differ by dialect.

        SQLite keeps NullPool: the test suite runs on a per-test file database
        and depends on connections not outliving a session.

        PostgreSQL previously also used NullPool, which meant every request paid
        a full TCP + TLS + SCRAM handshake before its first query. A small pool
        lets a warm serverless instance reuse its connection instead. The pool
        stays deliberately tiny because Vercel serves one concurrent request per
        instance; max_overflow covers the case where a request opens a second
        session, and pool_timeout turns exhaustion into a fast error rather than
        a hang.

        pool_pre_ping is what makes pooling safe across a function freeze: a
        socket that died while the instance was suspended costs one cheap round
        trip to detect, instead of surfacing as a query error. pool_recycle
        bounds connection age below the idle timeout of a managed Postgres.
        """
        if is_sqlite:
            return {
                "poolclass": NullPool,
                "connect_args": {"check_same_thread": False},
            }
        return {
            "pool_size": 1,
            "max_overflow": 2,
            "pool_timeout": 5,
            "pool_recycle": 300,
            "pool_pre_ping": True,
            "connect_args": {
                "connect_timeout": 5,
                "application_name": "dreamify-api",
                "keepalives": 1,
                "keepalives_idle": 30,
            },
        }

    @staticmethod
    def _enable_sqlite_foreign_keys(connection, _record) -> None:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    def create_schema(self) -> None:
        Base.metadata.create_all(self.engine)

    def dispose(self) -> None:
        self.engine.dispose()

    @contextmanager
    def session(self) -> Generator[Session, None, None]:
        with self.session_factory() as db_session:
            try:
                yield db_session
                db_session.commit()
            except Exception:
                db_session.rollback()
                raise


def get_session(request: Request) -> Generator[Session, None, None]:
    database: Database = request.app.state.database
    with database.session() as session:
        yield session


def get_runtime_settings(request: Request) -> Settings:
    return request.app.state.settings


def ensure_database_write_capacity(session: Session, settings: Settings) -> None:
    """Fail new high-growth writes once the Postgres demo budget is exhausted.

    SQLite is used only for local and deterministic test runs, where
    ``pg_database_size`` does not exist. Production validation already requires
    PostgreSQL, so bypassing non-Postgres dialects is explicit and safe.
    """

    bind = session.get_bind()
    if bind.dialect.name != "postgresql":
        return
    try:
        used_bytes = session.scalar(text("SELECT pg_database_size(current_database())"))
    except SQLAlchemyError as exc:
        raise ApiError(
            503,
            "DATABASE_SIZE_UNAVAILABLE",
            "Database capacity could not be verified",
        ) from exc
    if used_bytes is None:
        raise ApiError(
            503,
            "DATABASE_SIZE_UNAVAILABLE",
            "Database capacity could not be verified",
        )
    if int(used_bytes) >= settings.max_database_bytes:
        raise ApiError(
            507,
            "DATABASE_SOFT_LIMIT",
            "Database storage soft limit has been reached",
            {
                "max_bytes": settings.max_database_bytes,
                "used_bytes": int(used_bytes),
            },
        )
