import apiClient from './api'

export interface Role {
  id: string
  name: string
  description?: string
}

export interface PendingUser {
  id: string
  email: string
  username: string
  full_name: string
  role: string
  role_id: string
  invited_by_name?: string
  created_at: string
}

export interface PendingListResponse {
  users: PendingUser[]
  total: number
}

export interface InviteResponse {
  id: string
  email: string
  username: string
  full_name: string
  role: string
  temporary_password: string
  message: string
}

export interface UserListItem {
  id: string
  email: string
  username: string
  full_name: string
  role: string
  role_id: string
  is_active: boolean
  is_approved: boolean
  mfa_enabled: boolean
  last_login?: string
  created_at: string
  updated_at: string
  pending_email?: string | null
}

export interface UserListResponse {
  users: UserListItem[]
  total: number
}

export interface Profile {
  id: string
  email: string
  pending_email?: string | null
  email_change_requested_at?: string | null
  username: string
  full_name: string
  role: string
  role_id: string
  mfa_enabled: boolean
  is_active: boolean
  is_approved: boolean
  last_login?: string
  created_at: string
}

export interface ProfileUpdateResponse {
  message: string
  email_change_pending: boolean
  pending_email?: string | null
  updated_fields: string[]
}

export interface PasswordChangeResponse {
  message: string
  changed_at: string
}

export const userService = {
  // ---------- Self-service profile ----------
  getMyProfile: async (): Promise<Profile> => {
    return apiClient.get<Profile>('/api/v1/users/me')
  },

  updateMyProfile: async (data: {
    full_name?: string
    username?: string
    email?: string
  }): Promise<ProfileUpdateResponse> => {
    return apiClient.put<ProfileUpdateResponse>('/api/v1/users/me', data)
  },

  changeMyPassword: async (data: {
    current_password: string
    new_password: string
    confirm_password: string
  }): Promise<PasswordChangeResponse> => {
    return apiClient.post<PasswordChangeResponse>(
      '/api/v1/users/me/change-password',
      data
    )
  },

  // ---------- Admin: email change approval ----------
  approveEmailChange: async (userId: string): Promise<any> => {
    return apiClient.post(`/api/v1/users/${userId}/approve-email`)
  },

  rejectEmailChange: async (userId: string): Promise<any> => {
    return apiClient.post(`/api/v1/users/${userId}/reject-email`)
  },

  // ---------- Admin: existing ----------
  getAvailableRoles: async (): Promise<{ roles: Role[] }> => {
    return apiClient.get<{ roles: Role[] }>('/api/v1/users/available-roles')
  },

  invite: async (data: {
    email: string
    username: string
    full_name: string
    role_id: string
  }): Promise<InviteResponse> => {
    return apiClient.post<InviteResponse>('/api/v1/users/invite', data)
  },

  listPending: async (): Promise<PendingListResponse> => {
    return apiClient.get<PendingListResponse>('/api/v1/users/pending')
  },

  approve: async (userId: string): Promise<any> => {
    return apiClient.post(`/api/v1/users/${userId}/approve`)
  },

  reject: async (userId: string, reason?: string): Promise<any> => {
    return apiClient.post(`/api/v1/users/${userId}/reject`, { reason })
  },

  listUsers: async (search?: string): Promise<UserListResponse> => {
    const url = search
      ? `/api/v1/users?search=${encodeURIComponent(search)}`
      : '/api/v1/users'
    return apiClient.get<UserListResponse>(url)
  },

  updateRole: async (userId: string, roleId: string): Promise<any> => {
    return apiClient.put(`/api/v1/users/${userId}/role`, { role_id: roleId })
  },

  deactivate: async (userId: string): Promise<any> => {
    return apiClient.post(`/api/v1/users/${userId}/deactivate`)
  },

  activate: async (userId: string): Promise<any> => {
    return apiClient.post(`/api/v1/users/${userId}/activate`)
  },
}