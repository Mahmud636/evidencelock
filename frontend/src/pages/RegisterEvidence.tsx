import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { evidenceService } from '@/services/evidence'
import { caseService, Case } from '@/services/cases'
import { useAuth } from '@/hooks/useAuth'
import toast from 'react-hot-toast'

export const RegisterEvidence: React.FC = () => {
  const [file, setFile] = useState<File | null>(null)
  const [caseId, setCaseId] = useState('')
  const [description, setDescription] = useState('')
  const [sourceDevice, setSourceDevice] = useState('')
  const [cases, setCases] = useState<Case[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingCases, setIsLoadingCases] = useState(true)
  const navigate = useNavigate()
  const { user } = useAuth()

  useEffect(() => {
    loadCases()
  }, [])

  const loadCases = async () => {
    setIsLoadingCases(true)
    try {
      const response = await caseService.list()
      // Only allow registration in ACTIVE cases
      const activeCases = response.cases.filter((c) => c.status === 'ACTIVE')
      setCases(activeCases)
      if (activeCases.length === 1) {
        setCaseId(activeCases[0].id)
      }
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load cases')
    } finally {
      setIsLoadingCases(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!file) {
      toast.error('Please select a file')
      return
    }
    if (!caseId) {
      toast.error('Please select a case')
      return
    }

    setIsLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('case_id', caseId)
      if (description) formData.append('description', description)
      if (sourceDevice) formData.append('source_device', sourceDevice)

      const newEvidence = await evidenceService.register(formData)
      toast.success(`Evidence ${newEvidence.evidence_id} registered`)
      navigate(`/evidence/${newEvidence.evidence_id}`)
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Registration failed')
    } finally {
      setIsLoading(false)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const selectedCase = cases.find((c) => c.id === caseId)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Register Evidence</h1>
        <p className="text-sm text-gray-400 mt-1">
          Upload a file and record its cryptographic fingerprint in the chain of custody.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="dark-card space-y-6">
        {/* File Picker */}
        <div>
          <label className="dark-label">
            Evidence File <span className="text-red-400">*</span>
          </label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="dark-input file:mr-4 file:py-1.5 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-500 file:cursor-pointer"
            required
          />
          {file && (
            <p className="mt-2 text-xs text-gray-400">
              <span className="text-white font-medium">{file.name}</span>
              {' · '}
              {formatBytes(file.size)}
              {' · '}
              {file.type || 'unknown type'}
            </p>
          )}
        </div>

        {/* Case Picker */}
        <div>
          <label className="dark-label">
            Case <span className="text-red-400">*</span>
          </label>
          {isLoadingCases ? (
            <div className="dark-input flex items-center gap-2 text-gray-400 text-sm">
              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500"></div>
              Loading cases...
            </div>
          ) : cases.length === 0 ? (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <p className="text-xs text-amber-300">
                No active cases available. Create a case first or ask an admin to
                assign you to one.
              </p>
            </div>
          ) : (
            <select
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
              className="dark-select w-full"
              required
            >
              <option value="">— Select a case —</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.case_number} — {c.title}
                </option>
              ))}
            </select>
          )}
          {selectedCase && (
            <p className="mt-2 text-[10px] text-gray-500 tracking-wider">
              CLASSIFICATION: <span className="text-white">
                {selectedCase.classification || 'UNCLASSIFIED'}
              </span>
            </p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="dark-label">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="dark-input"
            placeholder="Describe the evidence, where it came from, etc."
          />
        </div>

        {/* Source Device */}
        <div>
          <label className="dark-label">Source Device</label>
          <input
            type="text"
            value={sourceDevice}
            onChange={(e) => setSourceDevice(e.target.value)}
            className="dark-input"
            placeholder="e.g., Laptop, USB drive, server, mobile phone"
          />
        </div>

        {/* Info Panel */}
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <p className="text-xs text-blue-300 font-semibold mb-2">
            🔒 When you register this evidence, EvidenceLock will:
          </p>
          <ul className="text-[11px] text-blue-200/80 space-y-1 ml-4 list-disc">
            <li>Compute the SHA-256 fingerprint of the file</li>
            <li>Store the original hash securely</li>
            <li>Create a chain-of-custody record</li>
            <li>Log the action in the tamper-evident audit trail</li>
          </ul>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-4 pt-2">
          <button
            type="button"
            onClick={() => navigate('/evidence')}
            className="dark-btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading || !file || !caseId}
            className="dark-btn-primary w-auto px-6"
          >
            {isLoading ? 'Registering...' : 'Register Evidence'}
          </button>
        </div>
      </form>
    </div>
  )
}