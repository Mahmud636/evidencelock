export interface User {
  id: string
  email: string
  username: string
  full_name: string
  role: string
  is_active: boolean
  is_approved: boolean
  mfa_enabled: boolean
  created_at: string
  updated_at: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  expires_in: number
  mfa_required: boolean
  user_id: string
  email: string
  full_name: string
  role: string
}

export interface RegisterRequest {
  email: string
  username: string
  password: string
  full_name: string
}

export interface RegisterResponse {
  id: string
  email: string
  username: string
  full_name: string
  message: string
  status: string
}

export interface MFAActivateResponse {
  secret: string
  qr_code: string
  recovery_codes: string[]
  message: string
}

export interface MFAVerifyRequest {
  totp_code: string
}

export interface MFAVerifyResponse {
  verified: boolean
  message: string
}

export interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  mfaRequired: boolean
}
