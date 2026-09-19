"""Evidence management service."""

import hashlib
import json
import os
import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, Role
from app.models.case import Case, CaseMember
from app.models.evidence import Evidence
from app.models.custody import CustodyEvent
from app.models.audit import AuditLog
from app.models.access_request import EvidenceAccessRequest
from app.config import settings
from app.exceptions.errors import (
    AuthorizationError,
    NotFoundError,
    ConflictError,
    ValidationError,
)


ALLOWED_EXTENSIONS = {
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".bmp",
    ".mp4", ".mov", ".avi", ".mkv",
    ".txt", ".log", ".csv", ".json", ".xml",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip", ".tar", ".gz", ".7z",
    ".mp3", ".wav", ".ogg",
}

MAX_FILE_SIZE = 100 * 1024 * 1024


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


def compute_file_hash(file_path: str) -> str:
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def generate_evidence_id() -> str:
    year = datetime.utcnow().year
    unique = uuid.uuid4().hex[:6].upper()
    return f"EVID-{year}-{unique}"


def generate_custody_event_id() -> str:
    year = datetime.utcnow().year
    unique = uuid.uuid4().hex[:8].upper()
    return f"CE-{year}-{unique}"


def sanitize_filename(filename: str) -> str:
    filename = os.path.basename(filename)
    filename = filename.replace("\x00", "")
    safe_chars = []
    for c in filename:
        if c.isalnum() or c in "._- ":
            safe_chars.append(c)
    return "".join(safe_chars) or "unnamed"


def is_valid_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, AttributeError):
        return False


class EvidenceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _get_user_permissions(self, user_id: str) -> List[str]:
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.role).selectinload(Role.permissions))
            .where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        if not user or not user.role:
            return []
        return [perm.name for perm in user.role.permissions]

    async def _check_permission(self, user_id: str, permission: str) -> None:
        permissions = await self._get_user_permissions(user_id)
        if permission not in permissions:
            raise AuthorizationError(f"Permission '{permission}' required")

    async def _is_admin(self, user_id: str) -> bool:
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.role))
            .where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        return bool(user and user.role and user.role.name == "SYSTEM_ADMINISTRATOR")

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

    async def _find_evidence(self, evidence_identifier: str) -> Optional[Evidence]:
        if is_valid_uuid(evidence_identifier):
            result = await self.db.execute(
                select(Evidence).where(Evidence.id == evidence_identifier)
            )
            evidence = result.scalar_one_or_none()
            if evidence:
                return evidence

        result = await self.db.execute(
            select(Evidence).where(Evidence.evidence_id == evidence_identifier)
        )
        return result.scalar_one_or_none()

    async def _has_violation_history(self, evidence_id) -> Optional[Dict[str, Any]]:
        """Check if any access request for this evidence has a VIOLATION status.
        Returns the most recent violating request details, or None."""
        result = await self.db.execute(
            select(EvidenceAccessRequest)
            .where(
                EvidenceAccessRequest.evidence_id == evidence_id,
                EvidenceAccessRequest.status == "VIOLATION",
            )
            .order_by(EvidenceAccessRequest.return_verified_at.desc())
            .limit(1)
        )
        req = result.scalar_one_or_none()
        if not req:
            return None
        return {
            "request_id": req.request_id,
            "return_hash": req.return_hash,
            "return_verified_at": req.return_verified_at,
            "returned_file_path": req.returned_file_path,
        }

    async def _format_evidence(self, evidence: Evidence) -> Dict[str, Any]:
        collector_result = await self.db.execute(
            select(User).where(User.id == evidence.collector_id)
        )
        collector = collector_result.scalar_one_or_none()

        case_result = await self.db.execute(
            select(Case).where(Case.id == evidence.case_id)
        )
        case = case_result.scalar_one_or_none()

        # Determine overall compromised status (sticky - never cleared once set)
        violation_history = await self._has_violation_history(evidence.id)
        is_compromised = (
            evidence.verified_status == "VIOLATION"
            or evidence.evidence_status == "RETURN_VIOLATION"
            or violation_history is not None
        )

        violation_info = None
        if is_compromised:
            violation_info = {
                "detected": True,
                "reason": (
                    "Returned file hash mismatch"
                    if violation_history
                    else "Current file hash mismatch"
                ),
                "request_id": violation_history["request_id"] if violation_history else None,
                "return_hash": violation_history["return_hash"] if violation_history else None,
                "detected_at": (
                    violation_history["return_verified_at"].isoformat()
                    if violation_history and violation_history["return_verified_at"]
                    else None
                ),
            }

        return {
            "id": str(evidence.id),
            "evidence_id": evidence.evidence_id,
            "case_id": str(evidence.case_id),
            "case_number": case.case_number if case else None,
            "original_filename": evidence.original_filename,
            "file_type": evidence.file_type,
            "file_size": evidence.file_size,
            "original_hash": evidence.original_hash,
            "current_hash": evidence.current_hash,
            "collection_date": evidence.collection_date,
            "collector_id": str(evidence.collector_id),
            "collector_name": collector.full_name if collector else None,
            "description": evidence.description,
            "source_device": evidence.source_device,
            "evidence_status": evidence.evidence_status,
            "created_at": evidence.created_at,
            "last_verified_at": evidence.last_verified_at,
            "verified_status": evidence.verified_status,
            # NEW: aggregate integrity fields for the UI
            "is_compromised": is_compromised,
            "violation_info": violation_info,
        }

    async def register_evidence(
        self,
        user_id: str,
        case_id: str,
        file: UploadFile,
        description: Optional[str] = None,
        source_device: Optional[str] = None,
    ) -> Dict[str, Any]:
        await self._check_permission(user_id, "EVIDENCE_REGISTER")
        await self._check_case_access(user_id, case_id)

        case_result = await self.db.execute(select(Case).where(Case.id == case_id))
        case = case_result.scalar_one_or_none()
        if not case:
            raise NotFoundError("Case not found")

        original_filename = sanitize_filename(file.filename or "unnamed")
        ext = os.path.splitext(original_filename)[1].lower()

        if ext not in ALLOWED_EXTENSIONS:
            raise ValidationError(f"File type '{ext}' not allowed")

        upload_dir = Path(settings.UPLOAD_DIR)
        upload_dir.mkdir(parents=True, exist_ok=True)

        evidence_id = generate_evidence_id()
        storage_filename = f"{evidence_id}{ext}"
        storage_path = upload_dir / storage_filename

        total_size = 0
        try:
            with open(storage_path, "wb") as buffer:
                while chunk := await file.read(65536):
                    total_size += len(chunk)
                    if total_size > MAX_FILE_SIZE:
                        buffer.close()
                        os.remove(storage_path)
                        raise ValidationError("File too large")
                    buffer.write(chunk)
        except Exception as e:
            if storage_path.exists():
                os.remove(storage_path)
            raise ValidationError(f"Failed to save file: {str(e)}")

        file_hash = compute_file_hash(str(storage_path))

        evidence = Evidence(
            evidence_id=evidence_id,
            case_id=case_id,
            original_filename=original_filename,
            file_type=ext.lstrip("."),
            file_size=total_size,
            file_path=str(storage_path),
            original_hash=file_hash,
            current_hash=file_hash,
            collection_date=datetime.utcnow(),
            collector_id=user_id,
            description=description,
            source_device=source_device,
            evidence_status="REGISTERED",
        )
        self.db.add(evidence)
        await self.db.flush()

        previous_event_result = await self.db.execute(
            select(CustodyEvent)
            .where(CustodyEvent.evidence_id == evidence.id)
            .order_by(CustodyEvent.created_at.desc())
            .limit(1)
        )
        previous_event = previous_event_result.scalar_one_or_none()
        previous_hash = previous_event.current_hash if previous_event else None

        custody_data = {
            "evidence_id": str(evidence.id),
            "action": "REGISTERED",
            "user_id": str(user_id),
            "file_hash": file_hash,
            "previous_hash": previous_hash,
        }
        custody_hash = hashlib.sha256(
            json.dumps(custody_data, sort_keys=True).encode()
        ).hexdigest()

        custody_event = CustodyEvent(
            event_id=generate_custody_event_id(),
            evidence_id=evidence.id,
            case_id=case_id,
            user_id=user_id,
            action="REGISTERED",
            description=f"Evidence '{original_filename}' registered",
            previous_hash=previous_hash,
            current_hash=custody_hash,
            integrity_status="VERIFIED",
            event_metadata={"file_hash": file_hash, "file_size": total_size},
        )
        self.db.add(custody_event)

        audit = create_audit_log(
            event_type="EVIDENCE_REGISTERED",
            user_id=user_id,
            resource_type="EVIDENCE",
            resource_id=evidence.id,
            action="REGISTER",
            details={
                "evidence_id": evidence_id,
                "filename": original_filename,
                "size": total_size,
            },
        )
        self.db.add(audit)

        await self.db.commit()
        return await self._format_evidence(evidence)

    async def list_evidence(self, user_id: str, case_id: Optional[str] = None):
        await self._check_permission(user_id, "EVIDENCE_VIEW")

        is_admin = await self._is_admin(user_id)

        query = select(Evidence).order_by(Evidence.created_at.desc())

        if case_id:
            await self._check_case_access(user_id, case_id)
            query = query.where(Evidence.case_id == case_id)
        elif not is_admin:
            member_cases = await self.db.execute(
                select(CaseMember.case_id).where(CaseMember.user_id == user_id)
            )
            case_ids = [str(row[0]) for row in member_cases.all()]
            if not case_ids:
                return []
            query = query.where(Evidence.case_id.in_(case_ids))

        result = await self.db.execute(query)
        evidences = result.scalars().all()

        output = []
        for evidence in evidences:
            output.append(await self._format_evidence(evidence))
        return output

    async def get_evidence(self, user_id: str, evidence_identifier: str):
        await self._check_permission(user_id, "EVIDENCE_VIEW")

        evidence = await self._find_evidence(evidence_identifier)
        if not evidence:
            raise NotFoundError("Evidence not found")

        await self._check_case_access(user_id, str(evidence.case_id))
        return await self._format_evidence(evidence)

    async def verify_evidence(self, user_id: str, evidence_identifier: str):
        await self._check_permission(user_id, "EVIDENCE_VERIFY")

        evidence = await self._find_evidence(evidence_identifier)
        if not evidence:
            raise NotFoundError("Evidence not found")

        await self._check_case_access(user_id, str(evidence.case_id))

        if not os.path.exists(evidence.file_path):
            raise NotFoundError("Evidence file missing from storage")

        current_hash = compute_file_hash(evidence.file_path)
        integrity_verified = current_hash == evidence.original_hash

        # Check historical violation record (from returned file mismatch)
        violation_history = await self._has_violation_history(evidence.id)

        # STICKY VIOLATION LOGIC:
        # If the evidence has EVER been flagged as VIOLATION (either from a prior
        # disk check or from a returned-file mismatch), it stays VIOLATION forever
        # until an admin explicitly resolves the case. A later clean disk check
        # does NOT clear the violation.
        already_violation = (
            evidence.verified_status == "VIOLATION"
            or evidence.evidence_status == "RETURN_VIOLATION"
            or violation_history is not None
        )

        if already_violation:
            # Do not downgrade; keep the violation record intact
            final_verified_status = "VIOLATION"
        else:
            final_verified_status = "VERIFIED" if integrity_verified else "VIOLATION"

        evidence.current_hash = current_hash
        evidence.last_verified_at = datetime.utcnow()
        evidence.last_verified_by = user_id
        evidence.verified_status = final_verified_status

        if final_verified_status == "VIOLATION":
            evidence.evidence_status = (
                evidence.evidence_status or "COMPROMISED"
            )

        previous_event_result = await self.db.execute(
            select(CustodyEvent)
            .where(CustodyEvent.evidence_id == evidence.id)
            .order_by(CustodyEvent.created_at.desc())
            .limit(1)
        )
        previous_event = previous_event_result.scalar_one_or_none()
        previous_hash = previous_event.current_hash if previous_event else None

        custody_data = {
            "evidence_id": str(evidence.id),
            "action": "VERIFIED",
            "user_id": str(user_id),
            "current_hash": current_hash,
            "original_hash": evidence.original_hash,
            "disk_verified": integrity_verified,
            "final_verified_status": final_verified_status,
            "sticky_violation": already_violation,
            "previous_hash": previous_hash,
        }
        custody_hash = hashlib.sha256(
            json.dumps(custody_data, sort_keys=True).encode()
        ).hexdigest()

        custody_event = CustodyEvent(
            event_id=generate_custody_event_id(),
            evidence_id=evidence.id,
            case_id=evidence.case_id,
            user_id=user_id,
            action="VERIFIED",
            description=(
                f"Integrity verification: "
                f"{'PASSED (disk)' if integrity_verified else 'FAILED (disk)'}"
                + (" [VIOLATION ON RECORD]" if already_violation else "")
            ),
            previous_hash=previous_hash,
            current_hash=custody_hash,
            integrity_status=final_verified_status,
            event_metadata={
                "original_hash": evidence.original_hash,
                "current_hash": current_hash,
                "disk_verified": integrity_verified,
                "sticky_violation": already_violation,
            },
        )
        self.db.add(custody_event)

        event_type = "EVIDENCE_VERIFIED" if final_verified_status == "VERIFIED" else "INTEGRITY_VIOLATION"
        audit = create_audit_log(
            event_type=event_type,
            user_id=user_id,
            resource_type="EVIDENCE",
            resource_id=evidence.id,
            action="VERIFY",
            details={
                "original_hash": evidence.original_hash,
                "current_hash": current_hash,
                "disk_verified": integrity_verified,
                "final_status": final_verified_status,
                "sticky_violation": already_violation,
            },
        )
        self.db.add(audit)

        await self.db.commit()

        verifier_result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        verifier = verifier_result.scalar_one_or_none()

        if final_verified_status == "VERIFIED":
            message = (
                "INTEGRITY VERIFIED: The SHA-256 fingerprint calculated during this "
                "verification matches the fingerprint recorded at registration. "
                "The file has not been changed since it was registered."
            )
        elif already_violation:
            message = (
                "INTEGRITY VIOLATION ON RECORD: This evidence has a previously "
                "recorded integrity violation that has not been resolved. The disk "
                "file may currently match the original, but the historical violation "
                "remains authoritative."
            )
        else:
            message = (
                "INTEGRITY VIOLATION DETECTED: The current SHA-256 fingerprint does "
                "not match the fingerprint recorded at registration. This indicates "
                "the file contents have changed or the stored file is no longer "
                "identical to the originally registered file."
            )

        return {
            "evidence_id": evidence.evidence_id,
            "original_hash": evidence.original_hash,
            "current_hash": current_hash,
            "integrity_verified": final_verified_status == "VERIFIED",
            "disk_verified": integrity_verified,
            "sticky_violation": already_violation,
            "verified_at": evidence.last_verified_at,
            "verified_by": verifier.full_name if verifier else "Unknown",
            "message": message,
        }