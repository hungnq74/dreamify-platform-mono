"""Environment-only settings for the Vercel API runtime."""

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

HOBBY_DEMO_MAXIMA = {
    "max_upload_bytes": 10 * 1024 * 1024,
    "max_user_storage_bytes": 100 * 1024 * 1024,
    "max_global_storage_bytes": 750 * 1024 * 1024,
    "upload_reservation_ttl_seconds": 15 * 60,
    "workflow_event_max_bytes": 32 * 1024,
    "workflow_max_events_per_run": 100,
    "workflow_max_provider_calls": 5,
    "workflow_artifact_max_bytes": 1024 * 1024,
    "workflow_max_aggregate_asset_bytes": 25 * 1024 * 1024,
    "workflow_slot_lease_seconds": 25 * 60,
    "workflow_dispatch_lease_seconds": 60,
    "max_workflow_assets": 3,
    "max_rows_per_file": 100_000,
    "max_columns_per_file": 200,
    "data_runs_per_user_per_day": 5,
    "deployment_runs_per_day": 10,
    "text_runs_per_user_per_day": 20,
    "feedback_submissions_per_day": 100,
    "max_dashboard_bytes": 1024 * 1024,
    "max_blog_content_bytes": 1024 * 1024,
    "max_database_bytes": 350 * 1024 * 1024,
}

PUBLIC_PLACEHOLDER_MARKERS = (
    "replace-with",
    "change-me",
    "changeme",
    "example.com",
    "example.test",
    "your-clerk",
    "user:password",
    "<",
    ">",
)


def is_public_placeholder(value: str) -> bool:
    """Reject documentation values that are unsafe as production credentials."""

    normalized = value.strip().lower()
    return not normalized or any(
        marker in normalized for marker in PUBLIC_PLACEHOLDER_MARKERS
    )


class Settings(BaseSettings):
    """Runtime configuration loaded from process environment only."""

    model_config = SettingsConfigDict(
        case_sensitive=False,
        env_file=None,
        extra="ignore",
    )

    app_env: Literal["development", "test", "preview", "production"] = "development"
    # Vercel injects these automatically. They bind hosted safety to the runtime
    # instead of trusting an operator to remember APP_ENV.
    vercel: bool = False
    vercel_env: Optional[Literal["development", "preview", "production"]] = None
    database_url: str = "sqlite:///./dreamify.db"
    direct_database_url: Optional[str] = None
    cors_origins: List[str] = ["http://localhost:3000"]
    auto_create_schema: bool = False
    seed_on_start: bool = False

    demo_auth_mode: bool = False
    clerk_jwt_public_key: Optional[str] = None
    clerk_jwks_url: Optional[str] = None
    clerk_issuer: Optional[str] = None
    clerk_audience: Optional[str] = None
    clerk_authorized_parties: List[str] = []
    owner_admin_allowlist: List[str] = []

    storage_backend: Literal["local", "vercel_blob"] = "local"
    local_storage_path: Path = Path("/tmp/dreamify-storage")
    vercel_blob_token: Optional[str] = None
    vercel_blob_access: Literal["private", "public"] = "private"
    blob_upload_gateway_url: Optional[str] = None
    blob_signing_gateway_url: Optional[str] = None
    blob_gateway_shared_secret: Optional[str] = None
    internal_service_shared_secret: Optional[str] = None
    workflow_dispatch_url: Optional[str] = None
    workflow_dispatch_timeout_seconds: float = 10.0
    workflow_dispatch_lease_seconds: int = 30
    workflow_sse_max_seconds: float = 15.0
    workflow_sse_poll_seconds: float = 0.5

    # A JSON keyring such as {"v1":"<base64-encoded 32-byte AES key>"}.
    # Keeping multiple versions permits read-time rotation without downtime.
    provider_encryption_keys: Dict[str, str] = Field(default_factory=dict, repr=False)
    provider_current_key_version: str = "v1"
    provider_validation_timeout_seconds: float = 10.0

    max_upload_bytes: int = 10 * 1024 * 1024
    max_user_storage_bytes: int = 100 * 1024 * 1024
    max_global_storage_bytes: int = 750 * 1024 * 1024
    upload_reservation_ttl_seconds: int = 15 * 60
    workflow_event_max_bytes: int = 32 * 1024
    workflow_max_events_per_run: int = 100
    workflow_max_provider_calls: int = 5
    workflow_artifact_max_bytes: int = 1024 * 1024
    workflow_max_aggregate_asset_bytes: int = 25 * 1024 * 1024
    workflow_slot_count: int = 2
    workflow_slot_lease_seconds: int = 25 * 60
    max_workflow_assets: int = 3
    max_rows_per_file: int = 100_000
    max_columns_per_file: int = 200
    data_runs_per_user_per_day: int = 5
    deployment_runs_per_day: int = 10
    text_runs_per_user_per_day: int = 20
    feedback_submissions_per_day: int = 100
    max_dashboard_bytes: int = 1024 * 1024
    dashboard_version_retention: int = 25
    max_blog_content_bytes: int = 1024 * 1024
    max_database_bytes: int = 350 * 1024 * 1024

    billing_enabled: bool = False
    connectors_enabled: bool = False

    @field_validator(
        "cors_origins",
        "clerk_authorized_parties",
        "owner_admin_allowlist",
        mode="before",
    )
    @classmethod
    def parse_string_list(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        value = value.strip()
        if not value:
            return []
        if value.startswith("["):
            return json.loads(value)
        return [item.strip() for item in value.split(",") if item.strip()]

    @field_validator("cors_origins")
    @classmethod
    def validate_origins(cls, origins: List[str]) -> List[str]:
        if not origins:
            raise ValueError("CORS_ORIGINS must contain at least one origin")
        if "*" in origins:
            raise ValueError("Wildcard CORS origins are not allowed")
        for origin in origins:
            if not origin.startswith(("http://", "https://")):
                raise ValueError("CORS origins must be absolute HTTP(S) origins")
        return origins

    @field_validator("owner_admin_allowlist")
    @classmethod
    def validate_owner_admin_allowlist(cls, values: List[str]) -> List[str]:
        normalized: List[str] = []
        for value in values:
            candidate = value.strip().lower()
            if not candidate or len(candidate) > 320:
                raise ValueError("Owner admin identities must be 1-320 characters")
            if candidate not in normalized:
                normalized.append(candidate)
        return normalized

    @field_validator("workflow_dispatch_timeout_seconds")
    @classmethod
    def validate_dispatch_timeout(cls, value: float) -> float:
        if not 0 < value <= 30:
            raise ValueError("Workflow dispatch timeout must be at most 30 seconds")
        return value

    @field_validator("workflow_sse_max_seconds")
    @classmethod
    def validate_sse_duration(cls, value: float) -> float:
        if not 0 < value <= 25:
            raise ValueError("Workflow SSE duration must be at most 25 seconds")
        return value

    @field_validator("workflow_sse_poll_seconds")
    @classmethod
    def validate_sse_poll(cls, value: float) -> float:
        if not 0.05 <= value <= 5:
            raise ValueError(
                "Workflow SSE poll interval must be between 0.05 and 5 seconds"
            )
        return value

    @field_validator("provider_current_key_version")
    @classmethod
    def validate_provider_key_version(cls, value: str) -> str:
        if not value or len(value) > 32 or not value.replace("-", "").isalnum():
            raise ValueError("Provider encryption key version is invalid")
        return value

    @field_validator("provider_validation_timeout_seconds")
    @classmethod
    def validate_provider_timeout(cls, value: float) -> float:
        if not 0 < value <= 20:
            raise ValueError("Provider validation timeout must be at most 20 seconds")
        return value

    @field_validator(
        "max_upload_bytes",
        "max_user_storage_bytes",
        "max_global_storage_bytes",
        "upload_reservation_ttl_seconds",
        "workflow_event_max_bytes",
        "workflow_max_events_per_run",
        "workflow_max_provider_calls",
        "workflow_artifact_max_bytes",
        "workflow_max_aggregate_asset_bytes",
        "workflow_slot_count",
        "workflow_slot_lease_seconds",
        "workflow_dispatch_lease_seconds",
        "max_workflow_assets",
        "max_rows_per_file",
        "max_columns_per_file",
        "data_runs_per_user_per_day",
        "deployment_runs_per_day",
        "text_runs_per_user_per_day",
        "feedback_submissions_per_day",
        "max_dashboard_bytes",
        "dashboard_version_retention",
        "max_blog_content_bytes",
        "max_database_bytes",
    )
    @classmethod
    def validate_positive_limits(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("Resource limits must be positive")
        return value

    @model_validator(mode="after")
    def validate_runtime_safety(self) -> "Settings":
        if self.billing_enabled or self.connectors_enabled:
            raise ValueError(
                "Billing and external connectors are disabled in this release"
            )
        if self.workflow_slot_count != 2:
            raise ValueError("hobby_demo requires exactly two workflow slots")
        if self.dashboard_version_retention > 50:
            raise ValueError("dashboard_version_retention cannot exceed 50")
        for field, maximum in HOBBY_DEMO_MAXIMA.items():
            if getattr(self, field) > maximum:
                raise ValueError(
                    f"{field} exceeds the locked hobby_demo ceiling of {maximum}"
                )
        if self.vercel and self.app_env not in {"preview", "production"}:
            raise ValueError("Vercel runtime requires APP_ENV=preview or production")
        if (
            self.vercel_env in {"preview", "production"}
            and self.app_env != self.vercel_env
        ):
            raise ValueError("APP_ENV must match the injected VERCEL_ENV")
        hosted = self.vercel or self.app_env == "production"
        if not hosted:
            return self
        if self.demo_auth_mode:
            raise ValueError("DEMO_AUTH_MODE cannot be enabled in a hosted runtime")
        if self.seed_on_start:
            raise ValueError("Hosted seed data must run as a deployment step")
        if not self.database_url.startswith(("postgres://", "postgresql://")):
            raise ValueError("Hosted DATABASE_URL must be PostgreSQL")
        self._warn_on_direct_database_url()
        if not (self.clerk_jwt_public_key or self.clerk_jwks_url):
            raise ValueError("Hosted runtime requires a Clerk public key or JWKS URL")
        if not self.clerk_issuer or not self.clerk_authorized_parties:
            raise ValueError(
                "Hosted runtime requires Clerk issuer and authorized parties"
            )
        if any(
            "localhost" in origin or "127.0.0.1" in origin
            for origin in self.cors_origins
        ):
            raise ValueError("Hosted CORS origins must not be local addresses")
        if self.storage_backend != "vercel_blob":
            raise ValueError("Hosted storage must use Vercel Blob")
        if not (
            self.vercel_blob_token
            and self.blob_upload_gateway_url
            and self.blob_signing_gateway_url
            and self.blob_gateway_shared_secret
            and self.internal_service_shared_secret
            and self.workflow_dispatch_url
        ):
            raise ValueError(
                "Hosted Blob gateways, workflow dispatch, and service "
                "secrets are required"
            )
        production_values = {
            "DATABASE_URL": self.database_url,
            "Clerk issuer": self.clerk_issuer,
            "Clerk authorized party": self.clerk_authorized_parties[0],
            "Vercel Blob token": self.vercel_blob_token,
            "Blob upload gateway URL": self.blob_upload_gateway_url,
            "Blob signing gateway URL": self.blob_signing_gateway_url,
            "Blob gateway secret": self.blob_gateway_shared_secret,
            "internal service secret": self.internal_service_shared_secret,
            "Workflow dispatch URL": self.workflow_dispatch_url,
        }
        for label, value in production_values.items():
            if is_public_placeholder(value):
                raise ValueError(f"Hosted {label} cannot be a public placeholder")
        if self.blob_gateway_shared_secret == self.internal_service_shared_secret:
            raise ValueError("Hosted service secrets must be independently generated")
        if not all(
            url.startswith("https://")
            for url in (
                self.blob_upload_gateway_url,
                self.blob_signing_gateway_url,
                self.workflow_dispatch_url,
            )
        ):
            raise ValueError("Hosted service gateways must use HTTPS")
        if len(self.blob_gateway_shared_secret) < 32:
            raise ValueError(
                "Hosted Blob gateway secret must be at least 32 characters"
            )
        if len(self.internal_service_shared_secret) < 32:
            raise ValueError(
                "Hosted internal service secret must be at least 32 characters"
            )
        if self.auto_create_schema:
            raise ValueError("Hosted schema changes must run through Alembic")
        return self

    def _warn_on_direct_database_url(self) -> None:
        """Flag a pooled/direct URL setup that is probably misconfigured.

        Request traffic should go through a connection pooler (PgBouncer,
        Supavisor) while Alembic must reach the database directly — a pooler in
        transaction mode cannot run DDL reliably. migration_database_url falls
        back to database_url when direct_database_url is unset, so a deployment
        that never sets DIRECT_DATABASE_URL silently runs its migrations through
        the pooler and nothing says so.

        This warns rather than raises on purpose. Turning it into a hard error
        would refuse to boot any existing deployment that has not set the
        variable, and CI would not catch that because api.yml exports
        DIRECT_DATABASE_URL="$DATABASE_URL" for the migration step. Promote it to
        a ValueError once the deployed environments are confirmed to set it.
        """
        message = self.direct_database_url_warning()
        if message:
            logging.getLogger(__name__).warning(message)

    def direct_database_url_warning(self) -> Optional[str]:
        """The warning text, or None when the two endpoints look correct.

        Split out from the logging call so it can be asserted on directly.
        """
        if not self.direct_database_url:
            return (
                "DIRECT_DATABASE_URL is not set; Alembic will run against "
                "DATABASE_URL. If that is a pooled endpoint, migrations may fail "
                "or behave inconsistently."
            )
        if self.direct_database_url == self.database_url:
            return (
                "DIRECT_DATABASE_URL matches DATABASE_URL; request traffic and "
                "migrations are sharing one endpoint. Point DATABASE_URL at the "
                "pooled host and DIRECT_DATABASE_URL at the direct host."
            )
        return None

    @property
    def migration_database_url(self) -> str:
        return self.direct_database_url or self.database_url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
