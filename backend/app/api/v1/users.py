"""User management API endpoints."""

from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.user_service import UserService
from app.schemas.user import (
    InviteRequest,
    InviteResponse,
    PendingListResponse,
    ApproveResponse,
    UserListResponse,
    AvailableRolesResponse,
    UpdateRoleRequest,
    ProfileResponse,
    ProfileUpdateRequest,
    ProfileUpdateResponse,
    PasswordChangeRequest,
    PasswordChangeResponse,
    ApproveEmailChangeResponse,
)
from app.exceptions.errors import (
    AuthorizationError,
    NotFoundError,
    ConflictError,
    ValidationError,
)

router = APIRouter()


def get_user_id_from_request(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


# ==========================================================
# SELF-SERVICE PROFILE
# (declared BEFORE /{user_id} routes to avoid route shadowing)
# ==========================================================

@router.get("/me", response_model=ProfileResponse)
async def get_own_profile(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get current user's own profile."""
    try:
        user_id = get_user_id_from_request(request)
        service = UserService(db)
        return await service.get_own_profile(user_id)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] get_own_profile:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/me", response_model=ProfileUpdateResponse)
async def update_own_profile(
    body: ProfileUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update own profile. Email change is queued for admin approval."""
    try:
        user_id = get_user_id_from_request(request)
        service = UserService(db)
        result = await service.update_own_profile(
            user_id=user_id,
            full_name=body.full_name,
            username=body.username,
            email=body.email,
        )
        return ProfileUpdateResponse(**result)
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] update_own_profile:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/me/change-password", response_model=PasswordChangeResponse)
async def change_own_password(
    body: PasswordChangeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Change own password. Requires current password."""
    try:
        user_id = get_user_id_from_request(request)
        service = UserService(db)
        result = await service.change_own_password(
            user_id=user_id,
            current_password=body.current_password,
            new_password=body.new_password,
            confirm_password=body.confirm_password,
        )
        return PasswordChangeResponse(**result)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] change_own_password:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{user_id}/approve-email", response_model=ApproveEmailChangeResponse)
async def approve_email_change(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Approve a pending email change. Admin only."""
    try:
        admin_id = get_user_id_from_request(request)
        service = UserService(db)
        result = await service.approve_email_change(admin_id, user_id)
        return ApproveEmailChangeResponse(**result)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] approve_email_change:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{user_id}/reject-email", response_model=ApproveEmailChangeResponse)
async def reject_email_change(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Reject a pending email change. Admin only."""
    try:
        admin_id = get_user_id_from_request(request)
        service = UserService(db)
        result = await service.reject_email_change(admin_id, user_id)
        return ApproveEmailChangeResponse(
            message=result["message"],
            user_id=result["user_id"],
            new_email="",
        )
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] reject_email_change:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================================
# ADMIN ENDPOINTS
# ==========================================================

@router.get("/available-roles", response_model=AvailableRolesResponse)
async def get_available_roles(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get roles the current user can assign."""
    try:
        user_id = get_user_id_from_request(request)
        service = UserService(db)
        roles = await service.get_available_roles(user_id)
        return AvailableRolesResponse(roles=roles)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/invite", response_model=InviteResponse, status_code=201)
async def invite_user(
    request: InviteRequest,
    request_obj: Request,
    db: AsyncSession = Depends(get_db),
):
    """Invite a new user with a specified role."""
    try:
        user_id = get_user_id_from_request(request_obj)
        service = UserService(db)
        result = await service.invite_user(
            inviter_id=user_id,
            email=request.email,
            username=request.username,
            full_name=request.full_name,
            role_id=request.role_id,
        )
        return InviteResponse(**result)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] invite_user:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pending", response_model=PendingListResponse)
async def list_pending(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List pending (unapproved) users. Admin only."""
    try:
        _ = get_user_id_from_request(request)
        service = UserService(db)
        users = await service.list_pending()
        return PendingListResponse(users=users, total=len(users))
    except Exception as e:
        import traceback
        print("[ERROR] list_pending:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{user_id}/approve", response_model=ApproveResponse)
async def approve_user(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Approve a pending user. Admin only."""
    try:
        admin_id = get_user_id_from_request(request)
        service = UserService(db)
        result = await service.approve_user(admin_id, user_id)
        return ApproveResponse(**result)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] approve_user:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{user_id}/reject", response_model=ApproveResponse)
async def reject_user(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Reject and delete a pending user. Admin only."""
    try:
        admin_id = get_user_id_from_request(request)
        service = UserService(db)
        result = await service.reject_user(admin_id, user_id)
        return ApproveResponse(**result)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] reject_user:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("", response_model=UserListResponse)
async def list_users(
    request: Request,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """List all users. Admin only."""
    try:
        admin_id = get_user_id_from_request(request)
        service = UserService(db)
        users = await service.list_users(admin_id, search)
        return UserListResponse(users=users, total=len(users))
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] list_users:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{user_id}/role")
async def update_user_role(
    user_id: str,
    request: UpdateRoleRequest,
    request_obj: Request,
    db: AsyncSession = Depends(get_db),
):
    """Change a user's role. Admin only."""
    try:
        admin_id = get_user_id_from_request(request_obj)
        service = UserService(db)
        result = await service.update_user_role(admin_id, user_id, request.role_id)
        return result
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] update_user_role:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{user_id}/deactivate")
async def deactivate_user(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        admin_id = get_user_id_from_request(request)
        service = UserService(db)
        result = await service.deactivate_user(admin_id, user_id)
        return result
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{user_id}/activate")
async def activate_user(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        admin_id = get_user_id_from_request(request)
        service = UserService(db)
        result = await service.activate_user(admin_id, user_id)
        return result
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))