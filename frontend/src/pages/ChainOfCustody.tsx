import React, { useEffect, useState, useCallback } from 'react'
import {
  custodyService,
  CustodyEvent,
  VerifyCustodyResponse,
} from '@/services/custody'
import toast from 'react-hot-toast'

export const ChainOfCustody: React.FC = () => {
  const [events, setEvents] = useState<CustodyEvent[]>([])
  const [actions, setActions] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [filterAction, setFilterAction] = useState<string>('')
  const [filterEvidence, setFilterEvidence] = useState<string>('')
  const [verification, setVerification] = useState<VerifyCustodyResponse | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)

  useEffect(() => {
    loadActions()
  }, [])

  useEffect(() => {
    loadEvents()
  }, [filterAction, filterEvidence])

  // Refresh whenever the tab regains focus
  useEffect(() => {
    const onFocus = () => loadEvents(true)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [filterAction, filterEvidence])

  const loadActions = async () => {
    try {
      const data = await custodyService.getActions()
      setActions(data.actions)
    } catch {
      // ignore
    }
  }

  const loadEvents = async (silent = false) => {
    if (silent) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    try {
      const data = await custodyService.list({
        action: filterAction || undefined,
        evidence_id: filterEvidence || undefined,
        limit: 200,
      })
      setEvents(data.events)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load custody events')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  const handleManualRefresh = useCallback(() => {
    loadEvents(true)
    loadActions()
  }, [filterAction, filterEvidence])

  const handleVerify = async () => {
    if (!filterEvidence) {
      toast.error('Select a specific evidence ID to verify its custody chain')
      return
    }
    setIsVerifying(true)
    try {
      const result = await custodyService.verify(filterEvidence)
      setVerification(result)
      if (result.verified) {
        toast.success('Custody chain verified')
      } else {
        toast.error('CUSTODY CHAIN BROKEN!')
      }
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Verification failed')
    } finally {
      setIsVerifying(false)
    }
  }

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getActionConfig = (action: string) => {
    const configs: Record<string, { color: string; bg: string; border: string; icon: string }> = {
      REGISTERED: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/40', icon: '＋' },
      VERIFIED: { color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/40', icon: '✓' },
      TRANSFERRED: { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/40', icon: '↗' },
      RECEIVED: { color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/40', icon: '↙' },
      RETURNED: { color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/40', icon: '↺' },
      VIEWED: { color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/40', icon: '👁' },
      EXPORTED: { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/40', icon: '↧' },
      REPORT_GENERATED: { color: 'text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/40', icon: '▤' },
      INTEGRITY_VIOLATION: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/40', icon: '⚠' },
      ARCHIVED: { color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/40', icon: '▤' },
      RESTORED: { color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/40', icon: '↺' },
      COLLECTED: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/40', icon: '📍' },
      DOWNLOADED: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/40', icon: '↧' },
      RETURN_VERIFIED: { color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/40', icon: '✓' },
      RETURN_VIOLATION: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/40', icon: '⚠' },
    }
    return configs[action] || { color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/40', icon: '·' }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <p className="text-xs text-gray-500 tracking-wider">
            {events.length} CUSTODY EVENT{events.length !== 1 ? 'S' : ''} · HASH-CHAINED
            {isRefreshing && <span className="ml-2 text-blue-400">· refreshing...</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="dark-btn-secondary"
          >
            {isRefreshing ? '⟳ Refreshing...' : '⟳ Refresh'}
          </button>
          <button
            onClick={handleVerify}
            disabled={isVerifying || !filterEvidence}
            className="dark-btn-primary w-auto px-5"
          >
            {isVerifying ? 'Verifying...' : '◈ Verify Custody Chain'}
          </button>
        </div>
      </div>

      {/* Verification banner */}
      {verification && (
        <div
          className={
            verification.verified
              ? 'bg-green-500/10 border border-green-500/40 rounded-lg p-4'
              : 'bg-red-500/10 border border-red-500/40 rounded-lg p-4'
          }
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl">{verification.verified ? '✓' : '⚠'}</span>
            <div className="flex-1">
              <h3
                className={`text-sm font-bold tracking-wide ${
                  verification.verified ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {verification.verified ? 'CUSTODY CHAIN VERIFIED' : 'CUSTODY CHAIN BROKEN'}
              </h3>
              <p className="text-xs text-gray-400 mt-1">
                {verification.evidence_id} · {verification.total_events} events
              </p>
              {!verification.verified && verification.reason && (
                <p className="text-xs text-red-300 mt-2 font-mono">
                  {verification.reason}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div>
          <label className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase block mb-1">
            Evidence ID
          </label>
          <input
            type="text"
            className="dark-input w-64"
            placeholder="EVID-2026-XXXXXX"
            value={filterEvidence}
            onChange={(e) => setFilterEvidence(e.target.value.toUpperCase())}
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase block mb-1">
            Action
          </label>
          <select
            className="dark-select w-56"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        {(filterAction || filterEvidence) && (
          <button
            onClick={() => {
              setFilterAction('')
              setFilterEvidence('')
              setVerification(null)
            }}
            className="dark-btn-secondary self-end"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : events.length === 0 ? (
        <div className="dark-card text-center py-16">
          <p className="text-gray-400">No custody events found</p>
        </div>
      ) : (
        <div className="dark-card">
          <div className="relative pl-8">
            {/* Vertical line */}
            <div className="absolute left-3 top-3 bottom-3 w-px bg-gradient-to-b from-blue-500/40 via-blue-500/20 to-transparent" />

            {events.map((event) => {
              const config = getActionConfig(event.action)
              return (
                <div key={event.id} className="relative pb-6 last:pb-0">
                  {/* Node circle */}
                  <div
                    className={`absolute -left-8 top-1 w-6 h-6 rounded-full ${config.bg} border-2 ${config.border} flex items-center justify-center z-10`}
                  >
                    <span className={`text-xs ${config.color}`}>{config.icon}</span>
                  </div>

                  {/* Content */}
                  <div className="pb-4 border-b border-[#1E2A3E] last:border-0">
                    <div className="flex justify-between items-start gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className={`text-xs font-bold tracking-wider ${config.color}`}>
                            {event.action.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] text-gray-500 font-mono">
                            {event.event_id}
                          </span>
                        </div>
                        {event.description && (
                          <p className="text-xs text-gray-300 mt-1.5">
                            {event.description}
                          </p>
                        )}
                        <div className="flex gap-4 mt-2 text-[10px] text-gray-500 flex-wrap">
                          <span>
                            <span className="text-gray-600">Evidence:</span>{' '}
                            <span className="text-blue-400 font-mono">
                              {event.evidence_id}
                            </span>
                          </span>
                          <span>
                            <span className="text-gray-600">By:</span>{' '}
                            <span className="text-white">{event.user_name}</span>
                          </span>
                          {event.location && (
                            <span>
                              <span className="text-gray-600">Location:</span>{' '}
                              {event.location}
                            </span>
                          )}
                        </div>

                        {/* Hash chain preview */}
                        <div className="mt-2 flex items-center gap-2 text-[10px] font-mono">
                          {event.previous_hash ? (
                            <>
                              <span className="text-gray-600">
                                prev: {event.previous_hash.substring(0, 8)}...
                              </span>
                              <span className="text-gray-700">→</span>
                            </>
                          ) : (
                            <span className="text-gray-700">(genesis) →</span>
                          )}
                          <span className={`${config.color}`}>
                            {event.current_hash.substring(0, 16)}...
                          </span>
                        </div>
                      </div>

                      <div className="text-right whitespace-nowrap">
                        <div className="text-[10px] text-gray-500 font-mono">
                          {formatTime(event.created_at)}
                        </div>
                        {event.integrity_status && (
                          <div className="mt-1">
                            <span
                              className={
                                event.integrity_status === 'VERIFIED'
                                  ? 'dark-badge-green text-[9px]'
                                  : 'dark-badge-red text-[9px]'
                              }
                            >
                              {event.integrity_status}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}