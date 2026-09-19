"""User management service - invites, approvals, roles, self-service profile."""

import secrets
import string
from typing import Optional, List, Dict, Any
from datetime import datetime

from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, Role
from app.models.audit import AuditLog
from app.utils.security import hash_password, verify_password
from app.exceptions.errors import (
    AuthorizationError,
    NotFoundError,
    ConflictError,
    ValidationError,
)


# Role hierarchy: higher = more power. Lower = assigned by higher.
ROLE_LEVELS = {
    "SYSTEM_ADMINISTRATOR": 1,
    "SUPERVISOR": 2,
    "LEAD_INVESTIGATOR": 3,
    "INVESTIGATOR": 4,
    "AUDITOR": 5,
    "JUDGE": 6,
}

# Who can invite (by role name)
CAN_INVITE = {
    "SYSTEM_ADMINISTRATOR",
    "SUPERVISOR",
    "LEAD_INVESTIGATOR",
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


def generate_temp_password(length: int = 12) -> str:
    """Generate a random temporary password."""
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.islower() for c in pwd)
                and any(c.isupper() for c in pwd)
                and any(c.isdigit() for c in pwd)
                and any(c in "!@#$%" for c in pwd)):
            return pwd


class UserService:
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

    async def _get_role(self, role_id: str) -> Role:
        result = await self.db.execute(
            select(Role).where(Role.id == role_id)
        )
        role = result.scalar_one_or_none()
        if not role:
            raise NotFoundError("Role not found")
        return role

    async def _get_role_by_name(self, name: str) -> Optional[Role]:
        result = await self.db.execute(
            select(Role).where(Role.name == name)
        )
        return result.scalar_one_or_none()

    async def get_available_roles(self, user_id: str) -> List[Dict[str, Any]]:
        """Roles the current user is allowed to assign."""
        user = await self._get_user(user_id)
        inviter_role = user.role.name

        if inviter_role not in CAN_INVITE:
            return []

        inviter_level = ROLE_LEVELS.get(inviter_role, 99)

        result = await self.db.execute(select(Role).order_by(Role.name))
        all_roles = result.scalars().all()

        available = []
        for role in all_roles:
            role_level = ROLE_LEVELS.get(role.name, 99)
            if role_level > inviter_level:
                available.append({
                    "id": str(role.id),
                    "name": role.name,
                    "description": role.description,
                })

        return available

    async def invite_user(
        self,
        inviter_id: str,
        email: str,
        username: str,
        full_name: str,
        role_id: str,
    ) -> Dict[str, Any]:
        """Invite a new user with a specific role."""
        inviter = await self._get_user(inviter_id)

        if inviter.role.name not in CAN_INVITE:
            raise AuthorizationError(
                f"Your role ({inviter.role.name}) cannot invite users"
            )

        target_role = await self._get_role(role_id)
        inviter_level = ROLE_LEVELS.get(inviter.role.name, 99)
        target_level = ROLE_LEVELS.get(target_role.name, 99)

        if target_level <= inviter_level:
            raise AuthorizationError(
                f"You cannot assign the role '{target_role.name}'. "
                f"You may only assign roles below your own level."
            )

        existing = await self.db.execute(
            select(User).where(
                or_(User.email == email, User.username == username)
            )
        )
        existing_user = existing.scalar_one_or_none()
        if existing_user:
            if existing_user.email == email:
                raise ConflictError("Email already registered")
            else:
                raise ConflictError("Username already taken")

        temp_password = generate_temp_password()

        user = User(
            email=email,
            username=username,
            full_name=full_name,
            password_hash=hash_password(temp_password),
            role_id=target_role.id,
            is_active=True,
            is_approved=False,
            mfa_enabled=False,
        )
        self.db.add(user)
        await self.db.flush()

        audit = create_audit_log(
            event_type="ACCOUNT_CREATED",
            user_id=inviter_id,
            resource_type="USER",
            resource_id=user.id,
            action="INVITE",
            details={
                "invited_email": email,
                "invited_role": target_role.name,
                "invited_by": inviter.email,
            },
        )
        self.db.add(audit)
        await self.db.commit()

        return {
            "id": str(user.id),
            "email": user.email,
            "username": user.username,
            "full_name": user.full_name,
            "role": target_role.name,
            "temporary_password": temp_password,
            "message": "User invited. Awaiting administrator approval.",
        }

    async def list_pending(self) -> List[Dict[str, Any]]:
        """List all pending (unapproved) users."""
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.role))
            .where(User.is_approved == False)
            .order_by(User.created_at.desc())
        )
        users = result.scalars().all()

        output = []
        for u in users:
            output.append({
                "id": str(u.id),
                "email": u.email,
                "username": u.username,
                "full_name": u.full_name,
                "role": u.role.name if u.role else "UNKNOWN",
                "role_id": str(u.role_id),
                "invited_by_name": None,
                "created_at": u.created_at,
            })
        return output

    async def approve_user(self, admin_id: str, user_id: str) -> Dict[str, Any]:
        """Approve a pending user. Admin only."""
        admin = await self._get_user(admin_id)
        if admin.role.name != "SYSTEM_ADMINISTRATOR":
            raise AuthorizationError("Only SYSTEM_ADMINISTRATOR can approve users")

        user = await self._get_user(user_id)
        if user.is_approved:
            raise ValidationError("User is already approved")

        user.is_approved = True
        user.approved_by = admin_id
        user.approved_at = datetime.utcnow()

        audit = create_audit_log(
            event_type="ACCOUNT_APPROVED",
            user_id=admin_id,
            resource_type="USER",
            resource_id=user.id,
            action="APPROVE",
            details={"email": user.email},
        )
        self.db.add(audit)
        await self.db.commit()

        return {
            "user_id": str(user.id),
            "email": user.email,
            "status": "APPROVED",
            "message": "User approved. They can now log in.",
        }

    async def reject_user(
        self,
        admin_id: str,
        user_id: str,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Reject and delete a pending user. Admin only."""
        admin = await self._get_user(admin_id)
        if admin.role.name != "SYSTEM_ADMINISTRATOR":
            raise AuthorizationError("Only SYSTEM_ADMINISTRATOR can reject users")

        user = await self._get_user(user_id)
        email = user.email

        audit = create_audit_log(
            event_type="ACCOUNT_REJECTED",
            user_id=admin_id,
            resource_type="USER",
            resource_id=user.id,
            action="REJECT",
            details={"email": email, "reason": reason or "No reason provided"},
        )
        self.db.add(audit)

        await self.db.delete(user)
        await self.db.commit()

        return {
            "user_id": str(user_id),
            "email": email,
            "status": "REJECTED",
            "message": "User rejected and removed.",
        }

    async def list_users(
        self,
        admin_id: str,
        search: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """List all users. Admin only."""
        admin = await self._get_user(admin_id)
        if admin.role.name != "SYSTEM_ADMINISTRATOR":
            raise AuthorizationError("Only SYSTEM_ADMINISTRATOR can list all users")

        query = select(User).options(selectinload(User.role))

        if search:
            term = f"%{search}%"
            query = query.where(
                or_(
                    User.email.ilike(term),
                    User.username.ilike(term),
                    User.full_name.ilike(term),
                )
            )

        query = query.order_by(User.created_at.desc())
        result = await self.db.execute(query)
        users = result.scalars().all()

        output = []
        for u in users:
            output.append({
                "id": str(u.id),
                "email": u.email,
                "username": u.username,
                "full_name": u.full_name,
                "role": u.role.name if u.role else "UNKNOWN",
                "role_id": str(u.role_id),
                "is_active": u.is_active,
                "is_approved": u.is_approved,
                "mfa_enabled": u.mfa_enabled,
                "last_login": u.last_login,
                "created_at": u.created_at,
                "updated_at": u.updated_at,
                "pending_email": u.pending_email,
            })
        return output

    async def update_user_role(
        self,
        admin_id: str,
        user_id: str,
        new_role_id: str,
    ) -> Dict[str, Any]:
        """Change a user's role. Admin only."""
        admin = await self._get_user(admin_id)
        if admin.role.name != "SYSTEM_ADMINISTRATOR":
            raise AuthorizationError("Only SYSTEM_ADMINISTRATOR can change roles")

        user = await self._get_user(user_id)
        new_role = await self._get_role(new_role_id)

        old_role = user.role.name if user.role else "UNKNOWN"
        user.role_id = new_role.id

        audit = create_audit_log(
            event_type="SYSTEM_EVENT",
            user_id=admin_id,
            resource_type="USER",
            resource_id=user.id,
            action="ROLE_CHANGE",
            details={
                "email": user.email,
                "old_role": old_role,
                "new_role": new_role.name,
            },
        )
        self.db.add(audit)
        await self.db.commit()

        return {
            "user_id": str(user.id),
            "email": user.email,
            "old_role": old_role,
            "new_role": new_role.name,
            "message": f"Role changed from {old_role} to {new_role.name}",
        }

    async def deactivate_user(
        self,
        admin_id: str,
        user_id: str,
    ) -> Dict[str, Any]:
        """Deactivate a user (soft disable). Admin only."""
        admin = await self._get_user(admin_id)
        if admin.role.name != "SYSTEM_ADMINISTRATOR":
            raise AuthorizationError("Only SYSTEM_ADMINISTRATOR can deactivate users")

        if user_id == admin_id:
            raise ValidationError("You cannot deactivate your own account")

        user = await self._get_user(user_id)
        user.is_active = False

        audit = create_audit_log(
            event_type="ACCOUNT_LOCKED",
            user_id=admin_id,
            resource_type="USER",
            resource_id=user.id,
            action="DEACTIVATE",
            details={"email": user.email},
        )
        self.db.add(audit)
        await self.db.commit()

        return {
            "user_id": str(user.id),
            "email": user.email,
            "is_active": False,
            "message": "User deactivated",
        }

    async def activate_user(
        self,
        admin_id: str,
        user_id: str,
    ) -> Dict[str, Any]:
        """Reactivate a user."""
        admin = await self._get_user(admin_id)
        if admin.role.name != "SYSTEM_ADMINISTRATOR":
            raise AuthorizationError("Only SYSTEM_ADMINISTRATOR can activate users")

        user = await self._get_user(user_id)
        user.is_active = True

        audit = create_audit_log(
            event_type="SYSTEM_EVENT",
            user_id=admin_id,
            resource_type="USER",
            resource_id=user.id,
            action="ACTIVATE",
            details={"email": user.email},
        )
        self.db.add(audit)
        await self.db.commit()

        return {
            "user_id": str(user.id),
            "email": user.email,
            "is_active": True,
            "message": "User activated",
        }

    # ==========================================================
    # SELF-SERVICE PROFILE
    # ==========================================================

    async def get_own_profile(self, user_id: str) -> Dict[str, Any]:
        """Get current user's own profile."""
        user = await self._get_user(user_id)
        return {
            "id": str(user.id),
            "email": user.email,
            "pending_email": user.pending_email,
            "email_change_requested_at": user.email_change_requested_at,
            "username": user.username,
            "full_name": user.full_name,
            "role": user.role.name if user.role else "UNKNOWN",
            "role_id": str(user.role_id),
            "mfa_enabled": user.mfa_enabled,
            "is_active": user.is_active,
            "is_approved": user.is_approved,
            "last_login": user.last_login,
            "created_at": user.created_at,
        }

    async def update_own_profile(
        self,
        user_id: str,
        full_name: Optional[str] = None,
        username: Optional[str] = None,
        email: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Update own profile.
        - full_name: applied immediately
        - username: applied immediately (uniqueness enforced)
        - email: queued as pending_email, requires admin approval
        """
        user = await self._get_user(user_id)
        updated: List[str] = []
        email_pending = False

        if full_name is not None and full_name != user.full_name:
            user.full_name = full_name
            updated.append("full_name")

        if username is not None and username != user.username:
            existing = await self.db.execute(
                select(User).where(
                    User.username == username,
                    User.id != user.id,
                )
            )
            if existing.scalar_one_or_none():
                raise ConflictError("Username already taken")
            user.username = username
            updated.append("username")

        if email is not None and email != user.email:
            existing = await self.db.execute(
                select(User).where(
                    User.email == email,
                    User.id != user.id,
                )
            )
            if existing.scalar_one_or_none():
                raise ConflictError("Email already registered")

            existing_pending = await self.db.execute(
                select(User).where(
                    User.pending_email == email,
                    User.id != user.id,
                )
            )
            if existing_pending.scalar_one_or_none():
                raise ConflictError(
                    "Email is already pending approval for another account"
                )

            user.pending_email = email
            user.email_change_requested_at = datetime.utcnow()
            updated.append("email_pending")
            email_pending = True

        if updated:
            user.updated_at = datetime.utcnow()
            audit = create_audit_log(
                event_type="SYSTEM_EVENT",
                user_id=user_id,
                resource_type="USER",
                resource_id=user.id,
                action="SELF_PROFILE_UPDATE",
                details={
                    "email": user.email,
                    "updated_fields": updated,
                    "pending_email": user.pending_email,
                },
            )
            self.db.add(audit)
            await self.db.commit()
            await self.db.refresh(user)

        return {
            "message": "Profile updated"
            if not email_pending
            else "Profile updated; email change pending admin approval",
            "email_change_pending": email_pending,
            "pending_email": user.pending_email,
            "updated_fields": updated,
        }

    async def change_own_password(
        self,
        user_id: str,
        current_password: str,
        new_password: str,
        confirm_password: str,
    ) -> Dict[str, Any]:
        """Change own password. Requires correct current password."""
        user = await self._get_user(user_id)

        if new_password != confirm_password:
            raise ValidationError("New password and confirmation do not match")

        if not verify_password(current_password, user.password_hash):
            audit = create_audit_log(
                event_type="PASSWORD_CHANGE_FAILED",
                user_id=user_id,
                resource_type="USER",
                resource_id=user.id,
                action="PASSWORD_CHANGE",
                details={"reason": "incorrect_current_password"},
            )
            self.db.add(audit)
            await self.db.commit()
            raise AuthorizationError("Current password is incorrect")

        if verify_password(new_password, user.password_hash):
            raise ValidationError(
                "New password must be different from your current password"
            )

        user.password_hash = hash_password(new_password)
        user.updated_at = datetime.utcnow()

        audit = create_audit_log(
            event_type="PASSWORD_CHANGED",
            user_id=user_id,
            resource_type="USER",
            resource_id=user.id,
            action="PASSWORD_CHANGE",
            details={"email": user.email},
        )
        self.db.add(audit)
        await self.db.commit()

        return {
            "message": "Password changed successfully",
            "changed_at": user.updated_at,
        }

    async def approve_email_change(
        self,
        admin_id: str,
        user_id: str,
    ) -> Dict[str, Any]:
        """Approve a pending email change. Admin only."""
        admin = await self._get_user(admin_id)
        if admin.role.name != "SYSTEM_ADMINISTRATOR":
            raise AuthorizationError(
                "Only SYSTEM_ADMINISTRATOR can approve email changes"
            )

        user = await self._get_user(user_id)
        if not user.pending_email:
            raise ValidationError("No pending email change for this user")

        new_email = user.pending_email
        old_email = user.email

        existing = await self.db.execute(
            select(User).where(
                User.email == new_email,
                User.id != user.id,
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictError(
                f"Cannot approve: {new_email} is already taken"
            )

        user.email = new_email
        user.pending_email = None
        user.email_change_requested_at = None
        user.updated_at = datetime.utcnow()

        audit = create_audit_log(
            event_type="SYSTEM_EVENT",
            user_id=admin_id,
            resource_type="USER",
            resource_id=user.id,
            action="APPROVE_EMAIL_CHANGE",
            details={
                "old_email": old_email,
                "new_email": new_email,
                "approved_by": admin.email,
            },
        )
        self.db.add(audit)
        await self.db.commit()

        return {
            "message": f"Email changed from {old_email} to {new_email}",
            "user_id": str(user.id),
            "new_email": new_email,
        }

    async def reject_email_change(
        self,
        admin_id: str,
        user_id: str,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Reject a pending email change. Admin only."""
        admin = await self._get_user(admin_id)
        if admin.role.name != "SYSTEM_ADMINISTRATOR":
            raise AuthorizationError(
                "Only SYSTEM_ADMINISTRATOR can reject email changes"
            )

        user = await self._get_user(user_id)
        if not user.pending_email:
            raise ValidationError("No pending email change for this user")

        rejected_email = user.pending_email
        user.pending_email = None
        user.email_change_requested_at = None
        user.updated_at = datetime.utcnow()

        audit = create_audit_log(
            event_type="SYSTEM_EVENT",
            user_id=admin_id,
            resource_type="USER",
            resource_id=user.id,
            action="REJECT_EMAIL_CHANGE",
            details={
                "rejected_email": rejected_email,
                "reason": reason or "No reason provided",
                "rejected_by": admin.email,
            },
        )
        self.db.add(audit)
        await self.db.commit()

        return {
            "message": f"Email change to {rejected_email} rejected",
            "user_id": str(user.id),
        }