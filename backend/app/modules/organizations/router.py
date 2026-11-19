from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.errors import ResourceNotFoundError
from app.core.security import (
    AuthenticatedUser,
    OrgAccessContext,
    get_current_user,
    require_permissions,
)
from app.modules.organizations import service
from app.modules.organizations.models import (
    AuditLog,
    Organization,
    OrganizationInvitation,
    OrganizationMember,
    SystemSetting,
)
from app.modules.organizations.schemas import (
    AuditLogResponse,
    CreateInvitationRequest,
    CreateOrganizationRequest,
    InvitationResponse,
    MemberResponse,
    OrganizationResponse,
    SystemSettingsResponse,
    UpdateMemberRequest,
    UpdateOrganizationRequest,
    UpdateSystemSettingsRequest,
)

router = APIRouter(prefix="/organizations", tags=["Organizations & Administration"])


@router.get("", response_model=List[OrganizationResponse])
def list_my_organizations(
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[OrganizationResponse]:
    orgs = db.scalars(
        select(Organization)
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(
            OrganizationMember.user_id == user.user_id,
            OrganizationMember.status == "active",
        )
        .order_by(Organization.created_at.asc())
    ).all()
    return [OrganizationResponse.model_validate(o) for o in orgs]


@router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
def create_organization(
    payload: CreateOrganizationRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OrganizationResponse:
    org = service.create_organization_with_owner(db, user, payload)
    return OrganizationResponse.model_validate(org)


@router.patch("/{organization_id}", response_model=OrganizationResponse)
def update_organization(
    payload: UpdateOrganizationRequest,
    context: OrgAccessContext = Depends(require_permissions("org:update")),
    db: Session = Depends(get_db),
) -> OrganizationResponse:
    org = service.update_organization(db, context, payload)
    return OrganizationResponse.model_validate(org)


@router.get("/{organization_id}/members", response_model=List[MemberResponse])
def get_members(
    context: OrgAccessContext = Depends(require_permissions("members:read")),
    db: Session = Depends(get_db),
) -> List[MemberResponse]:
    return service.list_members(db, context.organization_id)


@router.patch("/{organization_id}/members/{member_id}", response_model=MemberResponse)
def patch_member(
    member_id: UUID,
    payload: UpdateMemberRequest,
    context: OrgAccessContext = Depends(require_permissions("members:manage")),
    db: Session = Depends(get_db),
) -> MemberResponse:
    return service.update_member(db, context, member_id, payload)


@router.get("/{organization_id}/invitations", response_model=List[InvitationResponse])
def get_invitations(
    context: OrgAccessContext = Depends(require_permissions("members:read")),
    db: Session = Depends(get_db),
) -> List[InvitationResponse]:
    rows = db.scalars(
        select(OrganizationInvitation)
        .options(joinedload(OrganizationInvitation.role))
        .where(OrganizationInvitation.organization_id == context.organization_id)
        .order_by(OrganizationInvitation.created_at.desc())
    ).all()
    return [
        InvitationResponse(
            id=row.id,
            organization_id=row.organization_id,
            email=row.email,
            role_key=row.role.key,
            role_name=row.role.name,
            status=row.status,
            expires_at=row.expires_at,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.post(
    "/{organization_id}/invitations",
    response_model=InvitationResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_invitation(
    payload: CreateInvitationRequest,
    context: OrgAccessContext = Depends(require_permissions("members:invite")),
    db: Session = Depends(get_db),
) -> InvitationResponse:
    return service.create_invitation(db, context, payload)


@router.delete("/{organization_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invitation(
    invitation_id: UUID,
    context: OrgAccessContext = Depends(require_permissions("members:invite")),
    db: Session = Depends(get_db),
) -> None:
    invitation = db.scalar(
        select(OrganizationInvitation).where(
            OrganizationInvitation.id == invitation_id,
            OrganizationInvitation.organization_id == context.organization_id,
        )
    )
    if invitation is None:
        raise ResourceNotFoundError("Invitation not found.")
    invitation.status = "revoked"
    service.record_audit_event(
        db,
        organization_id=context.organization_id,
        actor_user_id=context.user.user_id,
        action="invitation.revoked",
        resource_type="organization_invitation",
        resource_id=str(invitation.id),
    )
    db.commit()


@router.post("/invitations/accept")
def accept_invitation_token(
    token: str = Query(..., min_length=16),
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    member = service.accept_invitation(db, user, token)
    return {"status": "accepted", "organization_id": str(member.organization_id)}


@router.get("/{organization_id}/settings", response_model=SystemSettingsResponse)
def get_settings(
    context: OrgAccessContext = Depends(require_permissions("settings:read")),
    db: Session = Depends(get_db),
) -> SystemSettingsResponse:
    row = db.scalar(
        select(SystemSetting).where(SystemSetting.organization_id == context.organization_id)
    )
    if row is None:
        raise ResourceNotFoundError("Organization settings not found.")
    return SystemSettingsResponse.model_validate(row)


@router.patch("/{organization_id}/settings", response_model=SystemSettingsResponse)
def patch_settings(
    payload: UpdateSystemSettingsRequest,
    context: OrgAccessContext = Depends(require_permissions("settings:update")),
    db: Session = Depends(get_db),
) -> SystemSettingsResponse:
    row = service.update_system_settings(db, context, payload)
    return SystemSettingsResponse.model_validate(row)


@router.get("/{organization_id}/audit-logs", response_model=List[AuditLogResponse])
def list_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    context: OrgAccessContext = Depends(require_permissions("audit:read")),
    db: Session = Depends(get_db),
) -> List[AuditLogResponse]:
    logs = db.scalars(
        select(AuditLog)
        .where(AuditLog.organization_id == context.organization_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    ).all()
    return [
        AuditLogResponse(
            id=log.id,
            organization_id=log.organization_id,
            actor_user_id=log.actor_user_id,
            action=log.action,
            resource_type=log.resource_type,
            resource_id=log.resource_id,
            metadata=log.metadata_json,
            created_at=log.created_at,
        )
        for log in logs
    ]
