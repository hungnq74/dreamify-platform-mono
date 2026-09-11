"""List ordering must be a total order, not just a sort on a timestamp.

TimestampMixin assigns created_at/updated_at in Python, so several rows written
in the same request can share a timestamp to the microsecond. Without a
tiebreaker the database is free to return those rows in any order, and a keyset
cursor built on the timestamp alone would skip or repeat them.
"""

from datetime import datetime, timezone
from unittest.mock import Mock

import pytest
from sqlalchemy.dialects import postgresql, sqlite

from app.platform.models import Project
from app.platform.repositories import (
    ConversationRepository,
    DashboardRepository,
    ProjectRepository,
    WorkflowRepository,
)


async def create_project(client, headers, name="Project A"):
    response = await client.post(
        "/api/v1/projects", headers=headers, json={"name": name}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _order_by_sql(statement) -> str:
    compiled = str(statement.compile(dialect=postgresql.dialect()))
    _, _, tail = compiled.partition("ORDER BY")
    return " ".join(tail.split())


def test_list_queries_order_by_sort_key_then_id():
    """Each list query must name its id column in ORDER BY, after the sort key."""
    cases = (
        (
            lambda s: ProjectRepository(s).list_owned("tenant-a"),
            "projects.created_at",
            "projects.id",
        ),
        (
            lambda s: ConversationRepository(s).list_owned("tenant-a"),
            "conversations.updated_at",
            "conversations.id",
        ),
        (
            lambda s: DashboardRepository(s).list_owned("tenant-a"),
            "dashboards.updated_at",
            "dashboards.id",
        ),
        (
            lambda s: WorkflowRepository(s).list_runs("tenant-a"),
            "workflow_runs.created_at",
            "workflow_runs.id",
        ),
    )

    for build, sort_column, id_column in cases:
        session = Mock()
        session.scalars.return_value.all.return_value = []
        build(session)

        statement = session.scalars.call_args.args[0]
        order_by = _order_by_sql(statement)
        assert sort_column in order_by, order_by
        assert id_column in order_by, order_by
        assert order_by.index(sort_column) < order_by.index(id_column), order_by


def test_order_by_compiles_on_both_dialects():
    """The ordering must not depend on a dialect-specific construct."""
    session = Mock()
    session.scalars.return_value.all.return_value = []
    ProjectRepository(session).list_owned("tenant-a")
    statement = session.scalars.call_args.args[0]

    for dialect in (postgresql.dialect(), sqlite.dialect()):
        compiled = str(statement.compile(dialect=dialect))
        assert "ORDER BY" in compiled
        assert "projects.id" in compiled


@pytest.mark.anyio
async def test_project_listing_is_stable_when_timestamps_collide(
    client, auth_headers, app
):
    """Rows sharing a created_at must come back in the same order every time."""
    owner = auth_headers("tenant-a")
    for index in range(5):
        await create_project(client, owner, name=f"Project {index}")

    collision = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with app.state.database.session() as session:
        for project in session.query(Project).all():
            project.created_at = collision

    first = await client.get("/api/v1/projects", headers=owner)
    second = await client.get("/api/v1/projects", headers=owner)
    assert first.status_code == 200, first.text

    ids = [item["id"] for item in first.json()]
    assert len(ids) == 5
    assert ids == [item["id"] for item in second.json()]
    assert ids == sorted(ids), "with created_at tied, id must decide the order"


@pytest.mark.anyio
async def test_composite_indexes_exist(client, app):
    """The ordering above is only affordable with a matching index.

    Depends on `client` because that fixture enters the app lifespan, which is
    what creates the schema.
    """
    from sqlalchemy import inspect

    inspector = inspect(app.state.database.engine)
    expected = {
        "projects": "ix_projects_created_at_id",
        "conversations": "ix_conversations_updated_at_id",
        "dashboards": "ix_dashboards_project_updated_at_id",
        "workflow_runs": "ix_workflow_runs_project_created_at_id",
    }

    for table, index_name in expected.items():
        names = {index["name"] for index in inspector.get_indexes(table)}
        assert index_name in names, f"{table}: {sorted(names)}"


def test_latest_row_lookups_keep_their_single_row_limit():
    """The limit(1) 'latest' helpers are deliberately left without a tiebreaker."""
    session = Mock()
    DashboardRepository(session).latest_for_project("tenant-a", "project-a")
    statement = session.scalar.call_args.args[0]
    compiled = str(statement.compile(dialect=postgresql.dialect()))
    assert "LIMIT" in compiled
    assert "dashboards.updated_at DESC" in compiled
