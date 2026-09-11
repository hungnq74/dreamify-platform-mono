from types import SimpleNamespace

import pytest

from app.platform.database import (
    DatabaseUrlConfigurationError,
    ensure_database_write_capacity,
    normalize_database_url,
)
from app.platform.errors import ApiError


class CapacitySession:
    def __init__(self, dialect: str, used_bytes=None):
        self.bind = SimpleNamespace(dialect=SimpleNamespace(name=dialect))
        self.used_bytes = used_bytes
        self.queries = []

    def get_bind(self):
        return self.bind

    def scalar(self, statement):
        self.queries.append(str(statement))
        return self.used_bytes


def test_database_url_normalizes_postgres_driver_without_exposing_credentials():
    assert normalize_database_url(
        " postgresql://app:encoded%40password@db.example.test:5432/dreamify "
    ) == ("postgresql+psycopg://app:encoded%40password@db.example.test:5432/dreamify")


def test_database_url_rejects_malformed_value_with_actionable_error():
    with pytest.raises(
        DatabaseUrlConfigurationError, match="DATABASE_URL_INVALID"
    ) as captured:
        normalize_database_url("not-a-database-uri")

    assert "not-a-database-uri" not in str(captured.value)


def test_database_capacity_bypasses_sqlite_deterministically(runtime_settings):
    session = CapacitySession("sqlite")
    ensure_database_write_capacity(session, runtime_settings)
    assert session.queries == []


def test_database_capacity_allows_postgres_below_limit(runtime_settings):
    session = CapacitySession("postgresql", runtime_settings.max_database_bytes - 1)
    ensure_database_write_capacity(session, runtime_settings)
    assert session.queries == ["SELECT pg_database_size(current_database())"]


def test_database_capacity_fails_closed_at_soft_limit(runtime_settings):
    session = CapacitySession("postgresql", runtime_settings.max_database_bytes)
    with pytest.raises(ApiError) as captured:
        ensure_database_write_capacity(session, runtime_settings)
    assert captured.value.status_code == 507
    assert captured.value.code == "DATABASE_SOFT_LIMIT"
    assert captured.value.details == {
        "max_bytes": runtime_settings.max_database_bytes,
        "used_bytes": runtime_settings.max_database_bytes,
    }


def test_database_capacity_fails_when_postgres_cannot_report_size(runtime_settings):
    session = CapacitySession("postgresql", None)
    with pytest.raises(ApiError) as captured:
        ensure_database_write_capacity(session, runtime_settings)
    assert captured.value.status_code == 503
    assert captured.value.code == "DATABASE_SIZE_UNAVAILABLE"
