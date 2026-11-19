import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.errors import AuthenticationError, ServiceUnavailableError, register_exception_handlers
from app.core.logging import configure_logging, get_logger, request_id_ctx
from app.core.security import verify_firebase_id_token
from app.modules.auth.router import router as auth_router
from app.modules.health.router import router as health_router
from app.modules.organizations.router import router as org_router
from app.modules.rbac.router import router as rbac_router

settings = get_settings()
configure_logging(settings.log_level)
logger = get_logger("visionx.api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info(
        "Starting VisionX AI FastAPI service",
        extra={
            "extra_data": {
                "env": settings.app_env,
                "firebase_configured": settings.firebase_configured,
                "database_configured": settings.database_configured,
            }
        },
    )
    yield
    logger.info("Shutting down VisionX AI FastAPI service")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="VisionX AI — Phase 1 Foundation API (Firebase Auth, RBAC, Worker Boundary)",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def attach_request_id(request: Request, call_next):
        req_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        token = request_id_ctx.set(req_id)
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = req_id
            return response
        finally:
            request_id_ctx.reset(token)

    register_exception_handlers(app)

    api_prefix = "/api/v1"
    app.include_router(health_router, prefix=api_prefix)
    app.include_router(auth_router, prefix=api_prefix)
    app.include_router(rbac_router, prefix=api_prefix)
    app.include_router(org_router, prefix=api_prefix)

    @app.websocket("/ws/events")
    async def websocket_events(websocket: WebSocket):
        """Authenticated WebSocket foundation for Phase 2+ real-time security events."""
        token = websocket.query_params.get("token")
        if not token:
            await websocket.close(code=4401, reason="Authentication token required")
            return
        try:
            claims = verify_firebase_id_token(token)
        except (AuthenticationError, ServiceUnavailableError) as exc:
            await websocket.close(code=4401, reason=exc.message)
            return

        await websocket.accept()
        await websocket.send_json(
            {
                "event_type": "system.websocket.connected",
                "schema_version": "1.0",
                "user_id": claims.get("sub"),
            }
        )
        try:
            while True:
                # Keepalive ping/pong channel; Phase 2/6 event bus plugs in here.
                message = await websocket.receive_text()
                if message == "ping":
                    await websocket.send_json({"event_type": "system.pong"})
        except WebSocketDisconnect:
            logger.info("WebSocket client disconnected")

    return app


app = create_app()
