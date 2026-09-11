from unittest.mock import Mock

import pytest
from sqlalchemy.dialects import postgresql, sqlite

from app.platform.repositories import ConversationRepository


class DispatchResponse:
    status_code = 202

    def json(self):
        return {"workflow_run_id": "wfr_test_123"}


class RejectedDispatchResponse:
    status_code = 503

    def json(self):
        return {}


async def create_legacy_project(client, headers, name="Compatibility"):
    response = await client.post(
        "/api/v1/user/project/create",
        headers=headers,
        json={"name": name, "description": "Migrated"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def chat_payload(project_id, request_id="chat-request-0001", text="Revenue?"):
    return {
        "client_request_id": request_id,
        "project_id": project_id,
        "user_node_contents": [{"type": "text", "data": {"text": text}}],
        "user_node_metadata": {"asset_selection": "none"},
        "model": "fast",
    }


def test_conversation_lock_targets_only_the_conversation_table():
    session = Mock()

    ConversationRepository(session).get_owned(
        "tenant-a",
        "conversation-a",
        for_update=True,
    )

    statement = session.scalar.call_args.args[0]
    postgres_sql = str(statement.compile(dialect=postgresql.dialect()))
    sqlite_sql = str(statement.compile(dialect=sqlite.dialect()))
    assert postgres_sql.rstrip().endswith("FOR UPDATE OF conversations")
    assert "FOR UPDATE" not in sqlite_sql


@pytest.mark.anyio
async def test_chat_dispatch_polling_events_and_bounded_sse(
    client, auth_headers, monkeypatch
):
    dispatched = []

    def fake_dispatch(url, *, headers, json, timeout):
        dispatched.append((url, headers, json, timeout))
        return DispatchResponse()

    monkeypatch.setattr("app.platform.dispatch.httpx.post", fake_dispatch)
    headers = auth_headers("tenant-a")
    project = await create_legacy_project(client, headers)
    missing_key = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json={
            "project_id": project["id"],
            "user_node_contents": [{"type": "text", "data": {"text": "Hi"}}],
        },
    )
    assert missing_key.status_code == 422

    payload = chat_payload(project["id"])
    accepted = await client.post(
        "/api/v1/conversation/chat", headers=headers, json=payload
    )
    assert accepted.status_code == 202, accepted.text
    body = accepted.json()
    assert body["status"] == "accepted"
    assert body["links"]["status"].startswith("/api/v1/conversation/workflow-status/")
    assert len(dispatched) == 1
    dispatch_url, dispatch_headers, dispatch_body, dispatch_timeout = dispatched[0]
    assert dispatch_url == "https://web.example.test/api/workflow/dispatch"
    assert dispatch_headers["X-Internal-Service-Secret"] == "internal-secret"
    assert dispatch_headers["Idempotency-Key"] == body["run_id"]
    assert len(dispatch_headers["X-Request-ID"]) == 32
    assert dispatch_headers["X-Trace-ID"] == dispatch_headers["X-Request-ID"]
    dispatch_lease_id = dispatch_body.pop("dispatch_lease_id")
    assert len(dispatch_lease_id) == 36
    assert dispatch_body == {
        "run_id": body["run_id"],
        "conversation_id": body["conversation_id"],
        "project_id": project["id"],
        "client_request_id": "chat-request-0001",
    }
    assert dispatch_timeout == 10.0

    repeated = await client.post(
        "/api/v1/conversation/chat", headers=headers, json=payload
    )
    assert repeated.status_code == 202
    assert repeated.json()["run_id"] == body["run_id"]
    assert len(dispatched) == 1
    conflict = await client.post(
        "/api/v1/conversation/chat",
        headers=headers,
        json={
            **payload,
            "user_node_contents": [{"type": "text", "data": {"text": "Changed"}}],
        },
    )
    assert conflict.status_code == 409

    for key, event_type in (("event-1", "run_started"), ("event-2", "run_completed")):
        event = await client.post(
            f"/api/v1/workflow-runs/{body['run_id']}/events",
            headers={"X-Internal-Service-Secret": "internal-secret"},
            json={
                "event_key": key,
                "event_type": event_type,
                "payload": {"title": key},
            },
        )
        assert event.status_code == 201, event.text

    status_response = await client.get(body["links"]["status"], headers=headers)
    assert status_response.json()["status"] == "completed"
    events_response = await client.get(
        f"{body['links']['events']}&after=1", headers=headers
    )
    assert [item["sequence"] for item in events_response.json()["events"]] == [2]
    assert events_response.json()["next_after"] == 2
    stream = await client.get(
        body["links"]["stream"],
        headers={**headers, "Last-Event-ID": "1", "Accept": "text/event-stream"},
    )
    assert stream.status_code == 200
    assert "event: status" in stream.text
    assert "id: 2\nevent: event" in stream.text
    assert "id: 1\nevent: event" not in stream.text


@pytest.mark.anyio
async def test_chat_dispatch_failure_is_durable_and_retryable(
    client, auth_headers, monkeypatch
):
    attempts = []

    def fake_dispatch(url, *, headers, json, timeout):
        attempts.append((url, headers, json, timeout))
        return RejectedDispatchResponse() if len(attempts) == 1 else DispatchResponse()

    monkeypatch.setattr("app.platform.dispatch.httpx.post", fake_dispatch)
    headers = auth_headers("tenant-a")
    project = await create_legacy_project(client, headers, "Retry")
    payload = chat_payload(project["id"], "chat-request-retry")

    rejected = await client.post(
        "/api/v1/conversation/chat", headers=headers, json=payload
    )
    assert rejected.status_code == 502
    assert rejected.json()["error"]["code"] == "WORKFLOW_DISPATCH_REJECTED"

    retried = await client.post(
        "/api/v1/conversation/chat", headers=headers, json=payload
    )
    assert retried.status_code == 202
    assert attempts[0][2]["run_id"] == attempts[1][2]["run_id"]
    runs = await client.get(
        f"/api/v1/workflow-runs?project_id={project['id']}", headers=headers
    )
    assert [run["id"] for run in runs.json()] == [retried.json()["run_id"]]


@pytest.mark.anyio
async def test_project_and_dashboard_compatibility_shapes(client, auth_headers):
    headers = auth_headers("tenant-a")
    project = await create_legacy_project(client, headers)
    listing = await client.get("/api/v1/user/project/list", headers=headers)
    assert listing.json()["projects"][0]["id"] == project["id"]
    updated = await client.put(
        f"/api/v1/user/project/{project['id']}",
        headers=headers,
        json={"name": "Renamed"},
    )
    assert updated.json()["name"] == "Renamed"

    conversation = await client.post(
        "/api/v1/conversations",
        headers=headers,
        json={"project_id": project["id"], "title": "Dashboard"},
    )
    conversation_id = conversation.json()["id"]
    dashboard = await client.post(
        "/api/v1/dashboards",
        headers=headers,
        json={
            "project_id": project["id"],
            "conversation_id": conversation_id,
            "title": "KPI",
            "content": {"id": "dashboard-1", "charts": []},
        },
    )
    dashboard_id = dashboard.json()["id"]
    data_url = (
        f"/api/v1/conversation/{conversation_id}/dashboard"
        f"?project_id={project['id']}&dashboard_id={dashboard_id}"
    )
    assert (await client.get(data_url, headers=headers)).json()[
        "dashboard_id"
    ] == dashboard_id

    wrong_style = await client.put(
        f"/api/v1/conversation/{conversation_id}/dashboard/{dashboard_id}/theme",
        headers=headers,
        json={
            "project_id": project["id"],
            "template_id": "minimal",
            "expected_version": 1,
        },
    )
    assert wrong_style.status_code == 422
    theme = await client.put(
        f"/api/v1/conversation/{conversation_id}/dashboard/{dashboard_id}/theme",
        headers=headers,
        json={
            "project_id": project["id"],
            "theme_id": "dark",
            "expected_version": 1,
        },
    )
    assert theme.json() == {"success": True}

    save = await client.put(
        f"/api/v1/conversation/{conversation_id}/dashboard/{dashboard_id}/data",
        headers=headers,
        json={
            "project_id": project["id"],
            "dashboard_data": {"id": "dashboard-1", "charts": [{"type": "bar"}]},
            "expected_version": 2,
            "edit_summary": "Added chart",
        },
    )
    assert save.json() == {"success": True}
    versions_url = (
        f"/api/v1/conversation/{conversation_id}/dashboard/{dashboard_id}/versions"
        f"?project_id={project['id']}"
    )
    versions = (await client.get(versions_url, headers=headers)).json()
    assert versions["current_version"] == 3
    assert [item["source"] for item in versions["versions"]] == [
        "edit",
        "style",
        "generation",
    ]
    version_one = await client.get(
        f"/api/v1/conversation/{conversation_id}/dashboard/{dashboard_id}/versions/1"
        f"?project_id={project['id']}",
        headers=headers,
    )
    assert version_one.status_code == 200
    assert version_one.json()["dashboard_data"]["charts"] == []
    reverted = await client.post(
        f"/api/v1/conversation/{conversation_id}/dashboard/{dashboard_id}/revert",
        headers=headers,
        json={
            "project_id": project["id"],
            "target_version": 1,
            "expected_version": 3,
        },
    )
    assert reverted.json()["new_version"] == 4
