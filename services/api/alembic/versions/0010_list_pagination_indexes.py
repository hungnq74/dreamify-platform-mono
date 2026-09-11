"""Add composite (sort key, id) indexes backing the deterministic list ordering.

Every app-facing list query sorted on a timestamp column that had no index and
no tiebreaker. TimestampMixin generates created_at/updated_at in Python, so
identical values across rows are possible and the resulting order was not
stable between calls. The repositories now order by (sort key, id); these
indexes make that ordering cheap, and they are the access path a keyset cursor
will need.

Plain create_index, not postgresql_concurrently: Alembic runs migrations inside
a transaction and CREATE INDEX CONCURRENTLY cannot. These tables are small in
the Hobby profile, so a blocking build is acceptable.

Revision ID: 0010_list_pagination_indexes
Revises: 0009_operator_briefs
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0010_list_pagination_indexes"
down_revision: str | None = "0009_operator_briefs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


INDEXES: tuple[tuple[str, str, list[str]], ...] = (
    ("ix_projects_created_at_id", "projects", ["created_at", "id"]),
    ("ix_conversations_updated_at_id", "conversations", ["updated_at", "id"]),
    (
        "ix_dashboards_project_updated_at_id",
        "dashboards",
        ["project_id", "updated_at", "id"],
    ),
    (
        "ix_workflow_runs_project_created_at_id",
        "workflow_runs",
        ["project_id", "created_at", "id"],
    ),
)


def upgrade() -> None:
    for name, table, columns in INDEXES:
        op.create_index(name, table, columns)


def downgrade() -> None:
    for name, table, _columns in reversed(INDEXES):
        op.drop_index(name, table_name=table)
