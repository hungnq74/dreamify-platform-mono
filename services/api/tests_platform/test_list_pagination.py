"""Keyset pagination on the app-facing list endpoints.

The contract these tests defend is that pagination is purely additive: with no
query parameters, every endpoint behaves exactly as it did before, returning an
unbounded bare JSON array. That is what keeps the existing contract tests and
the OpenAPI response schemas valid.
"""

from datetime import datetime, timezone
from unittest.mock import Mock

import pytest
from sqlalchemy.dialects import postgresql, sqlite

from app.platform.cursors import decode_cursor, encode_cursor
from app.platform.errors import ApiError
from app.platform.repositories import WorkflowRepository


async def create_project(client, headers, name="Project A"):
    response = await client.post(
        "/api/v1/projects", headers=headers, json={"name": name}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def create_dashboard(client, headers, project_id, title):
    response = await client.post(
        "/api/v1/dashboards",
        headers=headers,
        json={"project_id": project_id, "title": title, "layout": {}},
    )
    assert response.status_code == 201, response.text
    return response.json()


def cursor_for(item, sort_field):
    return encode_cursor(datetime.fromisoformat(item[sort_field]), item["id"])


# --------------------------------------------------------------------------
# Cursor encoding
# --------------------------------------------------------------------------


def test_cursor_round_trips():
    moment = datetime(2026, 3, 4, 5, 6, 7, tzinfo=timezone.utc)
    sort_value, row_id = decode_cursor(encode_cursor(moment, "row-a"))

    assert sort_value == moment
    assert row_id == "row-a"


def test_cursor_is_url_safe_and_unpadded():
    token = encode_cursor(datetime(2026, 1, 1, tzinfo=timezone.utc), "row-a")

    assert "=" not in token
    assert "+" not in token and "/" not in token


@pytest.mark.parametrize(
    "value",
    [
        "not-base64!!",
        "",
        "Zm9vYmFy",
        encode_cursor(datetime.now(timezone.utc), "x")[:3],
    ],
)
def test_malformed_cursor_raises_a_typed_400(value):
    with pytest.raises(ApiError) as excinfo:
        decode_cursor(value)

    assert excinfo.value.status_code == 400
    assert excinfo.value.code == "INVALID_CURSOR"
    # The message must not echo the caller's input back.
    if value:
        assert value not in excinfo.value.message


def test_keyset_predicate_compiles_on_both_dialects():
    """The cursor filter must not depend on row-value tuple comparison."""
    session = Mock()
    session.scalars.return_value.all.return_value = []

    WorkflowRepository(session).list_runs(
        "tenant-a",
        None,
        cursor=(datetime(2026, 1, 1, tzinfo=timezone.utc), "run-a"),
        limit=2,
    )
    statement = session.scalars.call_args.args[0]

    for dialect in (postgresql.dialect(), sqlite.dialect()):
        compiled = str(statement.compile(dialect=dialect))
        assert "LIMIT" in compiled
        assert "workflow_runs.created_at" in compiled
        assert "workflow_runs.id" in compiled
        # Explicit or_/and_, never a (a, b) < (c, d) row value.
        assert "(workflow_runs.created_at, workflow_runs.id) <" not in compiled


# --------------------------------------------------------------------------
# Endpoint behaviour
# --------------------------------------------------------------------------


@pytest.mark.anyio
async def test_no_parameters_is_unchanged_and_unbounded(client, auth_headers):
    owner = auth_headers("tenant-a")
    project = await create_project(client, owner)
    for index in range(5):
        await create_dashboard(client, owner, project["id"], f"Dashboard {index}")

    response = await client.get("/api/v1/dashboards", headers=owner)

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list), "the response must stay a bare array"
    assert len(payload) == 5


@pytest.mark.anyio
async def test_limit_bounds_the_page_without_changing_the_shape(client, auth_headers):
    owner = auth_headers("tenant-a")
    project = await create_project(client, owner)
    for index in range(5):
        await create_dashboard(client, owner, project["id"], f"Dashboard {index}")

    response = await client.get("/api/v1/dashboards?limit=2", headers=owner)

    assert response.status_code == 200
    assert isinstance(response.json(), list)
    assert len(response.json()) == 2


@pytest.mark.anyio
async def test_cursor_walks_the_list_without_gaps_or_overlap(client, auth_headers):
    owner = auth_headers("tenant-a")
    project = await create_project(client, owner)
    for index in range(5):
        await create_dashboard(client, owner, project["id"], f"Dashboard {index}")

    everything = (await client.get("/api/v1/dashboards", headers=owner)).json()
    expected = [item["id"] for item in everything]

    collected: list[str] = []
    cursor = None
    for _ in range(5):
        url = "/api/v1/dashboards?limit=2"
        if cursor:
            url = f"{url}&cursor={cursor}"
        page = (await client.get(url, headers=owner)).json()
        if not page:
            break
        collected.extend(item["id"] for item in page)
        cursor = cursor_for(page[-1], "updated_at")

    assert collected == expected
    assert len(collected) == len(set(collected)), "no row may repeat across pages"


@pytest.mark.anyio
async def test_malformed_cursor_is_rejected_by_the_endpoint(client, auth_headers):
    owner = auth_headers("tenant-a")

    response = await client.get("/api/v1/dashboards?cursor=!!!!", headers=owner)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_CURSOR"


@pytest.mark.anyio
async def test_a_cursor_cannot_reach_another_tenants_rows(client, auth_headers):
    owner = auth_headers("tenant-a")
    outsider = auth_headers("tenant-b")

    project = await create_project(client, owner)
    await create_dashboard(client, owner, project["id"], "Owned")
    owned = (await client.get("/api/v1/dashboards", headers=owner)).json()

    cursor = encode_cursor(datetime(2000, 1, 1, tzinfo=timezone.utc), owned[0]["id"])
    response = await client.get(f"/api/v1/dashboards?cursor={cursor}", headers=outsider)

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.anyio
async def test_workflow_events_expose_their_existing_sequence_cursor(
    client, auth_headers
):
    """The keyset already existed in the repository; the route now passes it."""
    owner = auth_headers("tenant-a")
    project = await create_project(client, owner)

    runs = await client.get(
        f"/api/v1/workflow-runs?project_id={project['id']}", headers=owner
    )
    assert runs.status_code == 200
    assert isinstance(runs.json(), list)

    # after/limit are accepted and default to the previous behaviour.
    schema = (await client.get("/api/v1/openapi.json", headers=owner)).json()
    params = schema["paths"]["/api/v1/workflow-runs/{run_id}/events"]["get"][
        "parameters"
    ]
    names = {param["name"] for param in params}
    assert {"after", "limit"} <= names
    for param in params:
        if param["name"] in {"after", "limit"}:
            assert param["required"] is False
