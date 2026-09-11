"""Clean v1 routes. Legacy route modules are intentionally not imported."""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.platform.auth import (
    get_current_user,
    get_optional_current_user,
    require_blob_gateway,
    require_internal_service,
)
from app.platform.cursors import decode_cursor
from app.platform.database import (
    ensure_database_write_capacity,
    get_runtime_settings,
    get_session,
)
from app.platform.errors import feature_disabled, not_found
from app.platform.models import (
    AppUser,
    ProviderConnection,
    UploadReservation,
    WorkflowRun,
)
from app.platform.providers import (
    ProviderConnectionService,
    ProviderCredentialVerifier,
)
from app.platform.repositories import UserRepository
from app.platform.schemas import (
    AssetRead,
    BlobTokenValidationRead,
    BlobUploadCallback,
    CancelRunRequest,
    CapabilitiesRead,
    ConversationCreate,
    ConversationRead,
    ConversationUpdate,
    DashboardCreate,
    DashboardRead,
    DashboardUpdate,
    DashboardVersionRead,
    DataAssetReferenceRead,
    InternalAssetResolveRequest,
    ProjectCreate,
    ProjectMemberCreate,
    ProjectMemberRead,
    ProjectMemberUpdate,
    ProjectRead,
    ProjectUpdate,
    ProviderConnectionRead,
    ProviderConnectionsRead,
    ProviderConnectionWrite,
    ProviderName,
    UploadIntentCreate,
    UploadIntentRead,
    UserLookupRead,
    UserRead,
    WorkflowEventCreate,
    WorkflowEventRead,
    WorkflowRunCreate,
    WorkflowRunRead,
)
from app.platform.services import (
    AssetResolverService,
    AssetService,
    CapabilityService,
    ConversationService,
    DashboardService,
    ProjectMemberService,
    ProjectService,
    UploadService,
    WorkflowService,
    active_data_run_error,
    is_active_data_run_conflict,
)
from app.platform.settings import Settings
from app.platform.storage import ObjectStorage

router = APIRouter(prefix="/api/v1")


def get_storage(request: Request) -> ObjectStorage:
    return request.app.state.storage


def get_provider_connection_service(
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
) -> ProviderConnectionService:
    return ProviderConnectionService(
        session,
        user.id,
        settings,
        ProviderCredentialVerifier(settings),
    )


@router.get("/health", tags=["platform"])
def api_health():
    return {"status": "ok", "service": "dreamify-api"}


@router.get("/health/ready", tags=["platform"])
def api_readiness(session: Session = Depends(get_session)):
    session.execute(text("SELECT 1"))
    return {"status": "ready"}


def upload_response(reservation, upload) -> UploadIntentRead:
    return UploadIntentRead(
        id=reservation.id,
        intent_id=reservation.id,
        client_request_id=reservation.client_request_id,
        project_id=reservation.project_id,
        pathname=reservation.pathname,
        filename=reservation.filename,
        asset_type=reservation.asset_type,
        content_type=reservation.content_type,
        expected_size_bytes=reservation.expected_size_bytes,
        max_size_bytes=reservation.expected_size_bytes,
        status=reservation.status,
        expires_at=reservation.expires_at,
        asset_id=reservation.asset_id,
        upload=upload.__dict__,
    )


@router.get("/capabilities", response_model=CapabilitiesRead, tags=["platform"])
def capabilities(
    response: Response,
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
    session: Session = Depends(get_session),
    user: Optional[AppUser] = Depends(get_optional_current_user),
):
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Authorization, X-Demo-User"
    active_provider = None
    if user:
        active_provider = session.scalar(
            select(ProviderConnection.provider).where(
                ProviderConnection.owner_id == user.id,
                ProviderConnection.is_active.is_(True),
                ProviderConnection.status == "verified",
            )
        )
    return CapabilityService(settings, storage, active_provider).read()


@router.get("/users/me", response_model=UserRead, tags=["users"])
def current_user(user: AppUser = Depends(get_current_user)):
    return user


@router.get("/user/lookup", response_model=UserLookupRead, tags=["users"])
def lookup_user_by_email(
    email: str = Query(min_length=3, max_length=320),
    session: Session = Depends(get_session),
    _user: AppUser = Depends(get_current_user),
):
    normalized = email.strip().lower()
    if "@" not in normalized:
        raise not_found("User")
    matched = UserRepository(session).by_email(normalized)
    return {
        "success": True,
        "user_id": matched.id if matched else None,
        "email": normalized,
        "name": matched.display_name if matched else None,
        "image_url": None,
    }


@router.get(
    "/provider-connections",
    response_model=ProviderConnectionsRead,
    tags=["model-providers"],
)
def list_provider_connections(
    response: Response,
    provider_service: ProviderConnectionService = Depends(
        get_provider_connection_service
    ),
):
    response.headers["Cache-Control"] = "private, no-store"
    return provider_service.status()


@router.put(
    "/provider-connections/{provider}",
    response_model=ProviderConnectionRead,
    tags=["model-providers"],
)
def configure_provider_connection(
    provider: ProviderName,
    payload: ProviderConnectionWrite,
    provider_service: ProviderConnectionService = Depends(
        get_provider_connection_service
    ),
):
    return provider_service.upsert(provider, payload)


@router.post(
    "/provider-connections/{provider}/activate",
    response_model=ProviderConnectionRead,
    tags=["model-providers"],
)
def activate_provider_connection(
    provider: ProviderName,
    provider_service: ProviderConnectionService = Depends(
        get_provider_connection_service
    ),
):
    return provider_service.activate(provider)


@router.post(
    "/provider-connections/{provider}/verify",
    response_model=ProviderConnectionRead,
    tags=["model-providers"],
)
def verify_provider_connection(
    provider: ProviderName,
    provider_service: ProviderConnectionService = Depends(
        get_provider_connection_service
    ),
):
    return provider_service.verify(provider)


@router.delete(
    "/provider-connections/{provider}",
    status_code=204,
    tags=["model-providers"],
)
def delete_provider_connection(
    provider: ProviderName,
    provider_service: ProviderConnectionService = Depends(
        get_provider_connection_service
    ),
):
    provider_service.delete(provider)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/projects", response_model=ProjectRead, status_code=201, tags=["projects"]
)
def create_project(
    request: ProjectCreate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return ProjectService(session, user.id).create(request.name, request.description)


@router.get("/projects", response_model=List[ProjectRead], tags=["projects"])
def list_projects(
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return ProjectService(session, user.id).list()


@router.get("/projects/{project_id}", response_model=ProjectRead, tags=["projects"])
def get_project(
    project_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return ProjectService(session, user.id).get(project_id)


@router.patch("/projects/{project_id}", response_model=ProjectRead, tags=["projects"])
def update_project(
    project_id: str,
    request: ProjectUpdate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    changes = request.model_dump(exclude_unset=True)
    return ProjectService(session, user.id).update(project_id, changes)


@router.delete("/projects/{project_id}", status_code=204, tags=["projects"])
def delete_project(
    project_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    ProjectService(session, user.id).delete(project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/projects/{project_id}/members",
    response_model=List[ProjectMemberRead],
    tags=["project-members"],
)
def list_project_members(
    project_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return ProjectMemberService(session, user.id).list(project_id)


@router.post(
    "/projects/{project_id}/members",
    response_model=ProjectMemberRead,
    status_code=201,
    tags=["project-members"],
)
def create_project_member(
    project_id: str,
    payload: ProjectMemberCreate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    ensure_database_write_capacity(session, settings)
    return ProjectMemberService(session, user.id).create(
        project_id, payload.user_id, payload.email, payload.role
    )


@router.get(
    "/projects/{project_id}/members/{member_id}",
    response_model=ProjectMemberRead,
    tags=["project-members"],
)
def get_project_member(
    project_id: str,
    member_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return ProjectMemberService(session, user.id).get(project_id, member_id)


@router.patch(
    "/projects/{project_id}/members/{member_id}",
    response_model=ProjectMemberRead,
    tags=["project-members"],
)
def update_project_member(
    project_id: str,
    member_id: str,
    payload: ProjectMemberUpdate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return ProjectMemberService(session, user.id).update(
        project_id, member_id, payload.role, payload.status
    )


@router.delete(
    "/projects/{project_id}/members/{member_id}",
    status_code=204,
    tags=["project-members"],
)
def delete_project_member(
    project_id: str,
    member_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    ProjectMemberService(session, user.id).delete(project_id, member_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/projects/{project_id}/assets", response_model=List[AssetRead], tags=["assets"]
)
def list_assets(
    project_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return AssetService(session, user.id).list(project_id)


@router.get("/assets/{asset_id}", response_model=AssetRead, tags=["assets"])
def get_asset(
    asset_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return AssetService(session, user.id).get(asset_id)


@router.delete("/assets/{asset_id}", status_code=204, tags=["assets"])
def delete_asset(
    asset_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    AssetService(session, user.id).delete(asset_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/uploads/intents",
    response_model=UploadIntentRead,
    status_code=201,
    tags=["uploads"],
)
def create_upload_intent(
    payload: UploadIntentCreate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
):
    reservation, upload = UploadService(
        session, user.id, settings, storage
    ).create_intent(payload)
    return upload_response(reservation, upload)


@router.get(
    "/uploads/intents/{intent_id}",
    response_model=UploadIntentRead,
    tags=["uploads"],
)
def get_upload_intent(
    intent_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
):
    service = UploadService(session, user.id, settings, storage)
    reservation = service.get_intent(intent_id)
    return upload_response(reservation, service._target(reservation))


@router.post(
    "/uploads/blob-token/validate",
    response_model=BlobTokenValidationRead,
    tags=["uploads"],
)
def validate_blob_token(
    payload: BlobUploadCallback,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
):
    reservation = UploadService(
        session, user.id, settings, storage
    ).validate_blob_token(payload)
    return {
        "valid": True,
        "intent_id": reservation.id,
        "client_request_id": payload.client_request_id,
        "pathname": reservation.pathname,
        "content_type": reservation.content_type,
        "size_bytes": reservation.expected_size_bytes,
        "checksum_sha256": reservation.expected_sha256,
        "max_size_bytes": reservation.expected_size_bytes,
    }


@router.post("/uploads/blob-completed", response_model=AssetRead, tags=["uploads"])
def complete_blob_upload(
    payload: BlobUploadCallback,
    session: Session = Depends(get_session),
    _gateway: None = Depends(require_blob_gateway),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
):
    reservation = session.get(UploadReservation, payload.intent_id)
    if reservation is None:
        from app.platform.errors import not_found

        raise not_found("Upload reservation")
    return UploadService(
        session, reservation.owner_id, settings, storage
    ).complete_blob_upload(payload)


@router.put("/uploads/{reservation_id}/content", status_code=202, tags=["uploads"])
async def upload_local_content(
    reservation_id: str,
    request: Request,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
):
    reservation = await UploadService(
        session, user.id, settings, storage
    ).accept_local_upload(
        reservation_id,
        request.headers.get("content-type", ""),
        request.stream(),
    )
    return {"id": reservation.id, "status": reservation.status}


@router.post(
    "/uploads/{reservation_id}/finalize", response_model=AssetRead, tags=["uploads"]
)
def finalize_upload(
    reservation_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
    storage: ObjectStorage = Depends(get_storage),
):
    return UploadService(session, user.id, settings, storage).finalize(reservation_id)


@router.post(
    "/conversations",
    response_model=ConversationRead,
    status_code=201,
    tags=["conversations"],
)
def create_conversation(
    payload: ConversationCreate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return ConversationService(session, user.id).create(
        payload.project_id, payload.title
    )


@router.get(
    "/conversations", response_model=List[ConversationRead], tags=["conversations"]
)
def list_conversations(
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return ConversationService(session, user.id).list()


@router.get(
    "/conversations/{conversation_id}",
    response_model=ConversationRead,
    tags=["conversations"],
)
def get_conversation(
    conversation_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return ConversationService(session, user.id).get(conversation_id)


@router.patch(
    "/conversations/{conversation_id}",
    response_model=ConversationRead,
    tags=["conversations"],
)
def update_conversation(
    conversation_id: str,
    payload: ConversationUpdate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return ConversationService(session, user.id).update(conversation_id, payload.title)


@router.delete(
    "/conversations/{conversation_id}", status_code=204, tags=["conversations"]
)
def delete_conversation(
    conversation_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    ConversationService(session, user.id).delete(conversation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/dashboards", response_model=DashboardRead, status_code=201, tags=["dashboards"]
)
def create_dashboard(
    payload: DashboardCreate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    ensure_database_write_capacity(session, settings)
    return DashboardService(
        session,
        user.id,
        settings.max_dashboard_bytes,
        settings.dashboard_version_retention,
    ).create(payload)


@router.get("/dashboards", response_model=List[DashboardRead], tags=["dashboards"])
def list_dashboards(
    project_id: Optional[str] = Query(default=None),
    cursor: Optional[str] = Query(
        default=None,
        max_length=128,
        description=(
            "Opaque keyset cursor. Resume after the last item of the previous "
            "page; omit to start from the newest."
        ),
    ),
    limit: Optional[int] = Query(default=None, ge=1, le=200),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    """Dashboards the caller can read, newest first.

    Both parameters are optional and default to the previous unbounded
    behaviour, so the response stays a bare array and existing callers are
    unaffected. The cursor is derived client-side from the last item received:
    every item already carries both the sort key and its id.
    """
    return DashboardService(session, user.id).list(
        project_id, decode_cursor(cursor) if cursor else None, limit
    )


@router.get(
    "/dashboards/{dashboard_id}", response_model=DashboardRead, tags=["dashboards"]
)
def get_dashboard(
    dashboard_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return DashboardService(session, user.id).get(dashboard_id)


@router.patch(
    "/dashboards/{dashboard_id}", response_model=DashboardRead, tags=["dashboards"]
)
def update_dashboard(
    dashboard_id: str,
    payload: DashboardUpdate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    ensure_database_write_capacity(session, settings)
    return DashboardService(
        session,
        user.id,
        settings.max_dashboard_bytes,
        settings.dashboard_version_retention,
    ).update(dashboard_id, payload)


@router.get(
    "/dashboards/{dashboard_id}/versions",
    response_model=List[DashboardVersionRead],
    tags=["dashboards"],
)
def list_dashboard_versions(
    dashboard_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    return DashboardService(session, user.id).versions(dashboard_id)


@router.delete("/dashboards/{dashboard_id}", status_code=204, tags=["dashboards"])
def delete_dashboard(
    dashboard_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
):
    DashboardService(session, user.id).delete(dashboard_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/workflow-runs",
    response_model=WorkflowRunRead,
    status_code=201,
    tags=["workflows"],
)
def create_workflow_run(
    payload: WorkflowRunCreate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    try:
        return WorkflowService(session, user.id, settings).create(payload)
    except IntegrityError as error:
        session.rollback()
        if is_active_data_run_conflict(error):
            raise active_data_run_error() from error
        raise


@router.get("/workflow-runs", response_model=List[WorkflowRunRead], tags=["workflows"])
def list_workflow_runs(
    project_id: Optional[str] = Query(default=None),
    cursor: Optional[str] = Query(
        default=None,
        max_length=128,
        description=(
            "Opaque keyset cursor. Resume after the last item of the previous "
            "page; omit to start from the newest."
        ),
    ),
    limit: Optional[int] = Query(default=None, ge=1, le=200),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    """Workflow runs the caller can read, newest first.

    Both parameters are optional and default to the previous unbounded
    behaviour, so the response stays a bare array and existing callers are
    unaffected. The cursor is derived client-side from the last item received:
    every item already carries both the sort key and its id.
    """
    return WorkflowService(session, user.id, settings).list(
        project_id, decode_cursor(cursor) if cursor else None, limit
    )


@router.get(
    "/workflow-runs/{run_id}", response_model=WorkflowRunRead, tags=["workflows"]
)
def get_workflow_run(
    run_id: str,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    return WorkflowService(session, user.id, settings).get(run_id)


@router.post(
    "/workflow-runs/{run_id}/events",
    response_model=WorkflowEventRead,
    status_code=201,
    tags=["workflows"],
)
def create_workflow_event(
    run_id: str,
    payload: WorkflowEventCreate,
    session: Session = Depends(get_session),
    _service: None = Depends(require_internal_service),
    settings: Settings = Depends(get_runtime_settings),
):
    run = session.get(WorkflowRun, run_id)
    if run is None:
        raise not_found("Workflow run")
    return WorkflowService(session, run.owner_id, settings).append_event(
        run_id, payload
    )


@router.get(
    "/workflow-runs/{run_id}/events",
    response_model=List[WorkflowEventRead],
    tags=["workflows"],
)
def list_workflow_events(
    run_id: str,
    after: int = Query(
        default=0,
        ge=0,
        description=(
            "Return only events with a sequence greater than this. Events carry a "
            "monotonic sequence, so the last one received is the cursor."
        ),
    ),
    limit: Optional[int] = Query(default=None, ge=1, le=500),
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    """Events for a run, oldest first.

    Both parameters default to today's unbounded behaviour. The keyset filter
    they expose already existed in WorkflowRepository.list_events; the route
    simply never passed anything to it.
    """
    return WorkflowService(session, user.id, settings).events(run_id, after, limit)


@router.post(
    "/workflow-runs/{run_id}/cancel", response_model=WorkflowRunRead, tags=["workflows"]
)
def cancel_workflow_run(
    run_id: str,
    payload: CancelRunRequest,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
    settings: Settings = Depends(get_runtime_settings),
):
    return WorkflowService(session, user.id, settings).cancel(run_id, payload.reason)


@router.post(
    "/internal/assets/resolve",
    response_model=DataAssetReferenceRead,
    tags=["internal"],
)
def resolve_internal_asset(
    payload: InternalAssetResolveRequest,
    session: Session = Depends(get_session),
    _service: None = Depends(require_internal_service),
    storage: ObjectStorage = Depends(get_storage),
):
    return AssetResolverService(session, storage).resolve(
        payload.run_id, payload.object_id
    )


@router.get(
    "/connectors/{provider}/{action:path}",
    tags=["disabled"],
    operation_id="connector_disabled_get",
)
@router.post(
    "/connectors/{provider}/{action:path}",
    tags=["disabled"],
    operation_id="connector_disabled_post",
)
@router.put(
    "/connectors/{provider}/{action:path}",
    tags=["disabled"],
    operation_id="connector_disabled_put",
)
@router.patch(
    "/connectors/{provider}/{action:path}",
    tags=["disabled"],
    operation_id="connector_disabled_patch",
)
@router.delete(
    "/connectors/{provider}/{action:path}",
    tags=["disabled"],
    operation_id="connector_disabled_delete",
)
def connector_disabled(
    provider: str, action: str, _user: AppUser = Depends(get_current_user)
):
    raise feature_disabled(f"connector:{provider}")


@router.get(
    "/billing/{action:path}",
    tags=["disabled"],
    operation_id="billing_disabled_get",
)
@router.post(
    "/billing/{action:path}",
    tags=["disabled"],
    operation_id="billing_disabled_post",
)
@router.put(
    "/billing/{action:path}",
    tags=["disabled"],
    operation_id="billing_disabled_put",
)
@router.patch(
    "/billing/{action:path}",
    tags=["disabled"],
    operation_id="billing_disabled_patch",
)
@router.delete(
    "/billing/{action:path}",
    tags=["disabled"],
    operation_id="billing_disabled_delete",
)
def billing_disabled(action: str, _user: AppUser = Depends(get_current_user)):
    raise feature_disabled("billing")


@router.get("/schedules", tags=["disabled"], operation_id="schedules_disabled_get")
@router.post("/schedules", tags=["disabled"], operation_id="schedules_disabled_post")
@router.put("/schedules", tags=["disabled"], operation_id="schedules_disabled_put")
@router.patch("/schedules", tags=["disabled"], operation_id="schedules_disabled_patch")
@router.delete(
    "/schedules", tags=["disabled"], operation_id="schedules_disabled_delete"
)
@router.get("/sync-runs", tags=["disabled"], operation_id="sync_runs_disabled_get")
@router.post("/sync-runs", tags=["disabled"], operation_id="sync_runs_disabled_post")
@router.put("/sync-runs", tags=["disabled"], operation_id="sync_runs_disabled_put")
@router.patch("/sync-runs", tags=["disabled"], operation_id="sync_runs_disabled_patch")
@router.delete(
    "/sync-runs", tags=["disabled"], operation_id="sync_runs_disabled_delete"
)
def scheduling_root_disabled(_user: AppUser = Depends(get_current_user)):
    raise feature_disabled("scheduling")


@router.get(
    "/schedules/{action:path}",
    tags=["disabled"],
    operation_id="schedules_path_disabled_get",
)
@router.post(
    "/schedules/{action:path}",
    tags=["disabled"],
    operation_id="schedules_path_disabled_post",
)
@router.put(
    "/schedules/{action:path}",
    tags=["disabled"],
    operation_id="schedules_path_disabled_put",
)
@router.patch(
    "/schedules/{action:path}",
    tags=["disabled"],
    operation_id="schedules_path_disabled_patch",
)
@router.delete(
    "/schedules/{action:path}",
    tags=["disabled"],
    operation_id="schedules_path_disabled_delete",
)
@router.get(
    "/sync-runs/{action:path}",
    tags=["disabled"],
    operation_id="sync_runs_path_disabled_get",
)
@router.post(
    "/sync-runs/{action:path}",
    tags=["disabled"],
    operation_id="sync_runs_path_disabled_post",
)
@router.put(
    "/sync-runs/{action:path}",
    tags=["disabled"],
    operation_id="sync_runs_path_disabled_put",
)
@router.patch(
    "/sync-runs/{action:path}",
    tags=["disabled"],
    operation_id="sync_runs_path_disabled_patch",
)
@router.delete(
    "/sync-runs/{action:path}",
    tags=["disabled"],
    operation_id="sync_runs_path_disabled_delete",
)
def scheduling_path_disabled(action: str, _user: AppUser = Depends(get_current_user)):
    del action
    raise feature_disabled("scheduling")
