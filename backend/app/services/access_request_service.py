"""Evidence access request service - download/return workflow."""

import hashlib
import json
import os
import shutil
import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime
from pathlib import Path

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


# Who can request
CAN_REQUEST = {"LEAD_INVESTIGATOR", "INVESTIGATOR"}

# Who can approve/deny/verify returns
CAN_REVIEW = {"SYSTEM_ADMINISTRATOR", "SUPERVISOR"}


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


def generate_request_id() -> str:
    year = datetime.utcnow().year
    unique = uuid.uuid4().hex[:6].upper()
    return f"REQ-{year}-{unique}"


def generate_custody_event_id() -> str:
    year = datetime.utcnow().year
    unique = uuid.uuid4().hex[:8].upper()
    return f"CE-{year}-{unique}"


def compute_file_hash(file_path: str) -> str:
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def sanitize_filename(filename: str) -> str:
    filename = os.path.basename(filename or "unnamed")
    filename = filename.replace("\x00", "")
    safe_chars = []
    for c in filename:
        if c.isalnum() or c in "._- ":
            safe_chars.append(c)
    return "".join(safe_chars) or "unnamed"


class AccessRequestService:
    def __init__(self, db: AsyncSession):
        self.db = db

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

    async def _create_custody_event(
        self,
        evidence: Evidence,
        user_id: str,
        action: str,
        description: str,
        extra_metadata: Optional[dict] = None,
    ) -> None:
        """Add a custody event with hash chaining."""
        prev_result = await self.db.execute(
            select(CustodyEvent)
            .where(CustodyEvent.evidence_id == evidence.id)
            .order_by(CustodyEvent.created_at.desc())
            .limit(1)
        )
        prev = prev_result.scalar_one_or_none()
        prev_hash = prev.current_hash if prev else None

        data = {
            "evidence_id": str(evidence.id),
            "action": action,
            "user_id": str(user_id),
            "previous_hash": prev_hash,
            "metadata": extra_metadata or {},
        }
        current = hashlib.sha256(
            json.dumps(data, sort_keys=True, default=str).encode()
        ).hexdigest()

        event = CustodyEvent(
            event_id=generate_custody_event_id(),
            evidence_id=evidence.id,
            case_id=evidence.case_id,
            user_id=user_id,
            action=action,
            description=description,
            previous_hash=prev_hash,
            current_hash=current,
            integrity_status="VERIFIED",
            event_metadata=extra_metadata or {},
        )
        self.db.add(event)

    async def _format_request(self, req: EvidenceAccessRequest) -> Dict[str, Any]:
        ev_result = await self.db.execute(
            select(Evidence).where(Evidence.id == req.evidence_id)
        )
        ev = ev_result.scalar_one_or_none()

        case_result = await self.db.execute(
            select(Case).where(Case.id == req.case_id)
        )
        case = case_result.scalar_one_or_none()

        req_name = None
        if req.requested_by:
            u_result = await self.db.execute(
                select(User.full_name).where(User.id == req.requested_by)
            )
            req_name = u_result.scalar()

        reviewer_name = None
        if req.reviewed_by:
            u_result = await self.db.execute(
                select(User.full_name).where(User.id == req.reviewed_by)
            )
            reviewer_name = u_result.scalar()

        verifier_name = None
        if req.return_verified_by:
            u_result = await self.db.execute(
                select(User.full_name).where(User.id == req.return_verified_by)
            )
            verifier_name = u_result.scalar()

        return {
            "id": str(req.id),
            "request_id": req.request_id,
            "evidence_id": str(req.evidence_id),
            "evidence_external_id": ev.evidence_id if ev else None,
            "evidence_filename": ev.original_filename if ev else None,
            "case_id": str(req.case_id),
            "case_number": case.case_number if case else None,
            "requested_by": str(req.requested_by),
            "requester_name": req_name,
            "reason": req.reason,
            "status": req.status,
            "reviewed_by": str(req.reviewed_by) if req.reviewed_by else None,
            "reviewer_name": reviewer_name,
            "reviewed_at": req.reviewed_at,
            "review_note": req.review_note,
            "downloaded_at": req.downloaded_at,
            "returned_at": req.returned_at,
            "return_hash": req.return_hash,
            "returned_file_path": req.returned_file_path,
            "returned_file_size": req.returned_file_size,
            "return_verified_by": str(req.return_verified_by) if req.return_verified_by else None,
            "return_verifier_name": verifier_name,
            "return_verified_at": req.return_verified_at,
            "return_notes": req.return_notes,
            "created_at": req.created_at,
        }

    # ==========================================================
    # 1. CREATE REQUEST (Investigator / Lead)
    # ==========================================================
    async def create_request(
        self,
        user_id: str,
        evidence_id: str,
        reason: str,
    ) -> Dict[str, Any]:
        user = await self._get_user(user_id)
        if user.role.name not in CAN_REQUEST:
            raise AuthorizationError(
                f"Role '{user.role.name}' cannot request evidence downloads"
            )

        ev = None
        try:
            ev_result = await self.db.execute(
                select(Evidence).where(Evidence.id == evidence_id)
            )
            ev = ev_result.scalar_one_or_none()
        except Exception:
            pass
        if not ev:
            ev_result = await self.db.execute(
                select(Evidence).where(Evidence.evidence_id == evidence_id)
            )
            ev = ev_result.scalar_one_or_none()
        if not ev:
            raise NotFoundError("Evidence not found")

        await self._check_case_access(user_id, str(ev.case_id))

        # NEW: block new requests on compromised evidence
        if ev.verified_status == "VIOLATION" or ev.evidence_status == "RETURN_VIOLATION":
            raise ConflictError(
                "This evidence is flagged as COMPROMISED (integrity violation). "
                "New access requests are blocked until an administrator resolves "
                "the case."
            )

        existing = await self.db.execute(
            select(EvidenceAccessRequest).where(
                EvidenceAccessRequest.evidence_id == ev.id,
                EvidenceAccessRequest.requested_by == user_id,
                EvidenceAccessRequest.status.in_(
                    ["PENDING", "APPROVED", "DOWNLOADED", "RETURNED"]
                ),
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictError(
                "You already have an active request for this evidence"
            )

        req = EvidenceAccessRequest(
            request_id=generate_request_id(),
            evidence_id=ev.id,
            case_id=ev.case_id,
            requested_by=user_id,
            reason=reason,
            status="PENDING",
        )
        self.db.add(req)
        await self.db.flush()

        audit = create_audit_log(
            event_type="EVIDENCE_VIEWED",
            user_id=user_id,
            resource_type="EVIDENCE",
            resource_id=ev.id,
            action="REQUEST_ACCESS",
            details={
                "request_id": req.request_id,
                "evidence_id": ev.evidence_id,
                "reason": reason[:200],
            },
        )
        self.db.add(audit)
        await self.db.commit()
        await self.db.refresh(req)

        return await self._format_request(req)

    # ==========================================================
    # 2. REVIEW REQUEST (Admin / Supervisor)
    # ==========================================================
    async def review_request(
        self,
        reviewer_id: str,
        request_id: str,
        approve: bool,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        reviewer = await self._get_user(reviewer_id)
        if reviewer.role.name not in CAN_REVIEW:
            raise AuthorizationError(
                f"Role '{reviewer.role.name}' cannot review access requests"
            )

        result = await self.db.execute(
            select(EvidenceAccessRequest).where(
                EvidenceAccessRequest.request_id == request_id
            )
        )
        req = result.scalar_one_or_none()
        if not req:
            raise NotFoundError("Access request not found")

        if req.status != "PENDING":
            raise ValidationError(
                f"Request is already {req.status.lower()}"
            )

        req.status = "APPROVED" if approve else "DENIED"
        req.reviewed_by = reviewer_id
        req.reviewed_at = datetime.utcnow()
        req.review_note = note

        audit = create_audit_log(
            event_type="EVIDENCE_VIEWED",
            user_id=reviewer_id,
            resource_type="EVIDENCE",
            resource_id=req.evidence_id,
            action="REVIEW_REQUEST",
            details={
                "request_id": req.request_id,
                "decision": "APPROVED" if approve else "DENIED",
                "note": note or "",
            },
        )
        self.db.add(audit)
        await self.db.commit()
        await self.db.refresh(req)

        return await self._format_request(req)

    # ==========================================================
    # 3. DOWNLOAD EVIDENCE (serves the pristine original)
    # ==========================================================
    async def mark_downloaded(
        self,
        user_id: str,
        request_id: str,
    ) -> Dict[str, Any]:
        result = await self.db.execute(
            select(EvidenceAccessRequest).where(
                EvidenceAccessRequest.request_id == request_id
            )
        )
        req = result.scalar_one_or_none()
        if not req:
            raise NotFoundError("Access request not found")

        if str(req.requested_by) != str(user_id):
            raise AuthorizationError("Only the requester can download this evidence")

        if req.status != "APPROVED":
            raise ValidationError(
                f"Cannot download. Request status is {req.status}"
            )

        ev_result = await self.db.execute(
            select(Evidence).where(Evidence.id == req.evidence_id)
        )
        ev = ev_result.scalar_one_or_none()
        if not ev:
            raise NotFoundError("Evidence not found")

        # NEW: refuse download if evidence is compromised
        if ev.verified_status == "VIOLATION" or ev.evidence_status == "RETURN_VIOLATION":
            raise ConflictError(
                "This evidence is flagged as COMPROMISED. Download is blocked "
                "until an administrator resolves the integrity violation."
            )

        if not os.path.exists(ev.file_path):
            raise NotFoundError("Evidence file missing from storage")

        current_hash = compute_file_hash(ev.file_path)

        req.status = "DOWNLOADED"
        req.downloaded_at = datetime.utcnow()
        ev.evidence_status = "DOWNLOADED"

        await self._create_custody_event(
            ev,
            user_id,
            "DOWNLOADED",
            f"Evidence downloaded by requester ({req.request_id})",
            {"request_id": req.request_id, "hash_at_download": current_hash},
        )

        audit = create_audit_log(
            event_type="EVIDENCE_VIEWED",
            user_id=user_id,
            resource_type="EVIDENCE",
            resource_id=ev.id,
            action="DOWNLOAD",
            details={
                "request_id": req.request_id,
                "hash_at_download": current_hash,
            },
        )
        self.db.add(audit)
        await self.db.commit()
        await self.db.refresh(req)

        return {
            "request": await self._format_request(req),
            "file_path": ev.file_path,
            "filename": ev.original_filename,
            "hash": current_hash,
        }

    # ==========================================================
    # 4. RETURN EVIDENCE (stores the returned file as an artifact)
    # ==========================================================
    async def mark_returned(
        self,
        user_id: str,
        request_id: str,
        returned_file: Any = None,
        returned_file_hash: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Store the actual returned file as a forensic artifact.

        Accepts either:
        - returned_file: an UploadFile to save (new behavior)
        - returned_file_hash: a pre-computed hash (legacy compatibility)
        """
        result = await self.db.execute(
            select(EvidenceAccessRequest).where(
                EvidenceAccessRequest.request_id == request_id
            )
        )
        req = result.scalar_one_or_none()
        if not req:
            raise NotFoundError("Access request not found")

        if str(req.requested_by) != str(user_id):
            raise AuthorizationError("Only the requester can return this evidence")

        if req.status != "DOWNLOADED":
            raise ValidationError(
                f"Cannot return. Request status is {req.status}"
            )

        ev_result = await self.db.execute(
            select(Evidence).where(Evidence.id == req.evidence_id)
        )
        ev = ev_result.scalar_one_or_none()
        if not ev:
            raise NotFoundError("Evidence not found")

        # Save the returned file to disk as an artifact
        stored_path: Optional[str] = None
        stored_size: Optional[int] = None
        final_hash: Optional[str] = returned_file_hash

        if returned_file is not None:
            try:
                returned_dir = Path(settings.UPLOAD_DIR) / "returned"
                returned_dir.mkdir(parents=True, exist_ok=True)

                original_name = sanitize_filename(
                    getattr(returned_file, "filename", None) or "returned_file"
                )
                stored_filename = f"{req.request_id}_{original_name}"
                stored_path = str(returned_dir / stored_filename)

                total = 0
                with open(stored_path, "wb") as buffer:
                    while True:
                        chunk = await returned_file.read(65536)
                        if not chunk:
                            break
                        total += len(chunk)
                        buffer.write(chunk)

                stored_size = total
                final_hash = compute_file_hash(stored_path)
            except Exception as e:
                # Clean up if partial
                if stored_path and os.path.exists(stored_path):
                    try:
                        os.remove(stored_path)
                    except Exception:
                        pass
                raise ValidationError(f"Failed to store returned file: {str(e)}")

        if not final_hash:
            raise ValidationError("No return hash and no file provided")

        req.status = "RETURNED"
        req.returned_at = datetime.utcnow()
        req.return_hash = final_hash
        req.return_notes = notes
        req.returned_file_path = stored_path
        req.returned_file_size = stored_size
        ev.evidence_status = "RETURNED"

        await self._create_custody_event(
            ev,
            user_id,
            "RETURNED",
            f"Evidence returned by requester ({req.request_id})",
            {
                "request_id": req.request_id,
                "return_hash": final_hash,
                "returned_file_path": stored_path,
                "returned_file_size": stored_size,
                "notes": notes or "",
            },
        )

        audit = create_audit_log(
            event_type="EVIDENCE_VIEWED",
            user_id=user_id,
            resource_type="EVIDENCE",
            resource_id=ev.id,
            action="RETURN",
            details={
                "request_id": req.request_id,
                "return_hash": final_hash,
                "returned_file_stored": bool(stored_path),
            },
        )
        self.db.add(audit)
        await self.db.commit()
        await self.db.refresh(req)

        return await self._format_request(req)

    # ==========================================================
    # 5. VERIFY RETURN (Admin / Supervisor)
    # ==========================================================
    async def verify_return(
        self,
        verifier_id: str,
        request_id: str,
        verified: bool,
        notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        verifier = await self._get_user(verifier_id)
        if verifier.role.name not in CAN_REVIEW:
            raise AuthorizationError(
                f"Role '{verifier.role.name}' cannot verify returns"
            )

        result = await self.db.execute(
            select(EvidenceAccessRequest).where(
                EvidenceAccessRequest.request_id == request_id
            )
        )
        req = result.scalar_one_or_none()
        if not req:
            raise NotFoundError("Access request not found")

        if req.status != "RETURNED":
            raise ValidationError(
                f"Cannot verify. Request status is {req.status}"
            )

        ev_result = await self.db.execute(
            select(Evidence).where(Evidence.id == req.evidence_id)
        )
        ev = ev_result.scalar_one_or_none()
        if not ev:
            raise NotFoundError("Evidence not found")

        if not req.return_hash:
            raise ValidationError("Cannot verify: no return hash recorded")
        if not ev.original_hash:
            raise ValidationError("Cannot verify: no original hash on file")

        hash_match = req.return_hash == ev.original_hash

        if verified != hash_match:
            print(
                f"[SECURITY] Client sent verified={verified}, but server-side "
                f"hash comparison result is {hash_match}. "
                f"Using server-side truth. request_id={req.request_id}"
            )

        verified = hash_match

        if verified:
            req.status = "VERIFIED"
            ev.evidence_status = "RETURN_VERIFIED"
            ev.verified_status = "VERIFIED"
            ev.current_hash = req.return_hash
            action = "VERIFIED"
            description = (
                f"Return verified - hash matches original ({req.request_id})"
            )
        else:
            req.status = "VIOLATION"
            ev.evidence_status = "RETURN_VIOLATION"
            ev.verified_status = "VIOLATION"
            # IMPORTANT: do not overwrite ev.current_hash from disk on violation.
            # The authoritative record of the returned hash lives on the request row.
            # We keep evidence.current_hash pointing at the registered original
            # so future verifications don't accidentally "clean" the record.
            action = "INTEGRITY_VIOLATION"
            description = (
                f"Return VIOLATION - hash differs from original ({req.request_id}) "
                f"| original={ev.original_hash[:16]}... "
                f"returned={req.return_hash[:16]}..."
            )

        req.return_verified_by = verifier_id
        req.return_verified_at = datetime.utcnow()
        if notes:
            req.return_notes = (req.return_notes or "") + f"\n[Verifier] {notes}"

        await self._create_custody_event(
            ev,
            verifier_id,
            action,
            description,
            {
                "request_id": req.request_id,
                "return_hash": req.return_hash,
                "original_hash": ev.original_hash,
                "verified": verified,
                "hash_match": hash_match,
                "returned_file_path": req.returned_file_path,
            },
        )

        audit = create_audit_log(
            event_type="EVIDENCE_VERIFIED" if verified else "INTEGRITY_VIOLATION",
            user_id=verifier_id,
            resource_type="EVIDENCE",
            resource_id=ev.id,
            action="VERIFY_RETURN",
            details={
                "request_id": req.request_id,
                "verified": verified,
                "original_hash": ev.original_hash,
                "return_hash": req.return_hash,
                "hash_match": hash_match,
            },
        )
        self.db.add(audit)
        await self.db.commit()
        await self.db.refresh(req)

        return await self._format_request(req)

    # ==========================================================
    # 6. LIST REQUESTS
    # ==========================================================
    async def list_requests(
        self,
        user_id: str,
        status_filter: Optional[str] = None,
        scope: str = "all",
    ) -> List[Dict[str, Any]]:
        user = await self._get_user(user_id)
        is_reviewer = user.role.name in CAN_REVIEW
        is_admin = user.role.name == "SYSTEM_ADMINISTRATOR"

        query = select(EvidenceAccessRequest).order_by(
            EvidenceAccessRequest.created_at.desc()
        )

        if status_filter:
            query = query.where(EvidenceAccessRequest.status == status_filter)

        if scope == "mine":
            query = query.where(EvidenceAccessRequest.requested_by == user_id)
        elif scope == "incoming" and is_reviewer:
            pass
        elif not is_reviewer and not is_admin:
            query = query.where(EvidenceAccessRequest.requested_by == user_id)

        result = await self.db.execute(query)
        reqs = result.scalars().all()

        return [await self._format_request(r) for r in reqs]

    async def get_request(self, user_id: str, request_id: str) -> Dict[str, Any]:
        result = await self.db.execute(
            select(EvidenceAccessRequest).where(
                EvidenceAccessRequest.request_id == request_id
            )
        )
        req = result.scalar_one_or_none()
        if not req:
            raise NotFoundError("Access request not found")
        return await self._format_request(req)