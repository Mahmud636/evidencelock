# Project Structure

A complete map of the EvidenceLock codebase.

---

## Root
evidencelock/
|-- .gitignore
|-- LICENSE
|-- README.md
|-- PROJECT_STRUCTURE.md
|-- backend/
|-- docs/
`-- frontend/

---

## Backend (`backend/`)

FastAPI application. Every HTTP endpoint delegates to a service; every service
enforces permissions and business rules.

backend/
|-- .env.example
|-- requirements.txt
-- app/ |-- __init__.py |-- config.py # Settings loaded from .env |-- database.py # SQLAlchemy async engine + Base |-- main.py # FastAPI app + router registration | |-- api/ | |-- __init__.py |-- v1/
| |-- init.py
| |-- access_requests.py # Request / approve / download / return / verify
| |-- audit.py # Audit log + chain verification
| |-- auth.py # Login, refresh, MFA
| |-- cases.py # Cases, members, close/reopen
| |-- custody.py # Chain-of-custody events
| |-- dashboard.py # Live stats
| |-- evidence.py # Register / verify / list
| |-- field.py # Offline field collection
| |-- reports.py # PDF generation + download
| -- users.py # Invite, approve, profile, roles | |-- exceptions/ | |-- __init__.py |-- errors.py # AuthorizationError, NotFoundError, etc.
|
|-- middleware/
| |-- init.py
| -- auth.py # JWT decode + request.state.user_id | |-- models/ # SQLAlchemy 2.x mapped classes | |-- __init__.py | |-- access_request.py # EvidenceAccessRequest | |-- audit.py # AuditLog (hash-chained) | |-- case.py # Case + CaseMember | |-- custody.py # CustodyEvent (hash-chained) | |-- evidence.py # Evidence | |-- field_device.py # FieldDevice (offline collection) | |-- mfa.py # MFAConfig | |-- report.py # Report |-- user.py # User, Role, Permission, RolePermission
|
|-- schemas/ # Pydantic v2 request/response models
| |-- init.py
| |-- access_request.py
| |-- auth.py
| |-- case.py
| |-- evidence.py
| |-- field.py
| -- user.py | |-- services/ # Business logic + permission checks | |-- __init__.py | |-- access_request_service.py # Download / return / verify workflow | |-- auth_service.py # Login, MFA enrollment, token refresh | |-- case_service.py # Case CRUD, team management, closure | |-- evidence_service.py # Register, verify, tamper handling | |-- field_service.py # Field token issuance + sync ingest | |-- report_service.py # PDF generation (evidence + case) |-- user_service.py # Invite, approve, profile, roles
|
-- utils/ |-- __init__.py-- security.py # Password hashing, JWT, encryption, MFA


---

## Frontend (`frontend/`)

React 18 + TypeScript + Vite single-page application.

frontend/
|-- .env.example
|-- index.html
|-- package.json
|-- package-lock.json
|-- postcss.config.js
|-- tailwind.config.js
|-- tsconfig.json
|-- tsconfig.node.json
|-- vite.config.ts
|
|-- public/
| -- favicon.ico |-- src/
|-- App.tsx # Route definitions
|-- index.css # Global styles (dark theme)
|-- main.tsx # React entry point
|-- vite-env.d.ts
|
|-- components/
| |-- auth/
| | |-- Login.tsx
| | |-- MFAEnrollment.tsx
| | |-- MFAVerification.tsx
| | -- Register.tsx |-- common/
| |-- Layout.tsx
| |-- Navbar.tsx
| |-- ProtectedRoute.tsx
| -- Sidebar.tsx | |-- contexts/ |-- AuthContext.tsx # Current user + token management
|
|-- hooks/
| |-- useApi.ts
| -- useAuth.ts | |-- pages/ | |-- AccessRequests.tsx # Request workflow | |-- AuditLog.tsx | |-- CaseDetail.tsx # Case view + team + reports | |-- Cases.tsx | |-- ChainOfCustody.tsx # Timeline + chain verification | |-- CreateCase.tsx | |-- Dashboard.tsx # System overview + live stats | |-- Evidence.tsx # Evidence registry | |-- EvidenceDetail.tsx # Single evidence view + tamper banner | |-- FieldCollection.tsx # Offline field mode UI | |-- IntegrityCheck.tsx # Bulk verification | |-- InviteUser.tsx | |-- PendingApprovals.tsx | |-- Profile.tsx # Self-service profile editing | |-- RegisterEvidence.tsx | |-- Reports.tsx # Report list + filter tabs |-- Users.tsx # Admin user management
|
|-- services/ # Typed API clients
| |-- accessRequests.ts
| |-- api.ts # Axios wrapper (interceptors, auth)
| |-- audit.ts
| |-- auth.ts
| |-- cases.ts
| |-- custody.ts
| |-- dashboard.ts
| |-- evidence.ts
| |-- field.ts
| |-- reports.ts
| -- users.ts | |-- types/ |-- index.ts
|
-- utils/ |-- fieldStorage.ts # IndexedDB wrapper for offline queue-- hash.ts # SHA-256 in the browser (Web Crypto)


---

## Docs (`docs/`)

docs/
|-- ARCHITECTURE.md # System components + data flows
|-- FEATURES.md # Role-by-role feature walkthrough
|-- HACKATHON_WRITEUP.md # 4-page technical write-up
|-- OFFLINE_COLLECTION.md # Field mode design + 4 hard problems
|-- TAMPER_HANDLING.md # Sticky violations + enforcement
`-- WRITEUP.md # Long-form narrative write-up


---

## File count summary

| Area | Files |
|------|-------|
| Backend — API routes | 10 |
| Backend — Models | 9 |
| Backend — Schemas | 6 |
| Backend — Services | 7 |
| Backend — Utils / Middleware / Config | 10 |
| Backend — `__init__.py` files | 9 |
| **Backend subtotal** | **~51** |
| Frontend — Pages | 17 |
| Frontend — Components | 8 |
| Frontend — Services | 11 |
| Frontend — Contexts / Hooks | 3 |
| Frontend — Utils | 2 |
| Frontend — Config / Entry | 10 |
| **Frontend subtotal** | **~51** |
| Docs | 6 |
| Root | 4 |
| **Total** | **~112** |

---

## Where things live

| Concern | Location |
|---------|----------|
| HTTP routes | `backend/app/api/v1/*.py` |
| Business logic | `backend/app/services/*.py` |
| Permission checks | `backend/app/services/*.py` (each service) |
| Database schema | `backend/app/models/*.py` |
| Request/response shapes | `backend/app/schemas/*.py` |
| JWT + password + MFA helpers | `backend/app/utils/security.py` |
| Auth middleware | `backend/app/middleware/auth.py` |
| Frontend routes | `frontend/src/App.tsx` |
| API clients | `frontend/src/services/*.ts` |
| Offline collection state | `frontend/src/utils/fieldStorage.ts` |
| Client-side hashing | `frontend/src/utils/hash.ts` |

---

## File storage layout (runtime)

These folders are **not** in the repository — they are created at runtime and
excluded via `.gitignore`:

backend/
|-- uploads/ # Original evidence files (immutable)
| |-- EVID-2026-XXXXXX.mp4
| |-- EVID-2026-YYYYYY.pdf
| -- returned/ # Returned files preserved as artifacts |-- REQ-2026-XXXXXX_CCTV.mp4
|-- reports/ # Generated PDF reports
| |-- RPT-2026-XXXXXXXX.pdf
| -- RPT-2026-YYYYYYYY.pdf |-- logs/-- .env # Local config (secrets)


---

*This file is a map, not an installation guide. For setup instructions, see
[README.md](README.md).*