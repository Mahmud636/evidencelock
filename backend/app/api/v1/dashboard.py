"""Dashboard statistics API."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, Role
from app.models.case import Case, CaseMember
from app.models.evidence import Evidence
from app.models.audit import AuditLog
from app.models.custody import CustodyEvent

router = APIRouter()


def get_user_id_from_request(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


@router.get("/stats")
async def get_dashboard_stats(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get dashboard statistics for the current user."""
    try:
        user_id = get_user_id_from_request(request)

        # Get user + role
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        role_result = await db.execute(
            select(Role).where(Role.id == user.role_id)
        )
        role = role_result.scalar_one_or_none()
        is_admin = role and role.name == "SYSTEM_ADMINISTRATOR"

        # Get cases user has access to
        if is_admin:
            cases_result = await db.execute(select(Case))
            cases = cases_result.scalars().all()
            case_ids = [str(c.id) for c in cases]
        else:
            memberships = await db.execute(
                select(CaseMember.case_id).where(CaseMember.user_id == user_id)
            )
            case_ids = [str(row[0]) for row in memberships.all()]

        total_cases = len(case_ids)
        active_cases = 0
        if case_ids:
            active_result = await db.execute(
                select(func.count(Case.id)).where(
                    Case.id.in_(case_ids),
                    Case.status == "ACTIVE",
                )
            )
            active_cases = active_result.scalar() or 0

        # Evidence stats
        evidence_count = 0
        verified_count = 0
        compromised_items = 0
        violation_events = 0

        if case_ids:
            ev_result = await db.execute(
                select(func.count(Evidence.id)).where(Evidence.case_id.in_(case_ids))
            )
            evidence_count = ev_result.scalar() or 0

            ver_result = await db.execute(
                select(func.count(Evidence.id)).where(
                    Evidence.case_id.in_(case_ids),
                    Evidence.verified_status == "VERIFIED",
                )
            )
            verified_count = ver_result.scalar() or 0

            # Compromised items: unique evidence currently in VIOLATION state
            comp_result = await db.execute(
                select(func.count(Evidence.id)).where(
                    Evidence.case_id.in_(case_ids),
                    Evidence.verified_status == "VIOLATION",
                )
            )
            compromised_items = comp_result.scalar() or 0

        # Violation events: total custody events with action=INTEGRITY_VIOLATION
        # These are historical - every failed check adds one.
        if is_admin:
            viol_events_result = await db.execute(
                select(func.count(CustodyEvent.id)).where(
                    CustodyEvent.action == "INTEGRITY_VIOLATION"
                )
            )
            violation_events = viol_events_result.scalar() or 0
        elif case_ids:
            viol_events_result = await db.execute(
                select(func.count(CustodyEvent.id)).where(
                    CustodyEvent.case_id.in_(case_ids),
                    CustodyEvent.action == "INTEGRITY_VIOLATION",
                )
            )
            violation_events = viol_events_result.scalar() or 0

        # TOTAL audit events count
        if is_admin:
            total_events_result = await db.execute(
                select(func.count(AuditLog.id))
            )
        else:
            total_events_result = await db.execute(
                select(func.count(AuditLog.id)).where(AuditLog.user_id == user_id)
            )
        total_audit_events = total_events_result.scalar() or 0

        # Total custody events count
        if is_admin:
            custody_result = await db.execute(select(func.count(CustodyEvent.id)))
        elif case_ids:
            custody_result = await db.execute(
                select(func.count(CustodyEvent.id)).where(
                    CustodyEvent.case_id.in_(case_ids)
                )
            )
        else:
            custody_result = await db.execute(
                select(func.count(CustodyEvent.id)).where(
                    CustodyEvent.user_id == user_id
                )
            )
        total_custody_events = custody_result.scalar() or 0

        # Recent activity (last 10 audit logs)
        if is_admin:
            activity_result = await db.execute(
                select(AuditLog).order_by(AuditLog.created_at.desc()).limit(10)
            )
        else:
            activity_result = await db.execute(
                select(AuditLog)
                .where(AuditLog.user_id == user_id)
                .order_by(AuditLog.created_at.desc())
                .limit(10)
            )
        logs = activity_result.scalars().all()

        recent_activity = []
        for log in logs:
            actor_name = "System"
            if log.user_id:
                actor_result = await db.execute(
                    select(User).where(User.id == log.user_id)
                )
                actor = actor_result.scalar_one_or_none()
                if actor:
                    actor_name = actor.full_name

            recent_activity.append({
                "id": str(log.id),
                "event_type": log.event_type,
                "action": log.action,
                "details": log.details,
                "actor": actor_name,
                "created_at": log.created_at.isoformat(),
            })

        return {
            "total_cases": total_cases,
            "active_cases": active_cases,
            "evidence_count": evidence_count,
            "verified_count": verified_count,
            # Backward-compat: violation_count == compromised_items
            "violation_count": compromised_items,
            # New, richer fields:
            "compromised_items": compromised_items,
            "violation_events": violation_events,
            "total_audit_events": total_audit_events,
            "total_custody_events": total_custody_events,
            "recent_activity": recent_activity,
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print("[ERROR] dashboard stats:", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))