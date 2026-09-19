import apiClient from './api'

export interface FieldSetupResponse {
  field_token: string
  device_id: string
  device_name: string
  user_id: string
  user_full_name: string
  user_email: string
  user_role: string
  expires_at: string
  scope: string
}

export interface FieldDeviceInfo {
  id: string
  device_id: string
  device_name: string
  issued_at: string
  expires_at: string
  last_seen_at?: string
  revoked_at?: string
  is_active: boolean
}

export interface SyncManifestItem {
  client_ref_id: string
  original_filename: string
  file_size: number
  declared_hash: string
  local_collected_at: string
  description?: string
  source_device?: string
}

export interface SyncManifest {
  case_id: string
  device_id: string
  items: SyncManifestItem[]
}

export interface SyncResultItem {
  client_ref_id: string
  original_filename: string
  status: string
  evidence_id?: string
  internal_id?: string
  server_hash?: string
  declared_hash: string
  error?: string
}

export interface SyncResponse {
  batch_id: string
  total_items: number
  synced: number
  violations: number
  errors: number
  server_received_at: string
  results: SyncResultItem[]
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const fieldService = {
  /**
   * Enable field mode. Requires normal session auth.
   * Returns a scoped field token bound to this device.
   */
  setup: async (
    deviceId: string,
    deviceName: string,
    hoursValid: number = 24
  ): Promise<FieldSetupResponse> => {
    return apiClient.post<FieldSetupResponse>('/api/v1/field/setup', {
      device_id: deviceId,
      device_name: deviceName,
      hours_valid: hoursValid,
    })
  },

  /**
   * Validate a stored field token. Uses X-Field-Token, not Authorization.
   */
  validate: async (fieldToken: string, deviceId: string): Promise<any> => {
    const res = await fetch(
      `${API_BASE}/api/v1/field/validate?device_id=${encodeURIComponent(deviceId)}`,
      {
        headers: { 'X-Field-Token': fieldToken },
      }
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Validation failed (${res.status})`)
    }
    return res.json()
  },

  /**
   * Sync a batch of collected items. Uses X-Field-Token.
   * Sends manifest as JSON string + files as multipart.
   */
  sync: async (
    fieldToken: string,
    manifest: SyncManifest,
    files: File[]
  ): Promise<SyncResponse> => {
    const formData = new FormData()
    formData.append('manifest', JSON.stringify(manifest))
    files.forEach((f) => formData.append('files', f))

    const res = await fetch(`${API_BASE}/api/v1/field/sync`, {
      method: 'POST',
      headers: { 'X-Field-Token': fieldToken },
      body: formData,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Sync failed (${res.status})`)
    }
    return res.json()
  },

  /** List all field devices (admin sees all, others see own). */
  listDevices: async (): Promise<{
    devices: FieldDeviceInfo[]
    total: number
  }> => {
    return apiClient.get<{ devices: FieldDeviceInfo[]; total: number }>(
      '/api/v1/field/devices'
    )
  },

  /** Revoke a device's field authorization. */
  revoke: async (deviceId: string): Promise<any> => {
    return apiClient.post('/api/v1/field/revoke', { device_id: deviceId })
  },
}