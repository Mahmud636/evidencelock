"""Evidence management schemas."""

from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


class EvidenceRegister(BaseModel):
    """Evidence registration request."""
    case_id: str
    description: Optional[str] = None
    source_device: Optional[str] = None


class EvidenceResponse(BaseModel):
    """Evidence response schema."""
    id: str
    evidence_id: str
    case_id: str
    original_filename: str
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    original_hash: str
    current_hash: Optional[str] = None
    collection_date: Optional[datetime] = None
    collector_id: str
    collector_name: Optional[str] = None
    description: Optional[str] = None
    source_device: Optional[str] = None
    evidence_status: str
    created_at: datetime
    last_verified_at: Optional[datetime] = None
    verified_status: Optional[str] = None
    case_number: Optional[str] = None


class EvidenceListResponse(BaseModel):
    """Evidence list response."""
    evidence: list[EvidenceResponse]
    total: int


class EvidenceVerifyResponse(BaseModel):
    """Evidence verification response."""
    evidence_id: str
    original_hash: str
    current_hash: str
    integrity_verified: bool
    verified_at: datetime
    verified_by: str
    message: str