"""Evidence access request schemas."""

from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


class AccessRequestCreate(BaseModel):
    """Create a new access request."""
    evidence_id: str
    reason: str = Field(..., min_length=10, max_length=2000)


class AccessRequestReview(BaseModel):
    """Approve or deny an access request."""
    approve: bool
    note: Optional[str] = Field(None, max_length=1000)


class AccessRequestReturn(BaseModel):
    """Return an evidence after investigation."""
    notes: Optional[str] = Field(None, max_length=1000)


class AccessRequestVerifyReturn(BaseModel):
    """Verify the return of evidence."""
    verified: bool
    notes: Optional[str] = Field(None, max_length=1000)


class AccessRequestResponse(BaseModel):
    """Access request response."""
    id: str
    request_id: str
    evidence_id: str
    evidence_external_id: Optional[str] = None
    evidence_filename: Optional[str] = None
    case_id: str
    case_number: Optional[str] = None
    requested_by: str
    requester_name: Optional[str] = None
    reason: str
    status: str
    reviewed_by: Optional[str] = None
    reviewer_name: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    review_note: Optional[str] = None
    downloaded_at: Optional[datetime] = None
    returned_at: Optional[datetime] = None
    return_hash: Optional[str] = None
    return_verified_by: Optional[str] = None
    return_verifier_name: Optional[str] = None
    return_verified_at: Optional[datetime] = None
    return_notes: Optional[str] = None
    created_at: datetime


class AccessRequestListResponse(BaseModel):
    """List of access requests."""
    requests: List[AccessRequestResponse]
    total: int