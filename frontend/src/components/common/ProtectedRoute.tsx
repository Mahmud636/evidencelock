import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireMFA?: boolean
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requireMFA = true }) => {
  const { isAuthenticated, isLoading, mfaRequired } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (requireMFA && mfaRequired) {
    return <Navigate to="/mfa-verify" state={{ from: location }} replace />
  }

  return <>{children}</>
}
