/**
 * Field storage — IndexedDB wrapper for offline evidence collection.
 *
 * Stores:
 * - device_id:    a stable UUID identifying this browser as a "field device"
 * - field_token:  the scoped JWT issued by the server at /field/setup
 * - user snapshot: name/email/role cached for offline display
 * - queue:        pending collected items (File blobs + metadata + hashes)
 *
 * IndexedDB is used because it can store File/Blob objects directly,
 * unlike localStorage which only stores strings.
 */

const DB_NAME = 'evidencelock_field'
const DB_VERSION = 1

const STORE_META = 'meta'
const STORE_QUEUE = 'queue'

export interface CachedUser {
  user_id: string
  full_name: string
  email: string
  role: string
  expires_at: string
}

export interface QueuedItem {
  id: string
  client_ref_id: string
  file: File
  original_filename: string
  file_size: number
  declared_hash: string
  local_collected_at: string
  case_id: string
  description?: string
  source_device?: string
  status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'VIOLATION' | 'ERROR'
  sync_result?: any
  created_at: string
}

// ---------------- DB helpers ----------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode)
    const objectStore = transaction.objectStore(store)
    const request = fn(objectStore)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => db.close()
  })
}

// ---------------- Device ID ----------------

const DEVICE_ID_KEY = 'evidencelock_device_id'

export function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    id = `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
      .slice(6, 8)
      .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

// ---------------- Meta: field token + cached user ----------------

export async function saveFieldToken(
  token: string,
  user: CachedUser
): Promise<void> {
  await tx(STORE_META, 'readwrite', (s) =>
    s.put({ key: 'field_token', value: token })
  )
  await tx(STORE_META, 'readwrite', (s) =>
    s.put({ key: 'cached_user', value: user })
  )
}

export async function getFieldToken(): Promise<string | null> {
  try {
    const rec: any = await tx(STORE_META, 'readonly', (s) =>
      s.get('field_token')
    )
    return rec?.value ?? null
  } catch {
    return null
  }
}

export async function getCachedUser(): Promise<CachedUser | null> {
  try {
    const rec: any = await tx(STORE_META, 'readonly', (s) =>
      s.get('cached_user')
    )
    return rec?.value ?? null
  } catch {
    return null
  }
}

export async function clearFieldMode(): Promise<void> {
  const db = await openDB()
  const transaction = db.transaction(
    [STORE_META, STORE_QUEUE],
    'readwrite'
  )
  transaction.objectStore(STORE_META).delete('field_token')
  transaction.objectStore(STORE_META).delete('cached_user')
  transaction.objectStore(STORE_QUEUE).clear()
  return new Promise((resolve) => {
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
  })
}

// ---------------- Queue ----------------

export async function addToQueue(item: QueuedItem): Promise<void> {
  await tx(STORE_QUEUE, 'readwrite', (s) => s.put(item))
}

export async function getQueue(): Promise<QueuedItem[]> {
  try {
    const all: any[] = await tx(STORE_QUEUE, 'readonly', (s) => s.getAll())
    return all.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  } catch {
    return []
  }
}

export async function getPendingQueue(): Promise<QueuedItem[]> {
  const all = await getQueue()
  return all.filter(
    (i) => i.status === 'PENDING' || i.status === 'ERROR'
  )
}

export async function updateQueueItem(
  id: string,
  updates: Partial<QueuedItem>
): Promise<void> {
  const rec: any = await tx(STORE_QUEUE, 'readonly', (s) => s.get(id))
  if (!rec) return
  const merged = { ...rec, ...updates }
  await tx(STORE_QUEUE, 'readwrite', (s) => s.put(merged))
}

export async function removeQueueItem(id: string): Promise<void> {
  await tx(STORE_QUEUE, 'readwrite', (s) => s.delete(id))
}

export async function clearSyncedItems(): Promise<void> {
  const all = await getQueue()
  for (const item of all) {
    if (item.status === 'SYNCED' || item.status === 'VIOLATION') {
      await removeQueueItem(item.id)
    }
  }
}

// ---------------- UUID helper ----------------

export function newUUID(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
}