from typing import Any, Dict, Optional

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.logging import get_logger, request_id_ctx

logger = get_logger("visionx.errors")


class VisionXError(Exception):
    """Base domain exception for centralized API error responses."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


class AuthenticationError(VisionXError):
    def __init__(self, message: str = "Authentication required", details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__("AUTH_REQUIRED", message, status.HTTP_401_UNAUTHORIZED, details)


class AuthorizationError(VisionXError):
    def __init__(self, message: str = "Insufficient permissions", details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__("FORBIDDEN", message, status.HTTP_403_FORBIDDEN, details)


class ResourceNotFoundError(VisionXError):
    def __init__(self, message: str = "Resource not found", details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__("NOT_FOUND", message, status.HTTP_404_NOT_FOUND, details)


class ConflictError(VisionXError):
    def __init__(self, message: str = "Resource conflict", details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__("CONFLICT", message, status.HTTP_409_CONFLICT, details)


class ServiceUnavailableError(VisionXError):
    def __init__(self, message: str = "Dependent service unavailable", details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__("SERVICE_UNAVAILABLE", message, status.HTTP_503_SERVICE_UNAVAILABLE, details)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(VisionXError)
    async def handle_visionx_error(_: Request, exc: VisionXError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                    "request_id": request_id_ctx.get(),
                }
            },
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Request validation failed",
                    "details": {"errors": exc.errors()},
                    "request_id": request_id_ctx.get(),
                }
            },
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled server exception", extra={"extra_data": {"type": type(exc).__name__}})
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "An unexpected internal error occurred.",
                    "details": {},
                    "request_id": request_id_ctx.get(),
                }
            },
        )
