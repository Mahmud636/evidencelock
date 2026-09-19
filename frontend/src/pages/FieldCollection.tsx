import React, { useEffect, useState, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { caseService, Case } from '@/services/cases'
import { fieldService } from '@/services/field'
import {
  getOrCreateDeviceId,
  saveFieldToken,
  getFieldToken,
  getCachedUser,
  clearFieldMode,
  addToQueue,
  getQueue,
  getPendingQueue,
  updateQueueItem,
  removeQueueItem,
  clearSyncedItems,
  newUUID,
  QueuedItem,
  CachedUser,
} from '@/utils/fieldStorage'
import { computeFileSHA256, formatBytes } from '@/utils/hash'
import toast from 'react-hot-toast'

export const FieldCollection: React.FC = () => {
  const { user } = useAuth()
  const [deviceId] = useState(getOrCreateDeviceId())
  const [fieldToken, setFieldToken] = useState<string | null>(null)
  const [cachedUser, setCachedUser] = useState<CachedUser | null>(null)
  const [queue, setQueue] = useState<QueuedItem[]>([])
  const [cases, setCases] = useState<Case[]>([])
  const [selectedCase, setSelectedCase] = useState('')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [isSettingUp, setIsSettingUp] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---------- Initial load ----------
  useEffect(() => {
    loadStoredFieldMode()
    loadQueue()
    loadCases()
    checkOnline()

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const checkOnline = () => setIsOnline(navigator.onLine)

  const loadStoredFieldMode = async () => {
    const token = await getFieldToken()
    const cached = await getCachedUser()
    setFieldToken(token)
    setCachedUser(cached)
  }

  const loadQueue = async () => {
    const items = await getQueue()
    setQueue(items)
  }

  const loadCases = async () => {
    try {
      const res = await caseService.list()
      const active = res.cases.filter((c) => c.status === 'ACTIVE')
      setCases(active)
    } catch {
      // Offline — cases are unavailable. Fine.
    }
  }

  // ---------- Setup field mode ----------
  const handleEnableFieldMode = async () => {
    if (!isOnline) {
      toast.error('You must be online to enable field mode')
      return
    }
    setIsSettingUp(true)
    try {
      const result = await fieldService.setup(
        deviceId,
        `${navigator.platform || 'Device'} - ${user?.full_name || 'User'}`,
        24
      )
      await saveFieldToken(result.field_token, {
        user_id: result.user_id,
        full_name: result.user_full_name,
        email: result.user_email,
        role: result.user_role,
        expires_at: result.expires_at,
      })
      setFieldToken(result.field_token)
      setCachedUser({
        user_id: result.user_id,
        full_name: result.user_full_name,
        email: result.user_email,
        role: result.user_role,
        expires_at: result.expires_at,
      })
      toast.success('Field mode enabled for 24 hours')
    } catch (error: any) {
      toast.error(error.response?.data?.detail || error.message || 'Setup failed')
    } finally {
      setIsSettingUp(false)
    }
  }

  const handleDisableFieldMode = async () => {
    if (!window.confirm('Disable field mode and clear the local queue?')) return
    await clearFieldMode()
    setFieldToken(null)
    setCachedUser(null)
    setQueue([])
    toast.success('Field mode disabled')
  }

  // ---------- File collection ----------
  const collectFiles = async (files: FileList | File[]) => {
    if (!selectedCase) {
      toast.error('Select a case first')
      return
    }
    const arr = Array.from(files)
    if (arr.length === 0) return

    const toastId = toast.loading(`Hashing ${arr.length} file(s)...`)
    try {
      for (const file of arr) {
        const hash = await computeFileSHA256(file)
        const item: QueuedItem = {
          id: newUUID(),
          client_ref_id: newUUID(),
          file,
          original_filename: file.name,
          file_size: file.size,
          declared_hash: hash,
          local_collected_at: new Date().toISOString(),
          case_id: selectedCase,
          description: 'Field-collected',
          source_device: 'Field device',
          status: 'PENDING',
          created_at: new Date().toISOString(),
        }
        await addToQueue(item)
      }
      await loadQueue()
      toast.success(`${arr.length} file(s) hashed and queued`, { id: toastId })
    } catch (e: any) {
      toast.error(e.message || 'Collection failed', { id: toastId })
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) collectFiles(e.target.files)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files) collectFiles(e.dataTransfer.files)
  }

  // ---------- Sync ----------
  const handleSync = async () => {
    if (!isOnline) {
      toast.error('Cannot sync while offline')
      return
    }
    if (!fieldToken) {
      toast.error('Field mode not enabled')
      return
    }
    const pending = await getPendingQueue()
    if (pending.length === 0) {
      toast.error('Nothing to sync')
      return
    }

    setIsSyncing(true)
    const toastId = toast.loading(`Syncing ${pending.length} item(s)...`)

    try {
      // Group by case_id (one batch per case)
      const groups: Record<string, QueuedItem[]> = {}
      for (const item of pending) {
        if (!groups[item.case_id]) groups[item.case_id] = []
        groups[item.case_id].push(item)
      }

      for (const [caseId, items] of Object.entries(groups)) {
        for (const item of items) {
          await updateQueueItem(item.id, { status: 'SYNCING' })
        }
        await loadQueue()

        const manifest = {
          case_id: caseId,
          device_id: deviceId,
          items: items.map((i) => ({
            client_ref_id: i.client_ref_id,
            original_filename: i.original_filename,
            file_size: i.file_size,
            declared_hash: i.declared_hash,
            local_collected_at: i.local_collected_at,
            description: i.description,
            source_device: i.source_device,
          })),
        }

        const result = await fieldService.sync(
          fieldToken,
          manifest,
          items.map((i) => i.file)
        )

        // Update each item with its result
        for (const r of result.results) {
          const item = items.find((i) => i.client_ref_id === r.client_ref_id)
          if (!item) continue
          const status =
            r.status === 'SYNCED'
              ? 'SYNCED'
              : r.status === 'VIOLATION'
              ? 'VIOLATION'
              : 'ERROR'
          await updateQueueItem(item.id, { status, sync_result: r })
        }
      }

      await loadQueue()

      // Show summary
      const final = await getQueue()
      const synced = final.filter((i) => i.status === 'SYNCED').length
      const violations = final.filter((i) => i.status === 'VIOLATION').length
      const errors = final.filter((i) => i.status === 'ERROR').length

      if (violations > 0) {
        toast.error(
          `Sync complete: ${synced} synced, ${violations} VIOLATION, ${errors} errors`,
          { id: toastId, duration: 8000 }
        )
      } else {
        toast.success(`Sync complete: ${synced} synced`, { id: toastId })
      }
    } catch (error: any) {
      toast.error(error.message || 'Sync failed', { id: toastId })
      await loadQueue()
    } finally {
      setIsSyncing(false)
    }
  }

  const handleClearSynced = async () => {
    await clearSyncedItems()
    await loadQueue()
    toast.success('Cleared synced items')
  }

  const handleRemoveItem = async (id: string) => {
    if (!window.confirm('Remove this item from the queue?')) return
    await removeQueueItem(id)
    await loadQueue()
  }

  // ---------- Derived ----------
  const pendingCount = queue.filter(
    (i) => i.status === 'PENDING' || i.status === 'ERROR'
  ).length
  const syncedCount = queue.filter((i) => i.status === 'SYNCED').length
  const violationCount = queue.filter((i) => i.status === 'VIOLATION').length

  const tokenExpiresAt = cachedUser?.expires_at
    ? new Date(cachedUser.expires_at)
    : null
  const tokenIsExpired = tokenExpiresAt ? tokenExpiresAt < new Date() : false
  const hasValidFieldMode = fieldToken && !tokenIsExpired

  // ---------- Render ----------
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Field Collection</h1>
          <p className="text-sm text-gray-400 mt-1">
            Collect evidence offline. Hashes are computed locally and verified on sync.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-1 rounded text-[10px] font-semibold tracking-wider ${
              isOnline
                ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
            }`}
          >
            {isOnline ? '● ONLINE' : '● OFFLINE'}
          </span>
        </div>
      </div>

      {/* Setup card */}
      {!hasValidFieldMode && (
        <div className="dark-card border-blue-500/30">
          <h3 className="text-sm font-semibold text-white tracking-wider uppercase mb-3">
            Enable Field Mode
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            To collect evidence offline, you must first authorize this device while
            online. You will receive a scoped token valid for 24 hours. This token
            can only be used to sync field collections — it cannot access any other
            API.
          </p>
          <div className="bg-[#0B1220] rounded-lg p-3 mb-4 text-xs text-gray-500 font-mono break-all">
            Device ID: {deviceId}
          </div>
          {tokenIsExpired && (
            <p className="text-xs text-amber-400 mb-3">
              ⚠ Previous field token expired. Re-enable to continue.
            </p>
          )}
          <button
            onClick={handleEnableFieldMode}
            disabled={!isOnline || isSettingUp}
            className="dark-btn-primary w-auto px-5 disabled:opacity-50"
          >
            {isSettingUp ? 'Enabling...' : '🔓 Enable Field Mode (24h)'}
          </button>
          {!isOnline && (
            <p className="mt-2 text-xs text-amber-400">
              You must be online to enable field mode.
            </p>
          )}
        </div>
      )}

      {/* Active field mode indicator */}
      {hasValidFieldMode && cachedUser && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex justify-between items-start gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🔓</span>
            <div>
              <p className="text-sm font-semibold text-green-300">
                Field mode active
              </p>
              <p className="text-xs text-green-200/80 mt-0.5">
                {cachedUser.full_name} · {cachedUser.email}
              </p>
              <p className="text-[10px] text-green-200/60 mt-1">
                Expires {tokenExpiresAt?.toLocaleString()}
              </p>
            </div>
          </div>
          <button
            onClick={handleDisableFieldMode}
            className="text-xs text-red-400 hover:text-red-300 font-medium"
          >
            Disable Field Mode
          </button>
        </div>
      )}

      {/* Case selector + collect area */}
      {hasValidFieldMode && (
        <>
          <div className="dark-card">
            <label className="dark-label">Case for Collection</label>
            <select
              value={selectedCase}
              onChange={(e) => setSelectedCase(e.target.value)}
              className="dark-select w-full"
            >
              <option value="">— Select a case —</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.case_number} — {c.title}
                </option>
              ))}
            </select>
            {cases.length === 0 && (
              <p className="mt-2 text-xs text-amber-400">
                No active cases available. Load this page while online to fetch cases.
              </p>
            )}
          </div>

          {/* Drag & drop */}
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => selectedCase && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-[#1E2A3E] hover:border-blue-500/50 hover:bg-blue-500/5'
            } ${!selectedCase ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              disabled={!selectedCase}
            />
            <div className="text-4xl mb-3">📁</div>
            <p className="text-sm text-white font-medium mb-1">
              {selectedCase
                ? 'Drop files here or click to browse'
                : 'Select a case first'}
            </p>
            <p className="text-xs text-gray-500">
              Files are hashed locally with SHA-256 — no upload happens until you sync
            </p>
          </div>
        </>
      )}

      {/* Queue */}
      {queue.length > 0 && (
        <div className="dark-card p-0 overflow-hidden">
          <div className="p-5 pb-4 border-b border-[#1E2A3E] flex justify-between items-center flex-wrap gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white tracking-wider uppercase">
                Collection Queue ({queue.length})
              </h3>
              <div className="flex gap-4 mt-2 text-[10px] tracking-wider">
                {pendingCount > 0 && (
                  <span className="text-amber-400">● {pendingCount} PENDING</span>
                )}
                {syncedCount > 0 && (
                  <span className="text-green-400">● {syncedCount} SYNCED</span>
                )}
                {violationCount > 0 && (
                  <span className="text-red-400">● {violationCount} VIOLATION</span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {(syncedCount > 0 || violationCount > 0) && (
                <button
                  onClick={handleClearSynced}
                  className="dark-btn-secondary text-xs"
                >
                  Clear Synced
                </button>
              )}
              <button
                onClick={handleSync}
                disabled={!isOnline || isSyncing || pendingCount === 0}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-sm disabled:opacity-50"
              >
                {isSyncing ? 'Syncing...' : `⟳ Sync Now (${pendingCount})`}
              </button>
            </div>
          </div>

          <table className="dark-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Size</th>
                <th>Hash (SHA-256)</th>
                <th>Collected</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {queue.map((item) => (
                <tr key={item.id}>
                  <td className="text-white text-sm truncate max-w-xs">
                    {item.original_filename}
                  </td>
                  <td className="text-xs text-gray-400 whitespace-nowrap">
                    {formatBytes(item.file_size)}
                  </td>
                  <td className="font-mono text-[10px] text-gray-500">
                    {item.declared_hash.substring(0, 16)}...
                  </td>
                  <td className="text-xs text-gray-400 whitespace-nowrap">
                    {new Date(item.local_collected_at).toLocaleString()}
                  </td>
                  <td>
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="whitespace-nowrap">
                    {(item.status === 'PENDING' ||
                      item.status === 'ERROR' ||
                      item.status === 'VIOLATION' ||
                      item.status === 'SYNCED') && (
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="text-red-400 hover:text-red-300 text-[10px] font-medium"
                      >
                        ✕ Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {queue.length === 0 && hasValidFieldMode && (
        <div className="dark-card text-center py-12">
          <div className="text-5xl mb-3">📦</div>
          <p className="text-gray-400">Queue is empty</p>
          <p className="text-xs text-gray-600 mt-2">
            Select files above to queue them for sync
          </p>
        </div>
      )}
    </div>
  )
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<string, string> = {
    PENDING: 'dark-badge-yellow',
    SYNCING: 'dark-badge-blue',
    SYNCED: 'dark-badge-green',
    VIOLATION: 'dark-badge-red',
    ERROR: 'dark-badge-red',
  }
  return <span className={map[status] || 'dark-badge-gray'}>{status}</span>
}