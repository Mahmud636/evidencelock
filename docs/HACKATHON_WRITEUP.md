# EvidenceLock

## A Tamper-Evident Digital Evidence Integrity and Chain-of-Custody System

**Team:** SLUK TEAM THREE
**Track:** Cybersecurity / Digital Forensics
**Date:** September 2026

---

### Abstract

Digital evidence is fragile in a way that physical evidence is not. A CCTV video
file, a disk image, or a seized document can be silently edited, re-encoded, or
swapped. When that evidence reaches court, the defence will ask a simple
question: *how do we know this file is the same one that was seized?*

**EvidenceLock** answers that question with cryptography. Every file registered
in the system is fingerprinted with SHA-256. Every action taken on that file is
written to a hash-chained chain-of-custody log. Access to evidence is request-
based, approved by a supervisor, and the returned file is verified server-side
against its original fingerprint. If a returned file has been modified, the
system blocks all future downloads of that evidence until an administrator
resolves the case. The system also supports evidence collection at a scene
with no network connection, syncing later with full server-side verification.

The system is delivered as a full-stack web application: React + TypeScript
frontend, FastAPI + PostgreSQL backend, six roles, nineteen permissions. It
proves what it can prove - and states clearly what it cannot.

---

## 1. Problem Addressed

Digital forensic investigations face five recurring integrity problems:

1. **Silent modification.** Unlike a physical exhibit, a digital file can be
   changed with no visible trace. A single byte flip in a video file, a
   re-encoded image, or a replaced archive produces a file that looks identical
   to a human observer but is no longer the seized original.

2. **Unverified handoffs.** Evidence is often downloaded by investigators for
   analysis, then returned. Without a cryptographic check, nothing proves the
   returned file is the file that was downloaded.

3. **Weak access trails.** Traditional tools log access in mutable databases.
   An attacker with database access can rewrite history.

4. **Enforcement gaps.** Detection without consequence is insufficient. If the
   system flags a tampered file but allows the investigation to proceed, the
   flag is decorative.

5. **Field collection.** Real forensic work happens at scenes with no network
   connectivity. A system that only works online is unusable in the field.

EvidenceLock addresses all five. It does **not** claim to prove *who* changed a
file, only *that* a change occurred. Attribution is drawn from the audit trail
and chain-of-custody records, which are themselves tamper-evident.

---

## 2. Approach Taken

The design follows five principles:

### 2.1 Fingerprint everything

Every file registered is fingerprinted with SHA-256. If the file changes by
even one byte, the hash changes completely. This is the entire integrity
mechanism - no encryption, no watermarking, no proprietary encoding.

### 2.2 Chain the history

Every action on an evidence item produces a **custody event**. Each event stores
the hash of the previous event, forming a chain:

event_n.previous_hash = event_(n-1).current_hash
event_n.current_hash = SHA256(own fields + previous_hash)

The same scheme protects the audit log. Retroactively editing any historical
row breaks the chain at that point. The verification endpoint walks the chain
and reports the first break.

### 2.3 Server-side truth

The client can request an integrity check, but the comparison of hashes is
always recomputed **on the server** from stored values. A compromised frontend
sending `{"verified": true}` for a tampered file is ignored.

### 2.4 Sticky violations with enforced consequences

Once a violation is recorded, it stays recorded. A later disk check does not
clear it. This prevents an attacker from "cleaning" the record by simply
re-verifying. Beyond detection, the system enforces:

- **Blocked downloads** for compromised evidence (HTTP 409 for all users)
- **Blocked new access requests** for compromised evidence
- **Preserved returned files** stored separately from the pristine original
- **System-wide visibility** of the tamper status across all UI pages

### 2.5 Scoped offline collection

Field collection uses a scoped, device-bound, time-limited token issued while
online. The token can only call the field sync endpoint - it cannot be used as
a session token. On sync, the server recomputes every file's hash and writes
two custody events: one with the claimed local time, one with the authoritative
server time.

---

## 3. Solution Developed

### 3.1 Stack

| Layer      | Technology                                                    |
|------------|---------------------------------------------------------------|
| Frontend   | React 18, TypeScript, Vite, Tailwind CSS, React Router, Axios |
| Backend    | Python 3.12, FastAPI (async), SQLAlchemy 2.x, Pydantic v2     |
| Database   | PostgreSQL 15                                                 |
| Auth       | JWT (access + refresh), Argon2id, pyotp (TOTP / RFC 6238)     |
| PDF        | ReportLab                                                     |
| Offline    | IndexedDB, Web Crypto API                                     |
| Storage    | Local filesystem (`uploads/`, `uploads/returned/`, `reports/`)|

### 3.2 Roles and permissions

Six roles, ordered by authority:

| Role                  | Level | Responsibility                          |
|-----------------------|-------|-----------------------------------------|
| SYSTEM_ADMINISTRATOR  | 1     | Full system access, user management     |
| SUPERVISOR            | 2     | Approve access, close/reopen cases      |
| LEAD_INVESTIGATOR     | 3     | Create cases, assign team               |
| INVESTIGATOR          | 4     | Request access, download, return, field collection |
| AUDITOR               | 5     | Read-only integrity + audit review      |
| JUDGE                 | 6     | Read-only; generate case reports        |

Nineteen fine-grained permissions are enforced on every API endpoint.

### 3.3 Key capabilities

**Evidence registration.** A file is uploaded, streamed to disk in 64 KB
chunks, and hashed on the fly. The SHA-256, size, type, collector, and
collection metadata are stored. A `REGISTERED` custody event is written.

**Integrity verification.** On demand, the file is re-read, re-hashed, and
compared to the stored original. The result is `VERIFIED` or `VIOLATION`. If a
violation is already on record, the check reports `VIOLATION ON RECORD` even
if the disk file currently matches.

**Access request lifecycle.** Investigator requests -> Supervisor approves or
denies -> Investigator downloads -> Investigator returns -> Supervisor verifies
-> `VERIFIED` or `VIOLATION`. The returned file is stored as a forensic
artifact at `uploads/returned/<request_id>_<filename>`.

**Tamper enforcement.** When a violation is recorded:

- Future downloads and new access requests are blocked (HTTP 409)
- The Evidence Registry, Integrity Check, and Evidence Detail pages show a
  red `TAMPERED` badge and banner for every user
- The violation cannot be cleared by re-checking the disk

**Team management.** Case members are managed through a dedicated UI. The case
creator is protected from removal. Removing a supervisor or lead investigator
clears their case-level role. A member with an active evidence request cannot
be removed until the request is resolved.

**Case closure with evidence-out guard.** A case cannot be closed while any of
its evidence is checked out to an investigator. The API returns HTTP 409 with
the list of blocking request IDs.

**Offline field collection.** Investigators enable Field Mode while online,
receive a scoped 24-hour token bound to their device, then collect evidence
offline. Files are hashed locally with the Web Crypto API and queued in
IndexedDB. On sync, the server recomputes each hash and rejects any mismatch.

**Court-ready PDF reports.** Two report types - Evidence Integrity Report and
Case Summary Report. Every generated report is itself hashed.

**Hash-chained audit log.** Every state-changing action is written to a
tamper-evident log. A `/audit/verify-chain` endpoint reports any break.

---

## 4. Methodology and Data

### 4.1 Development methodology

The system was built iteratively, feature-by-feature, with each feature
verified end-to-end before the next was started. Each feature followed the same
cycle:

1. Design the database entity and its relationships
2. Define the permission(s) required
3. Implement the service-layer business logic
4. Expose it through an HTTP endpoint
5. Add the frontend UI
6. Test all six roles against the feature

This produced a working, demonstrable system at every checkpoint.

### 4.2 Data used

- **Test evidence files.** Small text, image, and video files generated
  specifically for verification testing.
- **Seeded users.** One user per role, plus one of each role invited during
  testing, to exercise the invitation/approval flow.
- **Synthetic cases.** Three cases with different classifications
  (UNCLASSIFIED, CONFIDENTIAL, SECRET), each assigned to different team
  configurations.
- **Tamper test files.** A working copy of a registered file, deliberately
  modified (one or two characters added) to trigger the integrity violation
  path.

No real or personally identifiable data was used.

### 4.3 Test scenarios executed

| # | Scenario                                        | Expected result          |
|---|-------------------------------------------------|--------------------------|
| 1 | Register file, verify immediately               | VERIFIED                 |
| 2 | Modify file on disk, verify                     | VIOLATION                |
| 3 | Register file, download, return unchanged       | VERIFIED                 |
| 4 | Register file, download, return modified        | VIOLATION                |
| 5 | Malicious frontend sends `verified: true` for tampered file | Server ignores, returns VIOLATION |
| 6 | Admin views case created by Supervisor (SECRET) | Access granted           |
| 7 | Admin registers evidence in a case they did not create | Allowed            |
| 8 | Lead Investigator assigned to a case            | Sees case + evidence     |
| 9 | Lead Investigator downloads evidence           | Blocked; must request + be approved |
| 10 | Remove a case member with an active download request | Blocked (HTTP 409) |
| 11 | Close a case with evidence checked out          | Blocked (HTTP 409)      |
| 12 | Close a case with no evidence out               | CLOSED                  |
| 13 | Reopen closed case                              | ACTIVE, closed_at cleared|
| 14 | Verify audit log chain                          | Intact                  |
| 15 | Re-verify tampered evidence (sticky violation)  | VIOLATION ON RECORD     |
| 16 | Try to download tampered evidence as investigator | Blocked (HTTP 409)    |
| 17 | Try to request access to tampered evidence      | Blocked (HTTP 409)      |
| 18 | Field Mode: enable, collect offline, sync       | Evidence created with COLLECTED_OFFLINE + SYNCED_TO_SERVER |
| 19 | Field Mode: tampered file at sync time          | VIOLATION               |
| 20 | Field token used as session token               | Rejected by middleware  |

All twenty scenarios passed.

---

## 5. Results

### 5.1 Verified behaviour

- **Tamper detection is deterministic.** Two-byte modification to a registered
  file always produces `VIOLATION`. The original hash is preserved and shown
  alongside the current hash for comparison.

- **Client cannot forge verification.** The `verified` boolean sent by the
  frontend is treated as an informational hint only. The server recomputes the
  hash comparison and logs a warning when the client's claim disagrees with
  server truth.

- **Violations are sticky.** Once a violation is on record, later disk checks
  confirm the violation rather than clear it. This closes an attack path where
  an attacker could clean the record by re-verifying an untouched original.

- **Tamper enforcement blocks operations.** Downloads and new access requests
  return HTTP 409 for compromised evidence on all users. The UI shows the
  tamper state consistently across the Registry, Integrity Check, and Evidence
  Detail pages.

- **Preserved returned files.** The actual returned file is stored at
  `uploads/returned/<request_id>_<filename>` with its hash and size recorded
  on the access request row.

- **Chain-of-custody integrity holds.** Every custody event chains to the
  previous one. Modifying a historical event in the database breaks the chain
  and is detected by the verification endpoint.

- **Offline collection works.** Field Mode issues a scoped token, files are
  hashed locally with the Web Crypto API, and on sync the server recomputes
  the hash and rejects mismatches.

- **Field tokens cannot escalate.** The middleware rejects any request that
  presents a field-scoped token in the standard `Authorization` header.

- **Role-based access works end-to-end.** Six roles, nineteen permissions, all
  enforced server-side.

### 5.2 Reports produced

Two report types, both as multi-page PDFs:

- **Evidence Integrity Report** - case info, evidence metadata, original and
  current SHA-256, full chain-of-custody timeline, plain-language integrity
  summary, and an explicit notice of what the system does and does not prove.
- **Case Summary Report** - case info, team members, complete evidence
  inventory with hash status, detailed per-evidence records, and the same
  notice.

Both reports are hashed and stored with a report ID for later retrieval.

---

## 6. Limitations and Failure Modes

The system is deliberately honest about what it does not do.

### 6.1 Technical limitations

- **Hashing detects change, not authorship.** The system can prove that a file
  was altered. It cannot prove *who* altered it. Attribution depends on the
  chain-of-custody trail, which is only as strong as the identity layer beneath
  it.
- **No encryption at rest.** Evidence files are stored on disk as-is. An
  attacker with filesystem access could read them. Encryption is orthogonal to
  integrity and would be added separately.
- **No external timestamp authority.** All timestamps come from the server's
  clock. For legal-grade non-repudiation, hashes should be counter-signed
  against an RFC 3161 Time-Stamp Authority.
- **Local file storage.** The current implementation stores files on the local
  filesystem. This does not survive disk failure or scale across nodes. A
  production deployment would use immutable object storage (WORM) or a
  content-addressed store.
- **No auto-notification.** Violations are recorded and enforced but no email
  or push notification is sent to administrators.
- **No violation resolution workflow.** Once flagged, evidence stays compromised
  until an administrator resolves the case outside the system. A future version
  would add a "resolve violation" action with its own audit trail.
- **Offline field collection uses a client-generated device ID.** A stronger
  design would give each device a cryptographic keypair and require signed
  manifests. The current design is sufficient for a demonstration but not for
  adversarial environments.
- **No offline conflict resolution.** Two devices syncing to the same case both
  create new evidence items; there is no merging of concurrent edits.

### 6.2 Operational failure modes

- **Compromised administrator.** An attacker with a System Administrator
  account can add or remove users, close cases, and generally act inside the
  system. The audit log records every action, but the attacker cannot be
  prevented by the system itself. Mitigation: hardware-backed keys and MFA
  enforced for admin accounts.
- **Database tampering.** If an attacker modifies both a record *and* every
  subsequent record in the chain, the tamper will not be detected by chain
  verification alone. Mitigation: periodic anchoring of the chain head to an
  external service.
- **Client-side time manipulation.** Frontend timestamps displayed to users can
  differ from server timestamps. All authoritative timestamps come from the
  server; the UI is presentational.
- **Denial of service via large uploads.** A 100 MB file size cap is enforced,
  but a legitimate need to ingest larger files would require streaming to
  object storage rather than local disk.
- **Lost field device.** If a field device is lost or stolen, the token
  remains valid until its 24-hour expiry or explicit revocation. Real
  deployments would use shorter expiries or automatic revocation on next
  online check-in.

### 6.3 What the system explicitly does **not** claim

- It does not prove a file is *authentic* - only that it has not *changed*
  since registration.
- It does not replace legal chain-of-custody procedure. It documents and
  supports it.
- It is a demonstration system, not a certified forensic product. Independent
  audit and formal certification would be required before evidentiary use.

---

## 7. Conclusion

EvidenceLock demonstrates that a small, well-designed web application can
provide cryptographic proof of digital evidence integrity together with a
tamper-evident chain of custody. By combining SHA-256 fingerprinting,
hash-chained event logs, server-side verification, sticky violations with
enforced download blocks, and offline field collection with scoped tokens, the
system gives investigators and courts a defensible record of what happened to
a piece of evidence and whether it is still the same file that was originally
registered.

Equally important, the system is explicit about its boundaries. It proves
integrity, not authorship. It detects change, not intent. That honesty is a
design decision: a forensic tool that overstates what it proves is worse than
one that does less but states its limits.

---

*End of technical write-up. Full source code and documentation are provided in
the accompanying repository.*