"""Chain of custody API endpoints."""

from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, distinct
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, Role
from app.models.case import Case, CaseMember
from app.models.evidence import Evidence
from app.models.custody import CustodyEvent

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


async def _user_case_ids(db: AsyncSession, user_id: str) -> List[str]:
    result = await db.execute(
        select(CaseMember.case_id).where(CaseMember.user_id == user_id)
    )
    return [str(row[0]) for row in result.all()]


def _safe_metadata(event: CustodyEvent):
    """Get the JSONB metadata safely."""
    try:
        # Column is named event_metadata in the model (metadata is reserved by SQLAlchemy)
        return getattr(event, "event_metadata", None)
    except Exception:
        return None


@router.get("")
async def list_custody_events(
    request: Request,
    evidence_id: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = 200,
    db: AsyncSession = Depends(get_db),
):
    """List chain of custody events."""
    try:
        user_id = get_user_id_from_request(request)
        permissions = await _get_user_permissions(db, user_id)
        can_view_all = "AUDIT_VIEW" in permissions

        query = select(CustodyEvent).order_by(CustodyEvent.created_at.desc())

        if evidence_id:
            ev_result = await db.execute(
                select(Evidence).where(Evidence.id == evidence_id)
            )
            ev = ev_result.scalar_one_or_none()
            if not ev:
                ev_result = await db.execute(
                    select(Evidence).where(Evidence.evidence_id == evidence_id)
                )
                ev = ev_result.scalar_one_or_none()
            if not ev:
                raise HTTPException(status_code=404, detail="Evidence not found")
            query = query.where(CustodyEvent.evidence_id == ev.id)

        if action:
            query = query.where(CustodyEvent.action == action)

        if not can_view_all:
            case_ids = await _user_case_ids(db, user_id)
            if not case_ids:
                return {"events": [], "total": 0}
            query = query.where(CustodyEvent.case_id.in_(case_ids))

        query = query.limit(limit)
        result = await db.execute(query)
        events = result.scalars().all()

        enriched = []
        for event in events:
            # Get user name
            user_name = "Unknown"
            if event.user_id:
                u_result = await db.execute(
                    select(User).where(User.id == event.user_id)
                )
                u = u_result.scalar_one_or_none()
                if u:
                    user_name = u.full_name

            # Get evidence external id
            ev_result = await db.execute(
                select(Evidence.evidence_id).where(Evidence.id == event.evidence_id)
            )
            evidence_ext_id = ev_result.scalar() or str(event.evidence_id)

            enriched.append({
                "id": str(event.id),
                "event_id": event.event_id,
                "evidence_id": evidence_ext_id,
                "case_id": str(event.case_id),
                "action": event.action,
                "description": event.description,
                "location": event.location,
                "user_id": str(event.user_id) if event.user_id else None,
                "user_name": user_name,
                "previous_hash": event.previous_hash,
                "current_hash": event.current_hash,
                "integrity_status": event.integrity_status,
                "metadata": _safe_metadata(event),
                "created_at": event.created_at.isoformat(),
            })

        return {"events": enriched, "total": len(enriched)}

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("[ERROR] list_custody_events:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/actions")
async def list_actions(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get distinct custody actions."""
    _ = get_user_id_from_request(request)
    result = await db.execute(select(distinct(CustodyEvent.action)))
    return {"actions": sorted([row[0] for row in result.all()])}


@router.post("/verify/{evidence_id}")
async def verify_custody_chain(
    evidence_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Verify the hash chain for a specific evidence's custody events."""
    try:
        user_id = get_user_id_from_request(request)
        permissions = await _get_user_permissions(db, user_id)
        if "EVIDENCE_VIEW" not in permissions and "AUDIT_VIEW" not in permissions:
            raise HTTPException(status_code=403, detail="Permission required")

        ev_result = await db.execute(
            select(Evidence).where(Evidence.id == evidence_id)
        )
        ev = ev_result.scalar_one_or_none()
        if not ev:
            ev_result = await db.execute(
                select(Evidence).where(Evidence.evidence_id == evidence_id)
            )
            ev = ev_result.scalar_one_or_none()
        if not ev:
            raise HTTPException(status_code=404, detail="Evidence not found")

        result = await db.execute(
            select(CustodyEvent)
            .where(CustodyEvent.evidence_id == ev.id)
            .order_by(CustodyEvent.created_at.asc())
        )
        events = result.scalars().all()

        if not events:
            return {
                "evidence_id": ev.evidence_id,
                "total_events": 0,
                "verified": True,
                "message": "No custody events",
            }

        previous_hash = None
        for i, event in enumerate(events):
            if i == 0:
                if event.previous_hash is not None:
                    return {
                        "evidence_id": ev.evidence_id,
                        "total_events": len(events),
                        "verified": False,
                        "broken_at": i,
                        "broken_event_id": event.event_id,
                        "message": "First event has unexpected previous_hash",
                    }
            else:
                if event.previous_hash != previous_hash:
                    return {
                        "evidence_id": ev.evidence_id,
                        "total_events": len(events),
                        "verified": False,
                        "broken_at": i,
                        "broken_event_id": event.event_id,
                        "reason": f"Event #{i} previous_hash does not match chain",
                        "message": "⚠ CUSTODY CHAIN BROKEN",
                    }
            previous_hash = event.current_hash

        return {
            "evidence_id": ev.evidence_id,
            "total_events": len(events),
            "verified": True,
            "message": "✓ Custody chain integrity verified",
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("[ERROR] verify_custody_chain:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))