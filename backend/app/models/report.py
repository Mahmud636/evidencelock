from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, Mapped, mapped_column
import uuid
from app.database import Base


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    report_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    case_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cases.id", ondelete="SET NULL"),
        nullable=True,
    )
    evidence_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("evidence.id", ondelete="SET NULL"),
        nullable=True,
    )
    report_type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    generated_by: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    generated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(20), default="GENERATED")
    hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    signature: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    report_metadata: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Relationships
    case = relationship("Case", back_populates="reports")
    evidence = relationship("Evidence", back_populates="reports")
    generator = relationship(
        "User",
        foreign_keys=[generated_by],
        back_populates="reports_generated",
    )