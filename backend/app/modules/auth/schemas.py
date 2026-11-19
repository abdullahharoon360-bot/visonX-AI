from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class OrganizationMembershipSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    organization_id: UUID
    organization_name: str
    organization_slug: str
    role_key: str
    role_name: str
    hierarchy_level: int
    permissions: List[str]


class UserProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    full_name: str
    job_title: str
    avatar_url: Optional[str] = None
    mfa_enabled: bool
    is_active: bool
    last_seen_at: Optional[datetime] = None
    created_at: datetime


class UpdateProfileRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=160)
    job_title: str = Field(default="", max_length=160)


class AuthMeResponse(BaseModel):
    profile: UserProfileResponse
    memberships: List[OrganizationMembershipSummary]
