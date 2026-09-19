from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, BigInteger, Boolean, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, Mapped, mapped_column
import uuid
from app.database import Base


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    evidence_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    case_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cases.id", ondelete="RESTRICT"),
        nullable=False,
    )
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    file_size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    original_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    current_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    storage_reference: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    collection_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    collector_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_device: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    evidence_status: Mapped[str] = mapped_column(String(50), default="REGISTERED")
    is_encrypted: Mapped[bool] = mapped_column(Boolean, default=False)
    encryption_key_ref: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_verified_by: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    verified_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Relationships
    case = relationship("Case", back_populates="evidence_items")
    collector = relationship(
        "User",
        foreign_keys=[collector_id],
        back_populates="evidence_collected",
    )
    verifier = relationship(
        "User",
        foreign_keys=[last_verified_by],
        backref="verified_evidence",
    )
    custody_events = relationship(
        "CustodyEvent",
        back_populates="evidence",
        cascade="all, delete-orphan",
    )
    transfers = relationship(
        "Transfer",
        back_populates="evidence",
        cascade="all, delete-orphan",
    )
    versions = relationship(
        "EvidenceVersion",
        back_populates="evidence",
        cascade="all, delete-orphan",
    )
    reports = relationship(
        "Report",
        back_populates="evidence",
        cascade="all, delete-orphan",
    )
    access_requests = relationship(
        "EvidenceAccessRequest",
        foreign_keys="EvidenceAccessRequest.evidence_id",
        cascade="all, delete-orphan",
    )

class EvidenceVersion(Base):
    __tablename__ = "evidence_versions"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    evidence_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(nullable=False)
    version_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False)
    hash_override: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_by: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    evidence = relationship("Evidence", back_populates="versions")
    creator = relationship(
        "User",
        foreign_keys=[created_by],
        backref="evidence_versions_created",
    )