import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { authService } from '@/services/auth'
import toast from 'react-hot-toast'

export const MFAEnrollment: React.FC = () => {
  const [secret, setSecret] = useState('')
  const [qrCode, setQrCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [code, setCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const { enrollMFA } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    startEnrollment()
  }, [])

  const startEnrollment = async () => {
    try {
      const response = await enrollMFA()
      setSecret(response.secret)
      setQrCode(response.qr_code)
      setRecoveryCodes(response.recovery_codes)
    } catch (error) {
      toast.error('Failed to start MFA enrollment')
    }
  }

  const handleConfirm = async () => {
    if (code.length !== 6) {
      toast.error('Please enter a 6-digit code')
      return
    }
    setIsLoading(true)
    try {
      const result = await authService.confirmMFA(code)
      if (result.verified) {
        setStep(2)
        toast.success('MFA enabled successfully!')
      } else {
        toast.error('Verification failed')
      }
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Invalid code. Try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const copyAll = () => {
    navigator.clipboard.writeText(recoveryCodes.join('\n'))
    toast.success('Recovery codes copied')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-2xl w-full space-y-6">
        <div>
          <h2 className="text-center text-3xl font-extrabold text-gray-900">
            {step === 1 ? 'Set Up Two-Factor Authentication' : 'Save Your Recovery Codes'}
          </h2>
          {step === 1 && (
            <p className="mt-2 text-center text-sm text-gray-600">
              Scan the QR code with Google Authenticator, Authy, or 1Password
            </p>
          )}
        </div>

        {step === 1 && (
          <div className="card space-y-6">
            <div className="flex justify-center">
              {qrCode && (
                <img
                  src={`data:image/png;base64,${qrCode}`}
                  alt="MFA QR Code"
                  className="w-64 h-64"
                />
              )}
            </div>

            <div className="text-center">
              <p className="text-sm text-gray-600 mb-2">
                Or enter this key manually:
              </p>
              <code className="inline-block text-sm bg-gray-100 px-3 py-2 rounded border font-mono">
                {secret}
              </code>
            </div>

            <div className="border-t pt-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter the 6-digit code from your app to confirm:
              </label>
              <input
                type="text"
                maxLength={6}
                inputMode="numeric"
                className="input-field text-center text-2xl tracking-widest font-mono"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
              <button
                onClick={handleConfirm}
                disabled={isLoading || code.length !== 6}
                className="btn-primary mt-4"
              >
                {isLoading ? 'Verifying...' : 'Verify & Enable MFA'}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="card space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm font-medium text-yellow-900">
                ⚠️ Save these recovery codes now
              </p>
              <p className="text-xs text-yellow-800 mt-1">
                Each code can be used once if you lose access to your authenticator.
                Store them somewhere safe — they will NOT be shown again.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 bg-gray-50 p-4 rounded border font-mono text-sm">
              {recoveryCodes.map((c, i) => (
                <div key={i} className="text-gray-900">{c}</div>
              ))}
            </div>

            <button onClick={copyAll} className="btn-secondary w-full">
              📋 Copy All Codes
            </button>

            <button
              onClick={() => navigate('/dashboard')}
              className="btn-primary w-full"
            >
              I've Saved My Codes → Continue
            </button>
          </div>
        )}
      </div>
    </div>
  )
}