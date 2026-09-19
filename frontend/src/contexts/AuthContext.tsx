import React, { createContext, useState, useContext, useEffect, useCallback } from 'react'
import { authService } from '@/services/auth'
import type { User, AuthState } from '@/types'
import toast from 'react-hot-toast'

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean }>
  completeMFALogin: (code: string) => Promise<boolean>
  register: (data: { email: string; username: string; password: string; full_name: string }) => Promise<void>
  logout: () => Promise<void>
  verifyMFA: (code: string) => Promise<boolean>
  enrollMFA: () => Promise<{ secret: string; qr_code: string; recovery_codes: string[] }>
  checkAuth: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const extractErrorMessage = (error: any, defaultMessage: string): string => {
  const detail = error?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((e: any) => e.msg || JSON.stringify(e)).join(', ')
  }
  if (detail && typeof detail === 'object') return detail.msg || JSON.stringify(detail)
  if (error?.message) return error.message
  return defaultMessage
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
    mfaRequired: false,
  })

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = useCallback(async () => {
    try {
      const token = localStorage.getItem('access_token')
      if (!token) {
        setState(prev => ({ ...prev, isLoading: false }))
        return
      }
      const user = await authService.getCurrentUser()
      setState({
        user,
        token,
        isAuthenticated: true,
        isLoading: false,
        mfaRequired: false,
      })
    } catch (error) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      setState(prev => ({ ...prev, isLoading: false, isAuthenticated: false }))
    }
  }, [])

  const login = async (email: string, password: string): Promise<{ mfaRequired: boolean }> => {
    try {
      const response = await authService.login({ email, password })

      if (response.mfa_required) {
        // Keep partial token in localStorage so we can authorize the MFA verify call
        localStorage.setItem('access_token', response.access_token)
        setState(prev => ({
          ...prev,
          mfaRequired: true,
          token: response.access_token,
          user: {
            id: response.user_id,
            email: response.email,
            full_name: response.full_name,
            role: response.role,
            username: response.email.split('@')[0],
            is_active: true,
            is_approved: true,
            mfa_enabled: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        }))
        return { mfaRequired: true }
      }

      const user = {
        id: response.user_id,
        email: response.email,
        full_name: response.full_name,
        role: response.role,
        username: response.email.split('@')[0],
        is_active: true,
        is_approved: true,
        mfa_enabled: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setState({
        user,
        token: response.access_token,
        isAuthenticated: true,
        isLoading: false,
        mfaRequired: false,
      })
      toast.success('Login successful!')
      return { mfaRequired: false }
    } catch (error: any) {
      const msg = extractErrorMessage(error, 'Login failed')
      toast.error(msg)
      throw error
    }
  }

  const completeMFALogin = async (code: string): Promise<boolean> => {
    try {
      const response = await authService.verifyMFALogin(code)

      const user = {
        id: response.user_id,
        email: response.email,
        full_name: response.full_name,
        role: response.role,
        username: response.email.split('@')[0],
        is_active: true,
        is_approved: true,
        mfa_enabled: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setState({
        user,
        token: response.access_token,
        isAuthenticated: true,
        isLoading: false,
        mfaRequired: false,
      })
      toast.success('Welcome back!')
      return true
    } catch (error: any) {
      const msg = extractErrorMessage(error, 'Invalid MFA code')
      toast.error(msg)
      return false
    }
  }

  const register = async (data: { email: string; username: string; password: string; full_name: string }) => {
    try {
      await authService.register(data)
      toast.success('Account created! Awaiting administrator approval.')
    } catch (error: any) {
      const msg = extractErrorMessage(error, 'Registration failed')
      toast.error(msg)
      throw error
    }
  }

  const logout = async () => {
    await authService.logout()
    setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      mfaRequired: false,
    })
    toast.success('Logged out')
  }

  const verifyMFA = async (code: string): Promise<boolean> => {
    try {
      const response = await authService.verifyMFA({ totp_code: code })
      if (response.verified) {
        toast.success('MFA verified!')
        return true
      } else {
        toast.error('Invalid MFA code')
        return false
      }
    } catch (error: any) {
      const msg = extractErrorMessage(error, 'MFA verification failed')
      toast.error(msg)
      return false
    }
  }

  const enrollMFA = async () => {
    try {
      const response = await authService.enrollMFA()
      return response
    } catch (error: any) {
      const msg = extractErrorMessage(error, 'MFA enrollment failed')
      toast.error(msg)
      throw error
    }
  }

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        completeMFALogin,
        register,
        logout,
        verifyMFA,
        enrollMFA,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}