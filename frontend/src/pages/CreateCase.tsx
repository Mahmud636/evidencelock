import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { caseService } from '@/services/cases'
import { userService, UserListItem } from '@/services/users'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'

export const CreateCase: React.FC = () => {
  const [caseNumber, setCaseNumber] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [classification, setClassification] = useState('UNCLASSIFIED')
  const [supervisorId, setSupervisorId] = useState('')
  const [leadInvestigatorId, setLeadInvestigatorId] = useState('')
  const [supervisors, setSupervisors] = useState<UserListItem[]>([])
  const [leads, setLeads] = useState<UserListItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const navigate = useNavigate()
  const { user } = useAuth()

  const canPickTeam =
    user?.role === 'SYSTEM_ADMINISTRATOR' || user?.role === 'SUPERVISOR'

  useEffect(() => {
    if (canPickTeam) loadAssignableUsers()
  }, [canPickTeam])

  const loadAssignableUsers = async () => {
    setIsLoadingUsers(true)
    try {
      const response = await userService.listUsers()
      const allUsers = response.users.filter((u) => u.is_active && u.is_approved)
      setSupervisors(allUsers.filter((u) => u.role === 'SUPERVISOR'))
      setLeads(allUsers.filter((u) => u.role === 'LEAD_INVESTIGATOR'))
    } catch (error: any) {
      // Non-admins can't fetch user list; silently ignore
    } finally {
      setIsLoadingUsers(false)
    }
  }

  const generateCaseNumber = () => {
    const year = new Date().getFullYear()
    const random = Math.floor(Math.random() * 900 + 100)
    setCaseNumber(`CASE-${year}-${random}`)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!caseNumber.match(/^CASE-\d{4}-\d{3}$/)) {
      toast.error('Case number must be in format CASE-YYYY-XXX')
      return
    }

    setIsLoading(true)
    try {
      const newCase = await caseService.create({
        case_number: caseNumber,
        title,
        description,
        classification,
        supervisor_id: supervisorId || undefined,
        lead_investigator_id: leadInvestigatorId || undefined,
      })
      toast.success(`Case ${newCase.case_number} created`)
      navigate(`/cases/${newCase.id}`)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to create case')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Create New Case</h1>
        <p className="text-sm text-gray-400 mt-1">
          Start a new investigation case. You'll be automatically added as a member.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="dark-card space-y-6">
        <div>
          <label className="dark-label">
            Case Number <span className="text-red-400">*</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value.toUpperCase())}
              className="dark-input font-mono"
              placeholder="CASE-2026-001"
              required
            />
            <button
              type="button"
              onClick={generateCaseNumber}
              className="dark-btn-secondary whitespace-nowrap"
            >
              Generate
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Format: CASE-YYYY-XXX (e.g., CASE-2026-001)
          </p>
        </div>

        <div>
          <label className="dark-label">
            Title <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="dark-input"
            placeholder="e.g., Suspected Digital Evidence Manipulation"
            required
          />
        </div>

        <div>
          <label className="dark-label">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="dark-input"
            placeholder="Describe the investigation, scope, and objectives"
          />
        </div>

        <div>
          <label className="dark-label">Classification</label>
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
            className="dark-select w-full"
          >
            <option value="UNCLASSIFIED">Unclassified</option>
            <option value="CONFIDENTIAL">Confidential</option>
            <option value="SECRET">Secret</option>
            <option value="TOP_SECRET">Top Secret</option>
          </select>
        </div>

        {canPickTeam && (
          <>
            <div className="border-t border-[#1E2A3E] pt-6">
              <h3 className="text-sm font-semibold text-white mb-1">
                Team Assignment
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Optional. Assigned users will be automatically added as case members.
              </p>
            </div>

            <div>
              <label className="dark-label">Supervisor</label>
              <select
                value={supervisorId}
                onChange={(e) => setSupervisorId(e.target.value)}
                className="dark-select w-full"
                disabled={isLoadingUsers}
              >
                <option value="">
                  {isLoadingUsers ? 'Loading supervisors...' : '— No supervisor —'}
                </option>
                {supervisors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} ({s.email})
                  </option>
                ))}
              </select>
              {!isLoadingUsers && supervisors.length === 0 && (
                <p className="mt-1 text-xs text-amber-400">
                  No users with SUPERVISOR role found.
                </p>
              )}
            </div>

            <div>
              <label className="dark-label">Lead Investigator</label>
              <select
                value={leadInvestigatorId}
                onChange={(e) => setLeadInvestigatorId(e.target.value)}
                className="dark-select w-full"
                disabled={isLoadingUsers}
              >
                <option value="">
                  {isLoadingUsers ? 'Loading leads...' : '— No lead investigator —'}
                </option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.full_name} ({l.email})
                  </option>
                ))}
              </select>
              {!isLoadingUsers && leads.length === 0 && (
                <p className="mt-1 text-xs text-amber-400">
                  No users with LEAD_INVESTIGATOR role found.
                </p>
              )}
            </div>
          </>
        )}

        <div className="flex justify-end gap-4 pt-2">
          <button
            type="button"
            onClick={() => navigate('/cases')}
            className="dark-btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="dark-btn-primary w-auto px-6"
          >
            {isLoading ? 'Creating...' : 'Create Case'}
          </button>
        </div>
      </form>
    </div>
  )
}