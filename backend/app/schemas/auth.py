"""Authentication and MFA schemas."""

from typing import Optional
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, field_validator


class LoginRequest(BaseModel):
    """Login request schema."""
    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., min_length=8, description="User password")

    @field_validator("password")
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginResponse(BaseModel):
    """Login response schema."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    mfa_required: bool = False
    user_id: str
    email: str
    full_name: str
    role: str


class RegisterRequest(BaseModel):
    """User registration request schema."""
    email: EmailStr = Field(..., description="User email address")
    username: str = Field(..., min_length=3, max_length=50, description="Username")
    password: str = Field(..., min_length=8, description="Password")
    full_name: str = Field(..., min_length=2, max_length=200, description="Full name")

    @field_validator("username")
    def validate_username(cls, v: str) -> str:
        if not v.isalnum() and "_" not in v:
            raise ValueError("Username must contain only alphanumeric characters and underscores")
        return v


class RegisterResponse(BaseModel):
    """User registration response schema."""
    id: str
    email: str
    username: str
    full_name: str
    message: str = "Account created. Awaiting administrator approval."
    status: str = "PENDING"


class MFAActivateRequest(BaseModel):
    """MFA activation request schema."""
    totp_code: str = Field(..., min_length=6, max_length=6, description="TOTP code from authenticator app")


class MFAActivateResponse(BaseModel):
    """MFA activation response schema."""
    secret: str
    qr_code: str  # Base64 encoded QR code image
    recovery_codes: list[str]
    message: str = "MFA activated successfully. Scan the QR code with your authenticator app."


class MFAVerifyRequest(BaseModel):
    """MFA verification request schema."""
    totp_code: str = Field(..., min_length=6, max_length=6, description="TOTP code from authenticator app")


class MFAVerifyResponse(BaseModel):
    """MFA verification response schema."""
    verified: bool
    message: str


class MFAEnrollResponse(BaseModel):
    """MFA enrollment response schema."""
    secret: str
    qr_code: str
    backup_codes: list[str]


class TokenRefreshRequest(BaseModel):
    """Token refresh request schema."""
    refresh_token: str


class TokenRefreshResponse(BaseModel):
    """Token refresh response schema."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class MFADisableRequest(BaseModel):
    """MFA disable request schema."""
    recovery_code: str = Field(..., min_length=8, description="Recovery code")


class MFADisableResponse(BaseModel):
    """MFA disable response schema."""
    success: bool
    message: str