# Features

A role-by-role walkthrough of what EvidenceLock does.

---

## Roles

| Role                  | Level | Can do                                                             |
|-----------------------|-------|--------------------------------------------------------------------|
| SYSTEM_ADMINISTRATOR  | 1     | Everything; approve users; manage roles                            |
| SUPERVISOR            | 2     | Review requests; assign team; close/reopen cases; verify returns   |
| LEAD_INVESTIGATOR     | 3     | Create cases; register evidence; generate reports; invite users    |
| INVESTIGATOR          | 4     | Request access to evidence; download; return; collect offline      |
| AUDITOR               | 5     | Read-only; view audit log, custody chains, verify integrity        |
| JUDGE                 | 6     | Read-only; generate and download case reports for assigned cases   |

---

## Authentication

- **Register**: invitation-only (no public sign-up)
- **Login**: email + password
- **MFA**: TOTP enrollment with QR code, verification on login
- **Session**: JWT access token (30 min) + refresh token (7 days)

---

## Case Management

### Create a case
- Case number (auto-generate or type)
- Title, description, classification (Unclassified to Top Secret)
- Optionally assign a **Supervisor** and **Lead Investigator**
- Assigned users are automatically added as case members

### Assign team
- Admin or Supervisor can assign/change supervisor and lead
- Add or remove individual team members through the Team Members panel
- Auto-adds the user as a member; the creator cannot be removed

### Close a case
- Admin or Supervisor only
- **Guard:** cannot close while any evidence is still checked out
- Blocked closure lists the outstanding request IDs

### Reopen a case
- Admin or Supervisor only
- Clears `closed_at`, restores `ACTIVE` status

---

## Evidence Management

### Register evidence
- Upload any file (video, image, document, archive)
- Add metadata: description, source device, collection date, collector
- System computes SHA-256 as the file streams to disk

### Integrity verification
- **Per-item:** one-click verify on the evidence detail page
- **Bulk:** verify every evidence item at once
- **Result states:**
  - `VERIFIED` - hash matches original
  - `VIOLATION` - hash differs (file modified)
  - `PENDING` - never verified

### Tamper detection
- Modify any byte of the stored file on disk
- Run verification -> system reports `VIOLATION`
- The original hash is preserved; the current hash is red-flagged

---

## Chain of Custody

Every action on an evidence item produces a custody event:
- `REGISTERED`
- `VIEWED`
- `DOWNLOADED`
- `RETURNED`
- `VERIFIED`
- `INTEGRITY_VIOLATION`
- `COLLECTED_OFFLINE` (offline field collection)
- `SYNCED_TO_SERVER` (offline field collection)

Each event includes:
- Timestamp
- User (name + ID)
- Action
- Description
- **Previous hash** (of the prior event)
- **Current hash** (of this event, computed over its own fields)

**Chain verification** endpoint walks the entire chain and reports whether
any link is broken.

---

## Access Requests

| Status      | Meaning                                                  |
|-------------|----------------------------------------------------------|
| PENDING     | Investigator requested, awaiting review                  |
| APPROVED    | Supervisor approved, investigator may download           |
| DENIED      | Supervisor denied                                        |
| DOWNLOADED  | Investigator has the file; must return it                |
| RETURNED    | Investigator returned the file; awaiting verification    |
| VERIFIED    | Server confirmed the returned hash matches the original  |
| VIOLATION   | Server detected the returned hash does NOT match         |

### The workflow

1. **Investigator** opens an evidence item, clicks **Request Download**, provides a reason
2. **Supervisor** reviews the request, approves or denies with an optional note
3. **Investigator** downloads the file - system records the hash-at-download
4. **Investigator** finishes their analysis and returns the file
5. **Supervisor** clicks **Verify Now** - the server recomputes the hash comparison
6. Result is `VERIFIED` or `VIOLATION`

**Security:** the client cannot influence step 6. Even if a compromised
frontend sends `verified: true`, the server always recomputes from the hashes.

### What happens when a return is tampered with

If the returned file does not match the registered original:

1. The access request status becomes `VIOLATION`
2. The evidence is flagged `TAMPERED`
3. The actual returned file is preserved at `uploads/returned/`
4. Future downloads and new access requests are **blocked** for all users
5. The Evidence Registry, Integrity Check, and Evidence Detail pages all show a
   red TAMPERED badge and warning banner for every user
6. The violation is **sticky** - re-verifying the disk original does NOT clear it

See [TAMPER_HANDLING.md](TAMPER_HANDLING.md) for the full design.

---

## Offline Field Collection

### Enable Field Mode
- Investigator logs in normally while online
- Clicks **Enable Field Mode (24h)** on the Field Collection page
- Server issues a scoped, device-bound JWT valid for 24 hours
- Token is stored in IndexedDB (survives page reloads; not stored in `localStorage`)

### Collect offline
- Open the Field Collection page; select a case
- Drag and drop files (or click to browse)
- Each file is hashed locally with `crypto.subtle.digest('SHA-256', ...)`
- Files and hashes are queued in IndexedDB
- No network requests are made until you click Sync

### Sync
- Click **Sync Now** when back online
- Browser sends manifest + files in a multipart POST to `/api/v1/field/sync`
- Server recomputes each file's SHA-256 and compares to the declared hash
- If they match -> evidence created with two custody events:
  - `COLLECTED_OFFLINE` (records the claimed local time)
  - `SYNCED_TO_SERVER` (records the authoritative server time)
- If they do NOT match -> evidence flagged as VIOLATION

### Device management
- Each device gets a stable UUID stored in `localStorage`
- Devices can be listed and revoked from the Field Collection page
- Revoked devices immediately fail token validation on the next sync

See [OFFLINE_COLLECTION.md](OFFLINE_COLLECTION.md) for the full design.

---

## Reports

### Evidence Integrity Report (per evidence item)
- Case info
- Evidence metadata (filename, type, size, collector, source device)
- Original + current SHA-256
- Chain-of-custody timeline (all events)
- Plain-language integrity summary
- IMPORTANT NOTICE about what the system can and cannot prove

### Case Summary Report (per case)
- Case info (number, title, status, classification, dates)
- Team members
- Evidence inventory table (all items with status + hashes)
- Integrity summary counts
- Detailed records for each evidence item
- Important notice

### Reports page
- Lists all reports you have access to
- **Filter tabs:** All / Case / Evidence
- **Type badges** (blue = case, green = evidence)
- Download any report as PDF

---

## Self-Service Profile

### Edit profile
- Change your full name and username (applied immediately)
- Request an email change (requires administrator approval)

### Change password
- Requires current password
- Enforces 12+ chars with mixed case, digit, and symbol
- Live strength meter shows which requirements you've met

### Pending email changes
- If you request an email change, an amber banner appears on your profile
- Admin sees the pending change in the Users page with Approve / Reject buttons
- Approved -> email updates, audit log records who approved
- Rejected -> pending request cleared, old email retained

### MFA
- Enable MFA from the profile page (links to the enrollment page)
- Disable MFA requires a valid TOTP code

---

## Audit

Every state-changing action creates an audit log entry with:
- Event type (`CASE_CREATED`, `EVIDENCE_REGISTERED`, `ACCESS_REQUEST_APPROVED`, etc.)
- User
- Resource (case / evidence / user)
- Action
- Details (JSON)
- Hash chain (previous + current)

**Verify chain** endpoint walks the entire audit log and reports whether
any entry has been tampered with.

---

## Dashboard

- Total cases, evidence, users
- Evidence integrity breakdown:
  - **Compromised Items** (evidence currently in VIOLATION state)
  - **Violation Events** (historical count of all failed checks)
- Recent activity
- Recent custody events

---

## User Management (Admin only)

- **Invite user** - set email, username, full name, role
- **Approve / reject** pending users
- **Change role**
- **Deactivate / activate** users
- **Approve / reject email change requests**

**Invitation flow:**
1. Admin/Lead invites -> temporary password generated
2. New user is created with `is_approved = false`
3. Admin approves -> user can log in
4. User is prompted to enroll MFA

---

## What judges can do

The **JUDGE** role is read-only across the system, but has one specific power:
**generate and download case reports** for any case they are assigned to.

This lets a judge review the full integrity record for a case - all evidence,
all hashes, all custody events - without ever touching the raw files.