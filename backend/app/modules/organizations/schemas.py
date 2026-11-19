from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CreateOrganizationRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    slug: str = Field(min_length=3, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$")
    industry: str = Field(default="Enterprise Security", max_length=120)


class UpdateOrganizationRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    industry: Optional[str] = Field(default=None, max_length=120)


class OrganizationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    industry: str
    status: str
    created_at: datetime
    updated_at: datetime


class MemberResponse(BaseModel):
    id: UUID
    user_id: UUID
    email: str
    full_name: str
    job_title: str
    role_key: str
    role_name: str
    status: str
    joined_at: datetime


class UpdateMemberRequest(BaseModel):
    role_key: Optional[str] = Field(default=None)
    status: Optional[str] = Field(default=None)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in {"active", "suspended"}:
            raise ValueError("status must be 'active' or 'suspended'")
        return value


class CreateInvitationRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    role_key: str = Field(default="viewer")
    expires_in_hours: int = Field(default=72, ge=1, le=336)


class InvitationResponse(BaseModel):
    id: UUID
    organization_id: UUID
    email: str
    role_key: str
    role_name: str
    status: str
    expires_at: datetime
    created_at: datetime
    invitation_token: Optional[str] = None


class SystemSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    organization_id: UUID
    session_timeout_minutes: int
    require_mfa_for_privileged: bool
    allowed_ip_cidrs: List[str]
    retention_days: int
    updated_at: datetime


class UpdateSystemSettingsRequest(BaseModel):
    session_timeout_minutes: Optional[int] = Field(default=None, ge=15, le=10080)
    require_mfa_for_privileged: Optional[bool] = None
    allowed_ip_cidrs: Optional[List[str]] = None
    retention_days: Optional[int] = Field(default=None, ge=7, le=3650)


class AuditLogResponse(BaseModel):
    id: UUID
    organization_id: Optional[UUID]
    actor_user_id: Optional[UUID]
    action: str
    resource_type: str
    resource_id: Optional[str]
    metadata: Dict[str, Any]
    created_at: datetime
