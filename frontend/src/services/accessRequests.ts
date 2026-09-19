import apiClient from './api'

export interface AccessRequest {
  id: string
  request_id: string
  evidence_id: string
  evidence_external_id?: string
  evidence_filename?: string
  case_id: string
  case_number?: string
  requested_by: string
  requester_name?: string
  reason: string
  status: string
  reviewed_by?: string
  reviewer_name?: string
  reviewed_at?: string
  review_note?: string
  downloaded_at?: string
  returned_at?: string
  return_hash?: string
  return_verified_by?: string
  return_verifier_name?: string
  return_verified_at?: string
  return_notes?: string
  created_at: string
}

export interface AccessRequestListResponse {
  requests: AccessRequest[]
  total: number
}

export const accessRequestService = {
  list: async (params?: {
    status?: string
    scope?: 'all' | 'mine' | 'incoming'
  }): Promise<AccessRequestListResponse> => {
    const q = new URLSearchParams()
    if (params?.status) q.append('status', params.status)
    if (params?.scope) q.append('scope', params.scope)
    const qs = q.toString()
    return apiClient.get<AccessRequestListResponse>(
      `/api/v1/access-requests${qs ? '?' + qs : ''}`
    )
  },

  get: async (requestId: string): Promise<AccessRequest> => {
    return apiClient.get<AccessRequest>(`/api/v1/access-requests/${requestId}`)
  },

  create: async (data: {
    evidence_id: string
    reason: string
  }): Promise<AccessRequest> => {
    return apiClient.post<AccessRequest>('/api/v1/access-requests', data)
  },

  review: async (
    requestId: string,
    data: { approve: boolean; note?: string }
  ): Promise<AccessRequest> => {
    return apiClient.post<AccessRequest>(
      `/api/v1/access-requests/${requestId}/review`,
      data
    )
  },

  download: async (requestId: string): Promise<Blob> => {
    const response = await apiClient.getClient().post(
      `/api/v1/access-requests/${requestId}/download`,
      {},
      { responseType: 'blob' }
    )
    return response.data
  },

  returnEvidence: async (
    requestId: string,
    file: File,
    notes?: string
  ): Promise<any> => {
    const formData = new FormData()
    formData.append('file', file)
    if (notes) formData.append('notes', notes)
    return apiClient.upload(
      `/api/v1/access-requests/${requestId}/return`,
      formData
    )
  },

  verifyReturn: async (
    requestId: string,
    data: { verified: boolean; notes?: string }
  ): Promise<AccessRequest> => {
    return apiClient.post<AccessRequest>(
      `/api/v1/access-requests/${requestId}/verify-return`,
      data
    )
  },
}