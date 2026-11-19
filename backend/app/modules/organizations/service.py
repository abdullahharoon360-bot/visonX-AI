import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.errors import AuthorizationError, ConflictError, ResourceNotFoundError
from app.core.security import AuthenticatedUser, OrgAccessContext
from app.modules.organizations.models import (
    AuditLog,
    Organization,
    OrganizationInvitation,
    OrganizationMember,
    SystemSetting,
)
from app.modules.organizations.schemas import (
    CreateInvitationRequest,
    CreateOrganizationRequest,
    InvitationResponse,
    MemberResponse,
    UpdateMemberRequest,
    UpdateOrganizationRequest,
    UpdateSystemSettingsRequest,
)
from app.modules.rbac.models import Role


def _hash_invite_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def record_audit_event(
    db: Session,
    organization_id: Optional[UUID],
    actor_user_id: Optional[UUID],
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    log = AuditLog(
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        metadata_json=metadata or {},
    )
    db.add(log)


def create_organization_with_owner(
    db: Session,
    user: AuthenticatedUser,
    payload: CreateOrganizationRequest,
) -> Organization:
    existing = db.scalar(select(Organization).where(Organization.slug == payload.slug))
    if existing is not None:
        raise ConflictError(f"Organization slug '{payload.slug}' is already taken.")

    admin_role = db.scalar(select(Role).where(Role.key == "admin"))
    if admin_role is None:
        raise ResourceNotFoundError("System role 'admin' not initialized in database.")

    org = Organization(
        name=payload.name.strip(),
        slug=payload.slug.strip().lower(),
        industry=payload.industry.strip(),
        status="active",
        created_by=user.user_id,
    )
    db.add(org)
    db.flush()

    membership = OrganizationMember(
        organization_id=org.id,
        user_id=user.user_id,
        role_id=admin_role.id,
        status="active",
        invited_by=user.user_id,
    )
    settings = SystemSetting(
        organization_id=org.id,
        updated_by=user.user_id,
    )
    db.add(membership)
    db.add(settings)
    record_audit_event(
        db,
        organization_id=org.id,
        actor_user_id=user.user_id,
        action="organization.created",
        resource_type="organization",
        resource_id=str(org.id),
        metadata={"slug": org.slug, "assigned_creator_role": "admin"},
    )
    db.commit()
    db.refresh(org)
    return org


def update_organization(
    db: Session,
    context: OrgAccessContext,
    payload: UpdateOrganizationRequest,
) -> Organization:
    org = db.scalar(select(Organization).where(Organization.id == context.organization_id))
    if org is None:
        raise ResourceNotFoundError("Organization not found.")

    if payload.name is not None:
        org.name = payload.name.strip()
    if payload.industry is not None:
        org.industry = payload.industry.strip()

    record_audit_event(
        db,
        organization_id=org.id,
        actor_user_id=context.user.user_id,
        action="organization.updated",
        resource_type="organization",
        resource_id=str(org.id),
    )
    db.commit()
    db.refresh(org)
    return org


def list_members(db: Session, organization_id: UUID) -> List[MemberResponse]:
    rows = db.scalars(
        select(OrganizationMember)
        .options(joinedload(OrganizationMember.user), joinedload(OrganizationMember.role))
        .where(OrganizationMember.organization_id == organization_id)
        .order_by(OrganizationMember.joined_at.asc())
    ).all()

    return [
        MemberResponse(
            id=row.id,
            user_id=row.user_id,
            email=row.user.email,
            full_name=row.user.full_name,
            job_title=row.user.job_title,
            role_key=row.role.key,
            role_name=row.role.name,
            status=row.status,
            joined_at=row.joined_at,
        )
        for row in rows
    ]


def update_member(
    db: Session,
    context: OrgAccessContext,
    member_id: UUID,
    payload: UpdateMemberRequest,
) -> MemberResponse:
    member = db.scalar(
        select(OrganizationMember)
        .options(joinedload(OrganizationMember.user), joinedload(OrganizationMember.role))
        .where(
            OrganizationMember.id == member_id,
            OrganizationMember.organization_id == context.organization_id,
        )
    )
    if member is None:
        raise ResourceNotFoundError("Organization member not found.")

    if member.role.hierarchy_level > context.hierarchy_level:
        raise AuthorizationError("Cannot modify a member with a higher role hierarchy.")

    if payload.role_key is not None:
        target_role = db.scalar(select(Role).where(Role.key == payload.role_key))
        if target_role is None:
            raise ResourceNotFoundError(f"Role '{payload.role_key}' does not exist.")
        if target_role.hierarchy_level > context.hierarchy_level:
            raise AuthorizationError("Cannot assign a role higher than your own.")
        member.role_id = target_role.id
        member.role = target_role

    if payload.status is not None:
        if member.user_id == context.user.user_id and payload.status == "suspended":
            raise ConflictError("You cannot suspend your own membership.")
        member.status = payload.status

    record_audit_event(
        db,
        organization_id=context.organization_id,
        actor_user_id=context.user.user_id,
        action="member.updated",
        resource_type="organization_member",
        resource_id=str(member.id),
        metadata={"role_key": member.role.key, "status": member.status},
    )
    db.commit()
    db.refresh(member)

    return MemberResponse(
        id=member.id,
        user_id=member.user_id,
        email=member.user.email,
        full_name=member.user.full_name,
        job_title=member.user.job_title,
        role_key=member.role.key,
        role_name=member.role.name,
        status=member.status,
        joined_at=member.joined_at,
    )


def create_invitation(
    db: Session,
    context: OrgAccessContext,
    payload: CreateInvitationRequest,
) -> InvitationResponse:
    target_role = db.scalar(select(Role).where(Role.key == payload.role_key))
    if target_role is None:
        raise ResourceNotFoundError(f"Role '{payload.role_key}' does not exist.")
    if target_role.hierarchy_level > context.hierarchy_level:
        raise AuthorizationError("Cannot invite a user with a role higher than your own.")

    normalized_email = payload.email.strip().lower()
    raw_token = secrets.token_urlsafe(32)
    invitation = OrganizationInvitation(
        organization_id=context.organization_id,
        email=normalized_email,
        role_id=target_role.id,
        token_hash=_hash_invite_token(raw_token),
        status="pending",
        invited_by=context.user.user_id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=payload.expires_in_hours),
    )
    db.add(invitation)
    db.flush()

    record_audit_event(
        db,
        organization_id=context.organization_id,
        actor_user_id=context.user.user_id,
        action="invitation.created",
        resource_type="organization_invitation",
        resource_id=str(invitation.id),
        metadata={"invited_email": normalized_email, "role_key": target_role.key},
    )
    db.commit()
    db.refresh(invitation)

    return InvitationResponse(
        id=invitation.id,
        organization_id=invitation.organization_id,
        email=invitation.email,
        role_key=target_role.key,
        role_name=target_role.name,
        status=invitation.status,
        expires_at=invitation.expires_at,
        created_at=invitation.created_at,
        invitation_token=raw_token,
    )


def accept_invitation(
    db: Session,
    user: AuthenticatedUser,
    raw_token: str,
) -> OrganizationMember:
    token_hash = _hash_invite_token(raw_token)
    invitation = db.scalar(
        select(OrganizationInvitation)
        .options(joinedload(OrganizationInvitation.role))
        .where(OrganizationInvitation.token_hash == token_hash)
    )
    if invitation is None:
        raise ResourceNotFoundError("Invitation token is invalid.")
    if invitation.status != "pending":
        raise ConflictError(f"Invitation has already been {invitation.status}.")
    if invitation.expires_at < datetime.now(timezone.utc):
        invitation.status = "expired"
        db.commit()
        raise ConflictError("Invitation token has expired.")
    if invitation.email.lower() != user.email.lower():
        raise AuthorizationError("Invitation email does not match your authenticated account.")

    existing = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == invitation.organization_id,
            OrganizationMember.user_id == user.user_id,
        )
    )
    if existing is not None:
        raise ConflictError("You are already a member of this organization.")

    member = OrganizationMember(
        organization_id=invitation.organization_id,
        user_id=user.user_id,
        role_id=invitation.role_id,
        status="active",
        invited_by=invitation.invited_by,
    )
    invitation.status = "accepted"
    invitation.accepted_at = datetime.now(timezone.utc)
    db.add(member)
    record_audit_event(
        db,
        organization_id=invitation.organization_id,
        actor_user_id=user.user_id,
        action="invitation.accepted",
        resource_type="organization_invitation",
        resource_id=str(invitation.id),
    )
    db.commit()
    db.refresh(member)
    return member


def update_system_settings(
    db: Session,
    context: OrgAccessContext,
    payload: UpdateSystemSettingsRequest,
) -> SystemSetting:
    settings_row = db.scalar(
        select(SystemSetting).where(SystemSetting.organization_id == context.organization_id)
    )
    if settings_row is None:
        settings_row = SystemSetting(organization_id=context.organization_id)
        db.add(settings_row)

    if payload.session_timeout_minutes is not None:
        settings_row.session_timeout_minutes = payload.session_timeout_minutes
    if payload.require_mfa_for_privileged is not None:
        settings_row.require_mfa_for_privileged = payload.require_mfa_for_privileged
    if payload.allowed_ip_cidrs is not None:
        settings_row.allowed_ip_cidrs = payload.allowed_ip_cidrs
    if payload.retention_days is not None:
        settings_row.retention_days = payload.retention_days

    settings_row.updated_by = context.user.user_id
    record_audit_event(
        db,
        organization_id=context.organization_id,
        actor_user_id=context.user.user_id,
        action="settings.updated",
        resource_type="system_settings",
        resource_id=str(context.organization_id),
    )
    db.commit()
    db.refresh(settings_row)
    return settings_row
