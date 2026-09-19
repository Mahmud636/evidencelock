# EvidenceLock: Proving Digital Evidence Hasn't Been Touched

*A technical write-up of the design decisions, security properties, and honest
limits of a tamper-evident digital evidence system.*

---

## The problem

Digital evidence is fragile in a way that physical evidence is not. A CCTV
video file can be silently edited, re-encoded, or replaced. A seized hard drive
image can be modified without leaving a visible trace. When that evidence goes
to court, the defence will ask a simple question:

> "How do we know this file is the same one that was seized?"

Traditional answers rely on paperwork and procedure. EvidenceLock answers with
cryptography.

---

## The core idea

Every file that enters the system is **fingerprinted** with SHA-256. That
fingerprint is stored in the database. To check whether the file has been
modified, the system recomputes the fingerprint and compares it to the original.

A SHA-256 hash is a 256-bit value derived from the file's contents. Change one
byte of a video file and the hash changes completely - not just slightly. There
is no known way to modify a file while keeping the same hash.

So:

- If the hashes match, the file is byte-for-byte identical to what was registered
- If they differ, the file has been changed

That is what the system can prove.

---

## What the system deliberately does NOT claim

This is the part that matters.

**It does not prove who changed a file.** Hashing detects change. It cannot
attribute it. To know *who* touched a file, you need the chain of custody -
who downloaded it, when, and whether they returned it.

**It does not encrypt evidence at rest.** Files are stored as-is. Encryption is
a separate concern and would not help with integrity detection.

**It does not rely on the client.** Even if someone hacks the frontend to send
`{"verified": true}`, the server ignores that. The comparison is always
recomputed server-side from the stored hashes.

**It does not use an external timestamp authority.** For legal-grade
non-repudiation, you would counter-sign hashes against a trusted external time
source (RFC 3161 TSA). EvidenceLock records timestamps from its own database.

**It does not replace legal chain-of-custody procedures.** The digital trail
supports and documents those procedures. It is not a substitute.

Stating these limits explicitly is a design decision, not a weakness. A security
tool that over-claims is worse than useless - it gives false confidence.

---

## Architecture at a glance

React Frontend <--JWT--> FastAPI Backend <--async--> PostgreSQL
|
v
Local files
(uploads/ + reports/ +
uploads/returned/)


The frontend is a single-page app (Vite + React + TypeScript). It talks only to
the backend, never to the database or filesystem directly. Every request carries
a JWT; the backend validates it on every call.

The backend is a FastAPI app organized around resources: auth, users, cases,
evidence, custody, access requests, reports, audit, field. Each resource has:

- **Routes** that handle HTTP
- **Services** that enforce permissions and business rules
- **Models** that map to DB tables
- **Schemas** that validate request/response shapes

---

## The workflow, end to end

### Registering evidence

1. Investigator uploads a file with metadata (description, source device, collector)
2. Backend streams the file to disk in 64 KB chunks, computing SHA-256 as it goes
3. On completion, the file is stored at `uploads/<evidence_id>.<ext>`
4. The hash, size, type, and metadata are written to the `evidence` table
5. A `REGISTERED` custody event is written
6. An `EVIDENCE_REGISTERED` audit entry is written
7. Response returns the evidence ID

At this moment, the file has a cryptographic identity. Any future change is
detectable.

### Verifying integrity

1. Any authorized user clicks **Verify**
2. Backend re-reads the file from disk and recomputes SHA-256
3. Compares to the stored `original_hash`
4. Checks whether any violation is already on record for this evidence
5. Updates `current_hash` and `verified_status`. **Sticky:** if a violation is
   on record, the final status is `VIOLATION` regardless of what the disk shows.
6. Writes a custody event
7. Returns the result

The result is deterministic and server-authoritative.

### Access request lifecycle

Investigators don't just grab files. Access is requested, reviewed, and logged.

PENDING --> APPROVED --> DOWNLOADED --> RETURNED --> VERIFIED
| | |
v v v
DENIED (audit) VIOLATION


Every transition writes:
- A row in `evidence_access_requests`
- A custody event on the evidence item
- An audit log entry

The download action records the file's hash **at download time**. When the file
is returned, the backend recomputes the hash of the returned file and compares
it to the original.

**The critical security decision:** the comparison is done on the server. The
client's opinion is not consulted.

### When a return is tampered with

This is where the design gets interesting. A naive system would simply flag the
violation and move on. EvidenceLock does three additional things:

**1. It preserves the returned file.** The actual returned file is stored at
`uploads/returned/<request_id>_<filename>`. This is the forensic artifact of
what the investigator gave back. The registered original is never overwritten.

**2. It makes the violation sticky.** Once a violation is recorded, a later
verification of the *original* file cannot clear it. This closes a subtle
attack path: an attacker who returns a tampered file, then waits for an
administrator to re-verify the (still-intact) original, would otherwise see the
violation silently disappear.

The verification logic now performs:

```python
already_violation = (
    evidence.verified_status == "VIOLATION"
    or evidence.evidence_status == "RETURN_VIOLATION"
    or violation_history is not None
)

if already_violation:
    final_verified_status = "VIOLATION"
else:
    final_verified_status = "VERIFIED" if integrity_verified else "VIOLATION"
The response message becomes explicit: INTEGRITY VIOLATION ON RECORD.

3. It enforces consequences. Downloads and new access requests are blocked
for compromised evidence, for all users. The error message is unambiguous:

This evidence is flagged as COMPROMISED. Download is blocked until an
administrator resolves the integrity violation.

The system doesn't just detect - it enforces discipline.

Case closure
A case cannot be closed while any of its evidence is checked out. The backend
queries evidence_access_requests and blocks the closure with a 409 if any row
has status DOWNLOADED. The response lists the specific blocking request IDs.

This enforces a real forensic rule: chain of custody must be intact before the
case is archived.

Offline field collection
Real forensic work happens at crime scenes with no Wi-Fi. EvidenceLock supports
this with a scoped, pre-authenticated field mode:

While online, an investigator clicks Enable Field Mode (24h)

The server issues a JWT with scope: "field_collect" bound to a device ID

The token is stored in IndexedDB (not localStorage)

At the scene, files are hashed locally with crypto.subtle.digest('SHA-256', ...)
and queued in IndexedDB

On return to a network, the user clicks Sync Now

The server validates the field token, recomputes each file's hash, and
compares to the declared hash from the manifest

Two custody events are written per item:

COLLECTED_OFFLINE - records the claimed local time

SYNCED_TO_SERVER - records the authoritative server time

The field token is deliberately narrow. The auth middleware explicitly rejects
any field-scoped token presented in the standard Authorization header. A
compromised field device cannot escalate to a full session.

Hash chaining
The audit log and custody trail are not simple append-only tables. Each row
contains a hash of the previous row, chained like a mini blockchain:

row_n.previous_hash = row_(n-1).current_hash
row_n.current_hash  = SHA256(own fields + previous_hash)
Editing any historical row breaks the chain. The verification endpoint walks
the entire log, recomputes each hash, and reports whether the chain is intact.

This is the same tamper-evidence principle as the evidence files themselves,
applied to the metadata trail.

