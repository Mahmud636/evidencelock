"""Case management schemas."""

from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


class CaseMemberResponse(BaseModel):
    """Case member response."""
    user_id: str
    email: str
    full_name: str
    role: str
    assigned_at: datetime

    class Config:
        from_attributes = True


class CaseCreate(BaseModel):
    """Case creation schema."""
    case_number: str = Field(..., pattern=r'^CASE-\d{4}-\d{3}$')
    title: str = Field(..., min_length=3, max_length=255)
    description: Optional[str] = None
    classification: Optional[str] = None
    supervisor_id: Optional[str] = None
    lead_investigator_id: Optional[str] = None


class CaseUpdate(BaseModel):
    """Case update schema."""
    title: Optional[str] = Field(None, min_length=3, max_length=255)
    description: Optional[str] = None
    status: Optional[str] = None
    classification: Optional[str] = None
    supervisor_id: Optional[str] = None
    lead_investigator_id: Optional[str] = None


class CaseResponse(BaseModel):
    """Case response schema."""
    id: str
    case_number: str
    title: str
    description: Optional[str] = None
    status: str
    classification: Optional[str] = None
    created_by: str
    created_by_name: Optional[str] = None
    supervisor_id: Optional[str] = None
    lead_investigator_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    closed_at: Optional[datetime] = None
    evidence_count: int = 0
    member_count: int = 0


class CaseListResponse(BaseModel):
    """Case list response."""
    cases: List[CaseResponse]
    total: int


class CaseMemberAdd(BaseModel):
    """Add member to case request."""
    user_id: str