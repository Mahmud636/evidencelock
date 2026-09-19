import apiClient from './api'

export interface AuditLog {
  id: string
  event_type: string
  action?: string
  user_id?: string
  user_name: string
  user_email?: string
  ip_address?: string
  resource_type?: string
  resource_id?: string
  details?: any
  previous_hash?: string
  current_hash: string
  integrity_verified: boolean
  created_at: string
}

export interface AuditListResponse {
  logs: AuditLog[]
  total: number
}

export interface VerifyChainResponse {
  total_entries: number
  verified: boolean
  broken_at?: number
  broken_entry_id?: string
  broken_event_type?: string
  broken_at_time?: string
  reason?: string
  message: string
}

export const auditService = {
  list: async (params?: {
    event_type?: string
    user_id?: string
    limit?: number
    offset?: number
  }): Promise<AuditListResponse> => {
    const query = new URLSearchParams()
    if (params?.event_type) query.append('event_type', params.event_type)
    if (params?.user_id) query.append('user_id', params.user_id)
    if (params?.limit) query.append('limit', String(params.limit))
    if (params?.offset) query.append('offset', String(params.offset))
    const qs = query.toString()
    return apiClient.get<AuditListResponse>(`/api/v1/audit${qs ? '?' + qs : ''}`)
  },

  getEventTypes: async (): Promise<{ event_types: string[] }> => {
    return apiClient.get<{ event_types: string[] }>('/api/v1/audit/event-types')
  },

  verifyChain: async (): Promise<VerifyChainResponse> => {
    return apiClient.post<VerifyChainResponse>('/api/v1/audit/verify-chain')
  },
}