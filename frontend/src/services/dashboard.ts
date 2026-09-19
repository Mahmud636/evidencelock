import apiClient from './api'

export interface RecentActivity {
  id: string
  event_type: string
  action?: string
  details?: any
  actor: string
  created_at: string
}

export interface DashboardStats {
  total_cases: number
  active_cases: number
  evidence_count: number
  verified_count: number
  violation_count: number
  compromised_items: number
  violation_events: number
  total_audit_events: number
  total_custody_events: number
  recent_activity: RecentActivity[]
}

export const dashboardService = {
  getStats: async (): Promise<DashboardStats> => {
    return apiClient.get<DashboardStats>('/api/v1/dashboard/stats')
  },
}