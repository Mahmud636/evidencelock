import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { authService } from '@/services/auth'
import { userService, Profile as ProfileType } from '@/services/users'
import toast from 'react-hot-toast'

export const Profile: React.FC = () => {
  const { user, checkAuth } = useAuth()
  const [profile, setProfile] = useState<ProfileType | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Edit profile form
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [editFullName, setEditFullName] = useState('')
  const [editUsername, setEditUsername] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)

  // Change password form
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)

  // MFA disable form
  const [disableCode, setDisableCode] = useState('')
  const [isDisabling, setIsDisabling] = useState(false)
  const [showDisableForm, setShowDisableForm] = useState(false)

  useEffect(() => {
    loadProfile()
  }, [])

  const loadProfile = async () => {
    try {
      const data = await userService.getMyProfile()
      setProfile(data)
      setEditFullName(data.full_name)
      setEditUsername(data.username)
      setEditEmail(data.email)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load profile')
    } finally {
      setIsLoading(false)
    }
  }

  // ---------- Edit Profile ----------
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return

    const updates: Record<string, string> = {}
    if (editFullName && editFullName !== profile.full_name) {
      updates.full_name = editFullName
    }
    if (editUsername && editUsername !== profile.username) {
      updates.username = editUsername
    }
    if (editEmail && editEmail !== profile.email) {
      updates.email = editEmail
    }

    if (Object.keys(updates).length === 0) {
      toast.error('No changes to save')
      return
    }

    setIsSavingProfile(true)
    try {
      const result = await userService.updateMyProfile(updates)
      if (result.email_change_pending) {
        toast.success(
          `Profile updated. Email change to ${result.pending_email} is pending admin approval.`,
          { duration: 6000 }
        )
      } else {
        toast.success('Profile updated')
      }
      setShowEditProfile(false)
      await loadProfile()
      await checkAuth()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to update profile')
    } finally {
      setIsSavingProfile(false)
    }
  }

  // ---------- Change Password ----------
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match')
      return
    }
    setIsChangingPassword(true)
    try {
      await userService.changeMyPassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })
      toast.success('Password changed successfully')
      setShowChangePassword(false)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to change password')
    } finally {
      setIsChangingPassword(false)
    }
  }

  // ---------- MFA ----------
  const handleDisableMFA = async () => {
    if (disableCode.length !== 6) {
      toast.error('Enter a 6-digit code')
      return
    }
    setIsDisabling(true)
    try {
      await authService.disableMFA(disableCode)
      toast.success('MFA disabled')
      setShowDisableForm(false)
      setDisableCode('')
      await checkAuth()
      await loadProfile()
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to disable MFA')
    } finally {
      setIsDisabling(false)
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="dark-card text-center py-16">
        <p className="text-gray-400">Could not load profile</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Account Information */}
      <div className="dark-card">
        <h3 className="text-sm font-semibold text-white tracking-wider uppercase mb-5">
          Account Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Full Name" value={profile.full_name} />
          <Field label="Email" value={profile.email} />
          <Field label="Username" value={profile.username} />
          <div>
            <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-1.5">
              Role
            </p>
            <span className="dark-badge-blue">{profile.role}</span>
          </div>
          <Field
            label="Member Since"
            value={formatDate(profile.created_at)}
          />
          <Field
            label="Last Login"
            value={profile.last_login ? formatDate(profile.last_login) : 'Never'}
          />
        </div>
      </div>

      {/* Pending Email Change */}
      {profile.pending_email && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-xl">⏳</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-300">
                Email Change Pending Approval
              </p>
              <p className="text-xs text-amber-200/80 mt-1">
                Requested: <span className="font-mono text-white">{profile.pending_email}</span>
              </p>
              {profile.email_change_requested_at && (
                <p className="text-[10px] text-amber-200/60 mt-1">
                  Submitted {formatDate(profile.email_change_requested_at)}
                </p>
              )}
              <p className="text-xs text-amber-200/80 mt-2">
                An administrator must approve this change before it takes effect.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile */}
      <div className="dark-card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-white tracking-wider uppercase">
            Edit Profile
          </h3>
          {!showEditProfile && (
            <button
              onClick={() => setShowEditProfile(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors"
            >
              ✎ Edit
            </button>
          )}
        </div>

        {!showEditProfile ? (
          <p className="text-xs text-gray-500">
            Update your name, username, or request an email change.
          </p>
        ) : (
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="dark-label">Full Name</label>
              <input
                type="text"
                className="dark-input"
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                minLength={2}
                maxLength={200}
              />
            </div>
            <div>
              <label className="dark-label">Username</label>
              <input
                type="text"
                className="dark-input font-mono"
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                minLength={3}
                maxLength={50}
              />
              <p className="mt-1 text-[10px] text-gray-500">
                Letters, numbers, and underscores only
              </p>
            </div>
            <div>
              <label className="dark-label">Email</label>
              <input
                type="email"
                className="dark-input"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
              <p className="mt-1 text-[10px] text-amber-400">
                ⚠ Email changes require administrator approval
              </p>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowEditProfile(false)
                  setEditFullName(profile.full_name)
                  setEditUsername(profile.username)
                  setEditEmail(profile.email)
                }}
                disabled={isSavingProfile}
                className="dark-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingProfile}
                className="dark-btn-primary w-auto px-5"
              >
                {isSavingProfile ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Change Password */}
      <div className="dark-card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-white tracking-wider uppercase">
            Change Password
          </h3>
          {!showChangePassword && (
            <button
              onClick={() => setShowChangePassword(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors"
            >
              🔒 Change
            </button>
          )}
        </div>

        {!showChangePassword ? (
          <p className="text-xs text-gray-500">
            Password must be 12+ characters with uppercase, lowercase, digit, and symbol.
          </p>
        ) : (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="dark-label">Current Password</label>
              <input
                type="password"
                className="dark-input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="dark-label">New Password</label>
              <input
                type="password"
                className="dark-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
              />
              <PasswordStrength password={newPassword} />
            </div>
            <div>
              <label className="dark-label">Confirm New Password</label>
              <input
                type="password"
                className="dark-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
              />
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="mt-1 text-[10px] text-red-400">
                  Passwords do not match
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowChangePassword(false)
                  setCurrentPassword('')
                  setNewPassword('')
                  setConfirmPassword('')
                }}
                disabled={isChangingPassword}
                className="dark-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  isChangingPassword ||
                  !currentPassword ||
                  !newPassword ||
                  newPassword !== confirmPassword
                }
                className="dark-btn-primary w-auto px-5"
              >
                {isChangingPassword ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Two-Factor Authentication */}
      <div className="dark-card">
        <h3 className="text-sm font-semibold text-white tracking-wider uppercase mb-5">
          Two-Factor Authentication
        </h3>

        <div className="flex items-center gap-4 mb-5">
          {profile.mfa_enabled ? (
            <>
              <div className="w-12 h-12 rounded-lg bg-green-500/15 border border-green-500/30 flex items-center justify-center text-2xl">
                ✓
              </div>
              <div>
                <p className="font-medium text-green-400">MFA is enabled</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Your account is protected with TOTP-based two-factor authentication.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-lg bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center text-2xl">
                ⚠
              </div>
              <div>
                <p className="font-medium text-yellow-400">MFA is not enabled</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Enable MFA for stronger account security.
                </p>
              </div>
            </>
          )}
        </div>

        {!profile.mfa_enabled ? (
          <Link to="/mfa-enroll" className="dark-btn-primary inline-block w-auto px-5">
            🔐 Enable Two-Factor Authentication
          </Link>
        ) : (
          <div>
            {!showDisableForm ? (
              <button
                onClick={() => setShowDisableForm(true)}
                className="dark-btn-danger"
              >
                Disable MFA
              </button>
            ) : (
              <div className="space-y-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-300 font-medium">
                  Enter a 6-digit TOTP code from your authenticator to disable MFA:
                </p>
                <input
                  type="text"
                  maxLength={6}
                  inputMode="numeric"
                  className="dark-input font-mono text-center text-lg tracking-widest"
                  placeholder="000000"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
                />
                <div className="flex gap-3">
                  <button
                    onClick={handleDisableMFA}
                    disabled={isDisabling}
                    className="dark-btn-danger"
                  >
                    {isDisabling ? 'Disabling...' : 'Confirm Disable'}
                  </button>
                  <button
                    onClick={() => {
                      setShowDisableForm(false)
                      setDisableCode('')
                    }}
                    className="dark-btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const Field: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div>
    <p className="text-[10px] font-semibold text-gray-500 tracking-wider uppercase mb-1.5">
      {label}
    </p>
    <p className="text-sm text-white">{value || '-'}</p>
  </div>
)

const PasswordStrength: React.FC<{ password: string }> = ({ password }) => {
  if (!password) return null

  const checks = {
    length: password.length >= 12,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    digit: /[0-9]/.test(password),
    symbol: /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password),
  }

  const passed = Object.values(checks).filter(Boolean).length
  const total = 5
  const percent = (passed / total) * 100

  const color =
    passed <= 2 ? 'bg-red-500' : passed <= 3 ? 'bg-amber-500' : 'bg-green-500'

  return (
    <div className="mt-2">
      <div className="w-full bg-[#0B1220] rounded-full h-1.5 overflow-hidden">
        <div
          className={`${color} h-full transition-all duration-300`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 flex gap-2 text-[9px] text-gray-500 flex-wrap">
        <span className={checks.length ? 'text-green-400' : ''}>12+ chars</span>
        <span className={checks.lower ? 'text-green-400' : ''}>lowercase</span>
        <span className={checks.upper ? 'text-green-400' : ''}>uppercase</span>
        <span className={checks.digit ? 'text-green-400' : ''}>digit</span>
        <span className={checks.symbol ? 'text-green-400' : ''}>symbol</span>
      </div>
    </div>
  )
}