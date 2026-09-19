import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { caseService, Case, CaseMember, AssignableUser } from '@/services/cases'
import { reportService } from '@/services/reports'
import { userService, UserListItem } from '@/services/users'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'

export const CaseDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const [caseData, setCaseData] = useState<Case | null>(null)
  const [members, setMembers] = useState<CaseMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)

  // Assign Supervisor/Lead panel
  const [showAssignPanel, setShowAssignPanel] = useState(false)
  const [supervisors, setSupervisors] = useState<UserListItem[]>([])
  const [leads, setLeads] = useState<UserListItem[]>([])
  const [selectedSupervisor, setSelectedSupervisor] = useState('')
  const [selectedLead, setSelectedLead] = useState('')
  const [isSavingTeam, setIsSavingTeam] = useState(false)
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)

  // Add Member modal
  const [showAddMember, setShowAddMember] = useState(false)
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([])
  const [selectedNewMember, setSelectedNewMember] = useState('')
  const [isAddingMember, setIsAddingMember] = useState(false)
  const [isLoadingAssignable, setIsLoadingAssignable] = useState(false)

  // Remove member
  const [removingUserId, setRemovingUserId] = useState<string | null>(null)

  // Close / Reopen
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [showReopenModal, setShowReopenModal] = useState(false)
  const [isChangingStatus, setIsChangingStatus] = useState(false)

  const { user } = useAuth()

  const canGenerateReport =
    user?.role === 'SYSTEM_ADMINISTRATOR' ||
    user?.role === 'SUPERVISOR' ||
    user?.role === 'LEAD_INVESTIGATOR' ||
    user?.role === 'JUDGE'

  const canAssignTeam =
    user?.role === 'SYSTEM_ADMINISTRATOR' || user?.role === 'SUPERVISOR'

  const canCloseCase =
    user?.role === 'SYSTEM_ADMINISTRATOR' || user?.role === 'SUPERVISOR'

  useEffect(() => {
    if (id) loadCase(id)
  }, [id])

  const loadCase = async (caseId: string) => {
    try {
      const [caseResponse, membersResponse] = await Promise.all([
        caseService.get(caseId),
        caseService.getMembers(caseId),
      ])
      setCaseData(caseResponse)
      setMembers(membersResponse)
      setSelectedSupervisor(caseResponse.supervisor_id || '')
      setSelectedLead(caseResponse.lead_investigator_id || '')
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load case')
    } finally {
      setIsLoading(false)
    }
  }

  const reloadMembers = async () => {
    if (!caseData) return
    const membersResponse = await caseService.getMembers(caseData.id)
    setMembers(membersResponse)
  }

  // ---------------- Assign Supervisor/Lead ----------------
  const loadAssignableUsers = async () => {
    setIsLoadingUsers(true)
    try {
      const response = await userService.listUsers()
      const allUsers = response.users.filter((u) => u.is_active && u.is_approved)
      setSupervisors(allUsers.filter((u) => u.role === 'SUPERVISOR'))
      setLeads(allUsers.filter((u) => u.role === 'LEAD_INVESTIGATOR'))
    } catch (error: any) {
      toast.error(
        error.response?.data?.detail ||
          'Could not load users. Only admins can assign team.'
      )
    } finally {
      setIsLoadingUsers(false)
    }
  }

  const openAssignPanel = async () => {
    setShowAssignPanel(true)
    if (supervisors.length === 0 && leads.length === 0) {
      await loadAssignableUsers()
    }
  }

  const handleSaveTeam = async () => {
    if (!caseData) return
    setIsSavingTeam(true)
    try {
      const updated = await caseService.update(caseData.id, {
        supervisor_id: selectedSupervisor || undefined,
        lead_investigator_id: selectedLead || undefined,
      })
      setCaseData(updated)
      toast.success('Team assignment updated')
      setShowAssignPanel(false)
      await reloadMembers()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to update team')
    } finally {
      setIsSavingTeam(false)
    }
  }

  // ---------------- Add / Remove Member ----------------
  const openAddMember = async () => {
    if (!caseData) return
    setShowAddMember(true)
    setSelectedNewMember('')
    setIsLoadingAssignable(true)
    try {
      const res = await caseService.getAssignableUsers(caseData.id)
      setAssignableUsers(res.users)
    } catch (error: any) {
      toast.error(
        error.response?.data?.detail || 'Failed to load assignable users'
      )
      setShowAddMember(false)
    } finally {
      setIsLoadingAssignable(false)
    }
  }

  const handleAddMember = async () => {
    if (!caseData || !selectedNewMember) return
    setIsAddingMember(true)
    try {
      await caseService.addMember(caseData.id, selectedNewMember)
      toast.success('Member added')
      setShowAddMember(false)
      await reloadMembers()
      // Also reload case to refresh member_count
      const updated = await caseService.get(caseData.id)
      setCaseData(updated)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to add member')
    } finally {
      setIsAddingMember(false)
    }
  }

  const handleRemoveMember = async (member: CaseMember) => {
    if (!caseData) return
    if (
      !window.confirm(
        `Remove ${member.full_name} from this case?\n\nThey will lose access to the case and its evidence.`
      )
    ) {
      return
    }
    setRemovingUserId(member.user_id)
    try {
      await caseService.removeMember(caseData.id, member.user_id)
      toast.success('Member removed')
      await reloadMembers()
      const updated = await caseService.get(caseData.id)
      setCaseData(updated)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to remove member')
    } finally {
      setRemovingUserId(null)
    }
  }

  // ---------------- Close / Reopen ----------------
  const handleCloseCase = async () => {
    if (!caseData) return
    setIsChangingStatus(true)
    try {
      const updated = await caseService.close(caseData.id)
      setCaseData(updated)
      toast.success(`Case ${updated.case_number} closed`)
      setShowCloseModal(false)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to close case')
    } finally {
      setIsChangingStatus(false)
    }
  }

  const handleReopenCase = async () => {
    if (!caseData) return
    setIsChangingStatus(true)
    try {
      const updated = await caseService.reopen(caseData.id)
      setCaseData(updated)
      toast.success(`Case ${updated.case_number} reopened`)
      setShowReopenModal(false)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to reopen case')
    } finally {
      setIsChangingStatus(false)
    }
  }

  const handleGenerateReport = async () => {
    if (!caseData) return
    setIsGenerating(true)
    const toastId = toast.loading('Generating case report...')
    try {
      const result = await reportService.generateCaseReport(caseData.id)
      toast.success(
        `Report ${result.report_id} generated (${result.evidence_count} evidence items)`,
        { id: toastId }
      )

      try {
        const blob = await reportService.download(result.report_id)
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute(
          'download',
          `CaseReport-${caseData.case_number}-${result.report_id}.pdf`
        )
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.URL.revokeObjectURL(url)
      } catch {
        toast.error('Report created, but download failed. Visit the Reports page.')
      }
    } catch (error: any) {
      toast.error(
        error.response?.data?.detail || 'Failed to generate case report',
        { id: toastId }
      )
    } finally {
      setIsGenerating(false)
    }
  }

  const supervisorName = (() => {
    if (!caseData?.supervisor_id) return null
    const m = members.find((mm) => mm.user_id === caseData.supervisor_id)
    return m?.full_name || 'Assigned'
  })()

  const leadName = (() => {
    if (!caseData?.lead_investigator_id) return null
    const m = members.find((mm) => mm.user_id === caseData.lead_investigator_id)
    return m?.full_name || 'Assigned'
  })()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  if (!caseData) {
    return (
      <div className="dark-card text-center py-16">
        <p className="text-gray-400">Case not found</p>
        <Link to="/cases" className="mt-3 inline-block text-blue-400 hover:text-blue-300 text-sm">
          ← Back to Cases
        </Link>
      </div>
    )
  }

  const isClosed = caseData.status === 'CLOSED'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          to="/cases"
          className="text-xs text-blue-400 hover:text-blue-300 tracking-wider"
        >
          ← BACK TO CASES
        </Link>
        <div className="mt-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap">
            <h2 className="text-2xl font-bold text-white font-mono tracking-wide">
              {caseData.case_number}
            </h2>
            <span
              className={
                caseData.status === 'ACTIVE' ? 'dark-badge-blue' : 'dark-badge-gray'
              }
            >
              {caseData.status}
            </span>
            {caseData.closed_at && (
              <span className="text-[10px] text-gray-500 tracking-wider">
                CLOSED {new Date(caseData.closed_at).toLocaleDateString()}
              </span>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            {canAssignTeam && (
              <button
                onClick={openAssignPanel}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium text-sm transition-colors"
              >
                👥 Assign Team
              </button>
            )}

            {canCloseCase && !isClosed && (
              <button
                onClick={() => setShowCloseModal(true)}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-medium text-sm transition-colors"
              >
                🔒 Close Case
              </button>
            )}

            {canCloseCase && isClosed && (
              <button
                onClick={() => setShowReopenModal(true)}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium text-sm transition-colors"
              >
                🔓 Reopen Case
              </button>
            )}

            {canGenerateReport && (
              <button
                onClick={handleGenerateReport}
                disabled={isGenerating}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-sm disabled:opacity-50 transition-colors"
              >
                {isGenerating ? 'Generating...' : '📄 Generate Case Report'}
              </button>
            )}
          </div>
        </div>
        <p className="text-gray-400 mt-2">{caseData.title}</p>
      </div>

      {/* Closed banner */}
      {isClosed && (
        <div className="bg-gray-500/10 border border-gray-500/30 rounded-lg p-4">
          <p className="text-sm text-gray-300">
            🔒 <b>This case is closed.</b> No new evidence or access requests can be
            added until it is reopened.
          </p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <StatMini label="Evidence Items" value={caseData.evidence_count} />
        <StatMini label="Team Members" value={caseData.member_count} />
        <StatMini
          label="Classification"
          value={caseData.classification || 'N/A'}
        />
      </div>

      {/* Description */}
      {caseData.description && (
        <div className="dark-card">
          <h3 className="text-sm font-semibold text-white tracking-wider uppercase mb-3">
            Description
          </h3>
          <p className="text-sm text-gray-300 leading-relaxed">
            {caseData.description}
          </p>
        </div>
      )}

      {/* Case info */}
      <div className="dark-card">
        <h3 className="text-sm font-semibold text-white tracking-wider uppercase mb-5">
          Case Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Created By" value={caseData.created_by_name || 'Unknown'} />
          <Field
            label="Created At"
            value={new Date(caseData.created_at).toLocaleString()}
          />
          <Field
            label="Last Updated"
            value={new Date(caseData.updated_at).toLocaleString()}
          />
          <Field label="Supervisor" value={supervisorName || 'Not assigned'} />
          <Field label="Lead Investigator" value={leadName || 'Not assigned'} />
          {caseData.closed_at && (
            <Field
              label="Closed At"
              value={new Date(caseData.closed_at).toLocaleString()}
            />
          )}
        </div>
      </div>

      {/* Team Members table with Add/Remove */}
      <div className="dark-card p-0 overflow-hidden">
        <div className="p-5 pb-4 border-b border-[#1E2A3E] flex justify-between items-center">
          <h3 className="text-sm font-semibold text-white tracking-wider uppercase">
            Team Members ({members.length})
          </h3>
          {canAssignTeam && (
            <button
              onClick={openAddMember}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-xs transition-colors"
            >
              ＋ Add Member
            </button>
          )}
        </div>
        <table className="dark-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Case Role</th>
              <th>Assigned</th>
              {canAssignTeam && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const caseRoles: string[] = []
              if (member.is_creator) caseRoles.push('CREATOR')
              if (member.is_supervisor) caseRoles.push('SUPERVISOR')
              if (member.is_lead_investigator) caseRoles.push('LEAD')

              return (
                <tr key={member.user_id}>
                  <td className="text-white font-medium">{member.full_name}</td>
                  <td className="text-gray-400 text-xs font-mono">
                    {member.email}
                  </td>
                  <td>
                    <span className="dark-badge-blue">
                      {member.role.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    {caseRoles.length === 0 ? (
                      <span className="text-[10px] text-gray-500 tracking-wider">
                        MEMBER
                      </span>
                    ) : (
                      <div className="flex gap-1 flex-wrap">
                        {caseRoles.map((cr) => (
                          <span
                            key={cr}
                            className={`text-[10px] tracking-wider ${
                              cr === 'CREATOR'
                                ? 'text-purple-400'
                                : cr === 'SUPERVISOR'
                                ? 'text-blue-400'
                                : 'text-green-400'
                            }`}
                          >
                            {cr}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="text-xs text-gray-500 whitespace-nowrap">
                    {member.assigned_at
                      ? new Date(member.assigned_at).toLocaleDateString()
                      : '-'}
                  </td>
                  {canAssignTeam && (
                    <td>
                      {member.is_protected ? (
                        <span className="text-[10px] text-gray-500">
                          Protected
                        </span>
                      ) : (
                        <button
                          onClick={() => handleRemoveMember(member)}
                          disabled={removingUserId === member.user_id}
                          className="px-2.5 py-1 bg-red-600/80 hover:bg-red-500 text-white text-[10px] font-medium rounded disabled:opacity-50 transition-colors"
                        >
                          {removingUserId === member.user_id
                            ? '...'
                            : '✕ Remove'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* -------------------- MODALS -------------------- */}

      {/* Assign Supervisor/Lead Modal */}
      {showAssignPanel && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0F1729] border border-[#1E2A3E] rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold text-white mb-2">
              Assign Supervisor / Lead
            </h3>
            <p className="text-xs text-gray-400 mb-5">
              Set or change the supervisor and lead investigator. Assigned users
              are automatically added as case members.
            </p>

            {isLoadingUsers ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="dark-label">Supervisor</label>
                  <select
                    className="dark-select w-full"
                    value={selectedSupervisor}
                    onChange={(e) => setSelectedSupervisor(e.target.value)}
                  >
                    <option value="">— No supervisor —</option>
                    {supervisors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name} ({s.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="dark-label">Lead Investigator</label>
                  <select
                    className="dark-select w-full"
                    value={selectedLead}
                    onChange={(e) => setSelectedLead(e.target.value)}
                  >
                    <option value="">— No lead investigator —</option>
                    {leads.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.full_name} ({l.email})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAssignPanel(false)}
                className="dark-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTeam}
                disabled={isSavingTeam || isLoadingUsers}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-sm disabled:opacity-50"
              >
                {isSavingTeam ? 'Saving...' : 'Save Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showAddMember && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0F1729] border border-[#1E2A3E] rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold text-white mb-2">
              Add Team Member
            </h3>
            <p className="text-xs text-gray-400 mb-5">
              Add a user to this case. They will gain access to the case and all
              of its evidence. They can request downloads but must be approved
              first.
            </p>

            {isLoadingAssignable ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              </div>
            ) : assignableUsers.length === 0 ? (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                <p className="text-xs text-amber-300">
                  No assignable users available. All approved users are already
                  members of this case.
                </p>
              </div>
            ) : (
              <div>
                <label className="dark-label">Select User</label>
                <select
                  className="dark-select w-full"
                  value={selectedNewMember}
                  onChange={(e) => setSelectedNewMember(e.target.value)}
                >
                  <option value="">— Choose a user —</option>
                  {assignableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.email}) — {u.role.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAddMember(false)}
                disabled={isAddingMember}
                className="dark-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleAddMember}
                disabled={
                  isAddingMember ||
                  isLoadingAssignable ||
                  !selectedNewMember ||
                  assignableUsers.length === 0
                }
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-sm disabled:opacity-50"
              >
                {isAddingMember ? 'Adding...' : 'Add Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Case Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0F1729] border border-[#1E2A3E] rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold text-white mb-2">
              🔒 Close Case
            </h3>
            <p className="text-sm text-gray-300 mb-4">
              You are about to close <b>{caseData.case_number}</b>.
            </p>
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-5">
              <p className="text-xs text-amber-300 mb-2">
                <b>Before closing, all downloaded evidence must be returned.</b>
              </p>
              <p className="text-xs text-amber-300/80">
                If any evidence is still checked out, the system will block
                closure and list the outstanding request(s).
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCloseModal(false)}
                disabled={isChangingStatus}
                className="dark-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleCloseCase}
                disabled={isChangingStatus}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-medium text-sm disabled:opacity-50"
              >
                {isChangingStatus ? 'Closing...' : 'Confirm Closure'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen Case Modal */}
      {showReopenModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0F1729] border border-[#1E2A3E] rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold text-white mb-2">
              🔓 Reopen Case
            </h3>
            <p className="text-sm text-gray-300 mb-5">
              Reopen <b>{caseData.case_number}</b>? The case will become ACTIVE
              again and can receive new evidence and access requests.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowReopenModal(false)}
                disabled={isChangingStatus}
                className="dark-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleReopenCase}
                disabled={isChangingStatus}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium text-sm disabled:opacity-50"
              >
                {isChangingStatus ? 'Reopening...' : 'Confirm Reopen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const StatMini: React.FC<{ label: string; value: number | string }> = ({
  label,
  value,
}) => (
  <div className="dark-stat-card">
    <p className="dark-stat-label">{label}</p>
    <p className="dark-stat-value">{value}</p>
  </div>
)

const Field: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div>
    <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-1.5">
      {label}
    </p>
    <p className="text-sm text-white">{value || '-'}</p>
  </div>
)