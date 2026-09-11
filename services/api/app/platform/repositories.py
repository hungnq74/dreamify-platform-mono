"""Tenant-scoped repositories.

Project child reads join an active membership in the database query. Historical
``owner_id`` parameters identify the authenticated actor; creator/uploader
columns remain attribution fields and are not the project access boundary.
"""

from typing import List, Optional

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.platform.models import (
    AppUser,
    Asset,
    Conversation,
    Dashboard,
    DashboardVersion,
    Project,
    ProjectMember,
    ProjectPreviewGrant,
    StoredObject,
    UploadReservation,
    WorkflowEvent,
    WorkflowRun,
    WorkflowRunAsset,
    utc_now,
)

READ_PROJECT_ROLES = ("owner", "editor", "viewer")
WRITE_PROJECT_ROLES = ("owner", "editor")


class UserRepository:
    def __init__(self, session: Session):
        self.session = session

    def ensure(
        self,
        user_id: str,
        email: Optional[str] = None,
        display_name: Optional[str] = None,
    ) -> AppUser:
        normalized_email = email.strip().lower() if email else None
        user = self.session.get(AppUser, user_id)
        if user is None:
            table = AppUser.__table__
            statement = (
                sqlite_insert(table)
                if self.session.get_bind().dialect.name == "sqlite"
                else postgresql_insert(table)
            )
            now = utc_now()
            self.session.execute(
                statement.values(
                    id=user_id,
                    email=normalized_email,
                    display_name=display_name,
                    status="active",
                    created_at=now,
                    updated_at=now,
                ).on_conflict_do_nothing(index_elements=[table.c.id])
            )
            self.session.flush()
            user = self.session.get(AppUser, user_id)
        if user is None:
            raise RuntimeError("User upsert did not return a persisted user")
        if normalized_email and user.email != normalized_email:
            user.email = normalized_email
        if display_name and user.display_name != display_name:
            user.display_name = display_name
        self.session.flush()
        return user

    def by_email(self, email: str) -> Optional[AppUser]:
        query = select(AppUser).where(func.lower(AppUser.email) == email.lower())
        return self.session.scalar(query)


class ProjectRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(self, owner_id: str, name: str, description: Optional[str]) -> Project:
        project = Project(owner_id=owner_id, name=name, description=description)
        self.session.add(project)
        self.session.flush()
        self.session.add(
            ProjectMember(
                project_id=project.id,
                user_id=owner_id,
                role="owner",
                status="active",
            )
        )
        self.session.flush()
        return project

    def list_owned(self, owner_id: str) -> List[Project]:
        query = (
            select(Project)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
            )
            .order_by(Project.created_at, Project.id)
        )
        return list(self.session.scalars(query).all())

    def get_owned(self, owner_id: str, project_id: str) -> Optional[Project]:
        query = (
            select(Project)
            .join(ProjectMember)
            .where(
                Project.id == project_id,
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
            )
        )
        return self.session.scalar(query)

    def access(
        self,
        user_id: str,
        project_id: str,
        for_update: bool = False,
    ) -> Optional[tuple[Project, ProjectMember]]:
        query = (
            select(Project, ProjectMember)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(
                Project.id == project_id,
                ProjectMember.user_id == user_id,
                ProjectMember.status == "active",
            )
        )
        if for_update:
            query = query.with_for_update(of=Project)
        row = self.session.execute(query).one_or_none()
        if row is None:
            return None
        return row[0], row[1]

    def get(self, project_id: str) -> Optional[Project]:
        return self.session.get(Project, project_id)

    def has_preview_grant(self, project_id: str, user: AppUser) -> bool:
        identities = [ProjectPreviewGrant.user_id == user.id]
        if user.email:
            identities.append(
                func.lower(ProjectPreviewGrant.email) == user.email.strip().lower()
            )
        query = select(ProjectPreviewGrant.id).where(
            ProjectPreviewGrant.project_id == project_id,
            or_(*identities),
        )
        return self.session.scalar(query) is not None

    def has_active_membership(self, project_id: str, user_id: str) -> bool:
        query = select(ProjectMember.id).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
            ProjectMember.status == "active",
        )
        return self.session.scalar(query) is not None


class ProjectMemberRepository:
    def __init__(self, session: Session):
        self.session = session

    def list(self, project_id: str) -> List[ProjectMember]:
        query = (
            select(ProjectMember)
            .where(ProjectMember.project_id == project_id)
            .order_by(ProjectMember.created_at, ProjectMember.id)
        )
        return list(self.session.scalars(query).all())

    def get(self, project_id: str, member_id: str) -> Optional[ProjectMember]:
        query = select(ProjectMember).where(
            ProjectMember.id == member_id,
            ProjectMember.project_id == project_id,
        )
        return self.session.scalar(query)

    def for_user(self, project_id: str, user_id: str) -> Optional[ProjectMember]:
        query = select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
        return self.session.scalar(query)

    def active_owners(self, project_id: str) -> List[ProjectMember]:
        query = (
            select(ProjectMember)
            .where(
                ProjectMember.project_id == project_id,
                ProjectMember.role == "owner",
                ProjectMember.status == "active",
            )
            .order_by(ProjectMember.created_at, ProjectMember.id)
        )
        return list(self.session.scalars(query).all())

    def create(self, project_id: str, user_id: str, role: str) -> ProjectMember:
        member = ProjectMember(
            project_id=project_id,
            user_id=user_id,
            role=role,
            status="active",
        )
        self.session.add(member)
        self.session.flush()
        return member


class AssetRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(
        self,
        owner_id: str,
        project_id: str,
        stored: StoredObject,
        filename: str,
        asset_type: str,
    ) -> Asset:
        asset = Asset(
            owner_id=owner_id,
            project_id=project_id,
            stored_object_id=stored.id,
            filename=filename,
            asset_type=asset_type,
            content_type=stored.content_type,
            size_bytes=stored.size_bytes,
        )
        self.session.add(asset)
        self.session.flush()
        return asset

    def list_owned(self, owner_id: str, project_id: str) -> List[Asset]:
        query = (
            select(Asset)
            .join(ProjectMember, ProjectMember.project_id == Asset.project_id)
            .where(
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
                Asset.project_id == project_id,
            )
            .order_by(Asset.created_at)
        )
        return list(self.session.scalars(query).all())

    def list_all_owned(self, owner_id: str) -> List[Asset]:
        query = (
            select(Asset)
            .join(ProjectMember, ProjectMember.project_id == Asset.project_id)
            .where(
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
            )
            .order_by(Asset.created_at.desc())
        )
        return list(self.session.scalars(query).all())

    def get_owned(
        self,
        owner_id: str,
        asset_id: str,
        roles: tuple[str, ...] = READ_PROJECT_ROLES,
    ) -> Optional[Asset]:
        query = (
            select(Asset)
            .join(ProjectMember, ProjectMember.project_id == Asset.project_id)
            .where(
                Asset.id == asset_id,
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
                ProjectMember.role.in_(roles),
            )
        )
        return self.session.scalar(query)

    def get_many_owned(self, owner_id: str, asset_ids: List[str]) -> List[Asset]:
        if not asset_ids:
            return []
        query = (
            select(Asset)
            .join(ProjectMember, ProjectMember.project_id == Asset.project_id)
            .where(
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
                ProjectMember.role.in_(WRITE_PROJECT_ROLES),
                Asset.id.in_(asset_ids),
                Asset.status == "ready",
            )
        )
        return list(self.session.scalars(query).all())

    def stored_object(self, owner_id: str, asset: Asset) -> Optional[StoredObject]:
        query = (
            select(StoredObject)
            .join(Asset, Asset.stored_object_id == StoredObject.id)
            .join(ProjectMember, ProjectMember.project_id == Asset.project_id)
            .where(
                StoredObject.id == asset.stored_object_id,
                Asset.id == asset.id,
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
            )
        )
        return self.session.scalar(query)

    def total_size(self, owner_id: Optional[str] = None) -> int:
        query = select(func.coalesce(func.sum(Asset.size_bytes), 0))
        if owner_id is not None:
            query = query.where(Asset.owner_id == owner_id)
        return int(self.session.scalar(query) or 0)


class StoredObjectRepository:
    def __init__(self, session: Session):
        self.session = session

    def total_size(self, owner_id: Optional[str] = None) -> int:
        query = select(func.coalesce(func.sum(StoredObject.size_bytes), 0))
        if owner_id is not None:
            query = query.where(StoredObject.owner_id == owner_id)
        return int(self.session.scalar(query) or 0)


class UploadRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(self, reservation: UploadReservation) -> UploadReservation:
        self.session.add(reservation)
        self.session.flush()
        return reservation

    def by_idempotency_key(
        self, owner_id: str, idempotency_key: Optional[str]
    ) -> Optional[UploadReservation]:
        if not idempotency_key:
            return None
        query = select(UploadReservation).where(
            UploadReservation.owner_id == owner_id,
            UploadReservation.idempotency_key == idempotency_key,
        )
        return self.session.scalar(query)

    def get_owned(
        self, owner_id: str, reservation_id: str, for_update: bool = False
    ) -> Optional[UploadReservation]:
        query = select(UploadReservation).where(
            UploadReservation.id == reservation_id,
            UploadReservation.owner_id == owner_id,
        )
        if for_update:
            query = query.with_for_update()
        return self.session.scalar(query)

    def asset_for_reservation(self, reservation: UploadReservation) -> Optional[Asset]:
        if not reservation.asset_id:
            return None
        return self.session.get(Asset, reservation.asset_id)

    def reserved_size(self, owner_id: Optional[str] = None) -> int:
        query = select(
            func.coalesce(func.sum(UploadReservation.expected_size_bytes), 0)
        ).where(UploadReservation.status.in_(("pending", "uploaded")))
        query = query.where(UploadReservation.expires_at > utc_now())
        if owner_id is not None:
            query = query.where(UploadReservation.owner_id == owner_id)
        return int(self.session.scalar(query) or 0)


class ConversationRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(
        self, owner_id: str, project_id: Optional[str], title: str
    ) -> Conversation:
        conversation = Conversation(
            owner_id=owner_id, project_id=project_id, title=title
        )
        self.session.add(conversation)
        self.session.flush()
        return conversation

    def list_owned(self, owner_id: str) -> List[Conversation]:
        query = (
            select(Conversation)
            .outerjoin(
                ProjectMember,
                ProjectMember.project_id == Conversation.project_id,
            )
            .where(
                or_(
                    and_(
                        Conversation.project_id.is_(None),
                        Conversation.owner_id == owner_id,
                    ),
                    and_(
                        ProjectMember.user_id == owner_id,
                        ProjectMember.status == "active",
                    ),
                )
            )
            .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
        )
        return list(self.session.scalars(query).all())

    def latest_for_project(
        self, owner_id: str, project_id: str
    ) -> Optional[Conversation]:
        query = (
            select(Conversation)
            .join(ProjectMember, ProjectMember.project_id == Conversation.project_id)
            .where(
                Conversation.project_id == project_id,
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
            )
            .order_by(Conversation.updated_at.desc())
            .limit(1)
        )
        return self.session.scalar(query)

    def get_owned(
        self,
        owner_id: str,
        conversation_id: str,
        for_update: bool = False,
        roles: tuple[str, ...] = READ_PROJECT_ROLES,
    ) -> Optional[Conversation]:
        query = (
            select(Conversation)
            .outerjoin(
                ProjectMember,
                ProjectMember.project_id == Conversation.project_id,
            )
            .where(
                Conversation.id == conversation_id,
                or_(
                    and_(
                        Conversation.project_id.is_(None),
                        Conversation.owner_id == owner_id,
                    ),
                    and_(
                        ProjectMember.user_id == owner_id,
                        ProjectMember.status == "active",
                        ProjectMember.role.in_(roles),
                    ),
                ),
            )
        )
        if for_update:
            query = query.with_for_update(of=Conversation)
        return self.session.scalar(query)


class DashboardRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(self, dashboard: Dashboard) -> Dashboard:
        self.session.add(dashboard)
        self.session.flush()
        self.add_version(dashboard, source="generation")
        return dashboard

    def add_version(
        self,
        dashboard: Dashboard,
        source: str = "update",
        edit_summary: Optional[str] = None,
    ) -> DashboardVersion:
        version = DashboardVersion(
            dashboard_id=dashboard.id,
            version=dashboard.current_version,
            content=dashboard.content,
            source=source,
            edit_summary=edit_summary,
        )
        self.session.add(version)
        self.session.flush()
        return version

    def list_owned(
        self, owner_id: str, project_id: Optional[str] = None
    ) -> List[Dashboard]:
        query = (
            select(Dashboard)
            .join(ProjectMember, ProjectMember.project_id == Dashboard.project_id)
            .where(
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
            )
        )
        if project_id:
            query = query.where(Dashboard.project_id == project_id)
        return list(
            self.session.scalars(
                query.order_by(Dashboard.updated_at.desc(), Dashboard.id.desc())
            ).all()
        )

    def get_owned(
        self,
        owner_id: str,
        dashboard_id: str,
        for_update: bool = False,
        roles: tuple[str, ...] = READ_PROJECT_ROLES,
    ) -> Optional[Dashboard]:
        query = (
            select(Dashboard)
            .join(ProjectMember, ProjectMember.project_id == Dashboard.project_id)
            .where(
                Dashboard.id == dashboard_id,
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
                ProjectMember.role.in_(roles),
            )
        )
        if for_update:
            query = query.with_for_update()
        return self.session.scalar(query)

    def latest_for_project(
        self,
        owner_id: str,
        project_id: str,
        conversation_id: Optional[str] = None,
    ) -> Optional[Dashboard]:
        query = (
            select(Dashboard)
            .join(ProjectMember, ProjectMember.project_id == Dashboard.project_id)
            .where(
                Dashboard.project_id == project_id,
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
            )
        )
        if conversation_id:
            query = query.where(Dashboard.conversation_id == conversation_id)
        query = query.order_by(Dashboard.updated_at.desc()).limit(1)
        return self.session.scalar(query)

    def get_version(
        self, dashboard_id: str, version: int
    ) -> Optional[DashboardVersion]:
        query = select(DashboardVersion).where(
            DashboardVersion.dashboard_id == dashboard_id,
            DashboardVersion.version == version,
        )
        return self.session.scalar(query)

    def list_versions(self, dashboard_id: str) -> List[DashboardVersion]:
        query = (
            select(DashboardVersion)
            .where(DashboardVersion.dashboard_id == dashboard_id)
            .order_by(DashboardVersion.version.desc())
        )
        return list(self.session.scalars(query).all())

    def prune_versions(self, dashboard_id: str, retain: int) -> None:
        versions = self.list_versions(dashboard_id)
        if len(versions) <= retain:
            return
        oldest = versions[-1]
        keep = {item.id for item in versions[: max(retain - 1, 0)]}
        keep.add(oldest.id)
        self.session.execute(
            delete(DashboardVersion).where(
                DashboardVersion.dashboard_id == dashboard_id,
                DashboardVersion.id.not_in(keep),
            )
        )


class WorkflowRepository:
    def __init__(self, session: Session):
        self.session = session

    def create_run(self, run: WorkflowRun) -> WorkflowRun:
        self.session.add(run)
        self.session.flush()
        return run

    def get_by_client_request(
        self, owner_id: str, client_request_id: str, for_update: bool = False
    ) -> Optional[WorkflowRun]:
        query = select(WorkflowRun).where(
            WorkflowRun.owner_id == owner_id,
            WorkflowRun.client_request_id == client_request_id,
        )
        if for_update:
            query = query.with_for_update()
        return self.session.scalar(query)

    def link_assets(self, run_id: str, assets: List[Asset]) -> None:
        self.session.add_all(
            [WorkflowRunAsset(run_id=run_id, asset_id=asset.id) for asset in assets]
        )
        self.session.flush()

    def list_runs(
        self, owner_id: str, project_id: Optional[str] = None
    ) -> List[WorkflowRun]:
        query = (
            select(WorkflowRun)
            .join(ProjectMember, ProjectMember.project_id == WorkflowRun.project_id)
            .where(
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
            )
        )
        if project_id:
            query = query.where(WorkflowRun.project_id == project_id)
        return list(
            self.session.scalars(
                query.order_by(WorkflowRun.created_at.desc(), WorkflowRun.id.desc())
            ).all()
        )

    def get_run(
        self,
        owner_id: str,
        run_id: str,
        for_update: bool = False,
        roles: tuple[str, ...] = READ_PROJECT_ROLES,
    ) -> Optional[WorkflowRun]:
        query = (
            select(WorkflowRun)
            .join(ProjectMember, ProjectMember.project_id == WorkflowRun.project_id)
            .where(
                WorkflowRun.id == run_id,
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
                ProjectMember.role.in_(roles),
            )
        )
        if for_update:
            query = query.with_for_update()
        return self.session.scalar(query)

    def latest_for_conversation(
        self,
        owner_id: str,
        conversation_id: str,
        for_update: bool = False,
    ) -> Optional[WorkflowRun]:
        query = (
            select(WorkflowRun)
            .join(ProjectMember, ProjectMember.project_id == WorkflowRun.project_id)
            .where(
                WorkflowRun.conversation_id == conversation_id,
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
            )
            .order_by(WorkflowRun.created_at.desc())
            .limit(1)
        )
        if for_update:
            query = query.with_for_update()
        return self.session.scalar(query)

    def get_event(self, run_id: str, event_key: str) -> Optional[WorkflowEvent]:
        query = select(WorkflowEvent).where(
            WorkflowEvent.run_id == run_id,
            WorkflowEvent.event_key == event_key,
        )
        return self.session.scalar(query)

    def next_sequence(self, run_id: str) -> int:
        query = select(func.coalesce(func.max(WorkflowEvent.sequence), 0)).where(
            WorkflowEvent.run_id == run_id
        )
        return int(self.session.scalar(query) or 0) + 1

    def add_event(self, event: WorkflowEvent) -> WorkflowEvent:
        self.session.add(event)
        self.session.flush()
        return event

    def list_events(
        self,
        owner_id: str,
        run_id: str,
        after: int = 0,
        limit: Optional[int] = None,
    ) -> List[WorkflowEvent]:
        query = (
            select(WorkflowEvent)
            .join(WorkflowRun, WorkflowRun.id == WorkflowEvent.run_id)
            .join(ProjectMember, ProjectMember.project_id == WorkflowRun.project_id)
            .where(
                WorkflowEvent.run_id == run_id,
                WorkflowEvent.sequence > after,
                ProjectMember.user_id == owner_id,
                ProjectMember.status == "active",
            )
            .order_by(WorkflowEvent.sequence)
        )
        if limit is not None:
            query = query.limit(limit)
        return list(self.session.scalars(query).all())
