"""Audit log API endpoints."""

import hashlib
import json
from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, Role
from app.models.audit import AuditLog
from app.exceptions.errors import AuthorizationError

router = APIRouter()


def get_user_id_from_request(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


async def _get_user_permissions(db: AsyncSession, user_id: str) -> List[str]:
    result = await db.execute(
        select(User)
        .options(selectinload(User.role).selectinload(Role.permissions))
        .where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user or not user.role:
        return []
    return [perm.name for perm in user.role.permissions]


@router.get("")
async def list_audit_logs(
    request: Request,
    event_type: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """List audit logs. Requires AUDIT_VIEW permission."""
    try:
        current_user_id = get_user_id_from_request(request)
        permissions = await _get_user_permissions(db, current_user_id)
        if "AUDIT_VIEW" not in permissions:
            raise HTTPException(status_code=403, detail="AUDIT_VIEW permission required")

        query = select(AuditLog).options(selectinload(AuditLog.user))

        if event_type:
            query = query.where(AuditLog.event_type == event_type)
        if user_id:
            query = query.where(AuditLog.user_id == user_id)

        query = query.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)

        result = await db.execute(query)
        logs = result.scalars().all()

        # Get total count
        from sqlalchemy import func
        count_query = select(func.count(AuditLog.id))
        if event_type:
            count_query = count_query.where(AuditLog.event_type == event_type)
        if user_id:
            count_query = count_query.where(AuditLog.user_id == user_id)
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        output = []
        for log in logs:
            output.append({
                "id": str(log.id),
                "event_type": log.event_type,
                "action": log.action,
                "user_id": str(log.user_id) if log.user_id else None,
                "user_name": log.user.full_name if log.user else "System",
                "user_email": log.user.email if log.user else None,
                "ip_address": log.ip_address,
                "resource_type": log.resource_type,
                "resource_id": str(log.resource_id) if log.resource_id else None,
                "details": log.details,
                "previous_hash": log.previous_hash,
                "current_hash": log.current_hash,
                "integrity_verified": log.integrity_verified,
                "created_at": log.created_at.isoformat(),
            })

        return {"logs": output, "total": total}

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("[ERROR] list_audit_logs:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/event-types")
async def get_event_types(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get distinct event types for filtering."""
    try:
        current_user_id = get_user_id_from_request(request)
        permissions = await _get_user_permissions(db, current_user_id)
        if "AUDIT_VIEW" not in permissions:
            raise HTTPException(status_code=403, detail="AUDIT_VIEW permission required")

        from sqlalchemy import distinct
        result = await db.execute(select(distinct(AuditLog.event_type)))
        types = [row[0] for row in result.all()]
        return {"event_types": sorted(types)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/verify-chain")
async def verify_chain(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Verify the integrity of the entire audit log chain.
    Recomputes each entry's hash and checks that each entry's
    previous_hash matches the previous entry's current_hash.
    """
    try:
        current_user_id = get_user_id_from_request(request)
        permissions = await _get_user_permissions(db, current_user_id)
        if "AUDIT_VIEW" not in permissions:
            raise HTTPException(status_code=403, detail="AUDIT_VIEW permission required")

        # Get ALL logs in chronological order
        result = await db.execute(
            select(AuditLog).order_by(AuditLog.created_at.asc())
        )
        logs = result.scalars().all()

        if not logs:
            return {
                "total_entries": 0,
                "verified": True,
                "broken_at": None,
                "message": "No audit entries to verify",
            }

        previous_hash = None
        broken_at = None
        broken_reason = None

        for i, log in enumerate(logs):
            # Check that previous_hash matches the last entry's current_hash
            if i == 0:
                if log.previous_hash is not None:
                    broken_at = i
                    broken_reason = "First entry has unexpected previous_hash"
                    break
            else:
                if log.previous_hash != previous_hash:
                    broken_at = i
                    broken_reason = (
                        f"Entry {i} previous_hash does not match "
                        f"previous entry's current_hash"
                    )
                    break

            # Recompute the hash of this entry
            computed = log.generate_hash()
            if computed != log.current_hash:
                broken_at = i
                broken_reason = (
                    f"Entry {i} current_hash does not match recomputed hash"
                )
                break

            previous_hash = log.current_hash

        if broken_at is not None:
            return {
                "total_entries": len(logs),
                "verified": False,
                "broken_at": broken_at,
                "broken_entry_id": str(logs[broken_at].id),
                "broken_event_type": logs[broken_at].event_type,
                "broken_at_time": logs[broken_at].created_at.isoformat(),
                "reason": broken_reason,
                "message": "⚠ AUDIT CHAIN TAMPERING DETECTED",
            }

        return {
            "total_entries": len(logs),
            "verified": True,
            "broken_at": None,
            "message": "✓ Audit chain integrity verified — no tampering detected",
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("[ERROR] verify_chain:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))