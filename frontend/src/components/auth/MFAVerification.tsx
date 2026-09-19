import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export const MFAVerification: React.FC = () => {
  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [recoveryCode, setRecoveryCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { completeMFALogin } = useAuth()
  const navigate = useNavigate()

  const handleChange = (index: number, value: string) => {
    if (value.length > 1) return
    const newCode = [...code]
    newCode[index] = value.replace(/\D/g, '')
    setCode(newCode)
    if (value && index < 5) {
      document.getElementById(`mfa-${index + 1}`)?.focus()
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      document.getElementById(`mfa-${index - 1}`)?.focus()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    let submitCode = ''

    if (useRecovery) {
      submitCode = recoveryCode.trim().toUpperCase()
      if (submitCode.length < 6) {
        alert('Please enter your recovery code')
        return
      }
    } else {
      submitCode = code.join('')
      if (submitCode.length !== 6) {
        alert('Please enter the 6-digit code')
        return
      }
    }

    setIsLoading(true)
    try {
      const ok = await completeMFALogin(submitCode)
      if (ok) navigate('/dashboard')
    } catch (error) {
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    if (useRecovery) return
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    const newCode = pasted.split('').concat(Array(6).fill('')).slice(0, 6)
    setCode(newCode)
    e.preventDefault()
  }

  const toggleRecovery = () => {
    setUseRecovery(!useRecovery)
    setCode(['', '', '', '', '', ''])
    setRecoveryCode('')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="flex justify-center">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-xl">EL</span>
            </div>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Two-Factor Authentication
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {useRecovery
              ? 'Enter one of your recovery codes (8 characters)'
              : 'Enter the 6-digit code from your authenticator app'}
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {!useRecovery ? (
            <div className="flex justify-center gap-2" onPaste={handlePaste}>
              {code.map((digit, index) => (
                <input
                  key={index}
                  id={`mfa-${index}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  autoFocus={index === 0}
                  className="w-12 h-14 text-center text-2xl font-bold border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={digit}
                  onChange={(e) => handleChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                />
              ))}
            </div>
          ) : (
            <div>
              <input
                type="text"
                maxLength={20}
                className="w-full px-3 py-3 text-center font-mono text-lg tracking-widest uppercase border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="ABCD1234"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                autoFocus
              />
              <p className="mt-2 text-xs text-gray-500 text-center">
                Type or paste your 8-character recovery code
              </p>
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? 'Verifying...' : 'Verify'}
            </button>
          </div>

          <div className="text-center">
            <button
              type="button"
              onClick={toggleRecovery}
              className="text-sm font-medium text-blue-600 hover:text-blue-500 underline"
            >
              {useRecovery
                ? '← Use authenticator code instead'
                : '🔑 Use a recovery code instead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}