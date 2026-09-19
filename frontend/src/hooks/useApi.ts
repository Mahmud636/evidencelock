import { useQuery, useMutation } from '@tanstack/react-query'
import apiClient from '@/services/api'
import toast from 'react-hot-toast'

export function useApiQuery<T>(key: string[], url: string, options?: any) {
  return useQuery({
    queryKey: key,
    queryFn: () => apiClient.get<T>(url),
    ...options,
  })
}

export function useApiMutation<T, V>(url: string, method: 'post' | 'put' | 'delete' = 'post', options?: any) {
  return useMutation({
    mutationFn: (data: V) => {
      if (method === 'delete') {
        return apiClient.delete<T>(url)
      }
      return apiClient[method]<T>(url, data)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'An error occurred')
    },
    ...options,
  })
}

export function useApiUpload<T>(url: string, options?: any) {
  return useMutation({
    mutationFn: (formData: FormData) => apiClient.upload<T>(url, formData),
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || 'Upload failed')
    },
    ...options,
  })
}
