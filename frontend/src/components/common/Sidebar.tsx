import React, { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import apiClient from '@/services/api'

interface NavItem {
  to: string
  label: string
  icon: string
}

interface NavSection {
  title: string
  items: NavItem[]
  adminOnly?: boolean
  roles?: string[]
}

const SECTIONS: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: '▦' },
      { to: '/cases', label: 'Cases', icon: '▤' },
    ],
  },
  {
    title: 'Evidence',
    items: [
      { to: '/evidence', label: 'Registry', icon: '▥' },
      { to: '/field', label: 'Field Collection', icon: '📡' },
      { to: '/evidence/chain', label: 'Chain of Custody', icon: '⛓' },
      { to: '/evidence/integrity', label: 'Integrity Check', icon: '◈' },
      { to: '/access-requests', label: 'Access Requests', icon: '✎' },
    ],
  },
  {
    title: 'Compliance',
    items: [
      { to: '/audit', label: 'Audit Log', icon: '◉' },
      { to: '/reports', label: 'Court Report', icon: '▤' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/admin/users', label: 'Users', icon: '◯' },
      { to: '/admin/approvals', label: 'Pending Approvals', icon: '⚠' },
      { to: '/admin/invite', label: 'Invite User', icon: '＋' },
    ],
    roles: ['SYSTEM_ADMINISTRATOR', 'SUPERVISOR', 'LEAD_INVESTIGATOR'],
  },
]

export const Sidebar: React.FC = () => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [pendingCount, setPendingCount] = useState<number>(0)
  const [accessRequestCount, setAccessRequestCount] = useState<number>(0)

  useEffect(() => {
    loadPendingCount()
    loadAccessRequestCount()
  }, [user])

  const loadPendingCount = async () => {
    if (user?.role !== 'SYSTEM_ADMINISTRATOR') return
    try {
      const data = await apiClient.get<{ total: number }>('/api/v1/users/pending')
      setPendingCount(data.total)
    } catch {
      setPendingCount(0)
    }
  }

  const loadAccessRequestCount = async () => {
    try {
      const data = await apiClient.get<{
        requests: Array<{ status: string }>
        total: number
      }>('/api/v1/access-requests')

      let count = 0
      if (user?.role === 'SYSTEM_ADMINISTRATOR' || user?.role === 'SUPERVISOR') {
        count = data.requests.filter((r) => r.status === 'PENDING').length
      } else {
        count = data.requests.filter(
          (r) => r.status === 'APPROVED' || r.status === 'DOWNLOADED'
        ).length
      }
      setAccessRequestCount(count)
    } catch {
      setAccessRequestCount(0)
    }
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const userInitials = user?.full_name
    ? user.full_name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'U'

  const visibleSections = SECTIONS.filter((section) => {
    if (!section.roles) return true
    return user?.role && section.roles.includes(user.role)
  })

  return (
    <aside className="w-64 flex-shrink-0 bg-[#0B1220] border-r border-[#1E2A3E] flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-[#1E2A3E]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-600/30">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-white font-bold tracking-[0.15em] text-xs">
              EVIDENCE
            </div>
            <div className="text-blue-400 font-bold tracking-[0.25em] text-[10px]">
              LOCK
            </div>
          </div>
        </div>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto py-2">
        {visibleSections.map((section) => (
          <div key={section.title} className="mb-1">
            <div className="px-5 pt-4 pb-2 text-[10px] font-semibold text-gray-500 tracking-[0.15em] uppercase">
              {section.title}
            </div>
            <div className="px-2 space-y-0.5">
              {section.items.map((item) => {
                let badge: number | undefined = undefined
                if (item.to === '/admin/approvals' && pendingCount > 0) {
                  badge = pendingCount
                }
                if (
                  item.to === '/access-requests' &&
                  accessRequestCount > 0
                ) {
                  badge = accessRequestCount
                }
                return (
                  <SidebarLink key={item.to} item={item} badge={badge} />
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t border-[#1E2A3E] p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-md bg-blue-500/20 border border-blue-500/40 flex items-center justify-center flex-shrink-0">
            <span className="text-blue-400 text-xs font-bold">{userInitials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-white truncate">
              {user?.full_name || user?.email}
            </div>
            <div className="text-[10px] text-gray-500 truncate tracking-wider">
              {user?.role}
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full text-left text-xs text-gray-400 hover:text-red-400 
                     transition-colors px-2 py-1.5 rounded hover:bg-[#1E2A3E]"
        >
          ⌐ Sign Out
        </button>
      </div>
    </aside>
  )
}

const SidebarLink: React.FC<{ item: NavItem; badge?: number }> = ({
  item,
  badge,
}) => (
  <NavLink
    to={item.to}
    end={
      item.to === '/dashboard' ||
      item.to === '/evidence' ||
      item.to === '/cases'
    }
    className={({ isActive }) =>
      isActive
        ? 'flex items-center gap-3 px-3 py-2 rounded-md text-sm bg-blue-600 text-white font-medium transition-colors'
        : 'flex items-center gap-3 px-3 py-2 rounded-md text-sm text-gray-300 hover:bg-[#1E2A3E] hover:text-white transition-colors'
    }
  >
    <span className="text-base opacity-80 w-4 text-center">{item.icon}</span>
    <span className="flex-1 truncate">{item.label}</span>
    {badge !== undefined && badge > 0 && (
      <span className="text-[10px] bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center font-bold">
        {badge > 99 ? '99+' : badge}
      </span>
    )}
  </NavLink>
)