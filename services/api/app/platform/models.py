"""SQLAlchemy 2.0 persistence model for the clean platform."""

from datetime import date, datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class AppUser(TimestampMixin, Base):
    __tablename__ = "app_users"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "type IN ('sync_success', 'sync_failed', 'token_expired')",
            name="ck_notifications_type",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    schedule_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    run_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True
    )
    provider: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    asset_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL"), nullable=True
    )
    project_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )


class FeedbackSubmission(Base):
    __tablename__ = "feedback_submissions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("app_users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    category: Mapped[str] = mapped_column(String(100))
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )


class OverallFeedbackSubmission(Base):
    __tablename__ = "overall_feedback_submissions"
    __table_args__ = tuple(
        CheckConstraint(f"{field} BETWEEN 1 AND 5", name=f"ck_overall_feedback_{field}")
        for field in (
            "overall_rating",
            "visual_appeal_rating",
            "metrics_insights_rating",
            "layout_editing_rating",
            "share_link_rating",
        )
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("app_users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    full_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(320))
    overall_rating: Mapped[int] = mapped_column(Integer)
    visual_appeal_rating: Mapped[int] = mapped_column(Integer)
    metrics_insights_rating: Mapped[int] = mapped_column(Integer)
    layout_editing_rating: Mapped[int] = mapped_column(Integer)
    share_link_rating: Mapped[int] = mapped_column(Integer)
    requested_connectors: Mapped[str] = mapped_column(Text)
    dashboard_improvements: Mapped[str] = mapped_column(Text)
    export_improvements: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )


class BlogPost(TimestampMixin, Base):
    __tablename__ = "blog_posts"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'published')", name="ck_blog_posts_status"
        ),
        Index(
            "uq_blog_posts_featured",
            "featured",
            unique=True,
            sqlite_where=text("featured = 1"),
            postgresql_where=text("featured"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    slug: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(240))
    description: Mapped[str] = mapped_column(String(1000))
    content_html: Mapped[str] = mapped_column(Text)
    content_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    cover_image_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    cover_image_alt: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    author: Mapped[str] = mapped_column(String(160))
    persona: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    target_keyword: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    reading_minutes: Mapped[int] = mapped_column(Integer, default=1)
    published_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    featured: Mapped[bool] = mapped_column(Boolean, default=False)


class Project(TimestampMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (Index("ix_projects_created_at_id", "created_at", "id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_preview_public: Mapped[bool] = mapped_column(Boolean, default=False)
    preview_grants: Mapped[list["ProjectPreviewGrant"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    members: Mapped[list["ProjectMember"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ProjectMember(TimestampMixin, Base):
    __tablename__ = "project_members"
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_member_user"),
        CheckConstraint(
            "role IN ('owner', 'editor', 'viewer')",
            name="ck_project_members_role",
        ),
        CheckConstraint(
            "status IN ('active', 'inactive')",
            name="ck_project_members_status",
        ),
        Index("ix_project_members_user_status", "user_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="active")
    project: Mapped[Project] = relationship(back_populates="members")


class OperatorBrief(TimestampMixin, Base):
    __tablename__ = "operator_briefs"
    __table_args__ = (
        CheckConstraint(
            "severity IN ('alert', 'warn', 'info')",
            name="ck_operator_briefs_severity",
        ),
        UniqueConstraint("project_id", "run_id", name="uq_operator_briefs_project_run"),
        Index(
            "ix_operator_briefs_project_created_at",
            "project_id",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    created_by_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("app_users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    run_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="SET NULL"), index=True, nullable=True
    )
    source_asset_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL"), index=True, nullable=True
    )
    schedule_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    provider: Mapped[str] = mapped_column(String(80))
    account_name: Mapped[str] = mapped_column(String(160))
    headline: Mapped[str] = mapped_column(String(240))
    body: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(16), default="info")
    recommendation: Mapped[str] = mapped_column(Text, default="")
    changes: Mapped[list[Dict[str, Any]]] = mapped_column(JSON, default=list)
    metric_snapshot: Mapped[Dict[str, float]] = mapped_column(JSON, default=dict)
    outcome: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class ProjectPreviewGrant(Base):
    __tablename__ = "project_preview_grants"
    __table_args__ = (
        CheckConstraint(
            "user_id IS NOT NULL OR email IS NOT NULL",
            name="ck_project_preview_grant_identity",
        ),
        UniqueConstraint("project_id", "user_id", name="uq_project_preview_grant_user"),
        UniqueConstraint("project_id", "email", name="uq_project_preview_grant_email"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    project: Mapped[Project] = relationship(back_populates="preview_grants")


class StoredObject(Base):
    __tablename__ = "stored_objects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"), index=True
    )
    backend: Mapped[str] = mapped_column(String(32))
    pathname: Mapped[str] = mapped_column(String(1024), unique=True)
    url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    content_type: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    checksum_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    etag: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class UploadReservation(TimestampMixin, Base):
    __tablename__ = "upload_reservations"
    __table_args__ = (
        UniqueConstraint("owner_id", "idempotency_key", name="uq_upload_owner_key"),
        UniqueConstraint(
            "owner_id", "client_request_id", name="uq_upload_owner_client_request"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    client_request_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    pathname: Mapped[str] = mapped_column(String(1024), unique=True)
    filename: Mapped[str] = mapped_column(String(255))
    asset_type: Mapped[str] = mapped_column(String(32), default="dataset")
    content_type: Mapped[str] = mapped_column(String(255))
    expected_size_bytes: Mapped[int] = mapped_column(BigInteger)
    expected_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    uploaded_size_bytes: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )
    uploaded_etag: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    stored_object_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("stored_objects.id", ondelete="SET NULL"), nullable=True
    )
    asset_id: Mapped[Optional[str]] = mapped_column(
        String(36), unique=True, nullable=True
    )


class Asset(TimestampMixin, Base):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    stored_object_id: Mapped[str] = mapped_column(
        ForeignKey("stored_objects.id", ondelete="RESTRICT"), unique=True
    )
    filename: Mapped[str] = mapped_column(String(255))
    asset_type: Mapped[str] = mapped_column(String(32), default="dataset")
    content_type: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(32), default="ready")


class Conversation(TimestampMixin, Base):
    __tablename__ = "conversations"
    __table_args__ = (Index("ix_conversations_updated_at_id", "updated_at", "id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), default="New conversation")
    active_run_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)


class Dashboard(TimestampMixin, Base):
    __tablename__ = "dashboards"
    __table_args__ = (
        Index("ix_dashboards_project_updated_at_id", "project_id", "updated_at", "id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    conversation_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), index=True, nullable=True
    )
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(32), default="draft")
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    content: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)


class DashboardVersion(Base):
    __tablename__ = "dashboard_versions"
    __table_args__ = (
        UniqueConstraint("dashboard_id", "version", name="uq_dashboard_version"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    dashboard_id: Mapped[str] = mapped_column(
        ForeignKey("dashboards.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String(32), default="update")
    edit_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class ProviderConnection(TimestampMixin, Base):
    __tablename__ = "provider_connections"
    __table_args__ = (
        UniqueConstraint(
            "owner_id", "provider", name="uq_provider_connection_owner_provider"
        ),
        Index(
            "uq_provider_connections_owner_active",
            "owner_id",
            unique=True,
            sqlite_where=text("is_active = 1"),
            postgresql_where=text("is_active"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(128))
    encrypted_api_key: Mapped[str] = mapped_column(Text)
    key_version: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="verified")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class DailyRunUsage(TimestampMixin, Base):
    __tablename__ = "daily_run_usage"
    __table_args__ = (
        CheckConstraint(
            "scope IN ('user', 'deployment')",
            name="ck_daily_run_usage_scope",
        ),
        CheckConstraint(
            "run_kind IN ('data', 'text')",
            name="ck_daily_run_usage_kind",
        ),
        CheckConstraint("run_count >= 0", name="ck_daily_run_usage_count"),
    )

    usage_date: Mapped[date] = mapped_column(Date, primary_key=True)
    scope: Mapped[str] = mapped_column(String(16), primary_key=True)
    subject_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    run_kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    run_count: Mapped[int] = mapped_column(Integer, default=0)


class WorkflowRun(TimestampMixin, Base):
    __tablename__ = "workflow_runs"
    __table_args__ = (
        UniqueConstraint(
            "owner_id", "client_request_id", name="uq_workflow_owner_client_request"
        ),
        CheckConstraint(
            "provider_call_count BETWEEN 0 AND 5",
            name="ck_workflow_run_provider_call_count",
        ),
        Index(
            "ix_workflow_runs_project_created_at_id",
            "project_id",
            "created_at",
            "id",
        ),
        Index(
            "uq_workflow_runs_owner_active_data",
            "owner_id",
            unique=True,
            sqlite_where=text(
                "run_kind = 'data' AND status IN ('queued', 'running', 'cancelling')"
            ),
            postgresql_where=text(
                "run_kind = 'data' AND status IN ('queued', 'running', 'cancelling')"
            ),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    conversation_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), index=True, nullable=True
    )
    parent_run_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True
    )
    provider_connection_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("provider_connections.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    provider_mode: Mapped[str] = mapped_column(String(16), default="demo")
    provider_name: Mapped[str] = mapped_column(String(32), default="demo")
    provider_model: Mapped[str] = mapped_column(String(128), default="deterministic-v1")
    provider_encrypted_api_key: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )
    provider_key_version: Mapped[Optional[str]] = mapped_column(
        String(32), nullable=True
    )
    provider_call_count: Mapped[int] = mapped_column(Integer, default=0)
    client_request_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    request_fingerprint: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True
    )
    workflow_name: Mapped[str] = mapped_column(String(120))
    run_kind: Mapped[str] = mapped_column(
        String(16), default="text", server_default="text"
    )
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    current_step: Mapped[str] = mapped_column(String(32), default="accepted")
    response_type: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=0)
    input: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)
    output: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    result: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    response_artifact: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON, nullable=True
    )
    error: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    cancel_reason: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    workflow_execution_id: Mapped[Optional[str]] = mapped_column(
        String(128), nullable=True
    )
    dispatch_lease_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    dispatch_lease_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    dispatch_started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    dispatch_attempts: Mapped[int] = mapped_column(Integer, default=0)
    dispatched_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sandbox_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    sandbox_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class WorkflowRunAsset(Base):
    __tablename__ = "workflow_run_assets"

    run_id: Mapped[str] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey("assets.id", ondelete="RESTRICT"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class WorkflowProviderCall(Base):
    __tablename__ = "workflow_provider_calls"
    __table_args__ = (
        UniqueConstraint("run_id", "call_key", name="uq_workflow_provider_call_key"),
        UniqueConstraint("run_id", "ordinal", name="uq_workflow_provider_call_ordinal"),
        CheckConstraint(
            "ordinal BETWEEN 1 AND 5",
            name="ck_workflow_provider_call_ordinal",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="CASCADE"), index=True
    )
    call_key: Mapped[str] = mapped_column(String(128))
    ordinal: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class WorkflowStepJournal(TimestampMixin, Base):
    __tablename__ = "workflow_step_journals"
    __table_args__ = (
        UniqueConstraint("run_id", "step_key", name="uq_workflow_step_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="CASCADE"), index=True
    )
    step_key: Mapped[str] = mapped_column(String(128))
    step: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="running")
    result: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    result_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)


class WorkflowArtifact(Base):
    __tablename__ = "workflow_artifacts"
    __table_args__ = (
        UniqueConstraint(
            "run_id", "idempotency_key", name="uq_workflow_artifact_operation"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"), index=True
    )
    run_id: Mapped[str] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="CASCADE"), index=True
    )
    stored_object_id: Mapped[str] = mapped_column(
        ForeignKey("stored_objects.id", ondelete="RESTRICT"), unique=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(32))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    checksum_sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class WorkflowEvent(Base):
    __tablename__ = "workflow_events"
    __table_args__ = (
        UniqueConstraint("run_id", "sequence", name="uq_workflow_event_sequence"),
        UniqueConstraint("run_id", "event_key", name="uq_workflow_event_key"),
        Index("ix_workflow_events_run_created", "run_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE"), index=True
    )
    run_id: Mapped[str] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="CASCADE"), index=True
    )
    sequence: Mapped[int] = mapped_column(Integer)
    event_key: Mapped[str] = mapped_column(String(128))
    event_type: Mapped[str] = mapped_column(String(80))
    payload: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)
    payload_object_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("stored_objects.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class WorkflowSlot(Base):
    __tablename__ = "workflow_slots"

    slot_number: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    lease_id: Mapped[Optional[str]] = mapped_column(
        String(36), unique=True, nullable=True
    )
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    acquired_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    lease_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
