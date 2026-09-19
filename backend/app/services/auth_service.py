"""Authentication service for user management and authentication."""

import base64
import io
from typing import Optional, Dict, Any
from datetime import datetime, timedelta

import pyotp
import qrcode
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, Role
from app.models.mfa import MFAConfig
from app.models.audit import AuditLog
from app.schemas.auth import LoginRequest, RegisterRequest
from app.utils.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    encrypt_data,
    decrypt_data,
    generate_recovery_codes,
    hash_recovery_code,
)
from app.exceptions.errors import (
    AuthenticationError,
    NotFoundError,
    ConflictError,
    ValidationError,
)
from app.config import settings


def create_audit_log(
    event_type: str,
    user_id=None,
    ip_address: str = None,
    user_agent: str = None,
    resource_type: str = None,
    resource_id=None,
    action: str = None,
    details: dict = None,
) -> AuditLog:
    """Helper to create an audit log with proper hash chain."""
    log = AuditLog(
        event_type=event_type,
        user_id=user_id,
        ip_address=ip_address,
        user_agent=user_agent,
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


class AuthService:
    """Service for authentication and user management."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def register_user(self, request: RegisterRequest) -> Dict[str, Any]:
        existing_email = await self.db.execute(
            select(User).where(User.email == request.email)
        )
        if existing_email.scalar_one_or_none():
            raise ConflictError("Email already registered")

        existing_username = await self.db.execute(
            select(User).where(User.username == request.username)
        )
        if existing_username.scalar_one_or_none():
            raise ConflictError("Username already taken")

        default_role = await self.db.execute(
            select(Role).where(Role.name == "VIEWER")
        )
        role = default_role.scalar_one_or_none()
        if not role:
            raise ValidationError("Default role 'VIEWER' not found.")

        user = User(
            email=request.email,
            username=request.username,
            password_hash=hash_password(request.password),
            full_name=request.full_name,
            role_id=role.id,
            is_active=True,
            is_approved=False,
        )
        self.db.add(user)
        await self.db.flush()

        audit_log = create_audit_log(
            event_type="ACCOUNT_CREATED",
            user_id=user.id,
            action="REGISTER",
            resource_type="USER",
            resource_id=user.id,
            details={"email": user.email, "username": user.username},
        )
        self.db.add(audit_log)
        await self.db.commit()

        return {
            "id": str(user.id),
            "email": user.email,
            "username": user.username,
            "full_name": user.full_name,
            "status": "PENDING",
            "message": "Account created. Awaiting administrator approval.",
        }

    async def login(self, request: LoginRequest, ip_address: str, user_agent: str) -> Dict[str, Any]:
        user_result = await self.db.execute(
            select(User).where(User.email == request.email)
        )
        user = user_result.scalar_one_or_none()

        if not user:
            raise AuthenticationError("Invalid email or password")

        if user.locked_until and user.locked_until > datetime.utcnow():
            raise AuthenticationError("Account is temporarily locked.")

        if not verify_password(request.password, user.password_hash):
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= 5:
                user.locked_until = datetime.utcnow() + timedelta(minutes=15)
            await self.db.commit()
            raise AuthenticationError("Invalid email or password")

        if not user.is_approved:
            raise AuthenticationError("Account is pending approval.")

        if not user.is_active:
            raise AuthenticationError("Account is disabled.")

        user.failed_login_attempts = 0
        user.locked_until = None
        user.last_login = datetime.utcnow()
        await self.db.flush()

        role_result = await self.db.execute(
            select(Role)
            .options(selectinload(Role.permissions))
            .where(Role.id == user.role_id)
        )
        role = role_result.scalar_one()

        permissions = [perm.name for perm in role.permissions]

        # If MFA is enabled, we do NOT issue the full token yet
        # We return a temporary "mfa_required" response instead
        if user.mfa_enabled:
            # Create a short-lived partial token that only allows MFA verification
            partial_token = create_access_token(
                {"sub": str(user.id), "purpose": "mfa_verify"},
                expires_delta=timedelta(minutes=5),
            )
            return {
                "access_token": partial_token,
                "refresh_token": "",
                "token_type": "bearer",
                "expires_in": 300,
                "mfa_required": True,
                "user_id": str(user.id),
                "email": user.email,
                "full_name": user.full_name,
                "role": role.name,
            }

        # No MFA — issue full token
        token_data = {
            "sub": str(user.id),
            "email": user.email,
            "role": role.name,
            "permissions": permissions,
        }
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data)

        audit_log = create_audit_log(
            event_type="LOGIN_SUCCESS",
            user_id=user.id,
            ip_address=ip_address,
            user_agent=user_agent,
            action="LOGIN",
            resource_type="USER",
            resource_id=user.id,
            details={"email": user.email},
        )
        self.db.add(audit_log)
        await self.db.commit()

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            "mfa_required": False,
            "user_id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
            "role": role.name,
        }

    async def verify_mfa_and_login(
        self,
        user_id: str,
        totp_code: str,
        ip_address: str,
        user_agent: str,
    ) -> Dict[str, Any]:
        """Verify TOTP and issue the full access token."""
        user_result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        user = user_result.scalar_one_or_none()
        if not user:
            raise AuthenticationError("User not found")

        if not user.mfa_enabled or not user.mfa_secret_encrypted:
            raise ValidationError("MFA is not enabled for this user")

        secret = decrypt_data(user.mfa_secret_encrypted)
        totp = pyotp.TOTP(secret)
        is_valid = totp.verify(totp_code, valid_window=1)

        # Also check recovery codes
        if not is_valid:
            is_valid = await self._try_recovery_code(user, totp_code)

        if not is_valid:
            audit_log = create_audit_log(
                event_type="MFA_FAILURE",
                user_id=user.id,
                ip_address=ip_address,
                user_agent=user_agent,
                action="MFA_VERIFY",
                resource_type="USER",
                resource_id=user.id,
            )
            self.db.add(audit_log)
            await self.db.commit()
            raise AuthenticationError("Invalid MFA code")

        # Update last_used
        mfa_config_result = await self.db.execute(
            select(MFAConfig).where(MFAConfig.user_id == user.id)
        )
        config = mfa_config_result.scalar_one_or_none()
        if config:
            config.last_used_at = datetime.utcnow()

        # Load role + permissions
        role_result = await self.db.execute(
            select(Role)
            .options(selectinload(Role.permissions))
            .where(Role.id == user.role_id)
        )
        role = role_result.scalar_one()
        permissions = [perm.name for perm in role.permissions]

        token_data = {
            "sub": str(user.id),
            "email": user.email,
            "role": role.name,
            "permissions": permissions,
        }
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data)

        audit_log = create_audit_log(
            event_type="MFA_SUCCESS",
            user_id=user.id,
            ip_address=ip_address,
            user_agent=user_agent,
            action="MFA_VERIFY",
            resource_type="USER",
            resource_id=user.id,
        )
        self.db.add(audit_log)
        await self.db.commit()

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            "mfa_required": False,
            "user_id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
            "role": role.name,
        }

    async def _try_recovery_code(self, user: User, code: str) -> bool:
        """Check if code matches a recovery code."""
        mfa_config_result = await self.db.execute(
            select(MFAConfig).where(MFAConfig.user_id == user.id)
        )
        config = mfa_config_result.scalar_one_or_none()
        if not config or not config.recovery_codes_encrypted:
            return False

        hashed_codes_str = decrypt_data(config.recovery_codes_encrypted)
        hashed_codes = hashed_codes_str.split("\n")

        input_hash = hash_recovery_code(code.upper())
        if input_hash in hashed_codes:
            hashed_codes.remove(input_hash)
            config.recovery_codes_encrypted = encrypt_data("\n".join(hashed_codes))
            return True
        return False

    async def logout(self, user_id: str, ip_address: str, user_agent: str) -> None:
        audit_log = create_audit_log(
            event_type="LOGOUT",
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            action="LOGOUT",
            resource_type="USER",
            resource_id=user_id,
        )
        self.db.add(audit_log)
        await self.db.commit()

    async def get_user(self, user_id: str) -> Optional[User]:
        result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_user_by_email(self, email: str) -> Optional[User]:
        result = await self.db.execute(
            select(User).where(User.email == email)
        )
        return result.scalar_one_or_none()

    async def generate_mfa_secret(self, user_id: str) -> Dict[str, Any]:
        """Generate a new MFA secret + QR code + recovery codes."""
        user = await self.get_user(user_id)
        if not user:
            raise NotFoundError("User not found")

        secret = pyotp.random_base32()
        totp = pyotp.TOTP(secret)

        provisioning_uri = totp.provisioning_uri(
            name=user.email,
            issuer_name=settings.MFA_ISSUER_NAME,
        )

        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(provisioning_uri)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")

        buffered = io.BytesIO()
        img.save(buffered, format="PNG")
        img_base64 = base64.b64encode(buffered.getvalue()).decode()

        recovery_codes = generate_recovery_codes()
        hashed_codes = [hash_recovery_code(code) for code in recovery_codes]

        encrypted_secret = encrypt_data(secret)
        encrypted_codes = encrypt_data("\n".join(hashed_codes))

        # Save MFA config (but do NOT enable yet — enable after verification)
        existing_config_result = await self.db.execute(
            select(MFAConfig).where(MFAConfig.user_id == user.id)
        )
        existing_config = existing_config_result.scalar_one_or_none()

        if existing_config:
            existing_config.secret_encrypted = encrypted_secret
            existing_config.recovery_codes_encrypted = encrypted_codes
            existing_config.is_enabled = False
        else:
            config = MFAConfig(
                user_id=user.id,
                secret_encrypted=encrypted_secret,
                recovery_codes_encrypted=encrypted_codes,
                is_enabled=False,
            )
            self.db.add(config)

        user.mfa_secret_encrypted = encrypted_secret
        await self.db.commit()

        return {
            "secret": secret,
            "qr_code": img_base64,
            "recovery_codes": recovery_codes,
            "message": "Scan the QR code with your authenticator app.",
        }

    async def confirm_mfa_setup(self, user_id: str, totp_code: str) -> bool:
        """Verify the first TOTP code to confirm enrollment and enable MFA."""
        user = await self.get_user(user_id)
        if not user:
            raise NotFoundError("User not found")

        if not user.mfa_secret_encrypted:
            raise ValidationError("MFA setup not initiated")

        secret = decrypt_data(user.mfa_secret_encrypted)
        totp = pyotp.TOTP(secret)
        is_valid = totp.verify(totp_code, valid_window=1)

        if not is_valid:
            raise ValidationError("Invalid verification code. Please try again.")

        # Enable MFA
        user.mfa_enabled = True
        mfa_config_result = await self.db.execute(
            select(MFAConfig).where(MFAConfig.user_id == user.id)
        )
        config = mfa_config_result.scalar_one_or_none()
        if config:
            config.is_enabled = True

        audit_log = create_audit_log(
            event_type="MFA_SUCCESS",
            user_id=user.id,
            action="MFA_ENROLL",
            resource_type="USER",
            resource_id=user.id,
        )
        self.db.add(audit_log)
        await self.db.commit()

        return True

    async def verify_mfa(self, user_id: str, totp_code: str) -> bool:
        """Verify a TOTP code (for settings/testing)."""
        user = await self.get_user(user_id)
        if not user:
            raise NotFoundError("User not found")

        if not user.mfa_enabled or not user.mfa_secret_encrypted:
            raise ValidationError("MFA is not enabled for this user")

        secret = decrypt_data(user.mfa_secret_encrypted)
        totp = pyotp.TOTP(secret)
        return totp.verify(totp_code, valid_window=1)

    async def disable_mfa(self, user_id: str, totp_code: str) -> bool:
        """Disable MFA. Requires a valid TOTP code."""
        user = await self.get_user(user_id)
        if not user:
            raise NotFoundError("User not found")

        if not user.mfa_enabled:
            raise ValidationError("MFA is not enabled")

        is_valid = await self.verify_mfa(user_id, totp_code)
        if not is_valid:
            raise ValidationError("Invalid TOTP code")

        user.mfa_enabled = False
        user.mfa_secret_encrypted = None

        mfa_config_result = await self.db.execute(
            select(MFAConfig).where(MFAConfig.user_id == user.id)
        )
        config = mfa_config_result.scalar_one_or_none()
        if config:
            config.is_enabled = False

        audit_log = create_audit_log(
            event_type="MFA_FAILURE",
            user_id=user.id,
            action="MFA_DISABLE",
            resource_type="USER",
            resource_id=user.id,
        )
        self.db.add(audit_log)
        await self.db.commit()
        return True

    async def refresh_token(self, refresh_token: str) -> Dict[str, Any]:
        from app.utils.security import decode_token

        payload = decode_token(refresh_token)
        if not payload or payload.get("type") != "refresh":
            raise AuthenticationError("Invalid refresh token")

        user_id = payload.get("sub")
        user = await self.get_user(user_id)
        if not user:
            raise AuthenticationError("User not found")

        role_result = await self.db.execute(
            select(Role)
            .options(selectinload(Role.permissions))
            .where(Role.id == user.role_id)
        )
        role = role_result.scalar_one()

        permissions = [perm.name for perm in role.permissions]

        token_data = {
            "sub": str(user.id),
            "email": user.email,
            "role": role.name,
            "permissions": permissions,
        }
        access_token = create_access_token(token_data)

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }