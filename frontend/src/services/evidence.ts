import apiClient from './api'

export interface ViolationInfo {
  detected: boolean
  reason: string
  request_id?: string | null
  return_hash?: string | null
  detected_at?: string | null
}

export interface Evidence {
  id: string
  evidence_id: string
  case_id: string
  case_number?: string
  original_filename: string
  file_type?: string
  file_size?: number
  original_hash: string
  current_hash?: string
  collection_date?: string
  collector_id: string
  collector_name?: string
  description?: string
  source_device?: string
  evidence_status: string
  created_at: string
  last_verified_at?: string
  verified_status?: string
  is_compromised?: boolean
  violation_info?: ViolationInfo | null
}

export interface EvidenceListResponse {
  evidence: Evidence[]
  total: number
}

export interface VerifyResponse {
  evidence_id: string
  original_hash: string
  current_hash: string
  integrity_verified: boolean
  disk_verified?: boolean
  sticky_violation?: boolean
  verified_at: string
  verified_by: string
  message: string
}

export const evidenceService = {
  list: async (caseId?: string): Promise<EvidenceListResponse> => {
    const url = caseId
      ? `/api/v1/evidence?case_id=${caseId}`
      : '/api/v1/evidence'
    return apiClient.get<EvidenceListResponse>(url)
  },

  get: async (id: string): Promise<Evidence> => {
    return apiClient.get<Evidence>(`/api/v1/evidence/${id}`)
  },

  verify: async (id: string): Promise<VerifyResponse> => {
    return apiClient.post<VerifyResponse>(`/api/v1/evidence/${id}/verify`)
  },

  register: async (formData: FormData): Promise<Evidence> => {
    return apiClient.upload<Evidence>('/api/v1/evidence', formData)
  },
}