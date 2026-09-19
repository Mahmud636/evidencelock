"""Authentication middleware for FastAPI."""

from typing import Optional, Callable, Awaitable

from fastapi import Request, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.utils.security import decode_token


security = HTTPBearer(auto_error=False)


# Public paths that don't require authentication
PUBLIC_PATHS = [
    "/api/health",
    "/api/",
    "/api/docs",
    "/api/redoc",
    "/api/openapi.json",
    "/api/v1/auth/login",
    "/api/v1/auth/register",
    "/api/v1/auth/refresh",
]


async def auth_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Middleware to validate authentication token and set request.state.user_id."""
    
    # Initialize state defaults
    request.state.user = None
    request.state.user_id = None
    request.state.user_role = None
    
    # Skip auth for public paths
    path = request.url.path
    if any(path == p or path.startswith(p + "/") for p in PUBLIC_PATHS):
        return await call_next(request)
    
    # Also skip for /api/docs and swagger assets
    if path.startswith("/api/docs") or path.startswith("/openapi.json"):
        return await call_next(request)
    
    # Extract token from Authorization header
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return await call_next(request)
    
    token = auth_header.replace("Bearer ", "").strip()
    payload = decode_token(token)
    
    if not payload:
        return await call_next(request)
    
    # Reject field-scoped tokens used as session tokens.
    # Field tokens travel in X-Field-Token and must never grant full session access.
    if payload.get("scope") == "field_collect":
        return await call_next(request)
    
    # Set user info from token
    request.state.user_id = payload.get("sub")
    request.state.user_role = payload.get("role")
    request.state.user = payload
    
    return await call_next(request)


async def get_current_user(request: Request) -> Optional[dict]:
    """Dependency to get current authenticated user."""
    return getattr(request.state, "user", None)


async def get_current_user_id(request: Request) -> str:
    """Dependency to get current user ID."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        from app.exceptions.errors import AuthenticationError
        raise AuthenticationError("Not authenticated")
    return user_id