"""Evidence management API endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, File, UploadFile, Form
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.evidence_service import EvidenceService
from app.schemas.evidence import (
    EvidenceResponse,
    EvidenceListResponse,
    EvidenceVerifyResponse,
)
from app.exceptions.errors import (
    AuthorizationError,
    NotFoundError,
    ValidationError,
)

router = APIRouter()


def get_user_id_from_request(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


@router.get("", response_model=EvidenceListResponse)
async def list_evidence(
    request: Request,
    case_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request)
        service = EvidenceService(db)
        items = await service.list_evidence(user_id, case_id)
        return EvidenceListResponse(evidence=items, total=len(items))
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] list_evidence:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", response_model=EvidenceResponse, status_code=201)
async def register_evidence(
    request: Request,
    case_id: str = Form(...),
    description: Optional[str] = Form(None),
    source_device: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request)
        service = EvidenceService(db)
        evidence = await service.register_evidence(
            user_id=user_id,
            case_id=case_id,
            file=file,
            description=description,
            source_device=source_device,
        )
        return EvidenceResponse(**evidence)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] register_evidence:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{evidence_id}", response_model=EvidenceResponse)
async def get_evidence(
    evidence_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request)
        service = EvidenceService(db)
        evidence = await service.get_evidence(user_id, evidence_id)
        return EvidenceResponse(**evidence)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] get_evidence:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{evidence_id}/verify", response_model=EvidenceVerifyResponse)
async def verify_evidence(
    evidence_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = get_user_id_from_request(request)
        service = EvidenceService(db)
        result = await service.verify_evidence(user_id, evidence_id)
        return EvidenceVerifyResponse(**result)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] verify_evidence:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))