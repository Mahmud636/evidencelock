import React, { useEffect, useState } from 'react'
import { userService, PendingUser } from '@/services/users'
import toast from 'react-hot-toast'

export const PendingApprovals: React.FC = () => {
  const [pending, setPending] = useState<PendingUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [rejectModal, setRejectModal] = useState<PendingUser | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    loadPending()
  }, [])

  const loadPending = async () => {
    try {
      const data = await userService.listPending()
      setPending(data.users)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load pending users')
    } finally {
      setIsLoading(false)
    }
  }

  const handleApprove = async (user: PendingUser) => {
    setProcessing(user.id)
    try {
      await userService.approve(user.id)
      toast.success(`${user.email} approved`)
      await loadPending()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to approve')
    } finally {
      setProcessing(null)
    }
  }

  const handleReject = async () => {
    if (!rejectModal) return
    setProcessing(rejectModal.id)
    try {
      await userService.reject(rejectModal.id, rejectReason)
      toast.success(`${rejectModal.email} rejected`)
      setRejectModal(null)
      setRejectReason('')
      await loadPending()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to reject')
    } finally {
      setProcessing(null)
    }
  }

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-500 tracking-wider">
          {pending.length} ACCOUNT{pending.length !== 1 ? 'S' : ''} AWAITING APPROVAL
        </p>
      </div>

      {pending.length > 0 && (
        <div className="dark-alert bg-yellow-500/10 border-yellow-500/30">
          <div className="dark-alert-icon bg-yellow-500/20 text-yellow-400">
            <span className="text-sm font-bold">!</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-yellow-400 tracking-wide">
              {pending.length} Pending Approval{pending.length !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-yellow-200/80 mt-0.5">
              Users cannot log in until you approve them.
            </p>
          </div>
        </div>
      )}

      {pending.length === 0 ? (
        <div className="dark-card text-center py-16">
          <div className="text-5xl mb-4">✓</div>
          <p className="text-gray-400">No pending approvals</p>
          <p className="text-xs text-gray-600 mt-2">All invitations have been processed</p>
        </div>
      ) : (
        <div className="dark-card p-0 overflow-hidden">
          <table className="dark-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Requested Role</th>
                <th>Invited</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium text-white">{u.full_name}</div>
                    <div className="text-xs text-gray-500 font-mono mt-0.5">
                      {u.email}
                    </div>
                    <div className="text-[10px] text-gray-600 mt-0.5">
                      @{u.username}
                    </div>
                  </td>
                  <td>
                    <span className="dark-badge-blue">{u.role.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="text-xs text-gray-400 whitespace-nowrap">
                    {formatDate(u.created_at)}
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(u)}
                        disabled={processing === u.id}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
                      >
                        {processing === u.id ? '...' : '✓ Approve'}
                      </button>
                      <button
                        onClick={() => setRejectModal(u)}
                        disabled={processing === u.id}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
                      >
                        ✕ Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0F1729] border border-[#1E2A3E] rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white mb-2">Reject User</h3>
            <p className="text-xs text-gray-400 mb-5">
              This will permanently delete the invited account for{' '}
              <span className="text-white font-mono">{rejectModal.email}</span>
            </p>

            <label className="dark-label">Reason (optional)</label>
            <textarea
              className="dark-input mb-5"
              rows={3}
              placeholder="Why are you rejecting this invitation?"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setRejectModal(null)
                  setRejectReason('')
                }}
                className="dark-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={processing === rejectModal.id}
                className="dark-btn-danger"
              >
                {processing === rejectModal.id ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}