"""Engine pool configuration, which differs by dialect.

None of these tests opens a connection: create_engine is lazy, so the pool can
be inspected without a live PostgreSQL server.
"""

from sqlalchemy.pool import NullPool

from app.platform.database import Database
from app.platform.settings import Settings


def _settings(**overrides) -> Settings:
    base = {
        "app_env": "development",
        "cors_origins": ["http://localhost:3000"],
    }
    base.update(overrides)
    return Settings(**base)


def test_sqlite_keeps_null_pool(tmp_path):
    """The whole test suite runs on SQLite and must keep the engine it had."""
    database = Database(
        _settings(database_url=f"sqlite:///{tmp_path / 'platform.sqlite'}")
    )

    assert isinstance(database.engine.pool, NullPool)
    assert database.engine.dialect.name == "sqlite"


def test_postgresql_pools_connections():
    """A warm instance should reuse its connection instead of re-handshaking."""
    database = Database(
        _settings(database_url="postgresql://user:pw@db.example.test:5432/dreamify")
    )
    pool = database.engine.pool

    assert not isinstance(pool, NullPool)
    assert pool.size() == 1
    assert pool._max_overflow == 2
    assert pool._pre_ping is True
    assert pool._recycle == 300
    assert pool._timeout == 5


def test_postgresql_connect_args_bound_and_identified():
    """Connect timeout bounds a hung DNS or TLS handshake; the app name aids triage.

    Asserted on the options dict rather than the built engine: SQLAlchemy merges
    connect_args into the DBAPI call at connect time and does not expose them on
    the engine, so reading them back would mean reaching into pool internals.
    """
    connect_args = Database._engine_options(is_sqlite=False)["connect_args"]

    assert connect_args["connect_timeout"] == 5
    assert connect_args["application_name"] == "dreamify-api"
    assert connect_args["keepalives"] == 1
    assert connect_args["keepalives_idle"] == 30


def test_sqlite_options_carry_no_postgres_tuning():
    options = Database._engine_options(is_sqlite=True)

    assert options["poolclass"] is NullPool
    assert options["connect_args"] == {"check_same_thread": False}
    assert "pool_size" not in options
    assert "pool_pre_ping" not in options


def test_missing_direct_database_url_warns_without_raising():
    """A runtime missing DIRECT_DATABASE_URL warns; it must not refuse to boot."""
    settings = _settings(
        database_url="postgresql://user:pw@pooler.example.test:6543/dreamify",
    )

    warning = settings.direct_database_url_warning()
    assert warning is not None
    assert "DIRECT_DATABASE_URL is not set" in warning


def test_identical_pooled_and_direct_urls_warn():
    url = "postgresql://user:pw@db.example.test:5432/dreamify"
    settings = _settings(database_url=url, direct_database_url=url)

    warning = settings.direct_database_url_warning()
    assert warning is not None
    assert "matches DATABASE_URL" in warning


def test_distinct_pooled_and_direct_urls_are_silent():
    settings = _settings(
        database_url="postgresql://user:pw@pooler.example.test:6543/dreamify",
        direct_database_url="postgresql://user:pw@direct.example.test:5432/dreamify",
    )

    assert settings.direct_database_url_warning() is None


def test_migration_url_prefers_the_direct_endpoint():
    settings = _settings(
        database_url="postgresql://user:pw@pooler.example.test:6543/dreamify",
        direct_database_url="postgresql://user:pw@direct.example.test:5432/dreamify",
    )

    assert settings.migration_database_url == settings.direct_database_url
