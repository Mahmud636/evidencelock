import apiClient from './api'

export interface CaseMember {
  user_id: string
  email: string
  full_name: string
  role: string
  assigned_at: string
  is_creator?: boolean
  is_supervisor?: boolean
  is_lead_investigator?: boolean
  is_protected?: boolean
}

export interface AssignableUser {
  id: string
  email: string
  full_name: string
  role: string
}

export interface Case {
  id: string
  case_number: string
  title: string
  description?: string
  status: string
  classification?: string
  created_by: string
  created_by_name?: string
  supervisor_id?: string
  lead_investigator_id?: string
  created_at: string
  updated_at: string
  closed_at?: string
  evidence_count: number
  member_count: number
}

export interface CaseListResponse {
  cases: Case[]
  total: number
}

export const caseService = {
  list: async (): Promise<CaseListResponse> => {
    return apiClient.get<CaseListResponse>('/api/v1/cases')
  },

  get: async (caseId: string): Promise<Case> => {
    return apiClient.get<Case>(`/api/v1/cases/${caseId}`)
  },

  getMembers: async (caseId: string): Promise<CaseMember[]> => {
    return apiClient.get<CaseMember[]>(`/api/v1/cases/${caseId}/members`)
  },

  getAssignableUsers: async (
    caseId: string
  ): Promise<{ users: AssignableUser[]; total: number }> => {
    return apiClient.get<{ users: AssignableUser[]; total: number }>(
      `/api/v1/cases/${caseId}/assignable-users`
    )
  },

  create: async (data: {
    case_number: string
    title: string
    description?: string
    classification?: string
    supervisor_id?: string
    lead_investigator_id?: string
  }): Promise<Case> => {
    return apiClient.post<Case>('/api/v1/cases', data)
  },

  update: async (
    caseId: string,
    data: {
      title?: string
      description?: string
      status?: string
      classification?: string
      supervisor_id?: string
      lead_investigator_id?: string
    }
  ): Promise<Case> => {
    return apiClient.patch<Case>(`/api/v1/cases/${caseId}`, data)
  },

  close: async (caseId: string): Promise<Case> => {
    return apiClient.patch<Case>(`/api/v1/cases/${caseId}`, {
      status: 'CLOSED',
    })
  },

  reopen: async (caseId: string): Promise<Case> => {
    return apiClient.patch<Case>(`/api/v1/cases/${caseId}`, {
      status: 'ACTIVE',
    })
  },

  addMember: async (caseId: string, userId: string): Promise<any> => {
    return apiClient.post(`/api/v1/cases/${caseId}/members`, {
      user_id: userId,
    })
  },

  removeMember: async (caseId: string, userId: string): Promise<any> => {
    return apiClient.delete(`/api/v1/cases/${caseId}/members/${userId}`)
  },
}