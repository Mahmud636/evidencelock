"""Case management service."""

from typing import Optional, List, Dict, Any
from datetime import datetime

from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, Role
from app.models.case import Case, CaseMember
from app.models.evidence import Evidence
from app.models.access_request import EvidenceAccessRequest
from app.models.audit import AuditLog
from app.schemas.case import CaseCreate, CaseUpdate
from app.exceptions.errors import (
    AuthorizationError,
    NotFoundError,
    ConflictError,
    ValidationError,
)


def create_audit_log(
    event_type: str,
    user_id=None,
    resource_type: str = None,
    resource_id=None,
    action: str = None,
    details: dict = None,
) -> AuditLog:
    """Helper to create an audit log with proper hash chain."""
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


class CaseService:
    """Service for case management."""

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

    async def _is_case_creator(self, case_id: str, user_id: str) -> bool:
        """Check if user is the creator of the case."""
        result = await self.db.execute(
            select(Case.created_by).where(Case.id == case_id)
        )
        creator_id = result.scalar_one_or_none()
        return bool(creator_id and str(creator_id) == str(user_id))

    async def list_cases(self, user_id: str) -> List[Dict[str, Any]]:
        await self._check_permission(user_id, "CASE_VIEW")

        is_admin = await self._is_admin(user_id)

        if is_admin:
            cases_query = select(Case).order_by(Case.created_at.desc())
        else:
            cases_query = (
                select(Case)
                .join(CaseMember, CaseMember.case_id == Case.id)
                .where(CaseMember.user_id == user_id)
                .order_by(Case.created_at.desc())
            )

        result = await self.db.execute(cases_query)
        cases = result.scalars().all()

        output = []
        for case in cases:
            evidence_count_result = await self.db.execute(
                select(func.count(Evidence.id)).where(Evidence.case_id == case.id)
            )
            evidence_count = evidence_count_result.scalar() or 0

            member_count_result = await self.db.execute(
                select(func.count(CaseMember.user_id)).where(CaseMember.case_id == case.id)
            )
            member_count = member_count_result.scalar() or 0

            creator_result = await self.db.execute(
                select(User).where(User.id == case.created_by)
            )
            creator = creator_result.scalar_one_or_none()

            output.append({
                "id": str(case.id),
                "case_number": case.case_number,
                "title": case.title,
                "description": case.description,
                "status": case.status,
                "classification": case.classification,
                "created_by": str(case.created_by),
                "created_by_name": creator.full_name if creator else None,
                "supervisor_id": str(case.supervisor_id) if case.supervisor_id else None,
                "lead_investigator_id": str(case.lead_investigator_id) if case.lead_investigator_id else None,
                "created_at": case.created_at,
                "updated_at": case.updated_at,
                "closed_at": case.closed_at,
                "evidence_count": evidence_count,
                "member_count": member_count,
            })

        return output

    async def get_case(self, user_id: str, case_id: str) -> Dict[str, Any]:
        await self._check_permission(user_id, "CASE_VIEW")
        await self._check_case_access(user_id, case_id)

        result = await self.db.execute(
            select(Case).where(Case.id == case_id)
        )
        case = result.scalar_one_or_none()

        if not case:
            raise NotFoundError("Case not found")

        evidence_count_result = await self.db.execute(
            select(func.count(Evidence.id)).where(Evidence.case_id == case.id)
        )
        evidence_count = evidence_count_result.scalar() or 0

        member_count_result = await self.db.execute(
            select(func.count(CaseMember.user_id)).where(CaseMember.case_id == case.id)
        )
        member_count = member_count_result.scalar() or 0

        creator_result = await self.db.execute(
            select(User).where(User.id == case.created_by)
        )
        creator = creator_result.scalar_one_or_none()

        return {
            "id": str(case.id),
            "case_number": case.case_number,
            "title": case.title,
            "description": case.description,
            "status": case.status,
            "classification": case.classification,
            "created_by": str(case.created_by),
            "created_by_name": creator.full_name if creator else None,
            "supervisor_id": str(case.supervisor_id) if case.supervisor_id else None,
            "lead_investigator_id": str(case.lead_investigator_id) if case.lead_investigator_id else None,
            "created_at": case.created_at,
            "updated_at": case.updated_at,
            "closed_at": case.closed_at,
            "evidence_count": evidence_count,
            "member_count": member_count,
        }

    async def get_case_members(self, user_id: str, case_id: str) -> List[Dict[str, Any]]:
        await self._check_case_access(user_id, case_id)

        result = await self.db.execute(
            select(CaseMember, User, Role)
            .join(User, CaseMember.user_id == User.id)
            .join(Role, User.role_id == Role.id)
            .where(CaseMember.case_id == case_id)
            .order_by(User.full_name)
        )
        rows = result.all()

        # Get case to know creator/supervisor/lead
        case_result = await self.db.execute(
            select(Case).where(Case.id == case_id)
        )
        case = case_result.scalar_one_or_none()

        out = []
        for member, user, role in rows:
            is_creator = case and str(case.created_by) == str(member.user_id)
            is_supervisor = case and case.supervisor_id and str(case.supervisor_id) == str(member.user_id)
            is_lead = case and case.lead_investigator_id and str(case.lead_investigator_id) == str(member.user_id)

            out.append({
                "user_id": str(member.user_id),
                "email": user.email,
                "full_name": user.full_name,
                "role": role.name,
                "assigned_at": member.assigned_at,
                "is_creator": is_creator,
                "is_supervisor": is_supervisor,
                "is_lead_investigator": is_lead,
                "is_protected": is_creator,  # creator cannot be removed
            })
        return out

    async def create_case(
        self,
        user_id: str,
        request: CaseCreate,
    ) -> Dict[str, Any]:
        await self._check_permission(user_id, "CASE_CREATE")

        existing = await self.db.execute(
            select(Case).where(Case.case_number == request.case_number)
        )
        if existing.scalar_one_or_none():
            raise ConflictError(f"Case number '{request.case_number}' already exists")

        case = Case(
            case_number=request.case_number,
            title=request.title,
            description=request.description,
            classification=request.classification,
            status="ACTIVE",
            created_by=user_id,
            supervisor_id=request.supervisor_id,
            lead_investigator_id=request.lead_investigator_id,
        )
        self.db.add(case)
        await self.db.flush()

        self.db.add(CaseMember(
            case_id=case.id,
            user_id=user_id,
            assigned_by=user_id,
        ))

        if request.supervisor_id and request.supervisor_id != user_id:
            self.db.add(CaseMember(
                case_id=case.id,
                user_id=request.supervisor_id,
                assigned_by=user_id,
            ))
        if request.lead_investigator_id and request.lead_investigator_id not in [
            user_id, request.supervisor_id
        ]:
            self.db.add(CaseMember(
                case_id=case.id,
                user_id=request.lead_investigator_id,
                assigned_by=user_id,
            ))

        audit = create_audit_log(
            event_type="CASE_CREATED",
            user_id=user_id,
            resource_type="CASE",
            resource_id=case.id,
            action="CREATE",
            details={"case_number": case.case_number, "title": case.title},
        )
        self.db.add(audit)

        await self.db.commit()
        return await self.get_case(user_id, str(case.id))

    async def update_case(
        self,
        user_id: str,
        case_id: str,
        request: CaseUpdate,
    ) -> Dict[str, Any]:
        await self._check_permission(user_id, "CASE_ASSIGN")

        result = await self.db.execute(
            select(Case).where(Case.id == case_id)
        )
        case = result.scalar_one_or_none()
        if not case:
            raise NotFoundError("Case not found")

        if request.title is not None:
            case.title = request.title
        if request.description is not None:
            case.description = request.description
        if request.classification is not None:
            case.classification = request.classification

        changes: Dict[str, Any] = {}

        if request.status is not None and request.status != case.status:
            new_status = request.status
            old_status = case.status

            if new_status not in ("ACTIVE", "CLOSED", "ARCHIVED"):
                raise ValidationError(
                    f"Invalid status '{new_status}'. Allowed: ACTIVE, CLOSED, ARCHIVED"
                )

            actor = await self.db.execute(
                select(User)
                .options(selectinload(User.role))
                .where(User.id == user_id)
            )
            actor_user = actor.scalar_one_or_none()
            if not actor_user or actor_user.role.name not in (
                "SYSTEM_ADMINISTRATOR", "SUPERVISOR"
            ):
                raise AuthorizationError(
                    "Only SYSTEM_ADMINISTRATOR or SUPERVISOR can change case status"
                )

            if new_status == "CLOSED":
                open_reqs_result = await self.db.execute(
                    select(EvidenceAccessRequest)
                    .where(
                        EvidenceAccessRequest.case_id == case.id,
                        EvidenceAccessRequest.status == "DOWNLOADED",
                    )
                )
                open_reqs = open_reqs_result.scalars().all()
                if open_reqs:
                    req_ids = ", ".join(r.request_id for r in open_reqs)
                    raise ConflictError(
                        f"Cannot close case: {len(open_reqs)} evidence item(s) "
                        f"are still checked out. Open request(s): {req_ids}"
                    )

            if new_status == "CLOSED":
                case.closed_at = datetime.utcnow()
            elif new_status == "ACTIVE":
                case.closed_at = None

            case.status = new_status
            changes["status"] = {"from": old_status, "to": new_status}

        if request.supervisor_id is not None:
            old_sup = str(case.supervisor_id) if case.supervisor_id else None
            new_sup = request.supervisor_id or None
            if old_sup != new_sup:
                case.supervisor_id = new_sup
                changes["supervisor_id"] = {"from": old_sup, "to": new_sup}

                if new_sup:
                    u_check = await self.db.execute(select(User).where(User.id == new_sup))
                    if not u_check.scalar_one_or_none():
                        raise NotFoundError(f"Supervisor user not found: {new_sup}")

                    exists = await self.db.execute(
                        select(CaseMember).where(
                            CaseMember.case_id == case_id,
                            CaseMember.user_id == new_sup,
                        )
                    )
                    if not exists.scalar_one_or_none():
                        self.db.add(CaseMember(
                            case_id=case_id, user_id=new_sup, assigned_by=user_id,
                        ))

        if request.lead_investigator_id is not None:
            old_lead = str(case.lead_investigator_id) if case.lead_investigator_id else None
            new_lead = request.lead_investigator_id or None
            if old_lead != new_lead:
                case.lead_investigator_id = new_lead
                changes["lead_investigator_id"] = {"from": old_lead, "to": new_lead}

                if new_lead:
                    u_check = await self.db.execute(select(User).where(User.id == new_lead))
                    if not u_check.scalar_one_or_none():
                        raise NotFoundError(f"Lead investigator user not found: {new_lead}")

                    exists = await self.db.execute(
                        select(CaseMember).where(
                            CaseMember.case_id == case_id,
                            CaseMember.user_id == new_lead,
                        )
                    )
                    if not exists.scalar_one_or_none():
                        self.db.add(CaseMember(
                            case_id=case_id, user_id=new_lead, assigned_by=user_id,
                        ))

        case.updated_at = datetime.utcnow()

        if changes:
            if "status" in changes:
                ns = changes["status"]["to"]
                event_type = "CASE_CLOSED" if ns == "CLOSED" else ("CASE_REOPENED" if ns == "ACTIVE" else "CASE_UPDATED")
                action = "CLOSE" if ns == "CLOSED" else ("REOPEN" if ns == "ACTIVE" else "UPDATE")
            else:
                event_type = "CASE_UPDATED"
                action = "UPDATE"

            self.db.add(create_audit_log(
                event_type=event_type,
                user_id=user_id,
                resource_type="CASE",
                resource_id=case.id,
                action=action,
                details={"case_number": case.case_number, "changes": changes},
            ))

        await self.db.commit()
        return await self.get_case(user_id, str(case.id))

    # ==========================================================
    # TEAM MEMBER MANAGEMENT
    # ==========================================================
    async def add_member(
        self,
        user_id: str,
        case_id: str,
        new_user_id: str,
    ) -> Dict[str, Any]:
        """Add a member to a case. Admin/Supervisor only."""
        await self._check_permission(user_id, "CASE_ASSIGN")
        await self._check_case_access(user_id, case_id)

        # Verify case exists
        case_result = await self.db.execute(select(Case).where(Case.id == case_id))
        case = case_result.scalar_one_or_none()
        if not case:
            raise NotFoundError("Case not found")

        # Verify target user exists
        target_result = await self.db.execute(select(User).where(User.id == new_user_id))
        target = target_result.scalar_one_or_none()
        if not target:
            raise NotFoundError("User not found")

        # Check if already a member
        existing = await self.db.execute(
            select(CaseMember).where(
                CaseMember.case_id == case_id,
                CaseMember.user_id == new_user_id,
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictError("User is already a member of this case")

        self.db.add(CaseMember(
            case_id=case_id,
            user_id=new_user_id,
            assigned_by=user_id,
        ))

        self.db.add(create_audit_log(
            event_type="CASE_ASSIGNED",
            user_id=user_id,
            resource_type="CASE",
            resource_id=case_id,
            action="ADD_MEMBER",
            details={"added_user": target.email, "added_user_id": str(target.id)},
        ))

        await self.db.commit()
        return {"message": "Member added successfully"}

    async def remove_member(
        self,
        user_id: str,
        case_id: str,
        target_user_id: str,
    ) -> Dict[str, Any]:
        """Remove a member from a case. Admin/Supervisor only.
        Creator cannot be removed. If removed user was supervisor/lead,
        their slot is cleared."""
        await self._check_permission(user_id, "CASE_ASSIGN")
        await self._check_case_access(user_id, case_id)

        case_result = await self.db.execute(select(Case).where(Case.id == case_id))
        case = case_result.scalar_one_or_none()
        if not case:
            raise NotFoundError("Case not found")

        # Protected: cannot remove the creator
        if str(case.created_by) == str(target_user_id):
            raise ValidationError(
                "The case creator cannot be removed from the case"
            )

        # Find the member row
        member_result = await self.db.execute(
            select(CaseMember).where(
                CaseMember.case_id == case_id,
                CaseMember.user_id == target_user_id,
            )
        )
        member = member_result.scalar_one_or_none()
        if not member:
            raise NotFoundError("User is not a member of this case")

        # Check for active access requests from this user for this case
        active_reqs = await self.db.execute(
            select(EvidenceAccessRequest).where(
                EvidenceAccessRequest.case_id == case_id,
                EvidenceAccessRequest.requested_by == target_user_id,
                EvidenceAccessRequest.status.in_(["PENDING", "APPROVED", "DOWNLOADED", "RETURNED"]),
            )
        )
        blocking = active_reqs.scalars().all()
        if blocking:
            req_ids = ", ".join(r.request_id for r in blocking)
            raise ConflictError(
                f"Cannot remove this member: they have active access requests "
                f"({req_ids}). Resolve or cancel them first."
            )

        # Clear supervisor/lead slots if needed
        cleared_roles = []
        if case.supervisor_id and str(case.supervisor_id) == str(target_user_id):
            case.supervisor_id = None
            cleared_roles.append("Supervisor")
        if case.lead_investigator_id and str(case.lead_investigator_id) == str(target_user_id):
            case.lead_investigator_id = None
            cleared_roles.append("Lead Investigator")

        # Get target user for audit
        target_result = await self.db.execute(select(User).where(User.id == target_user_id))
        target = target_result.scalar_one_or_none()

        await self.db.delete(member)
        case.updated_at = datetime.utcnow()

        self.db.add(create_audit_log(
            event_type="CASE_ASSIGNED",
            user_id=user_id,
            resource_type="CASE",
            resource_id=case_id,
            action="REMOVE_MEMBER",
            details={
                "removed_user": target.email if target else str(target_user_id),
                "cleared_roles": cleared_roles,
            },
        ))

        await self.db.commit()
        return {
            "message": "Member removed successfully",
            "cleared_roles": cleared_roles,
        }

    async def list_assignable_users(
        self,
        user_id: str,
        case_id: str,
    ) -> List[Dict[str, Any]]:
        """List all users who can be assigned to this case.
        Excludes users who are already members."""
        await self._check_permission(user_id, "CASE_ASSIGN")
        await self._check_case_access(user_id, case_id)

        # Get existing member IDs
        member_result = await self.db.execute(
            select(CaseMember.user_id).where(CaseMember.case_id == case_id)
        )
        existing_ids = {str(row[0]) for row in member_result.all()}

        # Get all active, approved users
        users_result = await self.db.execute(
            select(User, Role)
            .join(Role, User.role_id == Role.id)
            .where(
                User.is_active == True,
                User.is_approved == True,
            )
            .order_by(Role.name, User.full_name)
        )
        rows = users_result.all()

        out = []
        for u, r in rows:
            if str(u.id) in existing_ids:
                continue
            out.append({
                "id": str(u.id),
                "email": u.email,
                "full_name": u.full_name,
                "role": r.name,
            })
        return out