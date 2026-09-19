"""Evidence access request model."""

from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, ForeignKey, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
import uuid
from app.database import Base


class EvidenceAccessRequest(Base):
    __tablename__ = "evidence_access_requests"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    request_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    evidence_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence.id", ondelete="CASCADE"),
        nullable=False,
    )
    case_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cases.id", ondelete="CASCADE"),
        nullable=False,
    )
    requested_by: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="PENDING")
    reviewed_by: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    downloaded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    returned_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    return_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    return_verified_by: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    return_verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    return_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # NEW: artifact of the actual returned file (kept for forensic evidence)
    returned_file_path: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )
    returned_file_size: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    evidence = relationship("Evidence", foreign_keys=[evidence_id])
    case = relationship("Case", foreign_keys=[case_id])
    requester = relationship("User", foreign_keys=[requested_by])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    return_verifier = relationship("User", foreign_keys=[return_verified_by])