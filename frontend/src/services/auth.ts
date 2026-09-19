import apiClient from './api'
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  MFAActivateResponse,
  MFAVerifyRequest,
  MFAVerifyResponse,
  User,
} from '@/types'

export const authService = {
  register: async (data: RegisterRequest): Promise<RegisterResponse> => {
    return apiClient.post<RegisterResponse>('/api/v1/auth/register', data)
  },

  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>('/api/v1/auth/login', data)
    if (response.access_token && !response.mfa_required) {
      localStorage.setItem('access_token', response.access_token)
    }
    return response
  },

  /** Verify TOTP code during login (after /login returned mfa_required=true). */
  verifyMFALogin: async (totpCode: string): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>(
      '/api/v1/auth/mfa/verify-login',
      { totp_code: totpCode }
    )
    if (response.access_token) {
      localStorage.setItem('access_token', response.access_token)
    }
    return response
  },

  logout: async (): Promise<void> => {
    try {
      await apiClient.post('/api/v1/auth/logout')
    } catch (error) {
      // ignore
    } finally {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
    }
  },

  getCurrentUser: async (): Promise<User> => {
    return apiClient.get<User>('/api/v1/auth/me')
  },

  enrollMFA: async (): Promise<MFAActivateResponse> => {
    return apiClient.post<MFAActivateResponse>('/api/v1/auth/mfa/enroll')
  },

  confirmMFA: async (totpCode: string): Promise<MFAVerifyResponse> => {
    return apiClient.post<MFAVerifyResponse>('/api/v1/auth/mfa/confirm', {
      totp_code: totpCode,
    })
  },

  verifyMFA: async (data: MFAVerifyRequest): Promise<MFAVerifyResponse> => {
    return apiClient.post<MFAVerifyResponse>('/api/v1/auth/mfa/verify', data)
  },

  disableMFA: async (totpCode: string): Promise<{ success: boolean; message: string }> => {
    return apiClient.post('/api/v1/auth/mfa/disable', { recovery_code: totpCode })
  },

  isAuthenticated: (): boolean => {
    return !!localStorage.getItem('access_token')
  },

  clearTokens: (): void => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
  },
}