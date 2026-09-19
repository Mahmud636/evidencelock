import apiClient from './api'

export interface CustodyEvent {
  id: string
  event_id: string
  evidence_id: string
  case_id: string
  action: string
  description?: string
  location?: string
  user_id?: string
  user_name: string
  previous_hash?: string
  current_hash: string
  integrity_status?: string
  metadata?: any
  created_at: string
}

export interface CustodyListResponse {
  events: CustodyEvent[]
  total: number
}

export interface VerifyCustodyResponse {
  evidence_id: string
  total_events: number
  verified: boolean
  broken_at?: number
  broken_event_id?: string
  reason?: string
  message: string
}

export const custodyService = {
  list: async (params?: {
    evidence_id?: string
    action?: string
    limit?: number
  }): Promise<CustodyListResponse> => {
    const query = new URLSearchParams()
    if (params?.evidence_id) query.append('evidence_id', params.evidence_id)
    if (params?.action) query.append('action', params.action)
    if (params?.limit) query.append('limit', String(params.limit))
    const qs = query.toString()
    return apiClient.get<CustodyListResponse>(`/api/v1/custody${qs ? '?' + qs : ''}`)
  },

  getActions: async (): Promise<{ actions: string[] }> => {
    return apiClient.get<{ actions: string[] }>('/api/v1/custody/actions')
  },

  verify: async (evidenceId: string): Promise<VerifyCustodyResponse> => {
    return apiClient.post<VerifyCustodyResponse>(`/api/v1/custody/verify/${evidenceId}`)
  },
}