from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.errors import ResourceNotFoundError
from app.core.security import AuthenticatedUser, get_current_user
from app.modules.auth.schemas import (
    AuthMeResponse,
    OrganizationMembershipSummary,
    UpdateProfileRequest,
    UserProfileResponse,
)
from app.modules.organizations.models import AuditLog, OrganizationMember, UserProfile
from app.modules.rbac.models import Role, RolePermission

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.get("/me", response_model=AuthMeResponse)
def get_me(
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AuthMeResponse:
    profile = db.scalar(select(UserProfile).where(UserProfile.id == user.user_id))
    if profile is None:
        raise ResourceNotFoundError("User profile not found.")

    profile.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(profile)

    memberships_rows = db.scalars(
        select(OrganizationMember)
        .options(
            joinedload(OrganizationMember.organization),
            joinedload(OrganizationMember.role)
            .joinedload(Role.permissions)
            .joinedload(RolePermission.permission),
        )
        .where(
            OrganizationMember.user_id == user.user_id,
            OrganizationMember.status == "active",
        )
    ).unique().all()

    memberships = [
        OrganizationMembershipSummary(
            organization_id=m.organization.id,
            organization_name=m.organization.name,
            organization_slug=m.organization.slug,
            role_key=m.role.key,
            role_name=m.role.name,
            hierarchy_level=m.role.hierarchy_level,
            permissions=sorted(
                rp.permission.key for rp in m.role.permissions if rp.permission is not None
            ),
        )
        for m in memberships_rows
    ]

    return AuthMeResponse(
        profile=UserProfileResponse.model_validate(profile),
        memberships=memberships,
    )


@router.patch("/profile", response_model=UserProfileResponse)
def update_profile(
    payload: UpdateProfileRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileResponse:
    profile = db.scalar(select(UserProfile).where(UserProfile.id == user.user_id))
    if profile is None:
        raise ResourceNotFoundError("User profile not found.")

    profile.full_name = payload.full_name.strip()
    profile.job_title = payload.job_title.strip()
    db.commit()
    db.refresh(profile)
    return UserProfileResponse.model_validate(profile)


@router.post("/logout-audit")
def record_logout_audit(
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    audit = AuditLog(
        actor_user_id=user.user_id,
        action="auth.logout",
        resource_type="session",
        resource_id=str(user.user_id),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        metadata_json={"method": "explicit_signout"},
    )
    db.add(audit)
    db.commit()
    return {"status": "recorded"}
