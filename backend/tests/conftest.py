from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.security import AuthenticatedUser, OrgAccessContext, get_current_user, resolve_org_context
from app.main import create_app


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
def client(app):
    return TestClient(app)


def make_org_context(role_key: str, hierarchy_level: int, permissions: set[str]) -> OrgAccessContext:
    user = AuthenticatedUser(
        user_id=uuid4(),
        email="analyst@visionx.example",
        full_name="Test Operator",
    )
    return OrgAccessContext(
        user=user,
        organization_id=uuid4(),
        role_key=role_key,
        role_name=role_key.replace("_", " ").title(),
        hierarchy_level=hierarchy_level,
        permissions=permissions,
    )


def override_current_user(app, user: AuthenticatedUser):
    app.dependency_overrides[get_current_user] = lambda: user


def override_org_context(app, context: OrgAccessContext):
    app.dependency_overrides[resolve_org_context] = lambda: context
