"""Evidence access request API endpoints."""

import os
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, File, UploadFile, Form
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.access_request_service import AccessRequestService
from app.schemas.access_request import (
    AccessRequestCreate,
    AccessRequestReview,
    AccessRequestReturn,
    AccessRequestVerifyReturn,
    AccessRequestResponse,
    AccessRequestListResponse,
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


@router.get("", response_model=AccessRequestListResponse)
async def list_requests(
    request: Request,
    status: Optional[str] = None,
    scope: str = "all",
    db: AsyncSession = Depends(get_db),
):
    """List access requests (role-aware)."""
    try:
        user_id = get_user_id_from_request(request)
        service = AccessRequestService(db)
        reqs = await service.list_requests(user_id, status, scope)
        return AccessRequestListResponse(requests=reqs, total=len(reqs))
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] list_requests:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", response_model=AccessRequestResponse, status_code=201)
async def create_request(
    data: AccessRequestCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new access request (Investigator / Lead)."""
    try:
        user_id = get_user_id_from_request(request)
        service = AccessRequestService(db)
        result = await service.create_request(
            user_id=user_id,
            evidence_id=data.evidence_id,
            reason=data.reason,
        )
        return AccessRequestResponse(**result)
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
        print("[ERROR] create_request:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{request_id}", response_model=AccessRequestResponse)
async def get_request(
    request_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request)
        service = AccessRequestService(db)
        result = await service.get_request(user_id, request_id)
        return AccessRequestResponse(**result)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{request_id}/review", response_model=AccessRequestResponse)
async def review_request(
    request_id: str,
    data: AccessRequestReview,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Approve or deny a pending request (Admin / Supervisor)."""
    try:
        user_id = get_user_id_from_request(request)
        service = AccessRequestService(db)
        result = await service.review_request(
            reviewer_id=user_id,
            request_id=request_id,
            approve=data.approve,
            note=data.note,
        )
        return AccessRequestResponse(**result)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] review_request:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{request_id}/download")
async def download_approved_evidence(
    request_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Download evidence after approval. Marks as DOWNLOADED.
    Serves the pristine registered original from disk.
    """
    try:
        user_id = get_user_id_from_request(request)
        service = AccessRequestService(db)
        result = await service.mark_downloaded(user_id, request_id)

        file_path = result["file_path"]
        filename = result["filename"]

        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File missing from storage")

        return FileResponse(
            file_path,
            media_type="application/octet-stream",
            filename=filename,
        )
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("[ERROR] download_approved_evidence:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{request_id}/return")
async def return_evidence(
    request_id: str,
    request: Request,
    file: UploadFile = File(...),
    notes: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Return evidence after investigation.

    The returned file is stored as a forensic artifact under
    uploads/returned/ and its SHA-256 is recorded on the request row.
    """
    try:
        user_id = get_user_id_from_request(request)
        service = AccessRequestService(db)

        # Pass the UploadFile directly to the service so it stores
        # the actual returned file as evidence.
        result = await service.mark_returned(
            user_id=user_id,
            request_id=request_id,
            returned_file=file,
            notes=notes,
        )

        return {"request": result}
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] return_evidence:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{request_id}/verify-return", response_model=AccessRequestResponse)
async def verify_return(
    request_id: str,
    data: AccessRequestVerifyReturn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Verify the return of evidence (Admin / Supervisor).

    The server compares the stored return hash with the registered original
    hash. The client's `verified` flag is only used for logging.
    """
    try:
        user_id = get_user_id_from_request(request)
        service = AccessRequestService(db)
        result = await service.verify_return(
            verifier_id=user_id,
            request_id=request_id,
            verified=data.verified,
            notes=data.notes,
        )
        return AccessRequestResponse(**result)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] verify_return:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))