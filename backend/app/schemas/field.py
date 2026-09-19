"""Field collection schemas."""

from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


# ==========================================================
# FIELD MODE SETUP (online)
# ==========================================================

class FieldSetupRequest(BaseModel):
    """Request to enable field mode on a device."""
    device_id: str = Field(..., min_length=8, max_length=255)
    device_name: str = Field(..., min_length=1, max_length=255)
    hours_valid: int = Field(24, ge=1, le=168)  # 1h to 7 days


class FieldSetupResponse(BaseModel):
    """Response with the field token to store locally."""
    field_token: str
    device_id: str
    device_name: str
    user_id: str
    user_full_name: str
    user_email: str
    user_role: str
    expires_at: datetime
    scope: str = "field_collect"


# ==========================================================
# FIELD MODE STATUS
# ==========================================================

class FieldDeviceInfo(BaseModel):
    id: str
    device_id: str
    device_name: str
    issued_at: datetime
    expires_at: datetime
    last_seen_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    is_active: bool


class FieldDeviceListResponse(BaseModel):
    devices: List[FieldDeviceInfo]
    total: int


# ==========================================================
# SYNC INGEST
# ==========================================================

class SyncManifestItem(BaseModel):
    """One item in the sync manifest, per file."""
    client_ref_id: str = Field(..., min_length=1, max_length=255)
    original_filename: str = Field(..., min_length=1, max_length=500)
    file_size: int = Field(..., ge=0)
    declared_hash: str = Field(..., min_length=64, max_length=64)
    local_collected_at: datetime
    description: Optional[str] = None
    source_device: Optional[str] = None


class SyncManifest(BaseModel):
    """Manifest describing a batch of field-collected items."""
    case_id: str
    device_id: str
    collected_by_claimed: Optional[str] = None
    items: List[SyncManifestItem]


class SyncResultItem(BaseModel):
    client_ref_id: str
    original_filename: str
    status: str  # SYNCED | VIOLATION | ERROR
    evidence_id: Optional[str] = None
    internal_id: Optional[str] = None
    server_hash: Optional[str] = None
    declared_hash: str
    error: Optional[str] = None


class SyncResponse(BaseModel):
    batch_id: str
    total_items: int
    synced: int
    violations: int
    errors: int
    server_received_at: datetime
    results: List[SyncResultItem]


# ==========================================================
# REVOKE
# ==========================================================

class FieldRevokeRequest(BaseModel):
    device_id: str


class FieldRevokeResponse(BaseModel):
    message: str
    device_id: str
    revoked_at: datetime