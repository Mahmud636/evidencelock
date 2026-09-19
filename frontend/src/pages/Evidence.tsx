import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { evidenceService, Evidence } from '@/services/evidence'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'

export const EvidencePage: React.FC = () => {
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const { user } = useAuth()

  const canRegister =
    user?.role === 'SYSTEM_ADMINISTRATOR' ||
    user?.role === 'SUPERVISOR' ||
    user?.role === 'LEAD_INVESTIGATOR' ||
    user?.role === 'INVESTIGATOR'

  useEffect(() => {
    loadEvidence()
    const onFocus = () => loadEvidence()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const loadEvidence = async () => {
    try {
      const response = await evidenceService.list()
      setEvidence(response.evidence)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load evidence')
    } finally {
      setIsLoading(false)
    }
  }

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getStatusBadge = (ev: Evidence) => {
    if (ev.is_compromised) {
      return <span className="dark-badge-red">⚠ TAMPERED</span>
    }
    if (ev.verified_status === 'VERIFIED') {
      return <span className="dark-badge-green">✓ VERIFIED</span>
    }
    if (ev.verified_status === 'VIOLATION') {
      return <span className="dark-badge-red">⚠ VIOLATION</span>
    }
    if (ev.evidence_status === 'DOWNLOADED') {
      return <span className="dark-badge-blue">DOWNLOADED</span>
    }
    if (ev.evidence_status === 'RETURNED') {
      return <span className="dark-badge-yellow">RETURNED</span>
    }
    if (ev.evidence_status === 'REGISTERED') {
      return <span className="dark-badge-blue">REGISTERED</span>
    }
    return <span className="dark-badge-gray">{ev.evidence_status}</span>
  }

  const filtered = evidence.filter((ev) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      ev.evidence_id.toLowerCase().includes(q) ||
      ev.original_filename.toLowerCase().includes(q) ||
      (ev.case_number || '').toLowerCase().includes(q) ||
      (ev.description || '').toLowerCase().includes(q)
    )
  })

  const compromisedCount = evidence.filter((e) => e.is_compromised).length

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
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <div>
          <p className="text-xs text-gray-500 tracking-wider">
            {filtered.length} ITEM{filtered.length !== 1 ? 'S' : ''}
            {compromisedCount > 0 && (
              <span className="ml-3 text-red-400 font-semibold">
                · {compromisedCount} TAMPERED
              </span>
            )}
          </p>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            className="dark-input w-64"
            placeholder="Search by ID, filename, case..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {canRegister && (
            <Link
              to="/evidence/register"
              className="dark-btn-primary w-auto px-5 whitespace-nowrap"
            >
              ＋ Register Evidence
            </Link>
          )}
        </div>
      </div>

      {/* Compromised alert banner */}
      {compromisedCount > 0 && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-4 flex items-start gap-3">
          <span className="text-xl">⚠</span>
          <div>
            <p className="text-sm font-semibold text-red-300">
              {compromisedCount} COMPROMISED ITEM
              {compromisedCount !== 1 ? 'S' : ''} IN REGISTRY
            </p>
            <p className="text-xs text-red-200/80 mt-1">
              Evidence items marked <b>TAMPERED</b> have a recorded integrity
              violation. Downloads are blocked for these items until an
              administrator resolves the case.
            </p>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="dark-card text-center py-16">
          <p className="text-gray-400">
            {search ? 'No evidence matches your search' : 'No evidence registered yet'}
          </p>
          {!search && canRegister && (
            <Link
              to="/evidence/register"
              className="mt-3 inline-block text-blue-400 hover:text-blue-300 text-sm font-medium"
            >
              ＋ Register your first evidence
            </Link>
          )}
        </div>
      ) : (
        <div className="dark-card p-0 overflow-hidden">
          <table className="dark-table">
            <thead>
              <tr>
                <th>Evidence ID</th>
                <th>File</th>
                <th>Case</th>
                <th>Type</th>
                <th>Size</th>
                <th>Status</th>
                <th>Registered</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ev) => {
                const compromised = ev.is_compromised === true
                return (
                  <tr
                    key={ev.id}
                    className={
                      compromised
                        ? 'bg-red-500/5 border-l-2 border-l-red-500'
                        : ''
                    }
                  >
                    <td className="font-mono font-medium text-white whitespace-nowrap">
                      {ev.evidence_id}
                    </td>
                    <td>
                      <div className="font-medium text-white truncate max-w-xs">
                        {ev.original_filename}
                      </div>
                      {compromised && ev.violation_info?.reason && (
                        <div className="text-[10px] text-red-400 mt-0.5">
                          ⚠ {ev.violation_info.reason}
                        </div>
                      )}
                    </td>
                    <td className="text-xs text-gray-400 font-mono whitespace-nowrap">
                      {ev.case_number || '-'}
                    </td>
                    <td className="text-xs text-gray-400 uppercase">
                      {ev.file_type || '-'}
                    </td>
                    <td className="text-xs text-gray-400 whitespace-nowrap">
                      {formatBytes(ev.file_size)}
                    </td>
                    <td className="whitespace-nowrap">{getStatusBadge(ev)}</td>
                    <td className="text-xs text-gray-500 whitespace-nowrap">
                      {new Date(ev.created_at).toLocaleDateString()}
                    </td>
                    <td className="whitespace-nowrap">
                      <Link
                        to={`/evidence/${ev.evidence_id}`}
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