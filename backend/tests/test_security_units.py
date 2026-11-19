import pytest

from app.core.config import Settings
from app.core.logging import redact_mapping


def test_redact_mapping_strips_sensitive_fields():
    raw = {
        "user": "operator",
        "password": "super-secret-password",
        "nested": {
            "service_role_key": "sb_secret_123",
            "rtsp_url": "rtsp://admin:pass@10.0.0.5/stream",
            "safe_field": "camera-01",
        },
    }
    sanitized = redact_mapping(raw)
    assert sanitized["user"] == "operator"
    assert sanitized["password"] == "[REDACTED]"
    assert sanitized["nested"]["service_role_key"] == "[REDACTED]"
    assert sanitized["nested"]["rtsp_url"] == "[REDACTED]"
    assert sanitized["nested"]["safe_field"] == "camera-01"


def test_settings_rejects_invalid_environment():
    with pytest.raises(ValueError):
        Settings(app_env="invalid_env")
