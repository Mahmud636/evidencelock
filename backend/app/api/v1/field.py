"""Field collection API endpoints."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
import json

from app.database import get_db
from app.services.field_service import FieldService
from app.schemas.field import (
    FieldSetupRequest,
    FieldSetupResponse,
    FieldDeviceListResponse,
    FieldDeviceInfo,
    SyncManifest,
    SyncResponse,
    SyncResultItem,
    FieldRevokeRequest,
    FieldRevokeResponse,
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
# 1. SETUP (online, requires normal auth)
# ==========================================================
@router.post("/setup", response_model=FieldSetupResponse)
async def setup_field_mode(
    body: FieldSetupRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Enable field mode on a device. Requires normal online authentication.
    Returns a scoped field token the browser stores locally."""
    try:
        user_id = get_user_id_from_request(request)
        service = FieldService(db)
        result = await service.setup_field_mode(
            user_id=user_id,
            device_id=body.device_id,
            device_name=body.device_name,
            hours_valid=body.hours_valid,
        )
        return FieldSetupResponse(**result)
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
        print("[ERROR] setup_field_mode:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================================
# 2. VALIDATE (offline-friendly check of the token)
# ==========================================================
@router.get("/validate")
async def validate_field_token(
    device_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Validate a stored field token. Returns user + device info if valid.

    Accepts the field token via the X-Field-Token header (NOT the normal
    Authorization header), because the field token is deliberately scoped
    and must not be confused with a full session token.
    """
    try:
        field_token = request.headers.get("X-Field-Token")
        if not field_token:
            raise HTTPException(status_code=401, detail="Missing X-Field-Token header")

        service = FieldService(db)
        user = await service.validate_field_token(field_token, device_id)
        return {
            "valid": True,
            "user_id": str(user.id),
            "user_full_name": user.full_name,
            "user_email": user.email,
            "user_role": user.role.name,
            "device_id": device_id,
        }
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] validate_field_token:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================================
# 3. SYNC (upload a batch of field-collected files)
# ==========================================================
@router.post("/sync", response_model=SyncResponse)
async def sync_batch(
    request: Request,
    manifest: str = Form(...),
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Ingest a batch of field-collected evidence.

    Multipart form:
    - manifest: JSON string of SyncManifest
    - files: one or more UploadFile entries

    Requires the X-Field-Token header (field token), NOT the normal
    Authorization header.
    """
    try:
        field_token = request.headers.get("X-Field-Token")
        if not field_token:
            raise HTTPException(status_code=401, detail="Missing X-Field-Token header")

        try:
            manifest_dict = json.loads(manifest)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid manifest JSON")

        try:
            parsed_manifest = SyncManifest(**manifest_dict)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Manifest validation failed: {e}")

        service = FieldService(db)
        user = await service.validate_field_token(
            field_token, parsed_manifest.device_id
        )

        result = await service.sync_batch(user, parsed_manifest, files)
        return SyncResponse(**result)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("[ERROR] sync_batch:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================================
# 4. LIST DEVICES (normal auth)
# ==========================================================
@router.get("/devices", response_model=FieldDeviceListResponse)
async def list_field_devices(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """List field devices. Non-admins see their own; admins see all."""
    try:
        user_id = get_user_id_from_request(request)
        service = FieldService(db)
        devices = await service.list_field_devices(user_id)
        return FieldDeviceListResponse(
            devices=[FieldDeviceInfo(**d) for d in devices],
            total=len(devices),
        )
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] list_field_devices:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================================
# 5. REVOKE (normal auth)
# ==========================================================
@router.post("/revoke", response_model=FieldRevokeResponse)
async def revoke_device(
    body: FieldRevokeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Revoke a device's field authorization. Owner or admin."""
    try:
        user_id = get_user_id_from_request(request)
        service = FieldService(db)
        result = await service.revoke_device(user_id, body.device_id)
        return FieldRevokeResponse(**result)
    except AuthorizationError as e:
        raise HTTPException(status_code=403, detail=e.message)
    except NotFoundError as e:
        raise HTTPException(status_code=404, detail=e.message)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception as e:
        import traceback
        print("[ERROR] revoke_device:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))