"""User management schemas."""

import re
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, field_validator


class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    full_name: str
    role: str
    role_id: str
    is_active: bool
    is_approved: bool
    mfa_enabled: bool
    last_login: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    pending_email: Optional[str] = None

    class Config:
        from_attributes = True


class InviteRequest(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=50)
    full_name: str = Field(..., min_length=2, max_length=200)
    role_id: str


class InviteResponse(BaseModel):
    id: str
    email: str
    username: str
    full_name: str
    role: str
    temporary_password: str
    message: str


class PendingUserResponse(BaseModel):
    id: str
    email: str
    username: str
    full_name: str
    role: str
    role_id: str
    invited_by_name: Optional[str] = None
    created_at: datetime


class PendingListResponse(BaseModel):
    users: List[PendingUserResponse]
    total: int


class ApproveRequest(BaseModel):
    pass


class RejectRequest(BaseModel):
    reason: Optional[str] = None


class ApproveResponse(BaseModel):
    user_id: str
    email: str
    status: str
    message: str


class RoleResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None


class AvailableRolesResponse(BaseModel):
    roles: List[RoleResponse]


class UserListResponse(BaseModel):
    users: List[UserResponse]
    total: int


class UpdateRoleRequest(BaseModel):
    role_id: str


# ==========================================================
# SELF-SERVICE PROFILE SCHEMAS
# ==========================================================

class ProfileResponse(BaseModel):
    id: str
    email: str
    pending_email: Optional[str] = None
    email_change_requested_at: Optional[datetime] = None
    username: str
    full_name: str
    role: str
    role_id: str
    mfa_enabled: bool
    is_active: bool
    is_approved: bool
    last_login: Optional[datetime] = None
    created_at: datetime


class ProfileUpdateRequest(BaseModel):
    """Update own profile.
    - full_name: applied immediately
    - username: applied immediately (must be unique)
    - email: stored as pending_email, requires admin approval
    """
    full_name: Optional[str] = Field(None, min_length=2, max_length=200)
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    email: Optional[EmailStr] = None

    @field_validator("username")
    @classmethod
    def validate_username(cls, v):
        if v is None:
            return v
        if not re.match(r"^[a-zA-Z0-9_]+$", v):
            raise ValueError(
                "Username may only contain letters, numbers, and underscores"
            )
        return v


class ProfileUpdateResponse(BaseModel):
    message: str
    email_change_pending: bool = False
    pending_email: Optional[str] = None
    updated_fields: List[str] = []


class PasswordChangeRequest(BaseModel):
    """Change own password. Requires current password."""
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=12, max_length=128)
    confirm_password: str = Field(..., min_length=12, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if len(v) < 12:
            raise ValueError("Password must be at least 12 characters")
        if not any(c.islower() for c in v):
            raise ValueError("Password must contain a lowercase letter")
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain an uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain a digit")
        if not any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in v):
            raise ValueError("Password must contain a symbol")
        return v


class PasswordChangeResponse(BaseModel):
    message: str
    changed_at: datetime


class ApproveEmailChangeResponse(BaseModel):
    message: str
    user_id: str
    new_email: str