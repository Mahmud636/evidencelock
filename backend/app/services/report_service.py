"""Report generation service - court-friendly PDF reports."""

import hashlib
import os
import uuid
from typing import Optional, Dict, Any, List
from datetime import datetime
from pathlib import Path

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, Role
from app.models.case import Case, CaseMember
from app.models.evidence import Evidence
from app.models.custody import CustodyEvent
from app.models.report import Report
from app.config import settings
from app.exceptions.errors import (
    AuthorizationError,
    NotFoundError,
    ValidationError,
)


def generate_report_id() -> str:
    year = datetime.utcnow().year
    unique = uuid.uuid4().hex[:8].upper()
    return f"RPT-{year}-{unique}"


class ReportService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _get_user_permissions(self, user_id: str) -> List[str]:
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.role).selectinload(Role.permissions))
            .where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        if not user or not user.role:
            return []
        return [perm.name for perm in user.role.permissions]

    async def _check_permission(self, user_id: str, permission: str) -> None:
        permissions = await self._get_user_permissions(user_id)
        if permission not in permissions:
            raise AuthorizationError(f"Permission '{permission}' required")

    async def _is_admin(self, user_id: str) -> bool:
        """Check if user is a System Administrator (global access)."""
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.role))
            .where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        return bool(user and user.role and user.role.name == "SYSTEM_ADMINISTRATOR")

    async def _check_case_access(self, user_id: str, case_id: str) -> None:
        """Admins bypass; everyone else must be a member."""
        if await self._is_admin(user_id):
            return

        result = await self.db.execute(
            select(CaseMember).where(
                CaseMember.case_id == case_id,
                CaseMember.user_id == user_id,
            )
        )
        if not result.scalar_one_or_none():
            raise AuthorizationError("Access to this case is not authorized")

    # ==========================================================
    # EVIDENCE-LEVEL REPORT
    # ==========================================================
    async def generate_evidence_report(
        self,
        user_id: str,
        evidence_id: str,
    ) -> Dict[str, Any]:
        await self._check_permission(user_id, "REPORT_GENERATE")

        evidence = None
        try:
            result = await self.db.execute(
                select(Evidence).where(Evidence.id == evidence_id)
            )
            evidence = result.scalar_one_or_none()
        except Exception:
            pass
        if not evidence:
            result = await self.db.execute(
                select(Evidence).where(Evidence.evidence_id == evidence_id)
            )
            evidence = result.scalar_one_or_none()

        if not evidence:
            raise NotFoundError("Evidence not found")

        await self._check_case_access(user_id, str(evidence.case_id))

        case_result = await self.db.execute(
            select(Case).where(Case.id == evidence.case_id)
        )
        case = case_result.scalar_one_or_none()

        collector_result = await self.db.execute(
            select(User).where(User.id == evidence.collector_id)
        )
        collector = collector_result.scalar_one_or_none()

        generator_result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        generator = generator_result.scalar_one_or_none()

        custody_result = await self.db.execute(
            select(CustodyEvent)
            .where(CustodyEvent.evidence_id == evidence.id)
            .order_by(CustodyEvent.created_at)
        )
        custody_events = custody_result.scalars().all()

        custody_data = []
        for event in custody_events:
            ev_user = None
            if event.user_id:
                u_result = await self.db.execute(
                    select(User).where(User.id == event.user_id)
                )
                ev_user = u_result.scalar_one_or_none()
            custody_data.append({
                "timestamp": event.created_at,
                "action": event.action,
                "user": ev_user.full_name if ev_user else "Unknown",
                "description": event.description or "",
                "integrity_status": event.integrity_status or "",
            })

        report_id = generate_report_id()
        report_dir = Path(settings.REPORT_DIR)
        report_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{report_id}.pdf"
        file_path = report_dir / filename

        self._build_evidence_pdf(
            file_path=str(file_path),
            report_id=report_id,
            evidence=evidence,
            case=case,
            collector=collector,
            generator=generator,
            custody_data=custody_data,
        )

        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                sha256.update(chunk)
        report_hash = sha256.hexdigest()

        report = Report(
            report_id=report_id,
            case_id=evidence.case_id,
            evidence_id=evidence.id,
            report_type="EVIDENCE_INTEGRITY",
            title=f"Evidence Integrity Report - {evidence.evidence_id}",
            file_path=str(file_path),
            generated_by=user_id,
            hash=report_hash,
            metadata={"evidence_id": evidence.evidence_id},
        )
        self.db.add(report)
        await self.db.commit()

        return {
            "report_id": report_id,
            "evidence_id": evidence.evidence_id,
            "file_path": str(file_path),
            "hash": report_hash,
            "generated_at": report.generated_at,
        }

    # ==========================================================
    # CASE-LEVEL REPORT
    # ==========================================================
    async def generate_case_report(
        self,
        user_id: str,
        case_id: str,
    ) -> Dict[str, Any]:
        """Generate a comprehensive case-level PDF report listing all evidence."""
        await self._check_permission(user_id, "REPORT_GENERATE")
        await self._check_case_access(user_id, case_id)

        case_result = await self.db.execute(
            select(Case).where(Case.id == case_id)
        )
        case = case_result.scalar_one_or_none()
        if not case:
            raise NotFoundError("Case not found")

        creator = None
        if case.created_by:
            c_result = await self.db.execute(
                select(User).where(User.id == case.created_by)
            )
            creator = c_result.scalar_one_or_none()

        supervisor = None
        if case.supervisor_id:
            s_result = await self.db.execute(
                select(User).where(User.id == case.supervisor_id)
            )
            supervisor = s_result.scalar_one_or_none()

        lead = None
        if case.lead_investigator_id:
            l_result = await self.db.execute(
                select(User).where(User.id == case.lead_investigator_id)
            )
            lead = l_result.scalar_one_or_none()

        members_result = await self.db.execute(
            select(CaseMember, User, Role)
            .join(User, CaseMember.user_id == User.id)
            .join(Role, User.role_id == Role.id)
            .where(CaseMember.case_id == case.id)
            .order_by(User.full_name)
        )
        members = [
            {
                "name": u.full_name,
                "email": u.email,
                "role": r.name,
                "assigned_at": m.assigned_at,
            }
            for m, u, r in members_result.all()
        ]

        ev_result = await self.db.execute(
            select(Evidence)
            .where(Evidence.case_id == case.id)
            .order_by(Evidence.created_at.asc())
        )
        evidence_items = ev_result.scalars().all()

        evidence_data = []
        for ev in evidence_items:
            collector = None
            if ev.collector_id:
                co_result = await self.db.execute(
                    select(User).where(User.id == ev.collector_id)
                )
                collector = co_result.scalar_one_or_none()

            verifier = None
            if ev.last_verified_by:
                v_result = await self.db.execute(
                    select(User).where(User.id == ev.last_verified_by)
                )
                verifier = v_result.scalar_one_or_none()

            evidence_data.append({
                "evidence_id": ev.evidence_id,
                "original_filename": ev.original_filename,
                "file_type": ev.file_type,
                "file_size": ev.file_size,
                "description": ev.description,
                "source_device": ev.source_device,
                "collection_date": ev.collection_date,
                "collector_name": collector.full_name if collector else "Unknown",
                "original_hash": ev.original_hash,
                "current_hash": ev.current_hash,
                "evidence_status": ev.evidence_status,
                "verified_status": ev.verified_status,
                "last_verified_at": ev.last_verified_at,
                "verifier_name": verifier.full_name if verifier else None,
                "created_at": ev.created_at,
            })

        generator_result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        generator = generator_result.scalar_one_or_none()

        report_id = generate_report_id()
        report_dir = Path(settings.REPORT_DIR)
        report_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{report_id}.pdf"
        file_path = report_dir / filename

        self._build_case_pdf(
            file_path=str(file_path),
            report_id=report_id,
            case=case,
            creator=creator,
            supervisor=supervisor,
            lead=lead,
            members=members,
            evidence_data=evidence_data,
            generator=generator,
        )

        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                sha256.update(chunk)
        report_hash = sha256.hexdigest()

        report = Report(
            report_id=report_id,
            case_id=case.id,
            evidence_id=None,
            report_type="CASE_SUMMARY",
            title=f"Case Summary Report - {case.case_number}",
            file_path=str(file_path),
            generated_by=user_id,
            hash=report_hash,
            metadata={
                "case_number": case.case_number,
                "evidence_count": len(evidence_data),
            },
        )
        self.db.add(report)
        await self.db.commit()

        return {
            "report_id": report_id,
            "case_id": str(case.id),
            "case_number": case.case_number,
            "evidence_count": len(evidence_data),
            "file_path": str(file_path),
            "hash": report_hash,
            "generated_at": report.generated_at,
        }

    # ==========================================================
    # EVIDENCE PDF BUILDER
    # ==========================================================
    def _build_evidence_pdf(
        self,
        file_path: str,
        report_id: str,
        evidence: Evidence,
        case: Optional[Case],
        collector: Optional[User],
        generator: Optional[User],
        custody_data: list,
    ) -> None:
        doc = SimpleDocTemplate(
            file_path,
            pagesize=LETTER,
            rightMargin=0.75 * inch,
            leftMargin=0.75 * inch,
            topMargin=0.75 * inch,
            bottomMargin=0.75 * inch,
        )

        styles = getSampleStyleSheet()

        title_style = ParagraphStyle(
            "Title", parent=styles["Heading1"],
            alignment=TA_CENTER,
            textColor=colors.HexColor("#1e40af"),
            fontSize=22, spaceAfter=6, leading=26,
        )
        subtitle_style = ParagraphStyle(
            "Subtitle", parent=styles["Normal"],
            alignment=TA_CENTER,
            textColor=colors.HexColor("#6b7280"),
            fontSize=11, spaceAfter=20, leading=14,
        )
        heading_style = ParagraphStyle(
            "CustomHeading", parent=styles["Heading2"],
            textColor=colors.HexColor("#1e40af"),
            fontSize=14, spaceBefore=14, spaceAfter=6, leading=17,
        )
        normal_style = ParagraphStyle(
            "NormalCustom", parent=styles["Normal"],
            fontSize=10, leading=14, spaceAfter=4,
        )
        small_style = ParagraphStyle(
            "Small", parent=styles["Normal"],
            fontSize=9, leading=12,
            textColor=colors.HexColor("#6b7280"),
        )
        code_style = ParagraphStyle(
            "Code", parent=styles["Normal"],
            fontName="Courier", fontSize=8, leading=11,
            textColor=colors.HexColor("#111827"),
            spaceAfter=4, wordWrap="CJK",
        )

        banner_heading_green = ParagraphStyle(
            "BannerGreen", parent=styles["Normal"],
            fontSize=16, leading=20, spaceAfter=6,
            textColor=colors.HexColor("#14532d"),
            fontName="Helvetica-Bold",
        )
        banner_heading_red = ParagraphStyle(
            "BannerRed", parent=styles["Normal"],
            fontSize=16, leading=20, spaceAfter=6,
            textColor=colors.HexColor("#7f1d1d"),
            fontName="Helvetica-Bold",
        )
        banner_heading_yellow = ParagraphStyle(
            "BannerYellow", parent=styles["Normal"],
            fontSize=16, leading=20, spaceAfter=6,
            textColor=colors.HexColor("#78350f"),
            fontName="Helvetica-Bold",
        )
        banner_body = ParagraphStyle(
            "BannerBody", parent=styles["Normal"],
            fontSize=10, leading=14,
        )

        cell_label = ParagraphStyle(
            "CellLabel", parent=styles["Normal"],
            fontSize=9, leading=12, fontName="Helvetica-Bold",
        )
        cell_value = ParagraphStyle(
            "CellValue", parent=styles["Normal"],
            fontSize=9, leading=12, wordWrap="CJK",
        )
        cell_value_small = ParagraphStyle(
            "CellValueSmall", parent=styles["Normal"],
            fontSize=8, leading=11, wordWrap="CJK",
        )

        elements = []

        elements.append(Paragraph("EvidenceLock", title_style))
        elements.append(Paragraph("Digital Evidence Integrity Report", subtitle_style))

        elements.append(Paragraph(f"<b>Report ID:</b> {report_id}", normal_style))
        elements.append(Paragraph(
            f"<b>Generated:</b> {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
            normal_style,
        ))
        elements.append(Paragraph(
            f"<b>Generated by:</b> {generator.full_name if generator else 'Unknown'}",
            normal_style,
        ))
        elements.append(Spacer(1, 20))

        if evidence.verified_status == "VERIFIED":
            bg = colors.HexColor("#dcfce7")
            heading_style_use = banner_heading_green
            heading_text = "INTEGRITY VERIFIED"
            body_text = (
                "The SHA-256 fingerprint calculated during the current verification "
                "matches the fingerprint recorded when the evidence was registered. "
                "The file has not been changed since it was registered."
            )
        elif evidence.verified_status == "VIOLATION":
            bg = colors.HexColor("#fee2e2")
            heading_style_use = banner_heading_red
            heading_text = "INTEGRITY VIOLATION DETECTED"
            body_text = (
                "The current SHA-256 fingerprint does NOT match the fingerprint "
                "recorded at registration. This indicates that the file contents "
                "have changed, or the stored file is no longer identical to the "
                "originally registered file."
            )
        else:
            bg = colors.HexColor("#fef3c7")
            heading_style_use = banner_heading_yellow
            heading_text = "PENDING VERIFICATION"
            body_text = (
                "This evidence has not yet been verified. Run integrity verification "
                "to compare the current SHA-256 fingerprint against the fingerprint "
                "recorded at registration."
            )

        banner_content = [
            [Paragraph(heading_text, heading_style_use)],
            [Paragraph(body_text, banner_body)],
        ]
        banner_table = Table(banner_content, colWidths=[6.5 * inch])
        banner_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), bg),
            ("BOX", (0, 0), (-1, -1), 1, colors.grey),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ]))
        elements.append(banner_table)
        elements.append(Spacer(1, 20))

        elements.append(Paragraph("Case Information", heading_style))
        case_rows = [
            [Paragraph("Case Number", cell_label), Paragraph(case.case_number if case else "-", cell_value)],
            [Paragraph("Case Title", cell_label), Paragraph(case.title if case else "-", cell_value)],
            [Paragraph("Status", cell_label), Paragraph(case.status if case else "-", cell_value)],
            [Paragraph("Classification", cell_label), Paragraph((case.classification or "-") if case else "-", cell_value)],
        ]
        case_table = Table(case_rows, colWidths=[1.6 * inch, 4.9 * inch])
        case_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f3f4f6")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        elements.append(case_table)
        elements.append(Spacer(1, 12))

        elements.append(Paragraph("Evidence Information", heading_style))
        evidence_rows = [
            [Paragraph("Evidence ID", cell_label), Paragraph(evidence.evidence_id, cell_value)],
            [Paragraph("Original Filename", cell_label), Paragraph(evidence.original_filename, cell_value)],
            [Paragraph("File Type", cell_label), Paragraph(evidence.file_type or "-", cell_value)],
            [Paragraph("File Size", cell_label), Paragraph(f"{evidence.file_size or 0} bytes", cell_value)],
            [Paragraph("Collection Date", cell_label), Paragraph(
                evidence.collection_date.strftime("%Y-%m-%d %H:%M:%S") if evidence.collection_date else "-",
                cell_value,
            )],
            [Paragraph("Collected By", cell_label), Paragraph(collector.full_name if collector else "-", cell_value)],
            [Paragraph("Source Device", cell_label), Paragraph(evidence.source_device or "-", cell_value)],
            [Paragraph("Description", cell_label), Paragraph(evidence.description or "-", cell_value)],
        ]
        evidence_table = Table(evidence_rows, colWidths=[1.6 * inch, 4.9 * inch])
        evidence_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f3f4f6")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        elements.append(evidence_table)
        elements.append(Spacer(1, 12))

        elements.append(Paragraph("Cryptographic Fingerprints (SHA-256)", heading_style))
        elements.append(Paragraph(
            "The SHA-256 hash is a cryptographic fingerprint. If even a single byte "
            "of the file changes, the fingerprint will change completely. This allows "
            "the system to detect any modification to the evidence.",
            small_style,
        ))
        elements.append(Spacer(1, 6))

        elements.append(Paragraph("<b>Original Hash (recorded at registration):</b>", normal_style))
        elements.append(Paragraph(evidence.original_hash, code_style))
        elements.append(Spacer(1, 4))

        if evidence.current_hash:
            elements.append(Paragraph("<b>Current Hash (at last verification):</b>", normal_style))
            elements.append(Paragraph(evidence.current_hash, code_style))

        if evidence.last_verified_at:
            elements.append(Paragraph(
                f"<b>Last Verified:</b> {evidence.last_verified_at.strftime('%Y-%m-%d %H:%M:%S')}",
                normal_style,
            ))
        elements.append(Spacer(1, 12))

        elements.append(Paragraph("Chain of Custody Timeline", heading_style))
        if custody_data:
            custody_rows = [[
                Paragraph("<b>Timestamp</b>", cell_value_small),
                Paragraph("<b>Action</b>", cell_value_small),
                Paragraph("<b>User</b>", cell_value_small),
                Paragraph("<b>Description</b>", cell_value_small),
            ]]
            for ev in custody_data:
                custody_rows.append([
                    Paragraph(ev["timestamp"].strftime("%Y-%m-%d %H:%M"), cell_value_small),
                    Paragraph(ev["action"], cell_value_small),
                    Paragraph(ev["user"], cell_value_small),
                    Paragraph(ev["description"], cell_value_small),
                ])
            custody_table = Table(
                custody_rows,
                colWidths=[1.2 * inch, 1.1 * inch, 1.3 * inch, 2.9 * inch],
                repeatRows=1,
            )
            custody_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e40af")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            elements.append(custody_table)
        else:
            elements.append(Paragraph("No custody events recorded.", normal_style))
        elements.append(Spacer(1, 12))

        elements.append(Paragraph("Plain Language Summary", heading_style))
        if evidence.verified_status == "VERIFIED":
            summary = (
                "The file registered as evidence has been verified. The SHA-256 "
                "fingerprint calculated during the most recent verification is "
                "identical to the fingerprint recorded when the evidence was "
                "first registered. This means the file contents have not been "
                "changed since registration."
            )
        elif evidence.verified_status == "VIOLATION":
            summary = (
                "The file registered as evidence has been modified. The current "
                "SHA-256 fingerprint does NOT match the fingerprint recorded at "
                "registration. This indicates the file contents have changed. "
                "The system cannot determine who made the change, but it can "
                "prove that a change occurred after registration."
            )
        else:
            summary = (
                "This evidence has not yet been verified. Run an integrity "
                "verification to determine whether the file has been changed "
                "since registration."
            )
        elements.append(Paragraph(summary, normal_style))
        elements.append(Spacer(1, 16))

        elements.append(Paragraph("Important Notice", heading_style))
        notice = (
            "This report is generated automatically by EvidenceLock. SHA-256 "
            "cryptographic fingerprints allow the system to detect whether a file "
            "has changed since it was registered. However, the system cannot "
            "determine who made the change. Hashing alone does not provide "
            "authenticity - it only detects changes. The chain-of-custody records "
            "in this report support investigation but are not a substitute for "
            "proper legal chain-of-custody procedures."
        )
        elements.append(Paragraph(notice, small_style))

        elements.append(Spacer(1, 30))
        elements.append(Paragraph(
            f"<i>Report generated by EvidenceLock v1.0.0 &nbsp;|&nbsp; {report_id}</i>",
            ParagraphStyle("Footer", parent=small_style, alignment=TA_CENTER),
        ))

        doc.build(elements)

    # ==========================================================
    # CASE PDF BUILDER
    # ==========================================================
    def _build_case_pdf(
        self,
        file_path: str,
        report_id: str,
        case: Case,
        creator: Optional[User],
        supervisor: Optional[User],
        lead: Optional[User],
        members: list,
        evidence_data: list,
        generator: Optional[User],
    ) -> None:
        doc = SimpleDocTemplate(
            file_path,
            pagesize=LETTER,
            rightMargin=0.6 * inch,
            leftMargin=0.6 * inch,
            topMargin=0.7 * inch,
            bottomMargin=0.7 * inch,
        )

        styles = getSampleStyleSheet()

        title_style = ParagraphStyle(
            "Title", parent=styles["Heading1"],
            alignment=TA_CENTER,
            textColor=colors.HexColor("#1e40af"),
            fontSize=22, spaceAfter=6, leading=26,
        )
        subtitle_style = ParagraphStyle(
            "Subtitle", parent=styles["Normal"],
            alignment=TA_CENTER,
            textColor=colors.HexColor("#6b7280"),
            fontSize=11, spaceAfter=20, leading=14,
        )
        heading_style = ParagraphStyle(
            "CustomHeading", parent=styles["Heading2"],
            textColor=colors.HexColor("#1e40af"),
            fontSize=14, spaceBefore=14, spaceAfter=6, leading=17,
        )
        normal_style = ParagraphStyle(
            "NormalCustom", parent=styles["Normal"],
            fontSize=10, leading=14, spaceAfter=4,
        )
        small_style = ParagraphStyle(
            "Small", parent=styles["Normal"],
            fontSize=9, leading=12,
            textColor=colors.HexColor("#6b7280"),
        )

        cell_label = ParagraphStyle(
            "CellLabel", parent=styles["Normal"],
            fontSize=9, leading=12, fontName="Helvetica-Bold",
        )
        cell_value = ParagraphStyle(
            "CellValue", parent=styles["Normal"],
            fontSize=9, leading=12, wordWrap="CJK",
        )
        cell_small = ParagraphStyle(
            "CellSmall", parent=styles["Normal"],
            fontSize=7, leading=10, wordWrap="CJK",
        )

        elements = []

        elements.append(Paragraph("EvidenceLock", title_style))
        elements.append(Paragraph("Case Summary Report", subtitle_style))

        elements.append(Paragraph(f"<b>Report ID:</b> {report_id}", normal_style))
        elements.append(Paragraph(
            f"<b>Generated:</b> {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}",
            normal_style,
        ))
        elements.append(Paragraph(
            f"<b>Generated by:</b> {generator.full_name if generator else 'Unknown'}",
            normal_style,
        ))
        elements.append(Spacer(1, 16))

        elements.append(Paragraph("Case Information", heading_style))
        case_rows = [
            [Paragraph("Case Number", cell_label), Paragraph(case.case_number, cell_value)],
            [Paragraph("Title", cell_label), Paragraph(case.title, cell_value)],
            [Paragraph("Description", cell_label), Paragraph(case.description or "-", cell_value)],
            [Paragraph("Status", cell_label), Paragraph(case.status, cell_value)],
            [Paragraph("Classification", cell_label), Paragraph(case.classification or "-", cell_value)],
            [Paragraph("Created By", cell_label), Paragraph(creator.full_name if creator else "-", cell_value)],
            [Paragraph("Supervisor", cell_label), Paragraph(supervisor.full_name if supervisor else "-", cell_value)],
            [Paragraph("Lead Investigator", cell_label), Paragraph(lead.full_name if lead else "-", cell_value)],
            [Paragraph("Created", cell_label), Paragraph(case.created_at.strftime('%Y-%m-%d %H:%M:%S') if case.created_at else "-", cell_value)],
        ]
        case_table = Table(case_rows, colWidths=[1.6 * inch, 5.5 * inch])
        case_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f3f4f6")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(case_table)
        elements.append(Spacer(1, 12))

        elements.append(Paragraph(f"Team Members ({len(members)})", heading_style))
        if members:
            member_rows = [[
                Paragraph("<b>Name</b>", cell_value),
                Paragraph("<b>Email</b>", cell_value),
                Paragraph("<b>Role</b>", cell_value),
            ]]
            for m in members:
                member_rows.append([
                    Paragraph(m["name"], cell_value),
                    Paragraph(m["email"], cell_small),
                    Paragraph(m["role"].replace("_", " "), cell_small),
                ])
            member_table = Table(
                member_rows,
                colWidths=[1.8 * inch, 3.3 * inch, 2.0 * inch],
                repeatRows=1,
            )
            member_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e40af")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]))
            elements.append(member_table)
        else:
            elements.append(Paragraph("No team members assigned.", small_style))
        elements.append(Spacer(1, 12))

        elements.append(Paragraph(
            f"Evidence Inventory ({len(evidence_data)} item{'s' if len(evidence_data) != 1 else ''})",
            heading_style,
        ))

        verified_count = sum(1 for e in evidence_data if e["verified_status"] == "VERIFIED")
        violation_count = sum(1 for e in evidence_data if e["verified_status"] == "VIOLATION")
        unverified_count = len(evidence_data) - verified_count - violation_count

        summary_text = (
            f"<b>Verified:</b> {verified_count} &nbsp;&nbsp; "
            f"<b>Violations:</b> {violation_count} &nbsp;&nbsp; "
            f"<b>Unverified:</b> {unverified_count}"
        )
        elements.append(Paragraph(summary_text, normal_style))
        elements.append(Spacer(1, 8))

        if evidence_data:
            ev_rows = [[
                Paragraph("<b>Evidence ID</b>", cell_small),
                Paragraph("<b>Filename</b>", cell_small),
                Paragraph("<b>Type</b>", cell_small),
                Paragraph("<b>Size</b>", cell_small),
                Paragraph("<b>Collected</b>", cell_small),
                Paragraph("<b>Status</b>", cell_small),
                Paragraph("<b>Original Hash</b>", cell_small),
                Paragraph("<b>Current Hash</b>", cell_small),
            ]]
            for ev in evidence_data:
                status_color = "#10b981"
                if ev["verified_status"] == "VIOLATION":
                    status_color = "#ef4444"
                elif ev["verified_status"] != "VERIFIED":
                    status_color = "#f59e0b"

                status_text = ev["verified_status"] or ev["evidence_status"]

                size_str = f"{ev['file_size'] or 0} B"
                if ev["file_size"] and ev["file_size"] > 1024 * 1024:
                    size_str = f"{(ev['file_size'] / (1024 * 1024)):.1f} MB"
                elif ev["file_size"] and ev["file_size"] > 1024:
                    size_str = f"{(ev['file_size'] / 1024):.1f} KB"

                collection_str = (
                    ev["collection_date"].strftime('%Y-%m-%d %H:%M')
                    if ev["collection_date"] else "-"
                )

                ev_rows.append([
                    Paragraph(ev["evidence_id"], cell_small),
                    Paragraph(ev["original_filename"], cell_small),
                    Paragraph((ev["file_type"] or "-")[:8], cell_small),
                    Paragraph(size_str, cell_small),
                    Paragraph(collection_str, cell_small),
                    Paragraph(
                        f'<font color="{status_color}">{status_text}</font>',
                        cell_small,
                    ),
                    Paragraph(ev["original_hash"][:16] + "...", cell_small),
                    Paragraph(
                        (ev["current_hash"][:16] + "...") if ev["current_hash"] else "-",
                        cell_small,
                    ),
                ])
            ev_table = Table(
                ev_rows,
                colWidths=[0.85 * inch, 1.35 * inch, 0.45 * inch, 0.5 * inch,
                           0.85 * inch, 0.7 * inch, 0.9 * inch, 0.9 * inch],
                repeatRows=1,
            )
            ev_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e40af")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]))
            elements.append(ev_table)

            elements.append(Spacer(1, 16))
            elements.append(Paragraph("Detailed Evidence Records", heading_style))

            for idx, ev in enumerate(evidence_data, 1):
                elements.append(Paragraph(
                    f"<b>{idx}. {ev['evidence_id']}</b> - {ev['original_filename']}",
                    normal_style,
                ))
                elements.append(Paragraph(
                    f"Collected by <b>{ev['collector_name']}</b> on "
                    f"<b>{ev['collection_date'].strftime('%Y-%m-%d %H:%M:%S') if ev['collection_date'] else '-'}</b>",
                    small_style,
                ))
                if ev["description"]:
                    elements.append(Paragraph(f"Description: {ev['description']}", small_style))
                if ev["source_device"]:
                    elements.append(Paragraph(f"Source Device: {ev['source_device']}", small_style))

                elements.append(Paragraph(
                    f"Original SHA-256: <font face='Courier' size='7'>{ev['original_hash']}</font>",
                    small_style,
                ))
                if ev["current_hash"] and ev["current_hash"] != ev["original_hash"]:
                    elements.append(Paragraph(
                        f"Current SHA-256: <font face='Courier' size='7' color='#ef4444'>{ev['current_hash']}</font>",
                        small_style,
                    ))
                elements.append(Paragraph(
                    f"Integrity: <b>{ev['verified_status'] or 'Not yet verified'}</b> "
                    f"(last checked: {ev['last_verified_at'].strftime('%Y-%m-%d %H:%M') if ev['last_verified_at'] else 'never'})",
                    small_style,
                ))
                elements.append(Spacer(1, 8))
        else:
            elements.append(Paragraph("No evidence registered for this case.", small_style))

        elements.append(Spacer(1, 16))
        elements.append(Paragraph("Chain of Custody", heading_style))
        elements.append(Paragraph(
            "Full chain-of-custody events for each evidence item are available "
            "in the evidence integrity report and in the EvidenceLock system. "
            "Each custody event is hash-chained for tamper-evidence.",
            small_style,
        ))

        elements.append(Spacer(1, 16))
        elements.append(Paragraph("Important Notice", heading_style))
        notice = (
            "This report is generated automatically by EvidenceLock. The SHA-256 "
            "fingerprints shown allow the system to detect whether any evidence file "
            "has changed since it was registered. The system cannot determine who "
            "made any change. The chain-of-custody records support investigation "
            "but are not a substitute for proper legal chain-of-custody procedures."
        )
        elements.append(Paragraph(notice, small_style))

        elements.append(Spacer(1, 24))
        elements.append(Paragraph(
            f"<i>Report generated by EvidenceLock v1.0.0 &nbsp;|&nbsp; {report_id}</i>",
            ParagraphStyle("Footer", parent=small_style, alignment=TA_CENTER),
        ))

        doc.build(elements)