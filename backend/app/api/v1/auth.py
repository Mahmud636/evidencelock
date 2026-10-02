"""Authentication API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.auth_service import AuthService
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    RegisterRequest,
    RegisterResponse,
    MFAVerifyRequest,
    MFAVerifyResponse,
    MFAEnrollResponse,
    MFADisableRequest,
    MFADisableResponse,
    TokenRefreshRequest,
    TokenRefreshResponse,
)
from app.exceptions.errors import (
    AuthenticationError,
    ValidationError,
    NotFoundError,
    ConflictError,
)

router = APIRouter()


def get_client_info(request: Request):
    ip_address = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "unknown")
    return ip_address, user_agent


def get_user_id_from_request(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


@router.post("/register", response_model=RegisterResponse, status_code=201)
async def register(
    request: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        service = AuthService(db)
        result = await service.register_user(request)
        return RegisterResponse(**result)
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] register:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/login", response_model=LoginResponse)
async def login(
    request: LoginRequest,
    request_obj: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        ip, ua = get_client_info(request_obj)
        service = AuthService(db)
        result = await service.login(request, ip_address=ip, user_agent=ua)
        return LoginResponse(**result)
    except AuthenticationError as e:
        raise HTTPException(status_code=401, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] login:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mfa/verify-login", response_model=LoginResponse)
async def verify_mfa_login(
    request: MFAVerifyRequest,
    request_obj: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        ip, ua = get_client_info(request_obj)

        auth_header = request_obj.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing partial token")

        from app.utils.security import decode_token
        payload = decode_token(auth_header.replace("Bearer ", "").strip())
        if not payload or payload.get("purpose") != "mfa_verify":
            raise HTTPException(status_code=401, detail="Invalid partial token")

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Partial token missing user")

        service = AuthService(db)
        result = await service.verify_mfa_and_login(
            user_id=user_id,
            totp_code=request.totp_code,
            ip_address=ip,
            user_agent=ua,
        )
        return LoginResponse(**result)
    except AuthenticationError as e:
        raise HTTPException(status_code=401, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("[ERROR] verify_mfa_login:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mfa/enroll", response_model=MFAEnrollResponse)
async def enroll_mfa(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request)
        service = AuthService(db)
        result = await service.generate_mfa_secret(user_id)
        return MFAEnrollResponse(
            secret=result["secret"],
            qr_code=result["qr_code"],
            backup_codes=result["recovery_codes"],
        )
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] enroll_mfa:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mfa/confirm", response_model=MFAVerifyResponse)
async def confirm_mfa(
    request: MFAVerifyRequest,
    request_obj: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request_obj)
        service = AuthService(db)
        await service.confirm_mfa_setup(user_id, request.totp_code)
        return MFAVerifyResponse(verified=True, message="MFA enabled successfully")
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] confirm_mfa:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mfa/disable", response_model=MFADisableResponse)
async def disable_mfa(
    request: MFADisableRequest,
    request_obj: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request_obj)
        service = AuthService(db)
        await service.disable_mfa(user_id, request.totp_code)
        return MFADisableResponse(
            success=True,
            message="MFA has been disabled for your account",
        )
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] disable_mfa:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh", response_model=TokenRefreshResponse)
async def refresh_token(
    request: TokenRefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        service = AuthService(db)
        result = await service.refresh_token(request.refresh_token)
        return TokenRefreshResponse(**result)
    except AuthenticationError as e:
        raise HTTPException(status_code=401, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] refresh_token:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/me")
async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request)
        service = AuthService(db)
        user = await service.get_user(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        from sqlalchemy import select
        from app.models.user import Role
        role_result = await db.execute(
            select(Role).where(Role.id == user.role_id)
        )
        role = role_result.scalar_one_or_none()

        return {
            "id": str(user.id),
            "email": user.email,
            "username": user.username,
            "full_name": user.full_name,
            "role": role.name if role else "UNKNOWN",
            "role_id": str(user.role_id),
            "mfa_enabled": user.mfa_enabled,
            "is_active": user.is_active,
            "is_approved": user.is_approved,
            "last_login": user.last_login,
            "created_at": user.created_at,
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("[ERROR] get_current_user:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))