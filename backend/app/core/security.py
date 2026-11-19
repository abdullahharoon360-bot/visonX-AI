from dataclasses import dataclass
from typing import Callable, Iterable, Optional, Set
from uuid import UUID

import jwt
from fastapi import Depends, Header
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import AuthenticationError, AuthorizationError, ServiceUnavailableError
from app.modules.organizations.models import OrganizationMember, UserProfile
from app.modules.rbac.models import Role, RolePermission


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: UUID
    email: str
    full_name: str


@dataclass(frozen=True)
class OrgAccessContext:
    user: AuthenticatedUser
    organization_id: UUID
    role_key: str
    role_name: str
    hierarchy_level: int
    permissions: Set[str]


_jwks_client: Optional[PyJWKClient] = None


def _get_jwks_client() -> Optional[PyJWKClient]:
    global _jwks_client
    settings = get_settings()
    if not settings.supabase_url or "YOUR_PROJECT_REF" in settings.supabase_url:
        return None
    if _jwks_client is None:
        jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(jwks_url)
    return _jwks_client


def verify_supabase_jwt(token: str) -> dict:
    """Verify Supabase JWT signature using JWKS (RS256/ES256) or HS256 secret."""
    settings = get_settings()
    if not settings.supabase_configured:
        raise ServiceUnavailableError(
            "Supabase authentication is not configured on the backend."
        )

    try:
        unverified_header = jwt.get_unverified_header(token)
        alg = unverified_header.get("alg", "HS256")
        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                raise ServiceUnavailableError("SUPABASE_JWT_SECRET is not configured.")
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
        else:
            jwks_client = _get_jwks_client()
            if jwks_client is None:
                raise ServiceUnavailableError("Supabase JWKS URL is not configured.")
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg],
                audience="authenticated",
            )
        return payload
    except jwt.ExpiredSignatureError as exc:
        raise AuthenticationError("Session token has expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthenticationError("Invalid authentication token.") from exc


def get_current_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> AuthenticatedUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise AuthenticationError("Missing Bearer authentication token.")

    raw_token = authorization.removeprefix("Bearer ").strip()
    claims = verify_supabase_jwt(raw_token)

    sub = claims.get("sub")
    if not sub:
        raise AuthenticationError("Token missing subject claim.")

    try:
        user_uuid = UUID(str(sub))
    except ValueError as exc:
        raise AuthenticationError("Malformed subject identifier in token.") from exc

    profile = db.scalar(select(UserProfile).where(UserProfile.id == user_uuid))
    if profile is None:
        # Ensure profile row exists if auth trigger hasn't fired in local dev
        email = str(claims.get("email") or "")
        user_meta = claims.get("user_metadata") or {}
        profile = UserProfile(
            id=user_uuid,
            email=email,
            full_name=str(user_meta.get("full_name") or ""),
            is_active=True,
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)

    if not profile.is_active:
        raise AuthorizationError("User account has been deactivated.")

    return AuthenticatedUser(
        user_id=profile.id,
        email=profile.email,
        full_name=profile.full_name,
    )


def resolve_org_context(
    organization_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OrgAccessContext:
    stmt = (
        select(OrganizationMember)
        .options(
            joinedload(OrganizationMember.role)
            .joinedload(Role.permissions)
            .joinedload(RolePermission.permission)
        )
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == user.user_id,
            OrganizationMember.status == "active",
        )
    )
    membership = db.scalar(stmt)
    if membership is None or membership.role is None:
        raise AuthorizationError("You do not have active membership in this organization.")

    perms = {rp.permission.key for rp in membership.role.permissions if rp.permission is not None}
    return OrgAccessContext(
        user=user,
        organization_id=organization_id,
        role_key=membership.role.key,
        role_name=membership.role.name,
        hierarchy_level=membership.role.hierarchy_level,
        permissions=perms,
    )


def require_permissions(*required: str) -> Callable[..., OrgAccessContext]:
    """FastAPI dependency enforcing organization-scoped RBAC permissions."""

    def _checker(
        context: OrgAccessContext = Depends(resolve_org_context),
    ) -> OrgAccessContext:
        missing = [perm for perm in required if perm not in context.permissions]
        if missing:
            raise AuthorizationError(
                "Missing required RBAC permission(s).",
                details={"missing_permissions": missing, "role": context.role_key},
            )
        return context

    return _checker
