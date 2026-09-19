# Architecture

This document describes how EvidenceLock is structured and how the key operations flow.

---

## Components

### Frontend (React + TypeScript)

- **Vite** dev server proxies API calls to `http://localhost:8000`
- **AuthContext** holds the current user; token stored in `localStorage`
- **axios** interceptor attaches `Authorization: Bearer <token>` to every request
- **401 handling**: automatic refresh attempt, then redirect to login
- **Pages** map 1:1 to API resources (cases, evidence, custody, etc.)
- **Services layer** (`src/services/*.ts`) wraps every API call in a typed function
- **IndexedDB** (via `src/utils/fieldStorage.ts`) stores the offline collection queue

### Backend (FastAPI + SQLAlchemy async)

- **Auth middleware** runs on every request, decodes the JWT, and stores `user_id` on `request.state`
- **Routers** in `app/api/v1/` handle HTTP and delegate to services
- **Services** in `app/services/` contain all business logic and permission checks
- **Models** in `app/models/` are SQLAlchemy 2.x mapped classes
- **Schemas** in `app/schemas/` are Pydantic v2 validation models

### Database (PostgreSQL)

The core tables:

| Table                      | Purpose                                        |
|----------------------------|------------------------------------------------|
| `users`                    | Accounts (invited / approved)                  |
| `roles`                    | 6 roles                                        |
| `permissions`              | 19 permissions                                 |
| `role_permissions`         | Many-to-many mapping                           |
| `cases`                    | Cases with supervisor / lead / closed_at       |
| `case_members`             | Case <-> user membership                       |
| `evidence`                 | Registered evidence with SHA-256               |
| `custody_events`           | Hash-chained custody trail                     |
| `evidence_access_requests` | Request / approve / download / return / verify |
| `reports`                  | Generated PDFs with hash                       |
| `audit_logs`               | Hash-chained audit trail                       |
| `field_devices`            | Authorized offline collection devices          |

### File storage

- `uploads/` - original evidence files (never overwritten)
- `uploads/returned/` - returned files preserved as forensic artifacts
- `reports/` - generated PDF reports

The DB stores the SHA-256 hash of every file.

---

## Data flow

### 1. Evidence registration

User uploads file
|
v
Backend receives multipart
|
v
Compute SHA-256 (streaming, 64 KB chunks)
|
v
Store file on disk at uploads/<evidence_id>.<ext>
|
v
INSERT evidence (original_hash = computed)
|
v
INSERT custody_event (action = REGISTERED)
|
v
INSERT audit_log (event = EVIDENCE_CREATED)
|
v
Return evidence metadata


### 2. Integrity verification

User clicks "Verify"
|
v
Backend loads evidence.file_path
|
v
Recompute SHA-256 from disk
|
v
Compare to evidence.original_hash
|
v
Check for any prior VIOLATION on record (sticky)
|
v
Update evidence.current_hash and verified_status
|
v
INSERT custody_event (action = VERIFIED or INTEGRITY_VIOLATION)
|
v
Return result


### 3. Access request lifecycle

Investigator requests access
|
v
status = PENDING -> audit log
|
v
Admin/Supervisor approves
|
v
status = APPROVED
|
v
Investigator downloads
|
v
status = DOWNLOADED; custody_event DOWNLOADED with hash-at-download
|
v
Investigator returns file (uploads it back)
|
v
Backend stores file at uploads/returned/<req-id>_<filename>
|
v
Backend computes SHA-256 of the returned file
|
v
status = RETURNED
|
v
Admin/Supervisor clicks Verify
|
v
Server compares return_hash to original_hash
|
v
status = VERIFIED or VIOLATION
|
v
custody_event VERIFIED or INTEGRITY_VIOLATION


**Key security property:** the server always recomputes the comparison from
the stored hashes. The client's `verified` flag is ignored.

### 4. Case closure

Admin/Supervisor clicks "Close Case"
|
v
Server queries evidence_access_requests
WHERE case_id = X AND status = 'DOWNLOADED'
|
v
If any exist -> return 409 with list of blocking request IDs
|
v
Else -> status = CLOSED, closed_at = now()
|
v
Audit log event = CASE_CLOSED


### 5. Hash chaining

Every custody event stores:

previous_hash = current_hash of the prior event
current_hash = SHA256({
evidence_id,
action,
user_id,
previous_hash,
metadata
})


To verify the chain: walk all events in order, recompute each `current_hash`,
ensure each one's `previous_hash` matches the previous event's `current_hash`.

Any retroactive edit breaks the chain.

Same scheme for `audit_logs`.

### 6. Offline field collection

Online (at HQ):
Investigator enables Field Mode
|
v
Backend creates field_devices row
|
v
Backend issues scoped JWT (24h, device-bound)
|
v
Browser stores token in IndexedDB

Offline (at scene):
Investigator opens Field Collection page
|
v
File selected -> browser computes SHA-256 via Web Crypto
|
v
File + hash stored in IndexedDB queue
|
v
No network calls made

Back online (back at HQ):
Investigator clicks "Sync Now"
|
v
Multipart POST to /api/v1/field/sync

X-Field-Token header (NOT Authorization)

manifest JSON

files
|
v
Server validates field token (scope + device binding + expiry)
|
v
Server recomputes SHA-256 of each file
|
v
Compares to declared hash
|
v
Creates evidence + TWO custody events:

COLLECTED_OFFLINE (claimed local time)

SYNCED_TO_SERVER (authoritative server time)


---

## Security properties

| Property                     | How it's enforced                                 |
|------------------------------|---------------------------------------------------|
| Confidentiality of passwords | Argon2id hashing                                  |
| Session security             | JWT with short expiry + refresh token             |
| Multi-factor auth            | TOTP (RFC 6238) via pyotp                         |
| Authorization                | Per-endpoint permission check on every request    |
| Tamper detection             | SHA-256 fingerprinting of every evidence file     |
| Sticky violations            | Once set, cannot be cleared by later disk checks  |
| Blocked downloads            | HTTP 409 for compromised evidence on all users    |
| Non-repudiation of custody   | Hash-chained custody events with user_id + time   |
| Non-repudiation of actions   | Hash-chained audit log                            |
| Server-side truth            | Verification always recomputed on the server      |
| Closure safety               | Guard against closing a case with evidence out    |
| Field token scope            | Middleware rejects field tokens used as sessions  |

---

## Tamper enforcement

When evidence is flagged as compromised, the system enforces the following
guarantees:

- **Sticky violation** - once recorded, a violation cannot be cleared by a
  later disk check. Every subsequent verify returns `VIOLATION ON RECORD`.
- **Preserved returned file** - the actual returned file is stored at
  `uploads/returned/<request_id>_<filename>` and its path is recorded on the
  access request row.
- **Blocked downloads** - new access requests and downloads return HTTP 409
  for compromised evidence.
- **System-wide visibility** - every user sees the `TAMPERED` badge in the
  Evidence Registry, Integrity Check, and Evidence Detail pages.

See [TAMPER_HANDLING.md](TAMPER_HANDLING.md) for the full design.

---

## What this system does **not** do

- **It does not prove who changed a file.** Hashing detects change; it cannot
  attribute it. Attribution comes from the custody trail and audit log.
- **It does not encrypt evidence at rest.** Files are stored as-is. Encryption
  would be a separate concern.
- **It does not provide an external timestamp authority.** For legal-grade
  non-repudiation you would timestamp hashes against a trusted external source
  (e.g., RFC 3161 TSA).
- **It does not auto-notify on violations.** No email or push. A future version
  could add this.
- **It does not replace legal chain-of-custody procedures.** The digital trail
  supports and documents those procedures; it is not a substitute.