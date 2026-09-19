import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { evidenceService, Evidence, VerifyResponse } from '@/services/evidence'
import { accessRequestService, AccessRequest } from '@/services/accessRequests'
import apiClient from '@/services/api'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'

export const EvidenceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const [evidence, setEvidence] = useState<Evidence | null>(null)
  const [verification, setVerification] = useState<VerifyResponse | null>(null)
  const [myRequests, setMyRequests] = useState<AccessRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isVerifying, setIsVerifying] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [requestReason, setRequestReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { user } = useAuth()

  const isRequester =
    user?.role === 'LEAD_INVESTIGATOR' || user?.role === 'INVESTIGATOR'
  const isReviewer =
    user?.role === 'SYSTEM_ADMINISTRATOR' || user?.role === 'SUPERVISOR'
  const canGenerateReport =
    user?.role === 'SYSTEM_ADMINISTRATOR' ||
    user?.role === 'SUPERVISOR' ||
    user?.role === 'LEAD_INVESTIGATOR'

  useEffect(() => {
    if (id) {
      loadEvidence(id)
      loadMyRequests(id)
    }
  }, [id])

  const loadEvidence = async (evidenceId: string) => {
    try {
      const data = await evidenceService.get(evidenceId)
      setEvidence(data)
      if (data.verified_status && data.current_hash && data.last_verified_at) {
        setVerification({
          evidence_id: data.evidence_id,
          original_hash: data.original_hash,
          current_hash: data.current_hash,
          integrity_verified: data.verified_status === 'VERIFIED',
          verified_at: data.last_verified_at,
          verified_by: data.collector_name || 'Unknown',
          message:
            data.verified_status === 'VERIFIED'
              ? 'INTEGRITY VERIFIED'
              : 'INTEGRITY VIOLATION DETECTED',
        })
      }
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load evidence')
    } finally {
      setIsLoading(false)
    }
  }

  const loadMyRequests = async (evidenceId: string) => {
    try {
      const data = await accessRequestService.list()
      const filtered = data.requests.filter(
        (r) =>
          r.evidence_external_id === evidenceId &&
          (r.status === 'PENDING' ||
            r.status === 'APPROVED' ||
            r.status === 'DOWNLOADED' ||
            r.status === 'RETURNED')
      )
      setMyRequests(filtered)
    } catch {
      // ignore
    }
  }

  const handleVerify = async () => {
    if (!id) return
    setIsVerifying(true)
    try {
      const result = await evidenceService.verify(id)
      setVerification(result)
      if (result.integrity_verified) {
        toast.success('Integrity verified!')
      } else {
        toast.error('INTEGRITY VIOLATION DETECTED!')
      }
      await loadEvidence(id)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Verification failed')
    } finally {
      setIsVerifying(false)
    }
  }

  const handleGenerateReport = async () => {
    if (!id) return
    setIsGenerating(true)
    try {
      const result: any = await apiClient.post(`/api/v1/reports/evidence/${id}`)
      toast.success('Report generated!')
      const response = await apiClient.getClient().get(
        `/api/v1/reports/${result.report_id}/download`,
        { responseType: 'blob' }
      )
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `${result.report_id}.pdf`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to generate report')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleRequestAccess = async () => {
    if (!id || !requestReason.trim()) {
      toast.error('Please enter a reason')
      return
    }
    if (requestReason.trim().length < 10) {
      toast.error('Reason must be at least 10 characters')
      return
    }
    setIsSubmitting(true)
    try {
      await accessRequestService.create({
        evidence_id: id,
        reason: requestReason.trim(),
      })
      toast.success('Access request submitted')
      setShowRequestModal(false)
      setRequestReason('')
      await loadMyRequests(id)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Request failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDownloadApproved = async (req: AccessRequest) => {
    try {
      const blob = await accessRequestService.download(req.request_id)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', evidence?.original_filename || 'evidence')
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      toast.success('Evidence downloaded')
      if (id) {
        await loadEvidence(id)
        await loadMyRequests(id)
      }
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Download failed')
    }
  }

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const activeRequest = myRequests[0]
  const hasPending = activeRequest?.status === 'PENDING'
  const hasApproved = activeRequest?.status === 'APPROVED'
  const hasDownloaded = activeRequest?.status === 'DOWNLOADED'
  const hasReturned = activeRequest?.status === 'RETURNED'

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  if (!evidence) {
    return (
      <div className="dark-card text-center py-16">
        <p className="text-gray-400">Evidence not found</p>
        <Link
          to="/evidence"
          className="mt-3 inline-block text-blue-400 hover:text-blue-300 text-sm"
        >
          ← Back to Evidence
        </Link>
      </div>
    )
  }

  const isCompromised = evidence.is_compromised === true
  const violationInfo = evidence.violation_info

  return (
    <div className="space-y-6">
      {/* ============================================================ */}
      {/* COMPROMISED BANNER (top of page) */}
      {/* ============================================================ */}
      {isCompromised && (
        <div className="bg-red-500/15 border-2 border-red-500/60 rounded-lg p-6">
          <div className="flex items-start gap-4">
            <div className="text-5xl flex-shrink-0">⚠</div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-red-300 tracking-wide mb-2">
                THIS EVIDENCE IS COMPROMISED
              </h2>
              <p className="text-sm text-red-200/90 mb-4">
                A recorded integrity violation exists for this evidence item. The
                original registered file is preserved intact, but the evidence has
                been flagged as TAMPERED in the system. All downloads and new
                access requests are blocked until an administrator resolves the
                case.
              </p>

              {violationInfo && (
                <div className="bg-[#0B1220]/60 border border-red-500/30 rounded-lg p-4 space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-[10px] font-semibold text-red-300/70 tracking-wider uppercase mb-1">
                        Detection Reason
                      </p>
                      <p className="text-red-200 font-medium">
                        {violationInfo.reason || 'Hash mismatch'}
                      </p>
                    </div>
                    {violationInfo.request_id && (
                      <div>
                        <p className="text-[10px] font-semibold text-red-300/70 tracking-wider uppercase mb-1">
                          Affected Request
                        </p>
                        <p className="text-red-200 font-mono">
                          {violationInfo.request_id}
                        </p>
                      </div>
                    )}
                    {violationInfo.detected_at && (
                      <div>
                        <p className="text-[10px] font-semibold text-red-300/70 tracking-wider uppercase mb-1">
                          Detected At
                        </p>
                        <p className="text-red-200">
                          {new Date(violationInfo.detected_at).toLocaleString()}
                        </p>
                      </div>
                    )}
                    {violationInfo.return_hash && (
                      <div className="md:col-span-2">
                        <p className="text-[10px] font-semibold text-red-300/70 tracking-wider uppercase mb-1">
                          Tampered File Hash (returned)
                        </p>
                        <code className="block text-[10px] bg-red-500/10 p-2 rounded border border-red-500/30 font-mono break-all text-red-300">
                          {violationInfo.return_hash}
                        </code>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-4 flex gap-3 flex-wrap">
                <Link
                  to="/evidence/chain"
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium text-sm"
                >
                  View Custody Chain →
                </Link>
                <Link
                  to="/access-requests"
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium text-sm"
                >
                  View Access Requests →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* Header */}
      {/* ============================================================ */}
      <div>
        <Link
          to="/evidence"
          className="text-xs text-blue-400 hover:text-blue-300 tracking-wider"
        >
          ← BACK TO EVIDENCE
        </Link>
        <div className="mt-3 flex justify-between items-start gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-4 flex-wrap">
              <h2 className="text-2xl font-bold text-white font-mono tracking-wide">
                {evidence.evidence_id}
              </h2>
              {isCompromised ? (
                <span className="dark-badge-red">⚠ TAMPERED</span>
              ) : (
                <span className="dark-badge-blue">{evidence.evidence_status}</span>
              )}
            </div>
            <p className="text-gray-400 mt-2">{evidence.original_filename}</p>
          </div>
          <div className="flex gap-3 flex-wrap">
            {canGenerateReport && (
              <button
                onClick={handleGenerateReport}
                disabled={isGenerating}
                className="dark-btn-secondary"
              >
                {isGenerating ? 'Generating...' : '▤ Generate Report'}
              </button>
            )}
            <button
              onClick={handleVerify}
              disabled={isVerifying}
              className="dark-btn-primary w-auto px-5"
            >
              {isVerifying ? 'Verifying...' : '◈ Verify Integrity'}
            </button>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* Access Request Workflow Panel (for Lead/Investigator) */}
      {/* ============================================================ */}
      {isRequester && (
        <div
          className={`dark-card ${
            isCompromised ? 'border-red-500/40' : 'border-blue-500/30'
          }`}
        >
          <div className="flex items-start gap-4">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                isCompromised
                  ? 'bg-red-500/15 border border-red-500/30'
                  : 'bg-blue-500/15 border border-blue-500/30'
              }`}
            >
              <span
                className={`text-lg ${
                  isCompromised ? 'text-red-400' : 'text-blue-400'
                }`}
              >
                {isCompromised ? '⚠' : '✎'}
              </span>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-white tracking-wide mb-1">
                Evidence Download Request
              </h3>

              {isCompromised ? (
                <>
                  <p className="text-xs text-red-200/80 mb-4">
                    This evidence is currently flagged as TAMPERED. You cannot
                    request or download it. An administrator must resolve the
                    integrity violation first.
                  </p>
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <p className="text-sm text-red-300 font-medium">
                      🚫 Downloads Blocked — Evidence Compromised
                    </p>
                    {violationInfo?.reason && (
                      <p className="text-xs text-red-200/70 mt-1">
                        Reason: {violationInfo.reason}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-500 mb-4">
                    To download this evidence for further investigation, submit a
                    request with a reason. An administrator or supervisor must
                    approve it before you can download.
                  </p>

                  {!activeRequest && (
                    <button
                      onClick={() => setShowRequestModal(true)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium"
                    >
                      ✎ Request Download
                    </button>
                  )}

                  {hasPending && (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                      <p className="text-sm text-yellow-400 font-medium">
                        ⏳ Request Pending Approval
                      </p>
                      <p className="text-xs text-yellow-200/70 mt-1">
                        Your request{' '}
                        <span className="font-mono">{activeRequest.request_id}</span>{' '}
                        is awaiting review by a Supervisor or Admin.
                      </p>
                    </div>
                  )}

                  {hasApproved && (
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                      <p className="text-sm text-green-400 font-medium mb-2">
                        ✓ Request Approved
                      </p>
                      <p className="text-xs text-green-200/70 mb-3">
                        You can now download the evidence. Once you finish the
                        investigation, return it to the system.
                      </p>
                      <button
                        onClick={() => handleDownloadApproved(activeRequest)}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium"
                      >
                        ↓ Download Evidence
                      </button>
                    </div>
                  )}

                  {hasDownloaded && (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                      <p className="text-sm text-yellow-400 font-medium">
                        📥 Downloaded — Awaiting Return
                      </p>
                      <p className="text-xs text-yellow-200/70 mt-1">
                        The evidence is currently in your possession.
                      </p>
                      <Link
                        to="/access-requests"
                        className="inline-block mt-2 text-xs text-blue-400 hover:text-blue-300 font-medium"
                      >
                        Go to Access Requests to Return →
                      </Link>
                    </div>
                  )}

                  {hasReturned && (
                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                      <p className="text-sm text-purple-400 font-medium">
                        ↩ Return Submitted — Awaiting Verification
                      </p>
                      <p className="text-xs text-purple-200/70 mt-1">
                        An administrator or supervisor will verify that the returned
                        file matches the original.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* Verification result */}
      {/* ============================================================ */}
      {verification && (
        <div
          className={
            verification.integrity_verified
              ? 'bg-green-500/10 border border-green-500/40 rounded-lg p-5'
              : 'bg-red-500/10 border border-red-500/40 rounded-lg p-5'
          }
        >
          <div className="flex items-start gap-4">
            <div className="text-4xl">
              {verification.integrity_verified ? '✓' : '⚠'}
            </div>
            <div className="flex-1 min-w-0">
              <h3
                className={`text-lg font-bold tracking-wider ${
                  verification.integrity_verified
                    ? 'text-green-400'
                    : 'text-red-400'
                }`}
              >
                {verification.integrity_verified
                  ? 'INTEGRITY VERIFIED'
                  : 'INTEGRITY VIOLATION DETECTED'}
              </h3>
              <p
                className={`mt-2 text-sm ${
                  verification.integrity_verified
                    ? 'text-green-200/80'
                    : 'text-red-200/80'
                }`}
              >
                {verification.message}
              </p>
              <div className="mt-4 space-y-2 text-xs">
                <HashRow
                  label="Original SHA-256"
                  value={verification.original_hash}
                />
                <HashRow
                  label="Current SHA-256"
                  value={verification.current_hash}
                  highlight={!verification.integrity_verified}
                />
                <p className="text-gray-400 mt-2">
                  Verified by{' '}
                  <span className="text-white font-medium">
                    {verification.verified_by}
                  </span>{' '}
                  at {new Date(verification.verified_at).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* Info */}
      {/* ============================================================ */}
      <div className="dark-card">
        <h3 className="text-sm font-semibold text-white tracking-wider uppercase mb-5">
          Evidence Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Case" value={evidence.case_number || '-'} mono />
          <Field label="File Type" value={evidence.file_type || '-'} />
          <Field label="File Size" value={formatBytes(evidence.file_size)} />
          <Field label="Collector" value={evidence.collector_name || '-'} />
          <Field
            label="Collection Date"
            value={
              evidence.collection_date
                ? new Date(evidence.collection_date).toLocaleString()
                : '-'
            }
          />
          <Field label="Source Device" value={evidence.source_device || '-'} />
          <div className="md:col-span-2">
            <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-1.5">
              Description
            </p>
            <p className="text-sm text-white">{evidence.description || '-'}</p>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* Fingerprints */}
      {/* ============================================================ */}
      <div className="dark-card">
        <h3 className="text-sm font-semibold text-white tracking-wider uppercase mb-5">
          Cryptographic Fingerprint (SHA-256)
        </h3>
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-1.5">
              Original Hash (at registration)
            </p>
            <code className="block text-xs bg-[#0B1220] p-3 rounded border border-[#1E2A3E] font-mono break-all text-gray-300">
              {evidence.original_hash}
            </code>
          </div>
          {evidence.current_hash &&
            evidence.current_hash !== evidence.original_hash && (
              <div>
                <p className="text-[10px] font-semibold text-red-400 tracking-wider uppercase mb-1.5">
                  ⚠ Current Hash (DIFFERENT)
                </p>
                <code className="block text-xs bg-red-500/10 p-3 rounded border border-red-500/30 font-mono break-all text-red-300">
                  {evidence.current_hash}
                </code>
              </div>
            )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* Timestamps */}
      {/* ============================================================ */}
      <div className="dark-card">
        <h3 className="text-sm font-semibold text-white tracking-wider uppercase mb-5">
          Timestamps
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field
            label="Registered"
            value={new Date(evidence.created_at).toLocaleString()}
          />
          <Field
            label="Last Verified"
            value={
              evidence.last_verified_at
                ? new Date(evidence.last_verified_at).toLocaleString()
                : 'Never'
            }
          />
        </div>
      </div>

      {/* ============================================================ */}
      {/* REQUEST MODAL */}
      {/* ============================================================ */}
      {showRequestModal && !isCompromised && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0F1729] border border-[#1E2A3E] rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold text-white mb-2">
              Request Evidence Download
            </h3>
            <p className="text-xs text-gray-400 mb-5">
              Explain why you need this evidence. A supervisor or administrator
              will review your request.
            </p>
            <label className="dark-label">Reason for Request *</label>
            <textarea
              className="dark-input mb-4"
              rows={5}
              placeholder="e.g., Need to run forensic analysis on this file. Required for case CASE-2026-001 investigation."
              value={requestReason}
              onChange={(e) => setRequestReason(e.target.value)}
            />
            <p className="text-[10px] text-gray-500 mb-4">
              {requestReason.length} / 2000 characters (min 10)
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowRequestModal(false)
                  setRequestReason('')
                }}
                className="dark-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleRequestAccess}
                disabled={isSubmitting || requestReason.trim().length < 10}
                className="dark-btn-primary w-auto px-5"
              >
                {isSubmitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const Field: React.FC<{ label: string; value?: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <div>
    <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-1.5">
      {label}
    </p>
    <p className={`text-sm text-white ${mono ? 'font-mono' : ''}`}>
      {value || '-'}
    </p>
  </div>
)

const HashRow: React.FC<{
  label: string
  value: string
  highlight?: boolean
}> = ({ label, value, highlight }) => (
  <div>
    <span className="text-gray-400">{label}:</span>
    <code
      className={`ml-2 text-[10px] px-2 py-1 rounded border font-mono break-all ${
        highlight
          ? 'bg-red-500/20 text-red-300 border-red-500/40'
          : 'bg-[#0B1220] text-gray-300 border-[#1E2A3E]'
      }`}
    >
      {value}
    </code>
  </div>
)