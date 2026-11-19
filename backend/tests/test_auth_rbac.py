from uuid import uuid4

from app.core.database import get_db
from tests.conftest import make_org_context, override_org_context


def test_protected_endpoint_rejects_missing_bearer_token(app, client):
    # Override DB so request reaches security dependency without needing live Postgres
    app.dependency_overrides[get_db] = lambda: None
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_viewer_cannot_invite_members(app, client):
    viewer_ctx = make_org_context("viewer", 20, {"org:read", "command_center:read"})
    override_org_context(app, viewer_ctx)
    app.dependency_overrides[get_db] = lambda: None

    response = client.post(
        f"/api/v1/organizations/{viewer_ctx.organization_id}/invitations",
        json={"email": "new.user@visionx.example", "role_key": "operator"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "FORBIDDEN"
    assert "members:invite" in body["error"]["details"]["missing_permissions"]


def test_viewer_cannot_update_system_settings(app, client):
    viewer_ctx = make_org_context("viewer", 20, {"org:read", "settings:read"})
    override_org_context(app, viewer_ctx)
    app.dependency_overrides[get_db] = lambda: None

    response = client.patch(
        f"/api/v1/organizations/{uuid4()}/settings",
        json={"session_timeout_minutes": 120},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"
