"""Authentication API endpoints."""

from fastapi import APIRouter, Depends, Request, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.auth_service import AuthService
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    RegisterRequest,
    RegisterResponse,
    MFAActivateResponse,
    MFAVerifyRequest,
    MFAVerifyResponse,
    TokenRefreshRequest,
    TokenRefreshResponse,
    MFADisableRequest,
    MFADisableResponse,
)
from app.exceptions.errors import AuthenticationError, ValidationError, ConflictError

router = APIRouter()


def get_user_id_from_request(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


@router.post("/register", response_model=RegisterResponse)
async def register(
    request: RegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> RegisterResponse:
    try:
        service = AuthService(db)
        result = await service.register_user(request)
        return RegisterResponse(**result)
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/login", response_model=LoginResponse)
async def login(
    request: LoginRequest,
    request_obj: Request,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    try:
        service = AuthService(db)
        ip_address = request_obj.client.host if request_obj.client else "unknown"
        user_agent = request_obj.headers.get("user-agent", "unknown")
        result = await service.login(request, ip_address, user_agent)
        return LoginResponse(**result)
    except AuthenticationError as e:
        raise HTTPException(status_code=401, detail=e.message)


@router.post("/mfa/verify-login", response_model=LoginResponse)
async def verify_mfa_login(
    request: MFAVerifyRequest,
    request_obj: Request,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    """
    Complete login by verifying the TOTP code.
    Called after /login when mfa_required=true.

    Note: The user_id is extracted from the partial token in the Authorization header.
    """
    try:
        # The partial token's user_id was set by the middleware
        user_id = getattr(request_obj.state, "user_id", None)
        if not user_id:
            raise HTTPException(status_code=401, detail="MFA session expired")

        service = AuthService(db)
        ip_address = request_obj.client.host if request_obj.client else "unknown"
        user_agent = request_obj.headers.get("user-agent", "unknown")
        result = await service.verify_mfa_and_login(
            user_id, request.totp_code, ip_address, user_agent
        )
        return LoginResponse(**result)
    except AuthenticationError as e:
        raise HTTPException(status_code=401, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/mfa/enroll", response_model=MFAActivateResponse)
async def enroll_mfa(
    request_obj: Request,
    db: AsyncSession = Depends(get_db),
) -> MFAActivateResponse:
    """Start MFA enrollment: returns secret + QR + recovery codes."""
    try:
        user_id = get_user_id_from_request(request_obj)
        service = AuthService(db)
        result = await service.generate_mfa_secret(user_id)
        return MFAActivateResponse(**result)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mfa/confirm", response_model=MFAVerifyResponse)
async def confirm_mfa(
    request: MFAVerifyRequest,
    request_obj: Request,
    db: AsyncSession = Depends(get_db),
) -> MFAVerifyResponse:
    """Confirm MFA setup by verifying the first TOTP code."""
    try:
        user_id = get_user_id_from_request(request_obj)
        service = AuthService(db)
        success = await service.confirm_mfa_setup(user_id, request.totp_code)
        return MFAVerifyResponse(
            verified=success,
            message="MFA enabled successfully" if success else "Verification failed",
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mfa/disable", response_model=MFADisableResponse)
async def disable_mfa(
    request: MFADisableRequest,
    request_obj: Request,
    db: AsyncSession = Depends(get_db),
) -> MFADisableResponse:
    """Disable MFA. Requires a valid TOTP code."""
    try:
        user_id = get_user_id_from_request(request_obj)
        service = AuthService(db)
        success = await service.disable_mfa(user_id, request.recovery_code)
        return MFADisableResponse(
            success=success,
            message="MFA disabled successfully" if success else "Failed to disable MFA",
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh", response_model=TokenRefreshResponse)
async def refresh_token(
    request: TokenRefreshRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenRefreshResponse:
    try:
        service = AuthService(db)
        result = await service.refresh_token(request.refresh_token)
        return TokenRefreshResponse(**result)
    except AuthenticationError as e:
        raise HTTPException(status_code=401, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/me")
async def get_current_user_info(
    request_obj: Request,
) -> dict:
    user_id = getattr(request_obj.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return {
        "id": user_id,
        "email": request_obj.state.user.get("email") if request_obj.state.user else None,
        "role": request_obj.state.user.get("role") if request_obj.state.user else None,
        "permissions": request_obj.state.user.get("permissions", []) if request_obj.state.user else [],
    }