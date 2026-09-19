import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ProtectedRoute } from './components/common/ProtectedRoute'
import { Layout } from './components/common/Layout'
import { Login } from './components/auth/Login'
import { Register } from './components/auth/Register'
import { MFAVerification } from './components/auth/MFAVerification'
import { MFAEnrollment } from './components/auth/MFAEnrollment'
import { Dashboard } from './pages/Dashboard'
import { Cases } from './pages/Cases'
import { CaseDetail } from './pages/CaseDetail'
import { CreateCase } from './pages/CreateCase'
import { EvidencePage } from './pages/Evidence'
import { EvidenceDetail } from './pages/EvidenceDetail'
import { RegisterEvidence } from './pages/RegisterEvidence'
import { Profile } from './pages/Profile'
import { InviteUser } from './pages/InviteUser'
import { PendingApprovals } from './pages/PendingApprovals'
import { Users } from './pages/Users'
import { AuditLog } from './pages/AuditLog'
import { ChainOfCustody } from './pages/ChainOfCustody'
import { IntegrityCheck } from './pages/IntegrityCheck'
import { Reports } from './pages/Reports'
import { AccessRequests } from './pages/AccessRequests'
import { FieldCollection } from './pages/FieldCollection'

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/mfa-verify" element={<MFAVerification />} />
        <Route path="/mfa-enroll" element={<MFAEnrollment />} />

        <Route path="/" element={<ProtectedRoute><Layout><Navigate to="/dashboard" replace /></Layout></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
        <Route path="/cases" element={<ProtectedRoute><Layout><Cases /></Layout></ProtectedRoute>} />
        <Route path="/cases/new" element={<ProtectedRoute><Layout><CreateCase /></Layout></ProtectedRoute>} />
        <Route path="/cases/:id" element={<ProtectedRoute><Layout><CaseDetail /></Layout></ProtectedRoute>} />
        <Route path="/evidence" element={<ProtectedRoute><Layout><EvidencePage /></Layout></ProtectedRoute>} />
        <Route path="/evidence/register" element={<ProtectedRoute><Layout><RegisterEvidence /></Layout></ProtectedRoute>} />
        <Route path="/evidence/chain" element={<ProtectedRoute><Layout><ChainOfCustody /></Layout></ProtectedRoute>} />
        <Route path="/evidence/integrity" element={<ProtectedRoute><Layout><IntegrityCheck /></Layout></ProtectedRoute>} />
        <Route path="/evidence/:id" element={<ProtectedRoute><Layout><EvidenceDetail /></Layout></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Layout><Profile /></Layout></ProtectedRoute>} />

        <Route path="/access-requests" element={<ProtectedRoute><Layout><AccessRequests /></Layout></ProtectedRoute>} />

        <Route path="/field" element={<ProtectedRoute><Layout><FieldCollection /></Layout></ProtectedRoute>} />

        <Route path="/audit" element={<ProtectedRoute><Layout><AuditLog /></Layout></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute><Layout><Reports /></Layout></ProtectedRoute>} />

        <Route path="/admin/users" element={<ProtectedRoute><Layout><Users /></Layout></ProtectedRoute>} />
        <Route path="/admin/invite" element={<ProtectedRoute><Layout><InviteUser /></Layout></ProtectedRoute>} />
        <Route path="/admin/approvals" element={<ProtectedRoute><Layout><PendingApprovals /></Layout></ProtectedRoute>} />
      </Routes>
    </AuthProvider>
  )
}

export default App