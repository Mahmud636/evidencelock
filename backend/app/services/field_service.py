"""Field collection service - offline evidence collection and sync."""

import hashlib
import json
import os
import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import UploadFile
from jose import jwt, JWTError
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, Role
from app.models.case import Case, CaseMember
from app.models.evidence import Evidence
from app.models.custody import CustodyEvent
from app.models.audit import AuditLog
from app.models.field_device import FieldDevice
from app.schemas.field import SyncManifest
from app.config import settings
from app.exceptions.errors import (
    AuthorizationError,
    NotFoundError,
    ConflictError,
    ValidationError,
)


# Who can use field mode
CAN_USE_FIELD = {
    "SYSTEM_ADMINISTRATOR",
    "SUPERVISOR",
    "LEAD_INVESTIGATOR",
    "INVESTIGATOR",
}


def create_audit_log(event_type, user_id=None, resource_type=None,
                     resource_id=None, action=None, details=None):
    log = AuditLog(
        event_type=event_type,
        user_id=user_id,
        resource_type=resource_type,
        resource_id=resource_id,
        action=action,
        details=details,
        previous_hash=None,
        current_hash="pending",
        created_at=datetime.utcnow(),
    )
    log.current_hash = log.generate_hash()
    return log


def generate_evidence_id() -> str:
    year = datetime.utcnow().year
    unique = uuid.uuid4().hex[:6].upper()
    return f"EVID-{year}-{unique}"


def generate_custody_event_id() -> str:
    year = datetime.utcnow().year
    unique = uuid.uuid4().hex[:8].upper()
    return f"CE-{year}-{unique}"


def generate_batch_id() -> str:
    year = datetime.utcnow().year
    unique = uuid.uuid4().hex[:8].upper()
    return f"SYNC-{year}-{unique}"


def compute_file_hash(file_path: str) -> str:
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def sanitize_filename(filename: str) -> str:
    filename = os.path.basename(filename)
    filename = filename.replace("\x00", "")
    safe_chars = []
    for c in filename:
        if c.isalnum() or c in "._- ":
            safe_chars.append(c)
    return "".join(safe_chars) or "unnamed"


def _to_naive_utc(dt: datetime) -> datetime:
    """Convert any datetime to a naive UTC datetime.
    - aware -> convert to UTC, drop tzinfo
    - naive -> assume already UTC, return as-is
    """
    if dt.tzinfo is not None:
        return dt.astimezone(tz=None).replace(tzinfo=None)
    return dt


class FieldService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ==========================================================
    # HELPERS
    # ==========================================================
    async def _get_user(self, user_id: str) -> User:
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.role))
            .where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            raise NotFoundError("User not found")
        return user

    async def _is_admin(self, user_id: str) -> bool:
        user = await self._get_user(user_id)
        return user.role.name == "SYSTEM_ADMINISTRATOR"

    async def _check_case_access(self, user_id: str, case_id: str) -> None:
        if await self._is_admin(user_id):
            return
        result = await self.db.execute(
            select(CaseMember).where(
                CaseMember.case_id == case_id,
                CaseMember.user_id == user_id,
            )
        )
        if not result.scalar_one_or_none():
            raise AuthorizationError("Access to this case is not authorized")

    # ==========================================================
    # 1. SETUP FIELD MODE (online)
    # ==========================================================
    async def setup_field_mode(
        self,
        user_id: str,
        device_id: str,
        device_name: str,
        hours_valid: int = 24,
    ) -> Dict[str, Any]:
        """Issue a field token bound to a device. Requires online auth."""
        user = await self._get_user(user_id)

        if user.role.name not in CAN_USE_FIELD:
            raise AuthorizationError(
                f"Role '{user.role.name}' cannot use field mode"
            )

        existing_result = await self.db.execute(
            select(FieldDevice).where(FieldDevice.device_id == device_id)
        )
        existing = existing_result.scalar_one_or_none()

        # Naive UTC to match the rest of the project's DateTime columns
        now = datetime.utcnow()
        expires_at = now + timedelta(hours=hours_valid)

        if existing:
            if str(existing.user_id) != str(user_id):
                raise ConflictError(
                    "This device ID is already registered to another user"
                )
            existing.device_name = device_name
            existing.issued_at = now
            existing.expires_at = expires_at
            existing.revoked_at = None
            existing.revoked_by = None
            device_row = existing
        else:
            device_row = FieldDevice(
                user_id=user.id,
                device_id=device_id,
                device_name=device_name,
                issued_at=now,
                expires_at=expires_at,
            )
            self.db.add(device_row)

        await self.db.flush()

        # Create a scoped JWT
        payload = {
            "sub": str(user.id),
            "device_id": device_id,
            "field_device_row_id": str(device_row.id),
            "scope": "field_collect",
            "purpose": "field_sync",
            "exp": expires_at,
            "iat": now,
        }
        field_token = jwt.encode(
            payload,
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM,
        )

        self.db.add(create_audit_log(
            event_type="FIELD_MODE_ENABLED",
            user_id=user.id,
            resource_type="FIELD_DEVICE",
            resource_id=device_row.id,
            action="ENABLE",
            details={
                "device_id": device_id,
                "device_name": device_name,
                "expires_at": expires_at.isoformat(),
                "hours_valid": hours_valid,
            },
        ))
        await self.db.commit()

        return {
            "field_token": field_token,
            "device_id": device_id,
            "device_name": device_name,
            "user_id": str(user.id),
            "user_full_name": user.full_name,
            "user_email": user.email,
            "user_role": user.role.name,
            "expires_at": expires_at,
            "scope": "field_collect",
        }

    # ==========================================================
    # 2. VALIDATE FIELD TOKEN
    # ==========================================================
    async def validate_field_token(
        self,
        token: str,
        device_id: str,
    ) -> User:
        """Validate a field token. Returns the user if valid."""
        try:
            payload = jwt.decode(
                token,
                settings.SECRET_KEY,
                algorithms=[settings.ALGORITHM],
            )
        except JWTError:
            raise AuthorizationError("Invalid or expired field token")

        if payload.get("scope") != "field_collect":
            raise AuthorizationError("Token is not scoped for field collection")

        if payload.get("purpose") != "field_sync":
            raise AuthorizationError("Token purpose mismatch")

        token_device_id = payload.get("device_id")
        if token_device_id != device_id:
            raise AuthorizationError(
                "Token device binding does not match the provided device_id"
            )

        user_id = payload.get("sub")
        if not user_id:
            raise AuthorizationError("Token missing user identity")

        device_row_result = await self.db.execute(
            select(FieldDevice).where(FieldDevice.device_id == device_id)
        )
        device_row = device_row_result.scalar_one_or_none()
        if not device_row:
            raise AuthorizationError("Device not registered")

        if str(device_row.user_id) != str(user_id):
            raise AuthorizationError("Device owner mismatch")

        if device_row.revoked_at is not None:
            raise AuthorizationError("Device has been revoked")

        # Normalize both sides to naive UTC before comparing
        expires = _to_naive_utc(device_row.expires_at)
        if expires < datetime.utcnow():
            raise AuthorizationError("Field device authorization has expired")

        user = await self._get_user(user_id)
        if not user.is_active or not user.is_approved:
            raise AuthorizationError("User account is not active")

        device_row.last_seen_at = datetime.utcnow()
        await self.db.flush()

        return user

    # ==========================================================
    # 3. SYNC BATCH
    # ==========================================================
    async def sync_batch(
        self,
        user: User,
        manifest: SyncManifest,
        files: List[UploadFile],
    ) -> Dict[str, Any]:
        """Ingest a batch of field-collected files.

        For each file:
        1. Save to disk (staging)
        2. Recompute SHA-256
        3. Compare to declared_hash from manifest
        4. Create Evidence row (marked as collected offline)
        5. Create TWO custody events: COLLECTED_OFFLINE (claimed time)
           and SYNCED_TO_SERVER (authoritative server time)
        6. Write an audit entry
        """
        await self._check_case_access(str(user.id), manifest.case_id)

        case_result = await self.db.execute(
            select(Case).where(Case.id == manifest.case_id)
        )
        case = case_result.scalar_one_or_none()
        if not case:
            raise NotFoundError("Case not found")

        files_by_name: Dict[str, UploadFile] = {}
        for f in files:
            files_by_name[f.filename or "unnamed"] = f

        batch_id = generate_batch_id()
        server_received_at = datetime.utcnow()

        upload_dir = Path(settings.UPLOAD_DIR)
        upload_dir.mkdir(parents=True, exist_ok=True)

        results = []
        synced = 0
        violations = 0
        errors = 0

        for item in manifest.items:
            try:
                uploaded = files_by_name.get(item.original_filename)
                if not uploaded:
                    results.append({
                        "client_ref_id": item.client_ref_id,
                        "original_filename": item.original_filename,
                        "status": "ERROR",
                        "evidence_id": None,
                        "internal_id": None,
                        "server_hash": None,
                        "declared_hash": item.declared_hash,
                        "error": "No matching uploaded file",
                    })
                    errors += 1
                    continue

                safe_name = sanitize_filename(item.original_filename)
                ext = os.path.splitext(safe_name)[1].lower()
                evidence_id = generate_evidence_id()
                storage_filename = f"{evidence_id}{ext}"
                storage_path = upload_dir / storage_filename

                total_size = 0
                with open(storage_path, "wb") as buffer:
                    while chunk := await uploaded.read(65536):
                        total_size += len(chunk)
                        buffer.write(chunk)

                server_hash = compute_file_hash(str(storage_path))
                hash_match = server_hash == item.declared_hash

                # Normalize the claimed collection time to naive UTC
                claimed_time = _to_naive_utc(item.local_collected_at)

                evidence = Evidence(
                    evidence_id=evidence_id,
                    case_id=case.id,
                    original_filename=safe_name,
                    file_type=ext.lstrip(".") or "unknown",
                    file_size=total_size,
                    file_path=str(storage_path),
                    original_hash=server_hash,
                    current_hash=server_hash,
                    collection_date=claimed_time,
                    collector_id=user.id,
                    description=item.description
                        or f"Field-collected (batch {batch_id})",
                    source_device=item.source_device or "Field device",
                    evidence_status="REGISTERED",
                )
                self.db.add(evidence)
                await self.db.flush()

                prev_hash = await self._last_custody_hash(evidence.id)
                collected_metadata = {
                    "batch_id": batch_id,
                    "client_ref_id": item.client_ref_id,
                    "claimed_time": claimed_time.isoformat(),
                    "device_id": manifest.device_id,
                    "server_received_at": server_received_at.isoformat(),
                    "declared_hash": item.declared_hash,
                    "hash_match": hash_match,
                }
                custody_hash = self._compute_custody_hash(
                    evidence.id, "COLLECTED_OFFLINE", user.id, prev_hash,
                    collected_metadata,
                )
                self.db.add(CustodyEvent(
                    event_id=generate_custody_event_id(),
                    evidence_id=evidence.id,
                    case_id=case.id,
                    user_id=user.id,
                    action="COLLECTED_OFFLINE",
                    description=(
                        f"Collected offline on device {manifest.device_id} "
                        f"(claimed {claimed_time.isoformat()})"
                    ),
                    previous_hash=prev_hash,
                    current_hash=custody_hash,
                    integrity_status="VERIFIED" if hash_match else "VIOLATION",
                    event_metadata=collected_metadata,
                ))

                prev_hash2 = custody_hash
                synced_metadata = {
                    "batch_id": batch_id,
                    "device_id": manifest.device_id,
                    "server_received_at": server_received_at.isoformat(),
                    "declared_hash": item.declared_hash,
                    "server_hash": server_hash,
                    "hash_match": hash_match,
                }
                custody_hash2 = self._compute_custody_hash(
                    evidence.id, "SYNCED_TO_SERVER", user.id, prev_hash2,
                    synced_metadata,
                )
                self.db.add(CustodyEvent(
                    event_id=generate_custody_event_id(),
                    evidence_id=evidence.id,
                    case_id=case.id,
                    user_id=user.id,
                    action="SYNCED_TO_SERVER",
                    description=(
                        f"Synced to server from device {manifest.device_id}"
                    ),
                    previous_hash=prev_hash2,
                    current_hash=custody_hash2,
                    integrity_status="VERIFIED" if hash_match else "VIOLATION",
                    event_metadata=synced_metadata,
                ))

                self.db.add(create_audit_log(
                    event_type=(
                        "EVIDENCE_REGISTERED" if hash_match
                        else "INTEGRITY_VIOLATION"
                    ),
                    user_id=user.id,
                    resource_type="EVIDENCE",
                    resource_id=evidence.id,
                    action="SYNC_FIELD_COLLECTION",
                    details={
                        "batch_id": batch_id,
                        "evidence_id": evidence_id,
                        "device_id": manifest.device_id,
                        "declared_hash": item.declared_hash,
                        "server_hash": server_hash,
                        "hash_match": hash_match,
                    },
                ))

                if hash_match:
                    synced += 1
                    results.append({
                        "client_ref_id": item.client_ref_id,
                        "original_filename": safe_name,
                        "status": "SYNCED",
                        "evidence_id": evidence_id,
                        "internal_id": str(evidence.id),
                        "server_hash": server_hash,
                        "declared_hash": item.declared_hash,
                        "error": None,
                    })
                else:
                    evidence.verified_status = "VIOLATION"
                    evidence.evidence_status = "COMPROMISED"
                    violations += 1
                    results.append({
                        "client_ref_id": item.client_ref_id,
                        "original_filename": safe_name,
                        "status": "VIOLATION",
                        "evidence_id": evidence_id,
                        "internal_id": str(evidence.id),
                        "server_hash": server_hash,
                        "declared_hash": item.declared_hash,
                        "error": (
                            "Hash mismatch between field-declared and "
                            "server-recomputed values"
                        ),
                    })

            except Exception as e:
                errors += 1
                results.append({
                    "client_ref_id": item.client_ref_id,
                    "original_filename": item.original_filename,
                    "status": "ERROR",
                    "evidence_id": None,
                    "internal_id": None,
                    "server_hash": None,
                    "declared_hash": item.declared_hash,
                    "error": str(e),
                })

        await self.db.commit()

        return {
            "batch_id": batch_id,
            "total_items": len(manifest.items),
            "synced": synced,
            "violations": violations,
            "errors": errors,
            "server_received_at": server_received_at,
            "results": results,
        }

    async def _last_custody_hash(self, evidence_id) -> Optional[str]:
        result = await self.db.execute(
            select(CustodyEvent)
            .where(CustodyEvent.evidence_id == evidence_id)
            .order_by(CustodyEvent.created_at.desc())
            .limit(1)
        )
        prev = result.scalar_one_or_none()
        return prev.current_hash if prev else None

    def _compute_custody_hash(
        self,
        evidence_id,
        action: str,
        user_id,
        prev_hash: Optional[str],
        metadata: dict,
    ) -> str:
        data = {
            "evidence_id": str(evidence_id),
            "action": action,
            "user_id": str(user_id),
            "previous_hash": prev_hash,
            "metadata": metadata,
        }
        return hashlib.sha256(
            json.dumps(data, sort_keys=True, default=str).encode()
        ).hexdigest()

    # ==========================================================
    # 4. LIST FIELD DEVICES
    # ==========================================================
    async def list_field_devices(
        self,
        user_id: str,
    ) -> List[Dict[str, Any]]:
        user = await self._get_user(user_id)

        if user.role.name == "SYSTEM_ADMINISTRATOR":
            result = await self.db.execute(
                select(FieldDevice).order_by(FieldDevice.issued_at.desc())
            )
        else:
            result = await self.db.execute(
                select(FieldDevice)
                .where(FieldDevice.user_id == user.id)
                .order_by(FieldDevice.issued_at.desc())
            )

        devices = result.scalars().all()
        now = datetime.utcnow()

        output = []
        for d in devices:
            expires = _to_naive_utc(d.expires_at)
            revoked = _to_naive_utc(d.revoked_at) if d.revoked_at else None
            is_active = revoked is None and expires > now

            output.append({
                "id": str(d.id),
                "device_id": d.device_id,
                "device_name": d.device_name,
                "issued_at": d.issued_at,
                "expires_at": d.expires_at,
                "last_seen_at": d.last_seen_at,
                "revoked_at": d.revoked_at,
                "is_active": is_active,
            })
        return output

    # ==========================================================
    # 5. REVOKE DEVICE
    # ==========================================================
    async def revoke_device(
        self,
        user_id: str,
        device_id: str,
    ) -> Dict[str, Any]:
        """Revoke a field device. Admin or the device owner."""
        user = await self._get_user(user_id)

        result = await self.db.execute(
            select(FieldDevice).where(FieldDevice.device_id == device_id)
        )
        device = result.scalar_one_or_none()
        if not device:
            raise NotFoundError("Device not found")

        is_admin = user.role.name == "SYSTEM_ADMINISTRATOR"
        is_owner = str(device.user_id) == str(user.id)
        if not is_admin and not is_owner:
            raise AuthorizationError(
                "Only the device owner or an administrator can revoke this device"
            )

        if device.revoked_at is not None:
            raise ValidationError("Device is already revoked")

        device.revoked_at = datetime.utcnow()
        device.revoked_by = user.id

        self.db.add(create_audit_log(
            event_type="FIELD_MODE_REVOKED",
            user_id=user.id,
            resource_type="FIELD_DEVICE",
            resource_id=device.id,
            action="REVOKE",
            details={
                "device_id": device_id,
                "device_name": device.device_name,
                "revoked_by": user.email,
            },
        ))
        await self.db.commit()

        return {
            "message": "Device revoked",
            "device_id": device_id,
            "revoked_at": device.revoked_at,
        }