import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { accessRequestService, AccessRequest } from '@/services/accessRequests'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'

export const AccessRequests: React.FC = () => {
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterScope, setFilterScope] = useState<'all' | 'mine' | 'incoming'>('all')
  const [processing, setProcessing] = useState<string | null>(null)
  const [reviewModal, setReviewModal] = useState<AccessRequest | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [returnModal, setReturnModal] = useState<AccessRequest | null>(null)
  const [returnFile, setReturnFile] = useState<File | null>(null)
  const [returnNotes, setReturnNotes] = useState('')
  const [verifyModal, setVerifyModal] = useState<AccessRequest | null>(null)
  const [verifyNotes, setVerifyNotes] = useState('')
  const { user } = useAuth()

  const isReviewer =
    user?.role === 'SYSTEM_ADMINISTRATOR' || user?.role === 'SUPERVISOR'
  const isRequester =
    user?.role === 'LEAD_INVESTIGATOR' || user?.role === 'INVESTIGATOR'

  useEffect(() => {
    loadRequests()
  }, [filterStatus, filterScope])

  const loadRequests = async () => {
    setIsLoading(true)
    try {
      const data = await accessRequestService.list({
        status: filterStatus || undefined,
        scope: filterScope,
      })
      setRequests(data.requests)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load requests')
    } finally {
      setIsLoading(false)
    }
  }

  const handleReview = async (approve: boolean) => {
    if (!reviewModal) return
    setProcessing(reviewModal.request_id)
    try {
      await accessRequestService.review(reviewModal.request_id, {
        approve,
        note: reviewNote || undefined,
      })
      toast.success(approve ? 'Request approved' : 'Request denied')
      setReviewModal(null)
      setReviewNote('')
      await loadRequests()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Review failed')
    } finally {
      setProcessing(null)
    }
  }

  const handleDownload = async (req: AccessRequest) => {
    setProcessing(req.request_id)
    try {
      const blob = await accessRequestService.download(req.request_id)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', req.evidence_filename || 'evidence')
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      toast.success('Evidence downloaded')
      await loadRequests()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Download failed')
    } finally {
      setProcessing(null)
    }
  }

  const handleReturn = async () => {
    if (!returnModal || !returnFile) {
      toast.error('Please select the returned file')
      return
    }
    setProcessing(returnModal.request_id)
    try {
      await accessRequestService.returnEvidence(
        returnModal.request_id,
        returnFile,
        returnNotes || undefined
      )
      toast.success('Evidence returned - awaiting verification')
      setReturnModal(null)
      setReturnFile(null)
      setReturnNotes('')
      await loadRequests()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Return failed')
    } finally {
      setProcessing(null)
    }
  }

  const handleVerifyReturn = async () => {
    if (!verifyModal) return
    setProcessing(verifyModal.request_id)
    try {
      const result = await accessRequestService.verifyReturn(
        verifyModal.request_id,
        {
          verified: true, // hint only - the server always decides
          notes: verifyNotes || undefined,
        }
      )
      if (result.status === 'VERIFIED') {
        toast.success('✓ Return VERIFIED - hash matches original')
      } else if (result.status === 'VIOLATION') {
        toast.error('⚠ Return VIOLATION - hash does NOT match original')
      }
      setVerifyModal(null)
      setVerifyNotes('')
      await loadRequests()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Verify failed')
    } finally {
      setProcessing(null)
    }
  }

  const formatDate = (iso?: string) => {
    if (!iso) return '-'
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      PENDING: 'dark-badge-yellow',
      APPROVED: 'dark-badge-blue',
      DENIED: 'dark-badge-red',
      DOWNLOADED: 'dark-badge-blue',
      RETURNED: 'dark-badge-yellow',
      VERIFIED: 'dark-badge-green',
      VIOLATION: 'dark-badge-red',
    }
    return map[status] || 'dark-badge-gray'
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <p className="text-xs text-gray-500 tracking-wider">
          {requests.length} REQUEST{requests.length !== 1 ? 'S' : ''}
        </p>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <div>
          <label className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase block mb-1">
            Status
          </label>
          <select
            className="dark-select w-48"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="DENIED">Denied</option>
            <option value="DOWNLOADED">Downloaded</option>
            <option value="RETURNED">Returned</option>
            <option value="VERIFIED">Verified</option>
            <option value="VIOLATION">Violation</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase block mb-1">
            Scope
          </label>
          <select
            className="dark-select w-48"
            value={filterScope}
            onChange={(e) => setFilterScope(e.target.value as any)}
          >
            {isReviewer && <option value="all">All requests</option>}
            <option value="mine">My requests</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : requests.length === 0 ? (
        <div className="dark-card text-center py-16">
          <p className="text-gray-400">No access requests</p>
          {isRequester && (
            <p className="text-xs text-gray-600 mt-2">
              Go to an evidence item and click "Request Download"
            </p>
          )}
        </div>
      ) : (
        <div className="dark-card p-0 overflow-hidden">
          <table className="dark-table">
            <thead>
              <tr>
                <th>Request ID</th>
                <th>Evidence</th>
                <th>Requested By</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono font-medium text-white whitespace-nowrap">
                    {r.request_id}
                  </td>
                  <td>
                    <Link
                      to={`/evidence/${r.evidence_external_id}`}
                      className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                    >
                      {r.evidence_external_id}
                    </Link>
                    <div className="text-[10px] text-gray-500 truncate max-w-xs mt-0.5">
                      {r.evidence_filename}
                    </div>
                  </td>
                  <td className="text-xs text-white whitespace-nowrap">
                    {r.requester_name}
                    <div className="text-[10px] text-gray-500 font-mono">
                      {r.case_number}
                    </div>
                  </td>
                  <td className="text-xs text-gray-300 max-w-xs">
                    <div className="truncate">{r.reason}</div>
                  </td>
                  <td className="whitespace-nowrap">
                    <span className={getStatusBadge(r.status)}>{r.status}</span>
                  </td>
                  <td className="text-xs text-gray-400 whitespace-nowrap">
                    {formatDate(r.created_at)}
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="flex gap-2 flex-wrap">
                      {isReviewer && r.status === 'PENDING' && (
                        <button
                          onClick={() => setReviewModal(r)}
                          disabled={processing === r.request_id}
                          className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-medium rounded"
                        >
                          Review
                        </button>
                      )}

                      {r.status === 'APPROVED' &&
                        r.requested_by === user?.id && (
                          <button
                            onClick={() => handleDownload(r)}
                            disabled={processing === r.request_id}
                            className="px-2.5 py-1 bg-green-600 hover:bg-green-500 text-white text-[10px] font-medium rounded"
                          >
                            {processing === r.request_id ? '...' : '↓ Download'}
                          </button>
                        )}

                      {r.status === 'DOWNLOADED' &&
                        r.requested_by === user?.id && (
                          <button
                            onClick={() => setReturnModal(r)}
                            disabled={processing === r.request_id}
                            className="px-2.5 py-1 bg-yellow-600 hover:bg-yellow-500 text-white text-[10px] font-medium rounded"
                          >
                            ↺ Return
                          </button>
                        )}

                      {isReviewer && r.status === 'RETURNED' && (
                        <button
                          onClick={() => setVerifyModal(r)}
                          disabled={processing === r.request_id}
                          className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-medium rounded"
                        >
                          Verify Return
                        </button>
                      )}

                      {r.status === 'DENIED' && (
                        <span className="text-[10px] text-gray-500">Denied</span>
                      )}
                      {r.status === 'VERIFIED' && (
                        <span className="text-[10px] text-green-400">✓ Done</span>
                      )}
                      {r.status === 'VIOLATION' && (
                        <span className="text-[10px] text-red-400">⚠ Violation</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* REVIEW MODAL */}
      {reviewModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0F1729] border border-[#1E2A3E] rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold text-white mb-2">
              Review Access Request
            </h3>
            <div className="space-y-3 mb-5">
              <InfoRow label="Request ID" value={reviewModal.request_id} mono />
              <InfoRow label="Evidence" value={reviewModal.evidence_external_id || ''} mono />
              <InfoRow label="File" value={reviewModal.evidence_filename || ''} />
              <InfoRow label="Requested by" value={reviewModal.requester_name || ''} />
              <div>
                <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-1">
                  Reason
                </p>
                <p className="text-sm text-gray-300 bg-[#0B1220] p-3 rounded border border-[#1E2A3E]">
                  {reviewModal.reason}
                </p>
              </div>
            </div>
            <label className="dark-label">Review Note (optional)</label>
            <textarea
              className="dark-input mb-5"
              rows={3}
              placeholder="Explain your decision..."
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setReviewModal(null)
                  setReviewNote('')
                }}
                className="dark-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => handleReview(false)}
                disabled={processing === reviewModal.request_id}
                className="dark-btn-danger"
              >
                ✕ Deny
              </button>
              <button
                onClick={() => handleReview(true)}
                disabled={processing === reviewModal.request_id}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium text-sm"
              >
                ✓ Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RETURN MODAL */}
      {returnModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0F1729] border border-[#1E2A3E] rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold text-white mb-2">
              Return Evidence
            </h3>
            <p className="text-xs text-gray-400 mb-5">
              Upload the file you received. The system will compute its SHA-256
              fingerprint to compare with the original.
            </p>
            <div className="space-y-4">
              <div>
                <label className="dark-label">Returned File *</label>
                <input
                  type="file"
                  onChange={(e) => setReturnFile(e.target.files?.[0] || null)}
                  className="dark-input"
                />
                {returnFile && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    {returnFile.name} ({(returnFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>
              <div>
                <label className="dark-label">Notes (optional)</label>
                <textarea
                  className="dark-input"
                  rows={3}
                  placeholder="Any notes about the investigation..."
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => {
                  setReturnModal(null)
                  setReturnFile(null)
                  setReturnNotes('')
                }}
                className="dark-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleReturn}
                disabled={processing === returnModal.request_id || !returnFile}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-medium text-sm disabled:opacity-50"
              >
                {processing === returnModal.request_id
                  ? 'Returning...'
                  : '↺ Submit Return'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VERIFY RETURN MODAL */}
      {verifyModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0F1729] border border-[#1E2A3E] rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold text-white mb-2">
              Verify Return
            </h3>
            <p className="text-xs text-gray-400 mb-5">
              The server will recompute the hash and compare it with the
              original. You cannot override the result.
            </p>
            <div className="space-y-3 mb-5">
              <InfoRow label="Request ID" value={verifyModal.request_id} mono />
              <InfoRow
                label="Evidence"
                value={verifyModal.evidence_external_id || ''}
                mono
              />
              <InfoRow label="Returned by" value={verifyModal.requester_name || ''} />
              <div>
                <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-1">
                  Returned Hash (SHA-256)
                </p>
                <code className="block text-[10px] bg-[#0B1220] p-2 rounded border border-[#1E2A3E] font-mono break-all text-gray-300">
                  {verifyModal.return_hash || '(no hash)'}
                </code>
              </div>
              {verifyModal.return_notes && (
                <InfoRow
                  label="Requester Notes"
                  value={verifyModal.return_notes}
                />
              )}
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-5">
              <p className="text-xs text-blue-300">
                ℹ The comparison is performed automatically by the server. Clicking
                Verify Now will record either VERIFIED or VIOLATION based on the
                actual hash comparison.
              </p>
            </div>
            <label className="dark-label">Verifier Notes (optional)</label>
            <textarea
              className="dark-input mb-5"
              rows={3}
              placeholder="Verification notes..."
              value={verifyNotes}
              onChange={(e) => setVerifyNotes(e.target.value)}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setVerifyModal(null)
                  setVerifyNotes('')
                }}
                className="dark-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleVerifyReturn}
                disabled={processing === verifyModal.request_id}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-sm disabled:opacity-50"
              >
                {processing === verifyModal.request_id
                  ? 'Verifying...'
                  : '◈ Verify Now (Server Compare)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const InfoRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <div>
    <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-1">
      {label}
    </p>
    <p className={`text-sm text-white ${mono ? 'font-mono' : ''}`}>
      {value || '-'}
    </p>
  </div>
)