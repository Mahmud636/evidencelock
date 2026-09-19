import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAuth } from '@/hooks/useAuth'

interface LayoutProps {
  children: ReactNode
}

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/cases': 'Cases',
  '/evidence': 'Evidence Registry',
  '/evidence/chain': 'Chain of Custody',
  '/evidence/integrity': 'Integrity Check',
  '/audit': 'Audit Log',
  '/reports': 'Court Reports',
  '/admin/users': 'User Management',
  '/admin/approvals': 'Pending Approvals',
  '/admin/invite': 'Invite User',
  '/profile': 'Profile & Security',
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation()
  const { user } = useAuth()

  const getPageTitle = (): string => {
    // Exact match
    if (PAGE_TITLES[location.pathname]) return PAGE_TITLES[location.pathname]
    // Prefix match (for /cases/:id, /evidence/:id)
    if (location.pathname.startsWith('/cases/')) return 'Case Details'
    if (location.pathname.startsWith('/evidence/register')) return 'Register Evidence'
    if (location.pathname.startsWith('/evidence/')) return 'Evidence Details'
    return 'EvidenceLock'
  }

  const getBreadcrumb = (): string => {
    if (location.pathname === '/dashboard') return ''
    const parts = location.pathname.split('/').filter(Boolean)
    return parts.join(' / ').toUpperCase()
  }

  const userInitials = user?.full_name
    ? user.full_name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'U'

  return (
    <div className="min-h-screen flex dark-bg">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 bg-[#0B1220] border-b border-[#1E2A3E] flex items-center justify-between px-6 sticky top-0 z-20">
          <div>
            <h1 className="text-lg font-semibold text-white tracking-wide">
              {getPageTitle()}
            </h1>
            {getBreadcrumb() && (
              <p className="text-[10px] text-gray-500 tracking-wider mt-0.5">
                {getBreadcrumb()}
              </p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <Link
              to="/profile"
              className="flex items-center gap-2 px-3 py-1.5 rounded-md 
                         bg-[#0F1729] border border-[#1E2A3E] 
                         hover:border-blue-500/50 transition-colors"
            >
              <div className="w-7 h-7 rounded bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
                <span className="text-blue-400 text-[10px] font-bold">
                  {userInitials}
                </span>
              </div>
              <span className="text-xs text-gray-300 hidden md:inline">
                {user?.full_name?.split(' ')[0] || 'User'}
              </span>
              <span className="text-[10px] bg-blue-500/20 text-blue-400 
                              px-2 py-0.5 rounded-full tracking-wider font-medium">
                {user?.role?.replace('SYSTEM_', '').replace('_', ' ') || 'USER'}
              </span>
            </Link>
          </div>
        </header>

        {/* Page body */}
        <main className="flex-1 p-6 overflow-x-hidden">
          {children}
        </main>

        {/* Footer */}
        <footer className="px-6 py-3 border-t border-[#1E2A3E] flex justify-between items-center text-[10px] text-gray-600 tracking-wider">
          <span>EVIDENCELOCK v1.0 · SECURE EVIDENCE MANAGEMENT</span>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
            SYSTEM OPERATIONAL
          </span>
        </footer>
      </div>
    </div>
  )
}