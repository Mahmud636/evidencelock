"""Case management API endpoints."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.case_service import CaseService
from app.schemas.case import (
    CaseCreate,
    CaseUpdate,
    CaseResponse,
    CaseListResponse,
    CaseMemberAdd,
    CaseMemberResponse,
)
from app.exceptions.errors import (
    AuthorizationError,
    NotFoundError,
    ConflictError,
    ValidationError,
)

router = APIRouter()
security = HTTPBearer(auto_error=False)


def get_user_id_from_request(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


@router.get("", response_model=CaseListResponse)
async def list_cases(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request)
        service = CaseService(db)
        cases = await service.list_cases(user_id)
        return CaseListResponse(cases=cases, total=len(cases))
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] list_cases:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", response_model=CaseResponse, status_code=201)
async def create_case(
    case_data: CaseCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request)
        service = CaseService(db)
        case = await service.create_case(user_id, case_data)
        return CaseResponse(**case)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] create_case:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{case_id}", response_model=CaseResponse)
async def get_case(
    case_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request)
        service = CaseService(db)
        case = await service.get_case(user_id, case_id)
        return CaseResponse(**case)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] get_case:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{case_id}", response_model=CaseResponse)
async def update_case(
    case_id: str,
    case_data: CaseUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request)
        service = CaseService(db)
        case = await service.update_case(user_id, case_id, case_data)
        return CaseResponse(**case)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] update_case:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================================
# MEMBERS
# ==========================================================
@router.get("/{case_id}/members", response_model=List[CaseMemberResponse])
async def get_case_members(
    case_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request)
        service = CaseService(db)
        members = await service.get_case_members(user_id, case_id)
        return [CaseMemberResponse(**m) for m in members]
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] get_case_members:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{case_id}/assignable-users")
async def list_assignable_users(
    case_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List users who can be added to this case (excludes current members)."""
    try:
        user_id = get_user_id_from_request(request)
        service = CaseService(db)
        users = await service.list_assignable_users(user_id, case_id)
        return {"users": users, "total": len(users)}
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] list_assignable_users:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{case_id}/members", status_code=201)
async def add_case_member(
    case_id: str,
    member_data: CaseMemberAdd,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request)
        service = CaseService(db)
        result = await service.add_member(user_id, case_id, member_data.user_id)
        return result
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] add_case_member:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{case_id}/members/{target_user_id}")
async def remove_case_member(
    case_id: str,
    target_user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Remove a member from a case. Admin/Supervisor only.
    Creator cannot be removed."""
    try:
        user_id = get_user_id_from_request(request)
        service = CaseService(db)
        result = await service.remove_member(user_id, case_id, target_user_id)
        return result
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] remove_case_member:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))