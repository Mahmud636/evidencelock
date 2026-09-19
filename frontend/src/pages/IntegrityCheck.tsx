import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { evidenceService, Evidence } from '@/services/evidence'
import { dashboardService } from '@/services/dashboard'
import toast from 'react-hot-toast'

interface CheckResult {
  evidence: Evidence
  verified: boolean
  originalHash: string
  currentHash: string
  verifiedAt?: string
  error?: string
  checked: boolean
  stickyViolation?: boolean
}

export const IntegrityCheck: React.FC = () => {
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [results, setResults] = useState<Record<string, CheckResult>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [violationEvents, setViolationEvents] = useState<number>(0)

  useEffect(() => {
    loadEvidence()
    loadViolationEvents()
  }, [])

  useEffect(() => {
    const onFocus = () => {
      loadEvidence(true)
      loadViolationEvents()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const loadViolationEvents = async () => {
    try {
      const stats = await dashboardService.getStats()
      setViolationEvents(stats.violation_events || 0)
    } catch {
      setViolationEvents(0)
    }
  }

  const loadEvidence = async (silent = false) => {
    if (silent) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    try {
      const response = await evidenceService.list()
      setEvidence(response.evidence)

      const initial: Record<string, CheckResult> = {}
      response.evidence.forEach((e) => {
        const compromised = e.is_compromised === true
        initial[e.evidence_id] = {
          evidence: e,
          verified: !compromised && e.verified_status === 'VERIFIED',
          originalHash: e.original_hash,
          currentHash: e.current_hash || e.original_hash,
          verifiedAt: e.last_verified_at,
          checked: !!e.verified_status || compromised,
          stickyViolation: compromised,
        }
      })
      setResults(initial)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load evidence')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  const handleManualRefresh = useCallback(() => {
    loadEvidence(true)
    loadViolationEvents()
  }, [])

  const runFullCheck = async () => {
    if (evidence.length === 0) {
      toast.error('No evidence to verify')
      return
    }

    setIsChecking(true)
    setProgress({ current: 0, total: evidence.length })

    let verifiedCount = 0
    let violationCount = 0

    for (let i = 0; i < evidence.length; i++) {
      const item = evidence[i]
      setProgress({ current: i + 1, total: evidence.length })

      try {
        const result = await evidenceService.verify(item.evidence_id)
        setResults((prev) => ({
          ...prev,
          [item.evidence_id]: {
            evidence: item,
            verified: result.integrity_verified,
            originalHash: result.original_hash,
            currentHash: result.current_hash,
            verifiedAt: result.verified_at,
            checked: true,
            stickyViolation: result.sticky_violation,
          },
        }))

        if (result.integrity_verified) verifiedCount++
        else violationCount++
      } catch (err: any) {
        setResults((prev) => ({
          ...prev,
          [item.evidence_id]: {
            evidence: item,
            verified: false,
            originalHash: item.original_hash,
            currentHash: item.current_hash || '',
            error: err.response?.data?.detail || 'Verification failed',
            checked: true,
          },
        }))
        violationCount++
      }
    }

    setIsChecking(false)

    if (violationCount > 0) {
      toast.error(`Check complete: ${violationCount} violation(s) detected!`)
    } else {
      toast.success(`Check complete: All ${verifiedCount} items verified`)
    }

    await loadEvidence(true)
    await loadViolationEvents()
  }

  const summary = {
    total: evidence.length,
    verified: Object.values(results).filter((r) => r.checked && r.verified).length,
    violation: Object.values(results).filter((r) => r.checked && !r.verified).length,
    unchecked: evidence.filter((e) => !results[e.evidence_id]?.checked).length,
  }

  const formatTime = (iso?: string) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const compromisedList = evidence.filter((e) => e.is_compromised === true)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <p className="text-xs text-gray-500 tracking-wider">
            BULK INTEGRITY VERIFICATION
            {isRefreshing && <span className="ml-2 text-blue-400">· refreshing...</span>}
          </p>
          <p className="text-[11px] text-gray-600 mt-1">
            Recompute SHA-256 for every evidence item and compare against registered hash
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing || isChecking}
            className="dark-btn-secondary"
          >
            {isRefreshing ? '⟳ Refreshing...' : '⟳ Refresh'}
          </button>
          <button
            onClick={runFullCheck}
            disabled={isChecking || evidence.length === 0}
            className="dark-btn-primary w-auto px-5"
          >
            {isChecking
              ? `Checking ${progress.current}/${progress.total}...`
              : '◈ Run Full Integrity Check'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatMini label="Total Evidence" value={summary.total} color="text-white" />
        <StatMini label="Verified" value={summary.verified} color="text-green-400" />
        <StatMini
          label="Items in Violation"
          value={summary.violation}
          color={summary.violation > 0 ? 'text-red-400' : 'text-gray-400'}
          highlight={summary.violation > 0}
          sub="Currently compromised"
        />
        <StatMini
          label="Violation Events"
          value={violationEvents}
          color={violationEvents > 0 ? 'text-red-400' : 'text-gray-400'}
          highlight={violationEvents > 0}
          sub="Total detections (history)"
        />
        <StatMini label="Unchecked" value={summary.unchecked} color="text-yellow-400" />
      </div>

      {/* Compromised evidence banner list */}
      {compromisedList.length > 0 && !isChecking && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠</span>
            <div className="flex-1">
              <p className="text-sm font-bold text-red-300 tracking-wide">
                {compromisedList.length} COMPROMISED EVIDENCE ITEM
                {compromisedList.length !== 1 ? 'S' : ''}
              </p>
              <p className="text-xs text-red-200/80 mt-1">
                These items have a recorded integrity violation. Downloads are blocked
                until an administrator resolves each case.
              </p>
              <div className="mt-3 space-y-2">
                {compromisedList.map((ev) => (
                  <div
                    key={ev.id}
                    className="bg-[#0B1220]/60 border border-red-500/20 rounded p-3 flex justify-between items-start gap-3 flex-wrap"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-red-300">
                          {ev.evidence_id}
                        </span>
                        <span className="text-xs text-white truncate">
                          {ev.original_filename}
                        </span>
                        <span className="dark-badge-red text-[9px]">TAMPERED</span>
                      </div>
                      {ev.violation_info?.reason && (
                        <p className="text-[10px] text-red-200/70 mt-1">
                          {ev.violation_info.reason}
                          {ev.violation_info.detected_at && (
                            <> · detected {formatTime(ev.violation_info.detected_at)}</>
                          )}
                          {ev.violation_info.request_id && (
                            <> · {ev.violation_info.request_id}</>
                          )}
                        </p>
                      )}
                    </div>
                    <Link
                      to={`/evidence/${ev.evidence_id}`}
                      className="text-[11px] text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap"
                    >
                      View Details →
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {violationEvents > 0 && (
        <div className="bg-[#0B1220] border border-[#1E2A3E] rounded-lg p-4">
          <p className="text-xs text-gray-400 leading-relaxed">
            <span className="text-white font-semibold">Items in Violation</span> = evidence
            files whose current hash does not match their registered hash (what is
            compromised now).{' '}
            <span className="text-white font-semibold">Violation Events</span> = total
            number of failed integrity checks ever recorded in the chain of custody.
          </p>
        </div>
      )}

      {/* Progress bar */}
      {isChecking && (
        <div className="dark-card">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-gray-400">
              Verifying evidence {progress.current} of {progress.total}...
            </span>
            <span className="text-xs text-blue-400 font-mono">
              {Math.round((progress.current / progress.total) * 100)}%
            </span>
          </div>
          <div className="w-full bg-[#0B1220] rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-500 h-full transition-all duration-300"
              style={{
                width: `${(progress.current / progress.total) * 100}%`,
              }}
            ></div>
          </div>
        </div>
      )}

      {/* Results table */}
      {evidence.length === 0 ? (
        <div className="dark-card text-center py-16">
          <p className="text-gray-400">No evidence registered yet</p>
          <Link
            to="/evidence/register"
            className="mt-3 inline-block text-blue-400 hover:text-blue-300 text-sm font-medium"
          >
            ＋ Register your first evidence
          </Link>
        </div>
      ) : (
        <div className="dark-card p-0 overflow-hidden">
          <table className="dark-table">
            <thead>
              <tr>
                <th>Evidence ID</th>
                <th>File</th>
                <th>Status</th>
                <th>Original Hash</th>
                <th>Current Hash</th>
                <th>Last Checked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((item) => {
                const result = results[item.evidence_id]
                const compromised = item.is_compromised === true
                return (
                  <tr
                    key={item.id}
                    className={compromised ? 'bg-red-500/5 border-l-2 border-l-red-500' : ''}
                  >
                    <td className="font-mono font-medium text-white whitespace-nowrap">
                      {item.evidence_id}
                    </td>
                    <td>
                      <div className="font-medium text-white truncate max-w-xs">
                        {item.original_filename}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        {formatBytes(item.file_size)} · {item.case_number}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      {compromised ? (
                        <span className="dark-badge-red">⚠ TAMPERED</span>
                      ) : !result?.checked ? (
                        <span className="dark-badge-yellow">NOT CHECKED</span>
                      ) : result.verified ? (
                        <span className="dark-badge-green">✓ VERIFIED</span>
                      ) : (
                        <span className="dark-badge-red">⚠ VIOLATION</span>
                      )}
                    </td>
                    <td className="font-mono text-[10px] text-gray-500">
                      {item.original_hash.substring(0, 16)}...
                    </td>
                    <td className="font-mono text-[10px]">
                      {result?.currentHash ? (
                        <span
                          className={
                            result.verified
                              ? 'text-gray-500'
                              : 'text-red-400 font-bold'
                          }
                        >
                          {result.currentHash.substring(0, 16)}...
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="text-xs text-gray-400 whitespace-nowrap">
                      {formatTime(result?.verifiedAt)}
                    </td>
                    <td className="whitespace-nowrap">
                      <Link
                        to={`/evidence/${item.evidence_id}`}
                        className="text-blue-400 hover:text-blue-300 text-xs font-medium tracking-wider"
                      >
                        VIEW →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const StatMini: React.FC<{
  label: string
  value: number
  color: string
  highlight?: boolean
  sub?: string
}> = ({ label, value, color, highlight, sub }) => (
  <div
    className={`bg-[#0F1729] border rounded-lg p-4 ${
      highlight ? 'border-red-500/40' : 'border-[#1E2A3E]'
    }`}
  >
    <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-2">
      {label}
    </p>
    <p className={`text-3xl font-bold ${color}`}>{value}</p>
    {sub && <p className="text-[10px] text-gray-500 mt-1">{sub}</p>}
  </div>
)