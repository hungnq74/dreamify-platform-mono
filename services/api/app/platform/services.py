"""Application services enforcing ownership, quotas, and lifecycle rules."""

import csv
import hashlib
import io
import json
import math
import re
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Literal, Optional, Tuple

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.platform.database import ensure_database_write_capacity
from app.platform.errors import ApiError, not_found
from app.platform.models import (
    AppUser,
    Asset,
    Conversation,
    DailyRunUsage,
    Dashboard,
    DashboardVersion,
    Project,
    ProjectMember,
    ProjectPreviewGrant,
    ProviderConnection,
    StoredObject,
    UploadReservation,
    WorkflowEvent,
    WorkflowRun,
    WorkflowRunAsset,
    new_id,
    utc_now,
)
from app.platform.repositories import (
    READ_PROJECT_ROLES,
    WRITE_PROJECT_ROLES,
    AssetRepository,
    ConversationRepository,
    DashboardRepository,
    ProjectMemberRepository,
    ProjectRepository,
    StoredObjectRepository,
    UploadRepository,
    UserRepository,
    WorkflowRepository,
)
from app.platform.schemas import (
    BlobUploadCallback,
    DashboardCreate,
    DashboardUpdate,
    UploadIntentCreate,
    WorkflowEventCreate,
    WorkflowRunCreate,
)
from app.platform.settings import Settings
from app.platform.storage import ObjectStorage, UploadTarget

ACCEPTED_UPLOAD_CONTENT_TYPES = (
    "text/csv",
    "application/csv",
    "text/plain",
    "application/json",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
)
UPLOAD_CONTENT_TYPES_BY_EXTENSION = {
    ".csv": {"text/csv", "application/csv", "text/plain"},
    ".json": {"application/json"},
    ".xls": {"application/vnd.ms-excel"},
    ".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
}
UPLOAD_QUOTA_LOCK_KEY = 4_473_945_902_024
MAX_PREVIEW_RESPONSE_BYTES = 4 * 1024 * 1024
TERMINAL_RUN_STATUSES = {"completed", "failed", "cancelled", "awaiting_user_input"}
ACTIVE_DATA_RUN_STATUSES = ("queued", "running", "cancelling")
EVENT_STATUS = {
    "run_started": "running",
    "run_completed": "completed",
    "run_succeeded": "completed",
    "run_failed": "failed",
    "awaiting_user_input": "awaiting_user_input",
}


ProjectPermission = Literal["read", "write", "manage"]


def _require_project(
    session: Session,
    owner_id: str,
    project_id: str,
    permission: ProjectPermission = "read",
    for_update: bool = False,
) -> Project:
    access = ProjectRepository(session).access(owner_id, project_id, for_update)
    if access is None:
        raise not_found("Project")
    project, membership = access
    allowed_roles = {
        "read": READ_PROJECT_ROLES,
        "write": WRITE_PROJECT_ROLES,
        "manage": ("owner",),
    }[permission]
    if membership.role not in allowed_roles:
        raise ApiError(
            403,
            "PROJECT_ROLE_FORBIDDEN",
            f"Project {permission} access is not allowed for this member role",
            {"role": membership.role, "required_permission": permission},
        )
    return project


def _clean_required_text(value: str, field: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ApiError(422, "INVALID_INPUT", f"{field} must not be blank")
    return cleaned


def _decode_upload_text(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ApiError(
            422, "INVALID_TEXT_ENCODING", "Uploaded text files must use UTF-8"
        ) from exc


def _validate_csv_upload(content: bytes, settings: Settings) -> None:
    csv.field_size_limit(settings.max_upload_bytes)
    try:
        reader = csv.reader(io.StringIO(_decode_upload_text(content), newline=""))
        for row_number, row in enumerate(reader):
            if len(row) > settings.max_columns_per_file:
                raise ApiError(413, "UPLOAD_COLUMN_LIMIT", "File exceeds 200 columns")
            if row_number > settings.max_rows_per_file:
                raise ApiError(413, "UPLOAD_ROW_LIMIT", "File exceeds 100,000 rows")
    except csv.Error as exc:
        raise ApiError(422, "INVALID_CSV", "CSV content could not be parsed") from exc


def _validate_json_upload(content: bytes, settings: Settings) -> None:
    try:
        value = json.loads(_decode_upload_text(content))
    except json.JSONDecodeError as exc:
        raise ApiError(422, "INVALID_JSON", "JSON content could not be parsed") from exc
    if not isinstance(value, list) or len(value) > settings.max_rows_per_file:
        code = "UPLOAD_ROW_LIMIT" if isinstance(value, list) else "JSON_NOT_FLAT"
        raise ApiError(
            413 if isinstance(value, list) else 422,
            code,
            "JSON must be a bounded array",
        )
    columns: set[str] = set()
    for record in value:
        if not isinstance(record, dict):
            raise ApiError(422, "JSON_NOT_FLAT", "JSON must contain flat objects")
        for key, cell in record.items():
            if (
                not isinstance(key, str)
                or isinstance(cell, (dict, list))
                or (isinstance(cell, float) and not math.isfinite(cell))
            ):
                raise ApiError(422, "JSON_NOT_FLAT", "JSON must contain scalar values")
            columns.add(key)
            if len(columns) > settings.max_columns_per_file:
                raise ApiError(413, "UPLOAD_COLUMN_LIMIT", "File exceeds 200 columns")


def _validate_excel_upload(extension: str, content: bytes) -> None:
    if extension == ".xls":
        if not content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
            raise ApiError(422, "INVALID_XLS", "XLS signature is invalid")
        return
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            names = set(archive.namelist())
    except zipfile.BadZipFile as exc:
        raise ApiError(422, "INVALID_XLSX", "XLSX archive is invalid") from exc
    if not {"[Content_Types].xml", "xl/workbook.xml"}.issubset(names):
        raise ApiError(422, "INVALID_XLSX", "XLSX workbook structure is invalid")


def validate_upload_content(filename: str, content: bytes, settings: Settings) -> None:
    extension = Path(filename).suffix.lower()
    if extension == ".csv":
        _validate_csv_upload(content, settings)
    elif extension == ".json":
        _validate_json_upload(content, settings)
    else:
        _validate_excel_upload(extension, content)


def validate_dashboard_content(content: Dict[str, Any], max_bytes: int) -> None:
    try:
        encoded = json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ApiError(
            422, "INVALID_DASHBOARD_JSON", "Dashboard content must be valid JSON"
        ) from exc
    if len(encoded) > max_bytes:
        raise ApiError(
            413,
            "DASHBOARD_TOO_LARGE",
            "Dashboard JSON exceeds the 1 MiB limit",
            {"max_bytes": max_bytes, "actual_bytes": len(encoded)},
        )


def active_data_run_error(active_run_id: Optional[str] = None) -> ApiError:
    details: Dict[str, Any] = {"limit": 1, "run_kind": "data"}
    if active_run_id:
        details["active_run_id"] = active_run_id
    return ApiError(
        429,
        "DATA_RUN_ALREADY_ACTIVE",
        "Only one data run can be active per user",
        details,
    )


def is_active_data_run_conflict(error: IntegrityError) -> bool:
    message = str(error.orig)
    return (
        "uq_workflow_runs_owner_active_data" in message
        or message.strip() == "UNIQUE constraint failed: workflow_runs.owner_id"
    )


class ProjectService:
    def __init__(self, session: Session, owner_id: str):
        self.session = session
        self.owner_id = owner_id
        self.repository = ProjectRepository(session)

    def create(self, name: str, description: Optional[str]) -> Project:
        return self.repository.create(
            self.owner_id, _clean_required_text(name, "name"), description
        )

    def list(self) -> List[Project]:
        return self.repository.list_owned(self.owner_id)

    def get(self, project_id: str) -> Project:
        return _require_project(self.session, self.owner_id, project_id)

    def update(self, project_id: str, changes: Dict[str, Any]) -> Project:
        project = _require_project(
            self.session,
            self.owner_id,
            project_id,
            permission="manage",
            for_update=True,
        )
        has_allowed = "allowed" in changes
        allowed = changes.pop("allowed", None)
        if has_allowed and allowed is None:
            raise ApiError(422, "INVALID_INPUT", "allowed must not be null")
        for field, value in changes.items():
            if value is None:
                raise ApiError(422, "INVALID_INPUT", f"{field} must not be null")
            if field == "name":
                value = _clean_required_text(value, "name")
            setattr(project, field, value)
        if has_allowed:
            self._replace_preview_grants(project, allowed)
        self.session.flush()
        return project

    def _replace_preview_grants(
        self, project: Project, entries: List[Dict[str, Any]]
    ) -> None:
        grants: List[ProjectPreviewGrant] = []
        user_ids: set[str] = set()
        emails: set[str] = set()
        users = UserRepository(self.session)
        for entry in entries:
            user_id = entry.get("user_id")
            email = entry.get("email")
            invited_user: Optional[AppUser] = None
            if user_id:
                invited_user = self.session.get(AppUser, user_id)
                if invited_user is None:
                    raise ApiError(
                        422,
                        "PREVIEW_USER_NOT_FOUND",
                        "Allowed user must be a registered Dreamify user",
                    )
            normalized_email = email.strip().lower() if email else None
            if invited_user is None and normalized_email:
                invited_user = users.by_email(normalized_email)
                if invited_user:
                    user_id = invited_user.id
            if invited_user and invited_user.email:
                registered_email = invited_user.email.strip().lower()
                if normalized_email and normalized_email != registered_email:
                    raise ApiError(
                        422,
                        "PREVIEW_IDENTITY_MISMATCH",
                        "Allowed user ID and email do not identify the same user",
                    )
                normalized_email = normalized_email or registered_email
            if user_id in user_ids or (
                normalized_email is not None and normalized_email in emails
            ):
                raise ApiError(
                    422,
                    "DUPLICATE_PREVIEW_GRANT",
                    "Allowed users must be unique",
                )
            if user_id:
                user_ids.add(user_id)
            if normalized_email:
                emails.add(normalized_email)
            grants.append(
                ProjectPreviewGrant(
                    project_id=project.id,
                    user_id=user_id,
                    email=normalized_email,
                )
            )
        for current in list(project.preview_grants):
            self.session.delete(current)
        self.session.flush()
        project.preview_grants = grants
        project.updated_at = utc_now()

    def delete(self, project_id: str) -> None:
        project = _require_project(
            self.session,
            self.owner_id,
            project_id,
            permission="manage",
            for_update=True,
        )
        self.session.delete(project)
        self.session.flush()


class ProjectMemberService:
    def __init__(self, session: Session, owner_id: str):
        self.session = session
        self.owner_id = owner_id
        self.repository = ProjectMemberRepository(session)

    def list(self, project_id: str) -> List[Dict[str, Any]]:
        _require_project(self.session, self.owner_id, project_id, permission="manage")
        return [self._serialize(member) for member in self.repository.list(project_id)]

    def get(self, project_id: str, member_id: str) -> Dict[str, Any]:
        _require_project(self.session, self.owner_id, project_id, permission="manage")
        return self._serialize(self._member(project_id, member_id))

    def create(
        self,
        project_id: str,
        user_id: Optional[str],
        email: Optional[str],
        role: str,
    ) -> Dict[str, Any]:
        _require_project(
            self.session,
            self.owner_id,
            project_id,
            permission="manage",
            for_update=True,
        )
        user = self._resolve_user(user_id, email)
        if self.repository.for_user(project_id, user.id):
            raise ApiError(
                409,
                "PROJECT_MEMBER_EXISTS",
                "The registered user is already a project member",
            )
        try:
            with self.session.begin_nested():
                member = self.repository.create(project_id, user.id, role)
        except IntegrityError as exc:
            raise ApiError(
                409,
                "PROJECT_MEMBER_EXISTS",
                "The registered user is already a project member",
            ) from exc
        return self._serialize(member, user)

    def update(
        self,
        project_id: str,
        member_id: str,
        role: Optional[str],
        status: Optional[str],
    ) -> Dict[str, Any]:
        project = _require_project(
            self.session,
            self.owner_id,
            project_id,
            permission="manage",
            for_update=True,
        )
        member = self._member(project_id, member_id)
        next_role = role or member.role
        next_status = status or member.status
        successor = self._owner_successor(project_id, member, next_role, next_status)
        member.role = next_role
        member.status = next_status
        if successor and project.owner_id == member.user_id:
            project.owner_id = successor.user_id
        self.session.flush()
        return self._serialize(member)

    def delete(self, project_id: str, member_id: str) -> None:
        project = _require_project(
            self.session,
            self.owner_id,
            project_id,
            permission="manage",
            for_update=True,
        )
        member = self._member(project_id, member_id)
        successor = self._owner_successor(
            project_id, member, next_role="viewer", next_status="inactive"
        )
        if successor and project.owner_id == member.user_id:
            project.owner_id = successor.user_id
        self.session.delete(member)
        self.session.flush()

    def _resolve_user(self, user_id: Optional[str], email: Optional[str]) -> AppUser:
        by_id = self.session.get(AppUser, user_id) if user_id else None
        by_email = UserRepository(self.session).by_email(email) if email else None
        if user_id and by_id is None:
            raise ApiError(
                422,
                "PROJECT_MEMBER_USER_NOT_FOUND",
                "Project members must be registered Dreamify users",
            )
        if email and by_email is None:
            raise ApiError(
                422,
                "PROJECT_MEMBER_USER_NOT_FOUND",
                "Project members must be registered Dreamify users",
            )
        if by_id and by_email and by_id.id != by_email.id:
            raise ApiError(
                422,
                "PROJECT_MEMBER_IDENTITY_MISMATCH",
                "User ID and email do not identify the same registered user",
            )
        user = by_id or by_email
        if user is None or user.status != "active":
            raise ApiError(
                422,
                "PROJECT_MEMBER_USER_NOT_FOUND",
                "Project members must be active registered Dreamify users",
            )
        return user

    def _member(self, project_id: str, member_id: str) -> ProjectMember:
        member = self.repository.get(project_id, member_id)
        if member is None:
            raise not_found("Project member")
        return member

    def _owner_successor(
        self,
        project_id: str,
        member: ProjectMember,
        next_role: str,
        next_status: str,
    ) -> Optional[ProjectMember]:
        remains_owner = next_role == "owner" and next_status == "active"
        is_active_owner = member.role == "owner" and member.status == "active"
        if not is_active_owner or remains_owner:
            return None
        successors = [
            current
            for current in self.repository.active_owners(project_id)
            if current.id != member.id
        ]
        if not successors:
            raise ApiError(
                409,
                "LAST_PROJECT_OWNER",
                "A project must retain at least one active owner",
            )
        return successors[0]

    def _serialize(
        self, member: ProjectMember, user: Optional[AppUser] = None
    ) -> Dict[str, Any]:
        current_user = user or self.session.get(AppUser, member.user_id)
        return {
            "id": member.id,
            "project_id": member.project_id,
            "user_id": member.user_id,
            "email": current_user.email if current_user else None,
            "display_name": current_user.display_name if current_user else None,
            "role": member.role,
            "status": member.status,
            "created_at": member.created_at,
            "updated_at": member.updated_at,
        }


class AssetService:
    def __init__(self, session: Session, owner_id: str):
        self.session = session
        self.owner_id = owner_id
        self.repository = AssetRepository(session)

    def list(self, project_id: str) -> List[Asset]:
        _require_project(self.session, self.owner_id, project_id)
        return self.repository.list_owned(self.owner_id, project_id)

    def get(self, asset_id: str) -> Asset:
        asset = self.repository.get_owned(self.owner_id, asset_id)
        if asset is None:
            raise not_found("Asset")
        return asset

    def delete(self, asset_id: str) -> None:
        asset = self.repository.get_owned(
            self.owner_id, asset_id, roles=WRITE_PROJECT_ROLES
        )
        if asset is None:
            candidate = self.repository.get_owned(self.owner_id, asset_id)
            if candidate is None:
                raise not_found("Asset")
            _require_project(
                self.session,
                self.owner_id,
                candidate.project_id,
                permission="write",
            )
            raise not_found("Asset")
        asset.status = "deleted"
        self.session.flush()


class FilePreviewService:
    def __init__(
        self,
        session: Session,
        owner_id: str,
        settings: Settings,
        storage: ObjectStorage,
    ):
        self.session = session
        self.owner_id = owner_id
        self.settings = settings
        self.storage = storage
        self.assets = AssetRepository(session)

    def read(self, asset_id: str, limit: int, offset: int) -> Dict[str, Any]:
        asset = self.assets.get_owned(self.owner_id, asset_id)
        if asset is None or asset.status != "ready":
            raise not_found("Asset")
        extension = Path(asset.filename).suffix.lower()
        if extension in {".xls", ".xlsx"}:
            raise ApiError(
                415,
                "PREVIEW_FORMAT_UNSUPPORTED",
                "Excel preview is unavailable; the file can still be analyzed",
                {"format": extension.lstrip("."), "analysis_supported": True},
            )
        if extension not in {".csv", ".json"}:
            raise ApiError(
                415,
                "PREVIEW_FORMAT_UNSUPPORTED",
                "Only CSV, text CSV, and flat JSON previews are supported",
            )
        if asset.size_bytes > self.settings.max_upload_bytes:
            raise ApiError(413, "PREVIEW_TOO_LARGE", "File exceeds the preview limit")
        stored = self.assets.stored_object(self.owner_id, asset)
        if stored is None:
            raise not_found("Asset object")
        content = self.storage.get_bytes(stored.pathname)
        if len(content) != asset.size_bytes:
            raise ApiError(409, "ASSET_SIZE_MISMATCH", "Stored file size changed")
        if len(content) > self.settings.max_upload_bytes:
            raise ApiError(413, "PREVIEW_TOO_LARGE", "File exceeds the preview limit")
        if extension == ".json":
            columns, rows, total_rows = self._flat_json(content, limit, offset)
            source_type = "json"
        else:
            columns, rows, total_rows = self._csv(content, limit, offset)
            source_type = "csv"
        return {
            "success": True,
            "filename": asset.filename,
            "columns": columns,
            "rows": rows,
            "total_rows": total_rows,
            "displayed_rows": len(rows),
            "offset": offset,
            "source_type": source_type,
        }

    def bounded_read(self, asset_id: str, limit: int, offset: int) -> Dict[str, Any]:
        preview = self.read(asset_id, limit, offset)
        encoded = json.dumps(
            preview, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
        if len(encoded) > MAX_PREVIEW_RESPONSE_BYTES:
            raise ApiError(
                413,
                "PREVIEW_RESPONSE_TOO_LARGE",
                "Preview page exceeds the safe function response limit",
                {"max_bytes": MAX_PREVIEW_RESPONSE_BYTES},
            )
        return preview

    def _csv(
        self, content: bytes, limit: int, offset: int
    ) -> Tuple[List[str], List[List[Any]], int]:
        text_content = self._decode(content)
        csv.field_size_limit(self.settings.max_upload_bytes)
        try:
            reader = csv.reader(io.StringIO(text_content, newline=""))
            header = next(reader, [])
            self._validate_column_count(len(header))
            rows: List[List[Any]] = []
            total_rows = 0
            for row in reader:
                self._validate_column_count(len(row))
                if total_rows >= self.settings.max_rows_per_file:
                    raise ApiError(
                        413,
                        "PREVIEW_ROW_LIMIT",
                        "File exceeds the 100,000-row preview limit",
                    )
                if offset <= total_rows < offset + limit:
                    rows.append(row)
                total_rows += 1
        except csv.Error as exc:
            raise ApiError(
                422, "INVALID_CSV", "CSV content could not be parsed"
            ) from exc
        return header, rows, total_rows

    def _flat_json(
        self, content: bytes, limit: int, offset: int
    ) -> Tuple[List[str], List[List[Any]], int]:
        try:
            value = json.loads(self._decode(content))
        except json.JSONDecodeError as exc:
            raise ApiError(
                422, "INVALID_JSON", "JSON content could not be parsed"
            ) from exc
        if not isinstance(value, list) or any(
            not isinstance(row, dict) for row in value
        ):
            raise ApiError(
                422,
                "JSON_NOT_FLAT",
                "JSON preview requires an array of flat objects",
            )
        if len(value) > self.settings.max_rows_per_file:
            raise ApiError(
                413,
                "PREVIEW_ROW_LIMIT",
                "File exceeds the 100,000-row preview limit",
            )
        columns: List[str] = []
        seen: set[str] = set()
        for record in value:
            for key, cell in record.items():
                if (
                    not isinstance(key, str)
                    or isinstance(cell, (dict, list))
                    or (isinstance(cell, float) and not math.isfinite(cell))
                ):
                    raise ApiError(
                        422,
                        "JSON_NOT_FLAT",
                        "JSON preview requires scalar values and string keys",
                    )
                if key not in seen:
                    seen.add(key)
                    columns.append(key)
                    self._validate_column_count(len(columns))
        selected = value[offset : offset + limit]
        return (
            columns,
            [[record.get(key) for key in columns] for record in selected],
            len(value),
        )

    def _validate_column_count(self, count: int) -> None:
        if count > self.settings.max_columns_per_file:
            raise ApiError(
                413,
                "PREVIEW_COLUMN_LIMIT",
                "File exceeds the 200-column preview limit",
            )

    @staticmethod
    def _decode(content: bytes) -> str:
        try:
            return content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ApiError(
                422, "INVALID_TEXT_ENCODING", "Preview files must use UTF-8"
            ) from exc


class UploadService:
    def __init__(
        self,
        session: Session,
        owner_id: str,
        settings: Settings,
        storage: ObjectStorage,
    ):
        self.session = session
        self.owner_id = owner_id
        self.settings = settings
        self.storage = storage
        self.repository = UploadRepository(session)

    def _validate_intent(self, request: UploadIntentCreate) -> None:
        if request.size_bytes > self.settings.max_upload_bytes:
            raise ApiError(413, "UPLOAD_TOO_LARGE", "File exceeds the per-upload limit")
        if request.content_type not in ACCEPTED_UPLOAD_CONTENT_TYPES:
            raise ApiError(
                415, "UNSUPPORTED_MEDIA_TYPE", "File content type is not accepted"
            )
        if (
            Path(request.filename).name != request.filename
            or not request.filename.strip()
        ):
            raise ApiError(400, "INVALID_FILENAME", "Filename must not contain a path")
        if re.search(r"[\x00-\x1f]", request.filename):
            raise ApiError(
                400, "INVALID_FILENAME", "Filename contains control characters"
            )
        extension = Path(request.filename).suffix.lower()
        if extension not in UPLOAD_CONTENT_TYPES_BY_EXTENSION:
            raise ApiError(
                415,
                "UNSUPPORTED_FILE_FORMAT",
                "File must be CSV, JSON, XLS, or XLSX",
            )
        if request.content_type not in UPLOAD_CONTENT_TYPES_BY_EXTENSION[extension]:
            raise ApiError(
                415,
                "FILE_TYPE_MISMATCH",
                "Filename extension and content type do not match",
            )

    def _lock_quota_scope(self) -> None:
        if self.session.get_bind().dialect.name == "postgresql":
            self.session.execute(
                text("SELECT pg_advisory_xact_lock(:lock_key)"),
                {"lock_key": UPLOAD_QUOTA_LOCK_KEY},
            )

    def _check_quota(self, size_bytes: int) -> None:
        objects = StoredObjectRepository(self.session)
        user_total = objects.total_size(self.owner_id) + self.repository.reserved_size(
            self.owner_id
        )
        global_total = objects.total_size() + self.repository.reserved_size()
        if user_total + size_bytes > self.settings.max_user_storage_bytes:
            raise ApiError(
                409, "USER_STORAGE_QUOTA", "User storage quota would be exceeded"
            )
        if global_total + size_bytes > self.settings.max_global_storage_bytes:
            raise ApiError(
                409,
                "GLOBAL_STORAGE_QUOTA",
                "Deployment storage quota would be exceeded",
            )

    def _same_intent(
        self, current: UploadReservation, request: UploadIntentCreate
    ) -> bool:
        return (
            current.project_id == request.project_id
            and current.filename == request.filename
            and current.asset_type == request.asset_type
            and current.content_type == request.content_type
            and current.expected_size_bytes == request.size_bytes
            and current.expected_sha256 == request.checksum_sha256
        )

    def create_intent(
        self, request: UploadIntentCreate
    ) -> Tuple[UploadReservation, UploadTarget]:
        self._validate_intent(request)
        _require_project(
            self.session, self.owner_id, request.project_id, permission="write"
        )
        request_key = request.idempotency_key or request.client_request_id
        current = self.repository.by_idempotency_key(self.owner_id, request_key)
        if current:
            if not self._same_intent(current, request):
                raise ApiError(
                    409, "IDEMPOTENCY_CONFLICT", "Idempotency key has different input"
                )
            return current, self._target(current)
        ensure_database_write_capacity(self.session, self.settings)
        self._lock_quota_scope()
        current = self.repository.by_idempotency_key(self.owner_id, request_key)
        if current:
            if not self._same_intent(current, request):
                raise ApiError(
                    409, "IDEMPOTENCY_CONFLICT", "Idempotency key has different input"
                )
            return current, self._target(current)
        self._check_quota(request.size_bytes)
        try:
            reservation = self.repository.create(self._new_reservation(request))
        except IntegrityError as exc:
            self.session.rollback()
            current = self.repository.by_idempotency_key(self.owner_id, request_key)
            if current and self._same_intent(current, request):
                return current, self._target(current)
            raise ApiError(
                409,
                "UPLOAD_RESERVATION_CONFLICT",
                "Upload reservation could not be created idempotently",
            ) from exc
        return reservation, self._target(reservation)

    def _new_reservation(self, request: UploadIntentCreate) -> UploadReservation:
        owner_hash = hashlib.sha256(self.owner_id.encode("utf-8")).hexdigest()[:16]
        reservation = UploadReservation(
            id=new_id(),
            owner_id=self.owner_id,
            project_id=request.project_id,
            idempotency_key=request.idempotency_key or request.client_request_id,
            client_request_id=request.client_request_id,
            pathname="pending",
            filename=request.filename,
            asset_type=request.asset_type,
            content_type=request.content_type,
            expected_size_bytes=request.size_bytes,
            expected_sha256=request.checksum_sha256,
            expires_at=utc_now()
            + timedelta(seconds=self.settings.upload_reservation_ttl_seconds),
        )
        reservation.pathname = (
            f"uploads/{owner_hash}/{reservation.id}/{request.filename}"
        )
        return reservation

    def _target(self, reservation: UploadReservation) -> UploadTarget:
        return self.storage.upload_target(
            reservation.id,
            reservation.pathname,
            reservation.content_type,
        )

    def get_intent(self, reservation_id: str) -> UploadReservation:
        reservation = self.repository.get_owned(self.owner_id, reservation_id)
        if reservation is None:
            raise not_found("Upload reservation")
        expires_at = reservation.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if reservation.status in {"pending", "uploaded"} and expires_at <= utc_now():
            reservation.status = "expired"
            self.session.flush()
        return reservation

    def _get_active(
        self, reservation_id: str, for_update: bool = False
    ) -> UploadReservation:
        reservation = self.repository.get_owned(
            self.owner_id, reservation_id, for_update
        )
        if reservation is None:
            raise not_found("Upload reservation")
        expires_at = reservation.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if reservation.status != "finalized" and expires_at <= utc_now():
            reservation.status = "expired"
            raise ApiError(410, "UPLOAD_EXPIRED", "Upload reservation has expired")
        return reservation

    async def accept_local_upload(
        self,
        reservation_id: str,
        content_type: str,
        chunks: AsyncIterator[bytes],
    ) -> UploadReservation:
        if not self.storage.supports_local_proxy:
            raise ApiError(404, "NOT_FOUND", "Local upload proxy is unavailable")
        reservation = self._get_active(reservation_id, for_update=True)
        if reservation.status == "finalized":
            raise ApiError(409, "UPLOAD_FINALIZED", "Upload is already finalized")
        if content_type.split(";", 1)[0].strip() != reservation.content_type:
            raise ApiError(
                415, "CONTENT_TYPE_MISMATCH", "Content type differs from reservation"
            )
        metadata = await self.storage.put_stream(
            reservation.pathname,
            chunks,
            reservation.content_type,
            reservation.expected_size_bytes,
        )
        reservation.status = "uploaded"
        reservation.uploaded_size_bytes = metadata.size_bytes
        reservation.uploaded_etag = metadata.etag
        self.session.flush()
        return reservation

    def finalize(self, reservation_id: str) -> Asset:
        reservation = self._get_active(reservation_id, for_update=True)
        current_asset = self.repository.asset_for_reservation(reservation)
        if reservation.status == "finalized" and current_asset:
            return current_asset
        ensure_database_write_capacity(self.session, self.settings)
        metadata = self.storage.head(
            reservation.pathname,
            verify_checksum=True,
        )
        self._validate_metadata(reservation, metadata)
        if not metadata.checksum_sha256:
            raise ApiError(
                409,
                "ASSET_INTEGRITY_MISSING",
                "Storage provider did not return an object checksum",
            )
        content = self.storage.get_bytes(reservation.pathname)
        if len(content) != metadata.size_bytes:
            raise ApiError(409, "UPLOAD_SIZE_MISMATCH", "Stored file size changed")
        validate_upload_content(reservation.filename, content, self.settings)
        stored = StoredObject(
            owner_id=self.owner_id,
            backend=self.storage.backend,
            pathname=metadata.pathname,
            url=metadata.url,
            content_type=metadata.content_type,
            size_bytes=metadata.size_bytes,
            checksum_sha256=metadata.checksum_sha256,
            etag=metadata.etag,
        )
        self.session.add(stored)
        self.session.flush()
        asset = AssetRepository(self.session).create(
            self.owner_id,
            reservation.project_id,
            stored,
            reservation.filename,
            reservation.asset_type,
        )
        reservation.status = "finalized"
        reservation.asset_id = asset.id
        reservation.stored_object_id = stored.id
        self.session.flush()
        return asset

    def validate_blob_token(self, callback: BlobUploadCallback) -> UploadReservation:
        if self.storage.backend != "vercel_blob":
            raise ApiError(404, "NOT_FOUND", "Blob upload validation is unavailable")
        reservation = self._get_active(callback.intent_id, for_update=True)
        self._validate_blob_callback(reservation, callback)
        if (
            reservation.client_request_id
            and reservation.client_request_id != callback.client_request_id
        ):
            raise ApiError(
                409, "CLIENT_REQUEST_CONFLICT", "Upload request is already bound"
            )
        reservation.client_request_id = callback.client_request_id
        self.session.flush()
        return reservation

    def complete_blob_upload(self, callback: BlobUploadCallback) -> Asset:
        if self.storage.backend != "vercel_blob":
            raise ApiError(404, "NOT_FOUND", "Blob upload completion is unavailable")
        reservation = self._get_active(callback.intent_id, for_update=True)
        self._validate_blob_callback(reservation, callback)
        if reservation.client_request_id != callback.client_request_id:
            raise ApiError(
                409, "CLIENT_REQUEST_MISMATCH", "Upload request was not validated"
            )
        return self.finalize(reservation.id)

    @staticmethod
    def _validate_blob_callback(
        reservation: UploadReservation, callback: BlobUploadCallback
    ) -> None:
        matches = (
            callback.pathname == reservation.pathname
            and callback.content_type == reservation.content_type
            and callback.size == reservation.expected_size_bytes
            and (
                not reservation.expected_sha256
                or callback.checksum == reservation.expected_sha256
            )
        )
        if not matches:
            raise ApiError(
                409, "UPLOAD_CONTRACT_MISMATCH", "Blob request differs from reservation"
            )

    @staticmethod
    def _validate_metadata(reservation: UploadReservation, metadata) -> None:
        if metadata.pathname != reservation.pathname:
            raise ApiError(
                409, "UPLOAD_PATH_MISMATCH", "Uploaded object path is unexpected"
            )
        if metadata.size_bytes != reservation.expected_size_bytes:
            raise ApiError(
                409, "UPLOAD_SIZE_MISMATCH", "Uploaded object size is unexpected"
            )
        if metadata.content_type != reservation.content_type:
            raise ApiError(
                409, "CONTENT_TYPE_MISMATCH", "Uploaded object type is unexpected"
            )
        if (
            reservation.expected_sha256
            and metadata.checksum_sha256 != reservation.expected_sha256
        ):
            raise ApiError(
                409,
                "UPLOAD_CHECKSUM_MISMATCH",
                "Uploaded object checksum is unexpected",
            )


class ConversationService:
    def __init__(self, session: Session, owner_id: str):
        self.session = session
        self.owner_id = owner_id
        self.repository = ConversationRepository(session)

    def create(self, project_id: Optional[str], title: str) -> Conversation:
        if project_id:
            _require_project(
                self.session, self.owner_id, project_id, permission="write"
            )
        return self.repository.create(
            self.owner_id, project_id, _clean_required_text(title, "title")
        )

    def list(self) -> List[Conversation]:
        return self.repository.list_owned(self.owner_id)

    def get(
        self, conversation_id: str, permission: ProjectPermission = "read"
    ) -> Conversation:
        roles = WRITE_PROJECT_ROLES if permission == "write" else READ_PROJECT_ROLES
        conversation = self.repository.get_owned(
            self.owner_id, conversation_id, roles=roles
        )
        if conversation is None:
            readable = self.repository.get_owned(self.owner_id, conversation_id)
            if readable is not None and readable.project_id:
                _require_project(
                    self.session,
                    self.owner_id,
                    readable.project_id,
                    permission=permission,
                )
            raise not_found("Conversation")
        return conversation

    def update(self, conversation_id: str, title: str) -> Conversation:
        conversation = self.get(conversation_id, permission="write")
        conversation.title = _clean_required_text(title, "title")
        self.session.flush()
        return conversation

    def delete(self, conversation_id: str) -> None:
        self.session.delete(self.get(conversation_id, permission="write"))
        self.session.flush()


class DashboardService:
    def __init__(
        self,
        session: Session,
        owner_id: str,
        max_dashboard_bytes: int = 1024 * 1024,
        version_retention: int = 25,
    ):
        self.session = session
        self.owner_id = owner_id
        self.max_dashboard_bytes = max_dashboard_bytes
        self.version_retention = version_retention
        self.repository = DashboardRepository(session)

    def create(self, request: DashboardCreate) -> Dashboard:
        validate_dashboard_content(request.content, self.max_dashboard_bytes)
        _require_project(
            self.session, self.owner_id, request.project_id, permission="write"
        )
        if request.conversation_id:
            conversation = ConversationRepository(self.session).get_owned(
                self.owner_id,
                request.conversation_id,
                roles=WRITE_PROJECT_ROLES,
            )
            if conversation is None or conversation.project_id != request.project_id:
                raise not_found("Conversation")
        return self.repository.create(
            Dashboard(
                owner_id=self.owner_id,
                project_id=request.project_id,
                conversation_id=request.conversation_id,
                title=_clean_required_text(request.title, "title"),
                content=request.content,
            )
        )

    def list(
        self,
        project_id: Optional[str],
        cursor: Optional[Tuple[datetime, str]] = None,
        limit: Optional[int] = None,
    ) -> List[Dashboard]:
        if project_id:
            _require_project(self.session, self.owner_id, project_id)
        return self.repository.list_owned(self.owner_id, project_id, cursor, limit)

    def get(self, dashboard_id: str, for_update: bool = False) -> Dashboard:
        roles = WRITE_PROJECT_ROLES if for_update else READ_PROJECT_ROLES
        dashboard = self.repository.get_owned(
            self.owner_id,
            dashboard_id,
            for_update=for_update,
            roles=roles,
        )
        if dashboard is None:
            readable = self.repository.get_owned(self.owner_id, dashboard_id)
            if readable is not None:
                _require_project(
                    self.session,
                    self.owner_id,
                    readable.project_id,
                    permission="write" if for_update else "read",
                )
            raise not_found("Dashboard")
        return dashboard

    def update(self, dashboard_id: str, request: DashboardUpdate) -> Dashboard:
        dashboard = self.get(dashboard_id, for_update=True)
        changes = request.model_dump(exclude_unset=True)
        expected_version = changes.pop("expected_version", None)
        content_changed = (
            "content" in changes and changes["content"] != dashboard.content
        )
        if content_changed and expected_version != dashboard.current_version:
            raise ApiError(409, "DASHBOARD_VERSION_CONFLICT", "Dashboard was updated")
        if "content" in changes and changes["content"] is not None:
            validate_dashboard_content(changes["content"], self.max_dashboard_bytes)
        for field, value in changes.items():
            if value is None:
                raise ApiError(422, "INVALID_INPUT", f"{field} must not be null")
            if field == "title":
                value = _clean_required_text(value, "title")
            setattr(dashboard, field, value)
        if content_changed:
            dashboard.current_version += 1
            self.repository.add_version(dashboard)
            self.repository.prune_versions(dashboard.id, self.version_retention)
        self.session.flush()
        return dashboard

    def versions(self, dashboard_id: str) -> List[DashboardVersion]:
        dashboard = self.get(dashboard_id)
        return self.repository.list_versions(dashboard.id)

    def delete(self, dashboard_id: str) -> None:
        self.session.delete(self.get(dashboard_id, for_update=True))
        self.session.flush()


class DailyRunUsageService:
    DEPLOYMENT_SUBJECT_ID = "deployment"

    def __init__(self, session: Session, owner_id: str, settings: Settings):
        self.session = session
        self.owner_id = owner_id
        self.settings = settings

    def consume(self, run_kind: str) -> None:
        if run_kind == "data":
            buckets = (
                ("user", self.owner_id, self.settings.data_runs_per_user_per_day),
                (
                    "deployment",
                    self.DEPLOYMENT_SUBJECT_ID,
                    self.settings.deployment_runs_per_day,
                ),
            )
        else:
            buckets = (
                ("user", self.owner_id, self.settings.text_runs_per_user_per_day),
            )
        for scope, subject_id, limit in buckets:
            self._consume_bucket(scope, subject_id, run_kind, limit)

    def _consume_bucket(
        self, scope: str, subject_id: str, run_kind: str, limit: int
    ) -> None:
        usage_date = utc_now().date()
        statement = self._upsert_statement(
            usage_date, scope, subject_id, run_kind, limit
        )
        if self.session.scalar(statement) is None:
            reset_date = usage_date + timedelta(days=1)
            raise ApiError(
                429,
                "RUN_QUOTA_EXCEEDED",
                "Daily run quota is exhausted",
                {
                    "scope": scope,
                    "run_kind": run_kind,
                    "limit": limit,
                    "usage_date": usage_date.isoformat(),
                    "reset_at": f"{reset_date.isoformat()}T00:00:00+00:00",
                },
            )

    def _upsert_statement(
        self,
        usage_date: date,
        scope: str,
        subject_id: str,
        run_kind: str,
        limit: int,
    ) -> Any:
        table = DailyRunUsage.__table__
        now = utc_now()
        statement = self._insert(table).values(
            usage_date=usage_date,
            scope=scope,
            subject_id=subject_id,
            run_kind=run_kind,
            run_count=1,
            created_at=now,
            updated_at=now,
        )
        return statement.on_conflict_do_update(
            index_elements=[
                table.c.usage_date,
                table.c.scope,
                table.c.subject_id,
                table.c.run_kind,
            ],
            set_={
                "run_count": table.c.run_count + 1,
                "updated_at": now,
            },
            where=table.c.run_count < limit,
        ).returning(table.c.run_count)

    def _insert(self, table: Any) -> Any:
        dialect = self.session.get_bind().dialect.name
        if dialect == "sqlite":
            return sqlite_insert(table)
        if dialect == "postgresql":
            return postgresql_insert(table)
        raise RuntimeError(f"Unsupported quota database dialect: {dialect}")


class WorkflowService:
    def __init__(self, session: Session, owner_id: str, settings: Settings):
        self.session = session
        self.owner_id = owner_id
        self.settings = settings
        self.repository = WorkflowRepository(session)

    def create(self, request: WorkflowRunCreate) -> WorkflowRun:
        _require_project(
            self.session, self.owner_id, request.project_id, permission="write"
        )
        assets = self._assets(request.asset_ids, request.project_id)
        parent = self._validate_parent(request.parent_run_id)
        run_kind = self._run_kind(assets, parent)
        if run_kind == "data":
            active_run_id = self._active_data_run_id()
            if active_run_id:
                raise active_data_run_error(active_run_id)
        conversation = self._conversation(request.conversation_id, request.project_id)
        self._ensure_conversation_available(conversation)
        ensure_database_write_capacity(self.session, self.settings)
        DailyRunUsageService(self.session, self.owner_id, self.settings).consume(
            run_kind
        )
        run = self._create_run(request, run_kind)
        self.repository.link_assets(run.id, assets)
        if conversation:
            conversation.active_run_id = run.id
            self.session.flush()
        return run

    def _ensure_conversation_available(
        self, conversation: Optional[Conversation]
    ) -> None:
        if not conversation or not conversation.active_run_id:
            return
        active = self.repository.get_run(self.owner_id, conversation.active_run_id)
        if active and active.status not in TERMINAL_RUN_STATUSES:
            raise ApiError(
                409,
                "WORKFLOW_ALREADY_ACTIVE",
                "Conversation already has an active run",
            )

    def _create_run(self, request: WorkflowRunCreate, run_kind: str) -> WorkflowRun:
        connection = self._active_provider_connection()
        return self.repository.create_run(
            WorkflowRun(
                owner_id=self.owner_id,
                project_id=request.project_id,
                conversation_id=request.conversation_id,
                parent_run_id=request.parent_run_id,
                workflow_name=request.workflow_name,
                run_kind=run_kind,
                input=request.input,
                provider_connection_id=connection.id if connection else None,
                provider_mode="byok" if connection else "demo",
                provider_name=connection.provider if connection else "demo",
                provider_model=(connection.model if connection else "deterministic-v1"),
                provider_encrypted_api_key=(
                    connection.encrypted_api_key if connection else None
                ),
                provider_key_version=connection.key_version if connection else None,
            )
        )

    @staticmethod
    def _run_kind(assets: List[Asset], parent: Optional[WorkflowRun]) -> str:
        if assets or (parent and parent.run_kind == "data"):
            return "data"
        return "text"

    def _active_data_run_id(self) -> Optional[str]:
        query = (
            select(WorkflowRun.id)
            .where(
                WorkflowRun.owner_id == self.owner_id,
                WorkflowRun.run_kind == "data",
                WorkflowRun.status.in_(ACTIVE_DATA_RUN_STATUSES),
            )
            .order_by(WorkflowRun.created_at.desc())
            .limit(1)
        )
        return self.session.scalar(query)

    def _active_provider_connection(self) -> Optional[ProviderConnection]:
        query = select(ProviderConnection).where(
            ProviderConnection.owner_id == self.owner_id,
            ProviderConnection.is_active.is_(True),
            ProviderConnection.status == "verified",
        )
        return self.session.scalar(query)

    def _assets(self, asset_ids: List[str], project_id: str) -> List[Asset]:
        if len(asset_ids) > self.settings.max_workflow_assets:
            raise ApiError(413, "TOO_MANY_ASSETS", "Workflow asset limit is exceeded")
        assets = AssetRepository(self.session).get_many_owned(self.owner_id, asset_ids)
        if len(assets) != len(asset_ids):
            raise not_found("Workflow asset")
        if any(asset.project_id != project_id for asset in assets):
            raise not_found("Workflow asset")
        aggregate_size = sum(asset.size_bytes for asset in assets)
        if aggregate_size > self.settings.workflow_max_aggregate_asset_bytes:
            raise ApiError(
                413,
                "WORKFLOW_ASSET_BYTES_EXCEEDED",
                "Workflow assets exceed the 25 MiB aggregate limit",
                {
                    "max_bytes": self.settings.workflow_max_aggregate_asset_bytes,
                    "actual_bytes": aggregate_size,
                },
            )
        return assets

    def _conversation(
        self, conversation_id: Optional[str], project_id: str
    ) -> Optional[Conversation]:
        if not conversation_id:
            return None
        conversation = ConversationRepository(self.session).get_owned(
            self.owner_id,
            conversation_id,
            for_update=True,
            roles=WRITE_PROJECT_ROLES,
        )
        if conversation is None or conversation.project_id not in (None, project_id):
            raise not_found("Conversation")
        return conversation

    def _validate_parent(self, parent_run_id: Optional[str]) -> Optional[WorkflowRun]:
        if not parent_run_id:
            return None
        parent = self.repository.get_run(
            self.owner_id,
            parent_run_id,
            for_update=True,
            roles=WRITE_PROJECT_ROLES,
        )
        if parent is None:
            raise not_found("Parent workflow run")
        if parent.status != "awaiting_user_input":
            raise ApiError(
                409, "PARENT_NOT_WAITING", "Parent run is not awaiting user input"
            )
        return parent

    def list(
        self,
        project_id: Optional[str],
        cursor: Optional[Tuple[datetime, str]] = None,
        limit: Optional[int] = None,
    ) -> List[WorkflowRun]:
        if project_id:
            _require_project(self.session, self.owner_id, project_id)
        return self.repository.list_runs(self.owner_id, project_id, cursor, limit)

    def get(
        self,
        run_id: str,
        for_update: bool = False,
        permission: ProjectPermission = "read",
    ) -> WorkflowRun:
        roles = WRITE_PROJECT_ROLES if permission == "write" else READ_PROJECT_ROLES
        run = self.repository.get_run(
            self.owner_id,
            run_id,
            for_update=for_update,
            roles=roles,
        )
        if run is None:
            readable = self.repository.get_run(self.owner_id, run_id)
            if readable is not None:
                _require_project(
                    self.session,
                    self.owner_id,
                    readable.project_id,
                    permission=permission,
                )
            raise not_found("Workflow run")
        return run

    def events(
        self, run_id: str, after: int = 0, limit: Optional[int] = None
    ) -> List[WorkflowEvent]:
        self.get(run_id)
        return self.repository.list_events(self.owner_id, run_id, after, limit)

    def append_event(self, run_id: str, request: WorkflowEventCreate) -> WorkflowEvent:
        query = select(WorkflowRun).where(
            WorkflowRun.id == run_id,
            WorkflowRun.owner_id == self.owner_id,
        )
        run = self.session.scalar(query.with_for_update())
        if run is None:
            raise not_found("Workflow run")
        current = self.repository.get_event(run.id, request.event_key)
        if current:
            if (
                current.event_type != request.event_type
                or current.payload != request.payload
            ):
                raise ApiError(
                    409, "IDEMPOTENCY_CONFLICT", "Event key has different input"
                )
            return current
        if run.status in TERMINAL_RUN_STATUSES:
            raise ApiError(409, "RUN_TERMINAL", "Workflow run is already terminal")
        payload_size = len(
            json.dumps(request.payload, separators=(",", ":")).encode("utf-8")
        )
        if payload_size > self.settings.workflow_event_max_bytes:
            raise ApiError(
                413, "EVENT_TOO_LARGE", "Workflow event payload must use object storage"
            )
        self._validate_payload_object(request.payload_object_id)
        event = WorkflowEvent(
            owner_id=self.owner_id,
            run_id=run.id,
            sequence=self.repository.next_sequence(run.id),
            event_key=request.event_key,
            event_type=request.event_type,
            payload=request.payload,
            payload_object_id=request.payload_object_id,
        )
        self.repository.add_event(event)
        self._apply_event_status(run, request.event_type, request.payload)
        return event

    def _validate_payload_object(self, object_id: Optional[str]) -> None:
        if not object_id:
            return
        query = select(StoredObject.id).where(
            StoredObject.id == object_id,
            StoredObject.owner_id == self.owner_id,
        )
        if self.session.scalar(query) is None:
            raise not_found("Payload object")

    def _apply_event_status(
        self, run: WorkflowRun, event_type: str, payload: Dict[str, Any]
    ) -> None:
        status = EVENT_STATUS.get(event_type)
        if not status:
            return
        run.status = status
        step = payload.get("step")
        if isinstance(step, str) and step:
            run.current_step = step[:32]
        if status == "running" and run.started_at is None:
            run.started_at = utc_now()
        if status in TERMINAL_RUN_STATUSES:
            run.completed_at = utc_now()
            run.output = payload if status == "completed" else run.output
            response_type = payload.get("response_type")
            if isinstance(response_type, str):
                run.response_type = response_type[:40]
            self._clear_active_run(run)
        run.version += 1
        self.session.flush()

    def cancel(self, run_id: str, reason: str) -> WorkflowRun:
        run = self.get(run_id, for_update=True, permission="write")
        if run.status in TERMINAL_RUN_STATUSES:
            raise ApiError(409, "RUN_TERMINAL", "Workflow run is already terminal")
        run.status = "cancelling"
        run.cancel_requested = True
        run.cancel_reason = reason
        run.version += 1
        self._clear_active_run(run)
        self.session.flush()
        return run

    def _clear_active_run(self, run: WorkflowRun) -> None:
        if not run.conversation_id:
            return
        query = select(Conversation).where(
            Conversation.id == run.conversation_id,
            Conversation.project_id == run.project_id,
        )
        conversation = self.session.scalar(query.with_for_update())
        if conversation is not None and conversation.active_run_id == run.id:
            conversation.active_run_id = None


class CapabilityService:
    EXTERNAL_CONNECTORS = (
        "amazon_seller",
        "appsflyer",
        "bigquery",
        "customer_io",
        "databricks",
        "firebase",
        "ga4",
        "google_ads",
        "google_search_console",
        "google_sheets",
        "hubspot",
        "klaviyo",
        "lazada_seller",
        "meta_ads",
        "mixpanel",
        "pipedrive",
        "postgres",
        "posthog",
        "quickbooks",
        "salesforce",
        "slack",
        "shopee_seller",
        "shopify",
        "snowflake",
        "stripe",
        "supabase",
        "tiktok_ads",
        "tiktok_shop_seller",
        "telegram",
        "whatsapp",
        "zalo",
        "zendesk",
    )

    def __init__(
        self,
        settings: Settings,
        storage: ObjectStorage,
        active_model_provider: Optional[str] = None,
    ):
        self.settings = settings
        self.storage = storage
        self.active_model_provider = active_model_provider

    def read(self) -> Dict[str, Any]:
        connector_reason = "This connector has not been certified for the Hobby demo"
        connectors = {
            connector: {
                "enabled": False,
                "connected": False,
                "reason": connector_reason,
            }
            for connector in self.EXTERNAL_CONNECTORS
        }
        connectors["file_upload"] = {
            "enabled": True,
            "connected": True,
            "reason": None,
        }
        disabled = {
            "billing": {
                "enabled": False,
                "reason": "Billing is disabled for the free release",
            },
            "connectors": {
                "enabled": False,
                "reason": (
                    "External connectors are not enabled in the bootstrap release"
                ),
            },
            "scheduling": {
                "enabled": False,
                "reason": "Scheduling is disabled for the Hobby demo",
            },
        }
        features = {
            "projects": {"enabled": True},
            "assets": {"enabled": True},
            "dashboards": {"enabled": True},
            "conversations": {"enabled": True},
            "workflows": {"enabled": True},
            "direct_upload": {
                "enabled": self.settings.storage_backend == "vercel_blob",
                "reason": None
                if self.settings.storage_backend == "vercel_blob"
                else "Local development proxy",
            },
            **disabled,
        }
        return {
            "api_version": "v1",
            "environment": self.settings.app_env,
            "auth_mode": "demo" if self.settings.demo_auth_mode else "clerk",
            "storage_backend": self.settings.storage_backend,
            "profile": "hobby_demo",
            "billing": {"enabled": False, "label": "Free Preview"},
            "model": {
                "mode": "byok" if self.active_model_provider else "demo",
                "active_provider": self.active_model_provider or "demo",
                "providers": [
                    "demo",
                    *(
                        [self.active_model_provider]
                        if self.active_model_provider
                        else []
                    ),
                ],
            },
            "connectors": connectors,
            "features": features,
            "limits": {
                "max_file_bytes": self.settings.max_upload_bytes,
                "max_files_per_run": self.settings.max_workflow_assets,
                "max_total_run_bytes": (
                    self.settings.workflow_max_aggregate_asset_bytes
                ),
                "max_rows_per_file": self.settings.max_rows_per_file,
                "max_columns_per_file": self.settings.max_columns_per_file,
                "max_upload_bytes": self.settings.max_upload_bytes,
                "max_user_storage_bytes": self.settings.max_user_storage_bytes,
                "max_global_storage_bytes": self.settings.max_global_storage_bytes,
                "workflow_event_max_bytes": self.settings.workflow_event_max_bytes,
                "workflow_slots": self.settings.workflow_slot_count,
                "active_data_runs_per_user": 1,
                "max_workflow_assets": self.settings.max_workflow_assets,
                "data_runs_per_user_per_day": (
                    self.settings.data_runs_per_user_per_day
                ),
                "deployment_runs_per_day": self.settings.deployment_runs_per_day,
                "text_runs_per_user_per_day": (
                    self.settings.text_runs_per_user_per_day
                ),
                "max_dashboard_bytes": self.settings.max_dashboard_bytes,
                "max_database_bytes": self.settings.max_database_bytes,
                "max_events_per_run": self.settings.workflow_max_events_per_run,
            },
            "accepted_upload_content_types": list(ACCEPTED_UPLOAD_CONTENT_TYPES),
            "checksum_verification": self.storage.supports_checksum_verification,
        }


class AssetResolverService:
    def __init__(self, session: Session, storage: ObjectStorage):
        self.session = session
        self.storage = storage

    def resolve(self, run_id: str, object_id: str) -> Dict[str, Any]:
        query = (
            select(WorkflowRun, Asset, StoredObject)
            .join(WorkflowRunAsset, WorkflowRunAsset.run_id == WorkflowRun.id)
            .join(Asset, Asset.id == WorkflowRunAsset.asset_id)
            .join(StoredObject, StoredObject.id == Asset.stored_object_id)
            .where(
                WorkflowRun.id == run_id,
                StoredObject.id == object_id,
                Asset.project_id == WorkflowRun.project_id,
                Asset.status == "ready",
            )
        )
        record = self.session.execute(query).one_or_none()
        if record is None:
            raise not_found("Workflow asset")
        run, asset, stored = record
        if run.status not in {"queued", "running"}:
            raise ApiError(409, "RUN_NOT_ACTIVE", "Workflow run cannot access assets")
        if not stored.checksum_sha256:
            raise ApiError(
                409, "ASSET_INTEGRITY_MISSING", "Asset checksum is unavailable"
            )
        signed = self.storage.signed_get_url(stored.pathname, 15 * 60)
        file_format = Path(asset.filename).suffix.lower().lstrip(".") or "bin"
        return {
            "asset_id": asset.id,
            "object_id": stored.id,
            "file_name": asset.filename,
            "format": file_format,
            "media_type": stored.content_type,
            "size_bytes": stored.size_bytes,
            "sha256": stored.checksum_sha256,
            "relative_path": f"input/{asset.id}.{file_format}",
            "download_url": signed.url,
            "expires_at": signed.expires_at,
        }
