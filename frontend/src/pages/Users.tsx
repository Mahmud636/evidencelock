import React, { useEffect, useState } from 'react'
import { userService, UserListItem, Role } from '@/services/users'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'

export const Users: React.FC = () => {
  const [users, setUsers] = useState<UserListItem[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [processing, setProcessing] = useState<string | null>(null)
  const [roleEditUser, setRoleEditUser] = useState<UserListItem | null>(null)
  const [selectedRole, setSelectedRole] = useState<string>('')
  const { user: currentUser } = useAuth()

  useEffect(() => {
    loadUsers()
    loadRoles()
  }, [])

  const loadUsers = async (searchTerm?: string) => {
    try {
      const data = await userService.listUsers(searchTerm)
      setUsers(data.users)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load users')
    } finally {
      setIsLoading(false)
    }
  }

  const loadRoles = async () => {
    try {
      const data = await userService.getAvailableRoles()
      setRoles(data.roles)
    } catch {
      // Non-admin users can't fetch roles
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    loadUsers(search || undefined)
  }

  const handleToggleActive = async (u: UserListItem) => {
    setProcessing(u.id)
    try {
      if (u.is_active) {
        await userService.deactivate(u.id)
        toast.success(`${u.full_name} deactivated`)
      } else {
        await userService.activate(u.id)
        toast.success(`${u.full_name} activated`)
      }
      await loadUsers(search || undefined)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Action failed')
    } finally {
      setProcessing(null)
    }
  }

  const handleApproveEmail = async (u: UserListItem) => {
    if (!u.pending_email) return
    if (
      !window.confirm(
        `Approve email change for ${u.full_name}?\n\nFrom: ${u.email}\nTo:   ${u.pending_email}`
      )
    ) {
      return
    }
    setProcessing(u.id)
    try {
      await userService.approveEmailChange(u.id)
      toast.success(`Email change approved for ${u.full_name}`)
      await loadUsers(search || undefined)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Approve failed')
    } finally {
      setProcessing(null)
    }
  }

  const handleRejectEmail = async (u: UserListItem) => {
    if (!u.pending_email) return
    if (
      !window.confirm(
        `Reject email change for ${u.full_name}?\n\nRequested: ${u.pending_email}`
      )
    ) {
      return
    }
    setProcessing(u.id)
    try {
      await userService.rejectEmailChange(u.id)
      toast.success('Email change rejected')
      await loadUsers(search || undefined)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Reject failed')
    } finally {
      setProcessing(null)
    }
  }

  const handleSaveRole = async () => {
    if (!roleEditUser || !selectedRole) return
    setProcessing(roleEditUser.id)
    try {
      await userService.updateRole(roleEditUser.id, selectedRole)
      toast.success('Role updated')
      setRoleEditUser(null)
      setSelectedRole('')
      await loadUsers(search || undefined)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to update role')
    } finally {
      setProcessing(null)
    }
  }

  const formatDate = (iso?: string) => {
    if (!iso) return '-'
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <p className="text-xs text-gray-500 tracking-wider">
          {users.length} USER{users.length !== 1 ? 'S' : ''}
        </p>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            className="dark-input w-64"
            placeholder="Search by name, email, or username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="dark-btn-secondary">
            Search
          </button>
        </form>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : users.length === 0 ? (
        <div className="dark-card text-center py-16">
          <p className="text-gray-400">No users found</p>
        </div>
      ) : (
        <div className="dark-card p-0 overflow-hidden">
          <table className="dark-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Pending Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>MFA</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="text-white font-medium">{u.full_name}</div>
                    <div className="text-[10px] text-gray-500 font-mono">
                      @{u.username}
                    </div>
                  </td>
                  <td className="text-xs text-gray-300 font-mono">
                    {u.email}
                  </td>
                  <td>
                    {u.pending_email ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-mono text-amber-300">
                          {u.pending_email}
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleApproveEmail(u)}
                            disabled={processing === u.id}
                            className="px-2 py-0.5 bg-green-600 hover:bg-green-500 text-white text-[9px] font-medium rounded disabled:opacity-50"
                          >
                            ✓ Approve
                          </button>
                          <button
                            onClick={() => handleRejectEmail(u)}
                            disabled={processing === u.id}
                            className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-[9px] font-medium rounded disabled:opacity-50"
                          >
                            ✕ Reject
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-[10px] text-gray-600">—</span>
                    )}
                  </td>
                  <td>
                    <span className="dark-badge-blue text-[9px]">
                      {u.role.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>
                    <div className="flex flex-col gap-1">
                      <span
                        className={
                          u.is_approved ? 'dark-badge-green' : 'dark-badge-yellow'
                        }
                      >
                        {u.is_approved ? 'APPROVED' : 'PENDING'}
                      </span>
                      <span
                        className={
                          u.is_active ? 'dark-badge-blue' : 'dark-badge-red'
                        }
                      >
                        {u.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span
                      className={
                        u.mfa_enabled ? 'dark-badge-green' : 'dark-badge-gray'
                      }
                    >
                      {u.mfa_enabled ? 'ON' : 'OFF'}
                    </span>
                  </td>
                  <td className="text-xs text-gray-500 whitespace-nowrap">
                    {u.last_login ? formatDate(u.last_login) : 'Never'}
                  </td>
                  <td className="whitespace-nowrap">
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setRoleEditUser(u)
                          setSelectedRole(u.role_id)
                        }}
                        disabled={processing === u.id}
                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-medium rounded"
                      >
                        Role
                      </button>
                      {u.id !== currentUser?.id && (
                        <button
                          onClick={() => handleToggleActive(u)}
                          disabled={processing === u.id}
                          className={`px-2.5 py-1 text-white text-[10px] font-medium rounded ${
                            u.is_active
                              ? 'bg-red-600 hover:bg-red-500'
                              : 'bg-green-600 hover:bg-green-500'
                          }`}
                        >
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Role Edit Modal */}
      {roleEditUser && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0F1729] border border-[#1E2A3E] rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold text-white mb-2">
              Change Role
            </h3>
            <p className="text-xs text-gray-400 mb-5">
              Change role for <b>{roleEditUser.full_name}</b>
            </p>
            <label className="dark-label">New Role</label>
            <select
              className="dark-select w-full"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
            >
              <option value="">— Select a role —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name.replace(/_/g, ' ')}
                  {r.description ? ` — ${r.description}` : ''}
                </option>
              ))}
            </select>
            {roles.length === 0 && (
              <p className="mt-2 text-[10px] text-amber-400">
                No assignable roles. You may only assign roles below your own level.
              </p>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setRoleEditUser(null)
                  setSelectedRole('')
                }}
                disabled={processing === roleEditUser.id}
                className="dark-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRole}
                disabled={processing === roleEditUser.id || !selectedRole}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-sm disabled:opacity-50"
              >
                {processing === roleEditUser.id ? 'Saving...' : 'Save Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}