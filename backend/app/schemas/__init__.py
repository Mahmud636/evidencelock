"""Pydantic schemas for request/response validation."""

from app.schemas.auth import (
    LoginRequest, LoginResponse, RegisterRequest, RegisterResponse,
    MFAActivateRequest, MFAActivateResponse, MFAVerifyRequest, MFAVerifyResponse,
    TokenRefreshRequest, TokenRefreshResponse, MFADisableRequest, MFADisableResponse,
)
from app.schemas.user import (
    UserResponse, InviteRequest, InviteResponse,
    PendingUserResponse, PendingListResponse,
    ApproveRequest, RejectRequest, ApproveResponse,
    RoleResponse, AvailableRolesResponse,
    UserListResponse, UpdateRoleRequest,
)
from app.schemas.case import (
    CaseCreate, CaseUpdate, CaseResponse, CaseListResponse,
    CaseMemberAdd, CaseMemberResponse,
)
from app.schemas.evidence import (
    EvidenceRegister, EvidenceResponse, EvidenceListResponse, EvidenceVerifyResponse,
)
from app.schemas.access_request import (
    AccessRequestCreate, AccessRequestReview, AccessRequestReturn,
    AccessRequestVerifyReturn, AccessRequestResponse, AccessRequestListResponse,
)

__all__ = [
    # Auth
    "LoginRequest", "LoginResponse", "RegisterRequest", "RegisterResponse",
    "MFAActivateRequest", "MFAActivateResponse", "MFAVerifyRequest", "MFAVerifyResponse",
    "TokenRefreshRequest", "TokenRefreshResponse", "MFADisableRequest", "MFADisableResponse",
    # User
    "UserResponse", "InviteRequest", "InviteResponse",
    "PendingUserResponse", "PendingListResponse",
    "ApproveRequest", "RejectRequest", "ApproveResponse",
    "RoleResponse", "AvailableRolesResponse",
    "UserListResponse", "UpdateRoleRequest",
    # Case
    "CaseCreate", "CaseUpdate", "CaseResponse", "CaseListResponse",
    "CaseMemberAdd", "CaseMemberResponse",
    # Evidence
    "EvidenceRegister", "EvidenceResponse", "EvidenceListResponse", "EvidenceVerifyResponse",
    # Access Request
    "AccessRequestCreate", "AccessRequestReview", "AccessRequestReturn",
    "AccessRequestVerifyReturn", "AccessRequestResponse", "AccessRequestListResponse",
]