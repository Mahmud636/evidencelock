from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
import uuid
from app.database import Base


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    case_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="ACTIVE")
    classification: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    created_by: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    supervisor_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    lead_investigator_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
    )

    # Relationships
    creator = relationship(
        "User",
        foreign_keys=[created_by],
        back_populates="cases_created",
    )
    supervisor = relationship(
        "User",
        foreign_keys=[supervisor_id],
        backref="supervised_cases",
    )
    lead_investigator = relationship(
        "User",
        foreign_keys=[lead_investigator_id],
        backref="led_cases",
    )
    members = relationship(
        "CaseMember",
        foreign_keys="CaseMember.case_id",
        back_populates="case",
        cascade="all, delete-orphan",
    )
    evidence_items = relationship(
        "Evidence",
        foreign_keys="Evidence.case_id",
        back_populates="case",
        cascade="all, delete-orphan",
    )
    custody_events = relationship(
        "CustodyEvent",
        foreign_keys="CustodyEvent.case_id",
        back_populates="case",
        cascade="all, delete-orphan",
    )
    reports = relationship(
        "Report",
        foreign_keys="Report.case_id",
        back_populates="case",
        cascade="all, delete-orphan",
    )


class CaseMember(Base):
    __tablename__ = "case_members"

    case_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cases.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )
    assigned_by: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )

    # Relationships
    case = relationship(
        "Case",
        foreign_keys=[case_id],
        back_populates="members",
    )
    user = relationship(
        "User",
        foreign_keys=[user_id],
        back_populates="case_memberships",
    )
    assigner = relationship(
        "User",
        foreign_keys=[assigned_by],
        backref="assigned_memberships",
    )