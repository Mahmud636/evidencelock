import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { userService, Role, InviteResponse } from '@/services/users'
import toast from 'react-hot-toast'

export const InviteUser: React.FC = () => {
  const [roles, setRoles] = useState<Role[]>([])
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [roleId, setRoleId] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [inviteResult, setInviteResult] = useState<InviteResponse | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    loadRoles()
  }, [])

  const loadRoles = async () => {
    try {
      const data = await userService.getAvailableRoles()
      setRoles(data.roles)
      if (data.roles.length > 0) {
        setRoleId(data.roles[0].id)
      }
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load roles')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !username || !fullName || !roleId) {
      toast.error('All fields are required')
      return
    }

    setIsLoading(true)
    try {
      const result = await userService.invite({
        email,
        username,
        full_name: fullName,
        role_id: roleId,
      })
      setInviteResult(result)
      toast.success('User invited successfully')
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to invite user')
    } finally {
      setIsLoading(false)
    }
  }

  const copyPassword = () => {
    if (inviteResult?.temporary_password) {
      navigator.clipboard.writeText(inviteResult.temporary_password)
      toast.success('Password copied')
    }
  }

  // Success view
  if (inviteResult) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="dark-card border-green-500/40">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 rounded-lg bg-green-500/15 border border-green-500/30 flex items-center justify-center text-green-400 text-2xl">
              ✓
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white tracking-wide">
                User Invited Successfully
              </h2>
              <p className="text-xs text-gray-400 mt-1">
                The user must be approved by a System Administrator before they can log in.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <Field label="Email" value={inviteResult.email} />
            <Field label="Full Name" value={inviteResult.full_name} />
            <Field label="Username" value={inviteResult.username} />
            <Field label="Role" value={inviteResult.role} />

            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <p className="text-xs font-semibold text-yellow-400 tracking-wider uppercase mb-2">
                ⚠ Save this temporary password
              </p>
              <p className="text-xs text-yellow-200/80 mb-3">
                Give this to the user securely. They cannot see it again.
              </p>
              <div className="flex items-center gap-3">
                <code className="flex-1 bg-[#0B1220] text-yellow-300 font-mono text-sm p-3 rounded border border-yellow-500/30 break-all">
                  {inviteResult.temporary_password}
                </code>
                <button
                  onClick={copyPassword}
                  className="dark-btn-secondary whitespace-nowrap"
                >
                  📋 Copy
                </button>
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={() => {
                setInviteResult(null)
                setEmail('')
                setUsername('')
                setFullName('')
              }}
              className="dark-btn-secondary"
            >
              Invite Another
            </button>
            <button
              onClick={() => navigate('/admin/approvals')}
              className="dark-btn-primary w-auto px-5"
            >
              Go to Approvals →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Form view
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-wide">Invite User</h2>
        <p className="text-xs text-gray-500 tracking-wider mt-1">
          You can only assign roles below your own level
        </p>
      </div>

      {roles.length === 0 ? (
        <div className="dark-card border-red-500/40">
          <div className="flex items-start gap-3">
            <span className="text-red-400 text-2xl">⚠</span>
            <div>
              <h3 className="text-sm font-semibold text-red-400">
                You cannot invite users
              </h3>
              <p className="text-xs text-gray-400 mt-1">
                Your current role does not have permission to invite users. Contact
                your System Administrator.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="dark-card space-y-5">
          <div>
            <label className="dark-label">Email Address *</label>
            <input
              type="email"
              required
              className="dark-input"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="dark-label">Full Name *</label>
            <input
              type="text"
              required
              className="dark-input"
              placeholder="John Doe"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div>
            <label className="dark-label">Username *</label>
            <input
              type="text"
              required
              className="dark-input"
              placeholder="johndoe"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
            />
          </div>

          <div>
            <label className="dark-label">Assign Role *</label>
            <select
              className="dark-select"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              required
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-gray-500 mt-2">
              Available roles: {roles.length}
            </p>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <p className="text-xs text-blue-300">
              ℹ The invited user will be created with a random temporary password. They
              will not be able to log in until a System Administrator approves their account.
            </p>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isLoading}
              className="dark-btn-primary w-auto px-6"
            >
              {isLoading ? 'Inviting...' : '＋ Send Invitation'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-1.5">
      {label}
    </p>
    <p className="text-sm text-white">{value}</p>
  </div>
)