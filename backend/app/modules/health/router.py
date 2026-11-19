from datetime import datetime, timezone
from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.database import check_database_health

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("/live")
def liveness() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "environment": settings.app_env,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/ready")
def readiness() -> JSONResponse:
    settings = get_settings()
    db_ok = False
    db_error = None
    try:
        db_ok = check_database_health()
    except Exception as exc:  # noqa: BLE001
        db_error = str(exc)

    ready = db_ok and settings.supabase_configured
    payload = {
        "status": "ready" if ready else "degraded",
        "checks": {
            "database_configured": settings.database_configured,
            "database_connected": db_ok,
            "supabase_configured": settings.supabase_configured,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if db_error:
        payload["checks"]["database_error"] = db_error

    code = status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(status_code=code, content=payload)
