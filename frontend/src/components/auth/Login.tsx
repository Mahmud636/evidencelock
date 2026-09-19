import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export const Login: React.FC = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const result = await login(email, password)
      if (result.mfaRequired) {
        navigate('/mfa-verify')
      } else {
        navigate('/dashboard')
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Authentication failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex dark-bg">
      {/* ==================== LEFT PANEL: BRANDING ==================== */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden">
        {/* Subtle grid background */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        <div className="relative z-10">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-20">
            <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-600/30">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <div className="leading-tight">
              <div className="text-white font-bold tracking-[0.2em] text-sm">EVIDENCE</div>
              <div className="text-blue-400 font-bold tracking-[0.3em] text-xs">LOCK</div>
            </div>
          </div>

          {/* Hero */}
          <h1 className="text-5xl lg:text-6xl font-light text-white leading-[1.1] mb-8 tracking-tight">
            DIGITAL
            <br />
            <span className="font-semibold">EVIDENCE</span>
            <br />
            INTEGRITY
          </h1>

          <p className="text-gray-400 text-base max-w-md leading-relaxed mb-12">
            Preserve it. Fingerprint it. Control access to it.
            Record every action. Make any unauthorized change
            immediately detectable.
          </p>

          {/* Feature list */}
          <div className="space-y-3">
            <FeatureItem icon="◆" label="SHA-256 Cryptographic Fingerprinting" />
            <FeatureItem icon="◆" label="Hash-Chained Tamper-Evident Audit Log" />
            <FeatureItem icon="◆" label="Role-Based Access Control (RBAC)" />
            <FeatureItem icon="◆" label="AES-256-GCM Evidence Encryption" />
          </div>
        </div>

        {/* Bottom mark */}
        <div className="relative z-10 text-[10px] text-gray-600 tracking-wider">
          SECURE EVIDENCE MANAGEMENT · v1.0
        </div>
      </div>

      {/* ==================== RIGHT PANEL: LOGIN FORM ==================== */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12 bg-[#0B1220]">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-white tracking-wide mb-2">
              SECURE ACCESS
            </h2>
            <p className="text-sm text-gray-400">
              Authorized personnel only. All access is logged.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="dark-label">
                Email / User ID
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                className="dark-input"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="password" className="dark-label">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                className="dark-input font-mono"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-400">⚠ {error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="dark-btn-primary flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  AUTHENTICATING...
                </>
              ) : (
                <>
                  AUTHENTICATE
                  <span className="text-lg">→</span>
                </>
              )}
            </button>
          </form>

          {/* Register link */}
          <div className="mt-10 pt-6 dark-divider text-center">
            <Link
              to="/register"
              className="text-sm text-gray-400 hover:text-blue-400 transition-colors"
            >
              Don't have an account?{' '}
              <span className="text-blue-400 font-medium">Request access</span>
            </Link>
          </div>

          {/* Footer notice */}
          <div className="mt-8 pt-6 dark-divider">
            <p className="text-[10px] text-gray-600 tracking-wider text-center leading-relaxed">
              ALL ACCESS ATTEMPTS ARE LOGGED AND AUDITED
              <br />
              UNAUTHORIZED ACCESS IS PROHIBITED
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

const FeatureItem: React.FC<{ icon: string; label: string }> = ({ icon, label }) => (
  <div className="flex items-center gap-3">
    <span className="text-blue-500 text-xs">{icon}</span>
    <span className="text-sm text-gray-300">{label}</span>
  </div>
)