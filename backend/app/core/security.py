from dataclasses import dataclass
from typing import Callable, Optional, Set
from uuid import UUID

import jwt
from fastapi import Depends, Header
from jwt import PyJWKClient

from app.core.config import get_settings
from app.core.errors import AuthenticationError, AuthorizationError, ServiceUnavailableError

FIREBASE_JWKS_URL = (
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
)


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: str
    email: str
    full_name: str
    email_verified: bool


@dataclass(frozen=True)
class OrgAccessContext:
    user: AuthenticatedUser
    organization_id: UUID
    role_key: str
    role_name: str
    hierarchy_level: int
    permissions: Set[str]


_jwks_client: Optional[PyJWKClient] = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(FIREBASE_JWKS_URL)
    return _jwks_client


def verify_firebase_id_token(token: str) -> dict:
    """Verify Firebase Auth RS256 ID token against Google's public securetoken JWKS."""
    settings = get_settings()
    if not settings.firebase_configured:
        raise ServiceUnavailableError("Firebase project ID is not configured on the backend.")

    project_id = settings.firebase_project_id
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=project_id,
            issuer=f"https://securetoken.google.com/{project_id}",
        )
        return payload
    except jwt.ExpiredSignatureError as exc:
        raise AuthenticationError("Firebase session token has expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthenticationError("Invalid Firebase authentication token.") from exc


def get_current_user(
    authorization: Optional[str] = Header(default=None),
) -> AuthenticatedUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise AuthenticationError("Missing Bearer authentication token.")

    raw_token = authorization.removeprefix("Bearer ").strip()
    claims = verify_firebase_id_token(raw_token)

    sub = claims.get("sub") or claims.get("user_id")
    if not sub:
        raise AuthenticationError("Token missing subject claim.")

    email_verified = bool(claims.get("email_verified", False))
    if not email_verified:
        raise AuthorizationError("Verified Google account email is required.")

    return AuthenticatedUser(
        user_id=str(sub),
        email=str(claims.get("email") or ""),
        full_name=str(claims.get("name") or ""),
        email_verified=email_verified,
    )


def resolve_org_context(
    organization_id: UUID,
    user: AuthenticatedUser = Depends(get_current_user),
) -> OrgAccessContext:
    """Baseline organization RBAC context resolver for FastAPI worker endpoints."""
    raise ServiceUnavailableError(
        "Organization RBAC lookup via FastAPI activates when backend worker storage is attached."
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
