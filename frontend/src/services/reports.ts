import { apiClient } from './api'

export interface Report {
  report_id: string
  title: string
  report_type: string
  evidence_id?: string | null
  case_number?: string | null
  generated_by: string
  generated_at: string
  status: string
  hash: string
}

export interface CaseReportResult {
  report_id: string
  case_id: string
  case_number: string
  evidence_count: number
  file_path: string
  hash: string
  generated_at: string
}

export interface EvidenceReportResult {
  report_id: string
  evidence_id: string
  file_path: string
  hash: string
  generated_at: string
}

export const reportService = {
  list: async (): Promise<{ reports: Report[]; total: number }> => {
    const response = await apiClient.getClient().get('/api/v1/reports')
    return response.data
  },

  generateCaseReport: async (caseId: string): Promise<CaseReportResult> => {
    const response = await apiClient
      .getClient()
      .post(`/api/v1/reports/case/${caseId}`, {})
    return response.data
  },

  generateEvidenceReport: async (
    evidenceId: string
  ): Promise<EvidenceReportResult> => {
    const response = await apiClient
      .getClient()
      .post(`/api/v1/reports/evidence/${evidenceId}`, {})
    return response.data
  },

  download: async (reportId: string): Promise<Blob> => {
    const response = await apiClient.getClient().get(
      `/api/v1/reports/${reportId}/download`,
      { responseType: 'blob' }
    )
    return response.data
  },
}