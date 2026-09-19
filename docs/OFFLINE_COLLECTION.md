# Offline Field Collection

This document explains how EvidenceLock supports evidence collection at a
scene with no network connection.

---

## The problem

Real forensic work happens in the field: at a crime scene, in a server room,
or in a building with no Wi-Fi. Investigators need to collect evidence on-site
and return it to the central system later.

The challenge is that the main system requires authentication and a network
connection. It cannot simply "trust" whatever a device claims to have
collected.

EvidenceLock takes a scoped, pre-authenticated approach.

---

## The approach

### 1. Enable Field Mode (online, at HQ)

Before leaving for the field, the investigator logs in normally and clicks
**Enable Field Mode (24h)**. The server:

1. Registers the device in the `field_devices` table
2. Issues a JWT with a specific `scope: "field_collect"` and
   `purpose: "field_sync"`
3. Binds the token to the device's `device_id` (a UUID stored in `localStorage`)
4. Returns the token to the browser

The browser stores the token and a snapshot of the user's identity in IndexedDB.

### 2. Collect offline (at the scene)

With Field Mode active, the investigator can:

- Open the Field Collection page (works offline because the frontend is cached)
- Select a case
- Drag and drop files onto the collection area

For each file, the browser:

1. Reads the file content
2. Computes SHA-256 using the Web Crypto API (same algorithm as the server)
3. Stores the file, its hash, and metadata in an IndexedDB queue

No network requests are made. The files stay in the browser's IndexedDB.

### 3. Sync (back online)

When the investigator returns to HQ and has connectivity, they click
**Sync Now**. The browser:

1. Groups queued items by case
2. Sends a multipart POST to `/api/v1/field/sync` with:
   - The field token in the `X-Field-Token` header (NOT `Authorization`)
   - A JSON manifest describing every item
   - The actual file blobs

The server then:

1. Validates the field token (scope, purpose, device binding, DB state, expiry)
2. For each item:
   - Saves the file to `uploads/`
   - Recomputes SHA-256 server-side
   - Compares to the declared hash from the manifest
   - Creates an Evidence row
   - Writes TWO custody events:
     - `COLLECTED_OFFLINE` - records the claimed local time from the manifest
     - `SYNCED_TO_SERVER` - records the authoritative server receipt time
3. Returns a per-item result (`SYNCED`, `VIOLATION`, or `ERROR`)

---

## The four hard problems

Offline evidence collection raises four questions that are difficult to answer
without care. EvidenceLock addresses each.

### 1. Time trust

**Problem:** The device's clock could be wrong or tampered with. A court cannot
accept a locally-claimed timestamp as authoritative.

**Solution:** The server writes TWO custody events:

- `COLLECTED_OFFLINE` carries the **claimed local time** in its metadata
- `SYNCED_TO_SERVER` carries the **authoritative server time**

Both are visible in the chain of custody. The client cannot forge the server
timestamp, and the claimed local time is presented as exactly that - a claim.

### 2. Device trust

**Problem:** How does the server know the sync came from a legitimate device
and not a forged request?

**Solution:** The field token is:

- **Scoped** (`scope: "field_collect"`). Middleware rejects field tokens
  presented in the standard `Authorization` header, preventing privilege
  escalation.
- **Device-bound** (the token's `device_id` must match the request's
  `device_id` AND the DB row's `device_id`).
- **Time-limited** (24-hour default, configurable 1-168 hours).
- **Revocable** (a `revoked_at` timestamp on the device row invalidates any
  token issued to that device on the next request).

### 3. Conflict resolution

**Problem:** What if two devices edit the same case offline?

**Solution (for this version):** There is no conflict resolution. Sync is
one-directional: device -> server. Two devices syncing to the same case will
both succeed, but they cannot overwrite each other because each collection
creates a new evidence item.

A future version would add per-item conflict detection using the manifest's
`client_ref_id`.

### 4. Chain integrity across the gap

**Problem:** The chain of custody must survive the offline gap without becoming
forgeable.

**Solution:** The chain is written entirely on the server, at sync time. Both
custody events (`COLLECTED_OFFLINE`, `SYNCED_TO_SERVER`) are chained normally
with `previous_hash`/`current_hash`. An attacker with the field token cannot
insert arbitrary events into the chain - they can only submit a batch, and the
server writes what it validates.

---

## Security properties

| Property | How it's enforced |
|----------|-------------------|
| Field token cannot escalate to full session | Middleware rejects `scope: "field_collect"` in `Authorization` |
| Field token cannot be used on another device | `device_id` binding checked in service |
| Token cannot be used after revocation | `revoked_at` check on every validate |
| Token cannot be used after expiry | DB `expires_at` check on every validate |
| Tampered files at sync are detected | Server recomputes SHA-256 and compares to manifest |
| Local clock cannot forge server time | Server writes authoritative time in `SYNCED_TO_SERVER` |
| Syncs are auditable | Two custody events + one audit log entry per item |

---

## What the system does **not** do

- **No signed binaries.** The field app is a web page, not a native app with
  code signing. In production, a native wrapper with a signed binary would be
  appropriate.
- **No cryptographic device keypair.** Device identity is a client-generated
  UUID plus a server-issued token. A stronger design would give each device
  a public/private keypair and require signed manifests.
- **No multi-device conflict resolution.** Sync is one-directional.
- **No external timestamp.** The `SYNCED_TO_SERVER` timestamp comes from the
  server's own clock. For legal-grade non-repudiation, you would anchor the
  chain head to an RFC 3161 TSA.
- **No automatic retry on failed sync.** The user clicks Sync again.

---

## Files involved

**Backend:**
- `app/models/field_device.py` - the `field_devices` table
- `app/schemas/field.py` - request/response schemas
- `app/services/field_service.py` - token issuance, validation, sync ingest
- `app/api/v1/field.py` - HTTP endpoints

**Frontend:**
- `src/utils/hash.ts` - SHA-256 in the browser
- `src/utils/fieldStorage.ts` - IndexedDB queue wrapper
- `src/services/field.ts` - API client for field endpoints
- `src/pages/FieldCollection.tsx` - the UI

**Middleware:**
- `app/middleware/auth.py` - rejects field tokens used as session tokens

---

## Database

```sql
CREATE TABLE field_devices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(255) NOT NULL UNIQUE,
    device_name VARCHAR(255) NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);