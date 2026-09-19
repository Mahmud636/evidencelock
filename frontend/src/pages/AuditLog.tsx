import React, { useEffect, useState } from 'react'
import {
  auditService,
  AuditLog as AuditEntry,
  VerifyChainResponse,
} from '@/services/audit'
import toast from 'react-hot-toast'

export const AuditLog: React.FC = () => {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [eventTypes, setEventTypes] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filterType, setFilterType] = useState<string>('')
  const [total, setTotal] = useState(0)
  const [verification, setVerification] = useState<VerifyChainResponse | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    loadEventTypes()
  }, [])

  useEffect(() => {
    loadLogs()
  }, [filterType])

  const loadEventTypes = async () => {
    try {
      const data = await auditService.getEventTypes()
      setEventTypes(data.event_types)
    } catch {
      // ignore
    }
  }

  const loadLogs = async () => {
    setIsLoading(true)
    try {
      const data = await auditService.list({
        event_type: filterType || undefined,
        limit: 100,
      })
      setLogs(data.logs)
      setTotal(data.total)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load audit logs')
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerify = async () => {
    setIsVerifying(true)
    try {
      const result = await auditService.verifyChain()
      setVerification(result)
      if (result.verified) {
        toast.success('Audit chain verified')
      } else {
        toast.error('AUDIT CHAIN TAMPERING DETECTED!')
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
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const getEventColor = (eventType: string) => {
    if (eventType.includes('VIOLATION')) return 'text-red-400'
    if (eventType.includes('SUCCESS') || eventType.includes('VERIFIED'))
      return 'text-green-400'
    if (eventType.includes('FAILURE') || eventType.includes('REJECTED'))
      return 'text-red-400'
    if (eventType.includes('EVIDENCE')) return 'text-blue-400'
    if (eventType.includes('CASE')) return 'text-purple-400'
    if (eventType.includes('LOGIN') || eventType.includes('LOGOUT'))
      return 'text-yellow-400'
    if (eventType.includes('MFA')) return 'text-cyan-400'
    return 'text-gray-400'
  }

  const getEventIcon = (eventType: string) => {
    if (eventType.includes('VIOLATION')) return '⚠'
    if (eventType.includes('VERIFIED')) return '✓'
    if (eventType.includes('EVIDENCE')) return '▥'
    if (eventType.includes('CASE')) return '▤'
    if (eventType.includes('LOGIN')) return '⌐'
    if (eventType.includes('LOGOUT')) return '⏻'
    if (eventType.includes('MFA')) return '🔐'
    if (eventType.includes('ACCOUNT')) return '👤'
    if (eventType.includes('REPORT')) return '▤'
    return '·'
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <p className="text-xs text-gray-500 tracking-wider">
            {total} AUDIT ENTRIES · HASH-CHAINED
          </p>
        </div>
        <button
          onClick={handleVerify}
          disabled={isVerifying}
          className="dark-btn-primary w-auto px-5"
        >
          {isVerifying ? 'Verifying...' : '◈ Verify Chain Integrity'}
        </button>
      </div>

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
                {verification.verified
                  ? 'AUDIT CHAIN INTEGRITY VERIFIED'
                  : 'AUDIT CHAIN TAMPERING DETECTED'}
              </h3>
              <p className="text-xs text-gray-400 mt-1">
                {verification.message} · {verification.total_entries} entries checked
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

      <div className="flex gap-3 flex-wrap items-center">
        <label className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase">
          Filter by Event Type:
        </label>
        <select
          className="dark-select w-64"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">All events</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : logs.length === 0 ? (
        <div className="dark-card text-center py-16">
          <p className="text-gray-400">No audit entries found</p>
        </div>
      ) : (
        <div className="dark-card p-0 overflow-hidden">
          <table className="dark-table">
            <thead>
              <tr>
                <th className="w-12"></th>
                <th>Event</th>
                <th>Actor</th>
                <th>Resource</th>
                <th>Timestamp</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <React.Fragment key={log.id}>
                  <tr
                    className="cursor-pointer"
                    onClick={() =>
                      setExpandedId(expandedId === log.id ? null : log.id)
                    }
                  >
                    <td className={`text-xl ${getEventColor(log.event_type)}`}>
                      {getEventIcon(log.event_type)}
                    </td>
                    <td>
                      <div
                        className={`text-xs font-semibold tracking-wider ${getEventColor(
                          log.event_type
                        )}`}
                      >
                        {log.event_type.replace(/_/g, ' ')}
                      </div>
                      {log.action && (
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {log.action}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="text-xs text-white">{log.user_name}</div>
                      {log.user_email && (
                        <div className="text-[10px] text-gray-500 font-mono">
                          {log.user_email}
                        </div>
                      )}
                    </td>
                    <td className="text-xs">
                      {log.resource_type ? (
                        <span className="text-gray-400">
                          {log.resource_type}
                          {log.resource_id && (
                            <span className="text-gray-600 ml-1 font-mono text-[10px]">
                              {log.resource_id.substring(0, 8)}...
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="text-xs text-gray-400 whitespace-nowrap font-mono">
                      {formatTime(log.created_at)}
                    </td>
                    <td className="text-[10px] text-gray-600 font-mono">
                      {log.current_hash.substring(0, 12)}...
                    </td>
                  </tr>
                  {expandedId === log.id && (
                    <tr>
                      <td colSpan={6} className="bg-[#0B1220] p-4">
                        <div className="space-y-3">
                          {log.details && (
                            <div>
                              <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-1">
                                Details
                              </p>
                              <pre className="text-[11px] text-gray-300 font-mono bg-[#0F1729] p-3 rounded border border-[#1E2A3E] overflow-x-auto">
                                {JSON.stringify(log.details, null, 2)}
                              </pre>
                            </div>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-1">
                                Previous Hash
                              </p>
                              <code className="block text-[10px] text-gray-400 font-mono bg-[#0F1729] p-2 rounded border border-[#1E2A3E] break-all">
                                {log.previous_hash || '(genesis entry)'}
                              </code>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-1">
                                Current Hash
                              </p>
                              <code className="block text-[10px] text-blue-300 font-mono bg-[#0F1729] p-2 rounded border border-blue-500/30 break-all">
                                {log.current_hash}
                              </code>
                            </div>
                          </div>

                          <div className="flex gap-4 text-[10px] text-gray-500 pt-2">
                            {log.ip_address && (
                              <span>
                                <span className="text-gray-600">IP:</span>{' '}
                                {log.ip_address}
                              </span>
                            )}
                            <span>
                              <span className="text-gray-600">Integrity:</span>{' '}
                              {log.integrity_verified ? (
                                <span className="text-green-400">✓ verified</span>
                              ) : (
                                <span className="text-red-400">✗ failed</span>
                              )}
                            </span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}