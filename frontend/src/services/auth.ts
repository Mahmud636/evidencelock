import apiClient from './api'

export interface LoginResponse {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in: number
  mfa_required: boolean
  user_id: string
  email: string
  full_name: string
  role: string
}

export interface MFAEnrollResponse {
  secret: string
  qr_code: string
  backup_codes: string[]
}

export interface MFAVerifyResponse {
  verified: boolean
  message: string
}

export interface RegisterData {
  email: string
  username: string
  password: string
  full_name: string
}

export const authService = {
  login: async (data: { email: string; password: string }): Promise<LoginResponse> => {
    return apiClient.post<LoginResponse>('/api/v1/auth/login', data)
  },

  verifyMfaLogin: async (totpCode: string): Promise<LoginResponse> => {
    return apiClient.post<LoginResponse>('/api/v1/auth/mfa/verify-login', {
      totp_code: totpCode,
    })
  },

  register: async (data: RegisterData): Promise<any> => {
    return apiClient.post('/api/v1/auth/register', data)
  },

  enrollMFA: async (): Promise<MFAEnrollResponse> => {
    return apiClient.post<MFAEnrollResponse>('/api/v1/auth/mfa/enroll')
  },

  confirmMFA: async (totpCode: string): Promise<MFAVerifyResponse> => {
    return apiClient.post<MFAVerifyResponse>('/api/v1/auth/mfa/confirm', {
      totp_code: totpCode,
    })
  },

  verifyMFA: async (data: { totp_code: string }): Promise<MFAVerifyResponse> => {
    return apiClient.post<MFAVerifyResponse>('/api/v1/auth/mfa/confirm', data)
  },

  disableMFA: async (totpCode: string): Promise<any> => {
    return apiClient.post('/api/v1/auth/mfa/disable', {
      totp_code: totpCode,
    })
  },

  refreshToken: async (refreshToken: string): Promise<any> => {
    return apiClient.post('/api/v1/auth/refresh', {
      refresh_token: refreshToken,
    })
  },

  getCurrentUser: async (): Promise<any> => {
    return apiClient.get('/api/v1/auth/me')
  },

  logout: () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
  },
}

export default authService