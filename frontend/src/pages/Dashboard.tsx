import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { dashboardService, DashboardStats } from '@/services/dashboard'
import toast from 'react-hot-toast'

export const Dashboard: React.FC = () => {
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadStats()
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadStats, 30000)
    // Refresh whenever the tab regains focus
    const onFocus = () => loadStats()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const loadStats = async () => {
    try {
      const data = await dashboardService.getStats()
      setStats(data)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load dashboard')
    } finally {
      setIsLoading(false)
    }
  }

  const formatEventType = (eventType: string) => {
    return eventType
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (l) => l.toUpperCase())
  }

  const formatTime = (iso: string) => {
    const date = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    return date.toLocaleDateString()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  const violationEvents = stats?.violation_events ?? 0
  const compromisedItems = stats?.compromised_items ?? stats?.violation_count ?? 0
  const hasViolations = violationEvents > 0 || compromisedItems > 0

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-wide">
            System Overview
          </h2>
          <p className="text-xs text-gray-500 tracking-wider mt-1">
            {new Date().toLocaleString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            · All systems operational
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          label="Active Cases"
          value={stats?.active_cases || 0}
          sub={`${stats?.total_cases || 0} total`}
          accent="text-white"
        />
        <StatCard
          label="Evidence Items"
          value={stats?.evidence_count || 0}
          sub={`${stats?.verified_count || 0} verified`}
          accent="text-blue-400"
        />
        <StatCard
          label="Integrity Warnings"
          value={violationEvents}
          sub={
            hasViolations
              ? `${compromisedItems} item${compromisedItems !== 1 ? 's' : ''} affected`
              : 'All clear'
          }
          accent={hasViolations ? 'text-red-400' : 'text-green-400'}
          borderColor={hasViolations ? 'border-red-500/40' : 'border-[#1E2A3E]'}
        />
        <StatCard
          label="Audit Events"
          value={stats?.total_audit_events || 0}
          sub={`${stats?.total_custody_events || 0} custody events`}
          accent="text-purple-400"
        />
      </div>

      {/* Integrity Alert Banner */}
      {hasViolations && (
        <div className="dark-alert">
          <div className="dark-alert-icon">
            <span className="text-sm font-bold">!</span>
          </div>
          <div className="flex-1">
            <p className="dark-alert-title">
              INTEGRITY ALERT — Action Required
            </p>
            <p className="dark-alert-body">
              <b>{violationEvents}</b> integrity violation event
              {violationEvents !== 1 ? 's have' : ' has'} been recorded, affecting{' '}
              <b>{compromisedItems}</b> evidence item
              {compromisedItems !== 1 ? 's' : ''}. Evidence may have been tampered
              with. Review the evidence registry immediately.
            </p>
            <Link
              to="/evidence"
              className="inline-block mt-2 text-xs text-red-400 hover:text-red-300 font-medium underline"
            >
              Review Evidence →
            </Link>
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Activity */}
        <div className="dark-card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-semibold text-white tracking-wider uppercase">
              Recent Activity
            </h3>
            <Link
              to="/audit"
              className="text-[10px] text-blue-400 hover:text-blue-300 tracking-wider"
            >
              VIEW ALL →
            </Link>
          </div>

          {!stats?.recent_activity || stats.recent_activity.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">
              No recent activity
            </p>
          ) : (
            <div className="space-y-2.5">
              {stats.recent_activity.slice(0, 8).map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 py-2 border-b border-[#1E2A3E] last:border-0"
                >
                  <div className="text-base flex-shrink-0 w-6 text-center">
                    {getEventIcon(activity.event_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">
                      {formatEventType(activity.event_type)}
                    </p>
                    <p className="text-[10px] text-gray-500 truncate">
                      {activity.actor}
                      {activity.details?.evidence_id &&
                        ` · ${activity.details.evidence_id}`}
                      {activity.details?.filename &&
                        ` · ${activity.details.filename}`}
                    </p>
                  </div>
                  <div className="text-[10px] text-gray-600 whitespace-nowrap">
                    {formatTime(activity.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="dark-card">
          <h3 className="text-sm font-semibold text-white tracking-wider uppercase mb-4">
            Quick Actions
          </h3>
          <div className="space-y-2">
            <QuickAction
              to="/cases"
              icon="▤"
              label="View All Cases"
              sub="Browse active investigations"
            />
            <QuickAction
              to="/evidence"
              icon="▥"
              label="Evidence Registry"
              sub="Search and verify evidence"
            />
            <QuickAction
              to="/evidence/integrity"
              icon="◈"
              label="Run Integrity Check"
              sub="Bulk verify all evidence"
            />
            {(user?.role === 'SYSTEM_ADMINISTRATOR' ||
              user?.role === 'LEAD_INVESTIGATOR') && (
              <QuickAction
                to="/evidence/register"
                icon="＋"
                label="Register New Evidence"
                sub="Upload file with SHA-256"
              />
            )}
            {user?.role === 'SYSTEM_ADMINISTRATOR' && (
              <QuickAction
                to="/admin/approvals"
                icon="⚠"
                label="Pending Approvals"
                sub="Review access requests"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Sub-components ----------

const StatCard: React.FC<{
  label: string
  value: number
  sub: string
  accent?: string
  borderColor?: string
}> = ({
  label,
  value,
  sub,
  accent = 'text-white',
  borderColor = 'border-[#1E2A3E]',
}) => (
  <div
    className={`bg-[#0F1729] border ${borderColor} rounded-lg p-5 relative overflow-hidden`}
  >
    <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500/40 to-transparent" />
    <p className="text-[10px] font-semibold text-gray-500 tracking-[0.15em] uppercase mb-3">
      {label}
    </p>
    <p className={`text-4xl font-bold ${accent} leading-none`}>{value}</p>
    <p className="text-[11px] text-gray-500 mt-2">{sub}</p>
  </div>
)

const QuickAction: React.FC<{
  to: string
  icon: string
  label: string
  sub: string
}> = ({ to, icon, label, sub }) => (
  <Link
    to={to}
    className="flex items-center gap-3 p-3 rounded-md 
               hover:bg-[#132035] transition-colors group"
  >
    <div className="w-9 h-9 rounded-md bg-blue-500/10 border border-blue-500/30 
                    flex items-center justify-center flex-shrink-0">
      <span className="text-blue-400 text-sm">{icon}</span>
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-sm text-white font-medium truncate">{label}</div>
      <div className="text-[10px] text-gray-500 truncate">{sub}</div>
    </div>
    <span className="text-gray-600 group-hover:text-blue-400 transition-colors">
      →
    </span>
  </Link>
)

function getEventIcon(eventType: string): string {
  if (eventType.includes('VIOLATION')) return '⚠'
  if (eventType.includes('VERIFIED')) return '✓'
  if (eventType.includes('EVIDENCE')) return '▥'
  if (eventType.includes('CASE')) return '▤'
  if (eventType.includes('LOGIN')) return '⌐'
  if (eventType.includes('MFA')) return '🔐'
  return '·'
}