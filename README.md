# EvidenceLock

**Digital Evidence Integrity & Chain-of-Custody System**

EvidenceLock is a full-stack web application for law-enforcement and forensic teams
to register digital evidence, prove that it has not been tampered with, track every
transfer, and produce court-ready integrity reports.

Every file registered in EvidenceLock is fingerprinted with SHA-256. Every custody
event is hash-chained. Every download/return is verified server-side. If a single
byte of an evidence file changes, the system can prove it.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Default Credentials](#default-credentials)
- [API](#api)
- [Security Model](#security-model)
- [Project Structure](#project-structure)
- [License](#license)

---

## Features

### Core integrity workflow
- **Evidence registration** with automatic SHA-256 fingerprinting
- **Integrity verification** - one-click hash comparison against the original
- **Tamper detection** - any byte change produces a completely different hash
- **Bulk integrity check** across all evidence in the system

### Chain of custody
- **Hash-chained custody events** - every transfer links to the previous event's hash
- **Tamper-evident chain** - verification endpoint detects any break in the chain
- **Full timeline** per evidence item

### Tamper enforcement
- **Sticky violations** - once flagged, a violation cannot be cleared by
  re-checking the disk. Every later verify reports `VIOLATION ON RECORD`
- **Blocked downloads** - downloads and new access requests are refused for
  compromised evidence until an administrator resolves the case
- **Preserved artifacts** - the tampered returned file is stored under
  `uploads/returned/` and its hash is recorded on the access request
- **System-wide visibility** - every user sees the `TAMPERED` badge in the
  Evidence Registry, Integrity Check, and Evidence Detail pages

### Access control
- **Invite-only user onboarding** with administrator approval
- **6 roles**: System Administrator, Supervisor, Lead Investigator, Investigator, Auditor, Judge
- **19 granular permissions** enforced on every endpoint
- **JWT authentication** with refresh tokens
- **MFA** (TOTP) enrollment and verification

### Access request workflow
- Investigators **request** access to evidence with a reason
- Supervisors / Admins **review and approve or deny**
- Approved investigators **download** the file (state recorded)
- Investigator **returns** the file - system stores it as an artifact and computes its SHA-256
- **Server-side verification** compares returned hash to original
- Result is `VERIFIED` or `VIOLATION` - the client cannot influence the outcome

### Case management
- Create cases with classification levels (Unclassified to Top Secret)
- Assign **Supervisor** and **Lead Investigator** (auto-added as members)
- **Close and reopen** cases with an **evidence-out guard** - cannot close a case
  while any evidence is still checked out to an investigator

### Offline field collection
- **Field Mode** lets investigators collect evidence while offline
- Files are hashed locally with the Web Crypto API (same SHA-256 as the server)
- Field token is scoped, device-bound, and expires in 24 hours
- On sync, the server recomputes hashes and rejects any mismatch
- Two custody events are written: `COLLECTED_OFFLINE` (claimed time) and
  `SYNCED_TO_SERVER` (authoritative server time)

### Reports
- **Evidence Integrity Report** (PDF) - full metadata, hashes, custody timeline, plain-language summary
- **Case Summary Report** (PDF) - all evidence in a case with hash comparison and integrity status
- Reports list with **filter tabs** (All / Case / Evidence)
- Every report is itself hashed

### Audit
- **Hash-chained audit log** of every state-changing action
- **Chain verification** endpoint detects tampering

### Self-service profile
- Users can edit their own name, username, and password
- Email changes require administrator approval (audited)
- MFA enrollment and disable from the profile page

---

## Tech Stack

**Backend**
- Python 3.12
- FastAPI (async)
- SQLAlchemy 2.x (async ORM)
- PostgreSQL 15+
- Pydantic v2
- Alembic (schema migrations)
- Python-JOSE (JWT)
- Passlib + Argon2id (password hashing)
- pyotp (MFA)
- ReportLab (PDF generation)

**Frontend**
- React 18
- TypeScript
- Vite
- React Router v6
- Axios
- Tailwind CSS
- React Hot Toast
- IndexedDB (offline field queue)

---

## Architecture

+-------------------+ HTTPS +----------------------+
| | <-----------------> | |
| React Frontend | JWT in header | FastAPI Backend |
| (Vite, :3000) | | (Uvicorn, :8000) |
| | | |
+-------------------+ +----------+-----------+
|
| Async SQLAlchemy
|
v
+----------------------+
| PostgreSQL 15 |
| |
| users, roles, |
| permissions, |
| cases, evidence, |
| custody_events, |
| access_requests, |
| reports, audit_logs,|
| field_devices |
+----------------------+
|
|
+----------+-----------+
| |
| Local file storage |
| uploads/ |
| uploads/returned/ |
| reports/ |
| |
+----------------------+


**Request flow (typical):**
1. Client logs in -> receives JWT access token + refresh token
2. Client calls any API -> token in `Authorization: Bearer` header
3. Auth middleware validates the token and puts `user_id` on `request.state`
4. Route handler calls the service layer
5. Service checks the required permission for the user's role
6. Service reads/writes the DB and (for evidence) computes SHA-256 on file
7. Every state change writes an audit log entry with hash chain

---

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- PostgreSQL 15+
- Windows / macOS / Linux

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd evidencelock

CREATE DATABASE evidencelock;

cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux

pip install -r requirements.txt
copy .env.example .env         # Windows
# cp .env.example .env         # macOS / Linux

# Start the backend:

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend setup

cd frontend
npm install
npm run dev

# Search this in your browser 

http://localhost:3000