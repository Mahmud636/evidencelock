from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, Mapped, mapped_column
import uuid
import hashlib
import json
from app.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    user_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    resource_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    resource_id: Mapped[Optional[UUID]] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
    )
    action: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    details: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    previous_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    current_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    integrity_verified: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    user = relationship(
        "User",
        back_populates="audit_logs",
    )

    def generate_hash(self) -> str:
        """Generate SHA-256 hash for this audit log entry."""
        data = {
            "event_type": self.event_type,
            "user_id": str(self.user_id) if self.user_id else None,
            "ip_address": self.ip_address,
            "resource_type": self.resource_type,
            "resource_id": str(self.resource_id) if self.resource_id else None,
            "action": self.action,
            "details": self.details,
            "previous_hash": self.previous_hash,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        data_str = json.dumps(data, sort_keys=True, default=str)
        return hashlib.sha256(data_str.encode()).hexdigest()