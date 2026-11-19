from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.security import AuthenticatedUser, get_current_user
from app.modules.rbac.models import Permission, Role, RolePermission


class PermissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    key: str
    module: str
    description: str


class RoleResponse(BaseModel):
    id: UUID
    key: str
    name: str
    description: str
    hierarchy_level: int
    is_system: bool
    permissions: List[str]


router = APIRouter(prefix="/rbac", tags=["RBAC"])


@router.get("/roles", response_model=List[RoleResponse])
def list_roles(
    _: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[RoleResponse]:
    roles = db.scalars(
        select(Role)
        .options(joinedload(Role.permissions).joinedload(RolePermission.permission))
        .order_by(Role.hierarchy_level.desc())
    ).unique().all()

    return [
        RoleResponse(
            id=role.id,
            key=role.key,
            name=role.name,
            description=role.description,
            hierarchy_level=role.hierarchy_level,
            is_system=role.is_system,
            permissions=sorted(
                rp.permission.key for rp in role.permissions if rp.permission is not None
            ),
        )
        for role in roles
    ]


@router.get("/permissions", response_model=List[PermissionResponse])
def list_permissions(
    _: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[PermissionResponse]:
    perms = db.scalars(select(Permission).order_by(Permission.module, Permission.key)).all()
    return [PermissionResponse.model_validate(p) for p in perms]
