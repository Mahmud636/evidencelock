import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import apiClient from '@/services/api'
import toast from 'react-hot-toast'

interface ReportItem {
  report_id: string
  title: string
  report_type: string
  evidence_id?: string | null
  case_number?: string | null
  generated_by: string
  generated_at: string
  status: string
  hash?: string
}

type Filter = 'ALL' | 'CASE' | 'EVIDENCE'

export const Reports: React.FC = () => {
  const [reports, setReports] = useState<ReportItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('ALL')

  useEffect(() => {
    loadReports()
  }, [])

  const loadReports = async () => {
    try {
      const data = await apiClient.get<{ reports: ReportItem[]; total: number }>(
        '/api/v1/reports'
      )
      setReports(data.reports)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load reports')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownload = async (reportId: string) => {
    setDownloadingId(reportId)
    try {
      const response = await apiClient.getClient().get(
        `/api/v1/reports/${reportId}/download`,
        { responseType: 'blob' }
      )
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `${reportId}.pdf`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      toast.success('Report downloaded')
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Download failed')
    } finally {
      setDownloadingId(null)
    }
  }

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const isCaseReport = (r: ReportItem) => r.report_type === 'CASE_SUMMARY'

  const filtered = reports.filter((r) => {
    if (filter === 'ALL') return true
    if (filter === 'CASE') return isCaseReport(r)
    return !isCaseReport(r)
  })

  const caseCount = reports.filter(isCaseReport).length
  const evidenceCount = reports.length - caseCount

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header + filter tabs */}
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <p className="text-xs text-gray-500 tracking-wider">
          {filtered.length} REPORT{filtered.length !== 1 ? 'S' : ''}
          {filter !== 'ALL' && ` (FILTERED FROM ${reports.length})`}
        </p>

        <div className="flex gap-1 bg-[#0B1220] border border-[#1E2A3E] rounded-lg p-1">
          <FilterTab
            label={`All (${reports.length})`}
            active={filter === 'ALL'}
            onClick={() => setFilter('ALL')}
          />
          <FilterTab
            label={`Case (${caseCount})`}
            active={filter === 'CASE'}
            onClick={() => setFilter('CASE')}
          />
          <FilterTab
            label={`Evidence (${evidenceCount})`}
            active={filter === 'EVIDENCE'}
            onClick={() => setFilter('EVIDENCE')}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="dark-card text-center py-16">
          <div className="text-5xl mb-4">📄</div>
          <p className="text-gray-400">
            {reports.length === 0
              ? 'No reports generated yet'
              : `No ${filter.toLowerCase()} reports found`}
          </p>
          <p className="text-xs text-gray-600 mt-2">
            {reports.length === 0
              ? 'Generate one from an evidence detail page or a case detail page'
              : 'Try a different filter'}
          </p>
          {reports.length === 0 && (
            <div className="mt-4 flex gap-3 justify-center">
              <Link
                to="/evidence"
                className="text-blue-400 hover:text-blue-300 text-sm font-medium"
              >
                → Go to Evidence
              </Link>
              <span className="text-gray-600">|</span>
              <Link
                to="/cases"
                className="text-blue-400 hover:text-blue-300 text-sm font-medium"
              >
                → Go to Cases
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="dark-card p-0 overflow-hidden">
          <table className="dark-table">
            <thead>
              <tr>
                <th>Report ID</th>
                <th>Type</th>
                <th>Title</th>
                <th>Case / Evidence</th>
                <th>Generated By</th>
                <th>Generated At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isCase = isCaseReport(r)
                return (
                  <tr key={r.report_id}>
                    <td className="font-mono font-medium text-white whitespace-nowrap">
                      {r.report_id}
                    </td>
                    <td className="whitespace-nowrap">
                      {isCase ? (
                        <span className="dark-badge-blue">CASE</span>
                      ) : (
                        <span className="dark-badge-green">EVIDENCE</span>
                      )}
                    </td>
                    <td>
                      <div className="text-sm text-white">{r.title}</div>
                    </td>
                    <td className="text-xs whitespace-nowrap">
                      {isCase ? (
                        r.case_number ? (
                          <span className="font-mono text-purple-300">
                            {r.case_number}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )
                      ) : r.evidence_id ? (
                        <Link
                          to={`/evidence/${r.evidence_id}`}
                          className="font-mono text-blue-400 hover:text-blue-300"
                        >
                          {r.evidence_id}
                        </Link>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="text-xs text-gray-400">
                      {r.generated_by}
                    </td>
                    <td className="text-xs text-gray-400 whitespace-nowrap">
                      {formatDate(r.generated_at)}
                    </td>
                    <td className="whitespace-nowrap">
                      <button
                        onClick={() => handleDownload(r.report_id)}
                        disabled={downloadingId === r.report_id}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
                      >
                        {downloadingId === r.report_id ? '...' : '↓ Download'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const FilterTab: React.FC<{
  label: string
  active: boolean
  onClick: () => void
}> = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
      active
        ? 'bg-blue-600 text-white'
        : 'text-gray-400 hover:text-white hover:bg-[#1E2A3E]'
    }`}
  >
    {label}
  </button>
)