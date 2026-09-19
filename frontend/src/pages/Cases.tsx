import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { caseService, Case } from '@/services/cases'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'

export const Cases: React.FC = () => {
  const [cases, setCases] = useState<Case[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { user } = useAuth()

  useEffect(() => {
    loadCases()
  }, [])

  const loadCases = async () => {
    try {
      const response = await caseService.list()
      setCases(response.cases)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load cases')
    } finally {
      setIsLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const classes: Record<string, string> = {
      ACTIVE: 'dark-badge-blue',
      CLOSED: 'dark-badge-gray',
      ARCHIVED: 'dark-badge-gray',
      PENDING: 'dark-badge-yellow',
    }
    return classes[status] || 'dark-badge-gray'
  }

  const canCreateCase =
    user?.role === 'SYSTEM_ADMINISTRATOR' || user?.role === 'SUPERVISOR'

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-xs text-gray-500 tracking-wider">
            {cases.length} CASE{cases.length !== 1 ? 'S' : ''} ACCESSIBLE
          </p>
        </div>
        {canCreateCase && (
          <Link to="/cases/new" className="dark-btn-primary w-auto inline-block px-5">
            ＋ New Case
          </Link>
        )}
      </div>

      {cases.length === 0 ? (
        <div className="dark-card text-center py-16">
          <p className="text-gray-400">No cases available</p>
          {canCreateCase && (
            <Link
              to="/cases/new"
              className="mt-3 inline-block text-blue-400 hover:text-blue-300 text-sm font-medium"
            >
              ＋ Create your first case
            </Link>
          )}
        </div>
      ) : (
        <div className="dark-card p-0 overflow-hidden">
          <table className="dark-table">
            <thead>
              <tr>
                <th>Case Number</th>
                <th>Title</th>
                <th>Status</th>
                <th>Evidence</th>
                <th>Members</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono font-medium text-white whitespace-nowrap">
                    {c.case_number}
                  </td>
                  <td>
                    <div className="font-medium text-white">{c.title}</div>
                    {c.description && (
                      <div className="text-xs text-gray-500 truncate max-w-md mt-0.5">
                        {c.description}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className={getStatusBadge(c.status)}>{c.status}</span>
                  </td>
                  <td className="text-white font-mono">{c.evidence_count}</td>
                  <td className="text-white font-mono">{c.member_count}</td>
                  <td className="whitespace-nowrap">
                    <Link
                      to={`/cases/${c.id}`}
                      className="text-blue-400 hover:text-blue-300 text-xs font-medium tracking-wider"
                    >
                      VIEW →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}