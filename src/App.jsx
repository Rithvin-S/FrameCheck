import { BrowserRouter, Navigate, Route, Routes, useMatch } from 'react-router-dom';
import { Header } from './components/Header.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { PublicOnlyRoute } from './components/PublicOnlyRoute.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { AdminUsersPage } from './pages/AdminUsersPage.jsx';
import { AnalyticsPage } from './pages/AnalyticsPage.jsx';
import { BatchDetailPage } from './pages/BatchDetailPage.jsx';
import { CreateBatchPage } from './pages/CreateBatchPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { RegisterPage } from './pages/RegisterPage.jsx';
import { ReviewWorkspacePage } from './pages/ReviewWorkspacePage.jsx';
import { ROLES } from './services/profileService.js';
import './App.css';

function AppShell() {
  const isReviewWorkspace = Boolean(useMatch('/batches/:batchId/review'));

  return (
    <div className="fc-app-shell">
      {isReviewWorkspace ? null : <Header />}
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <LoginPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnlyRoute>
              <RegisterPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <ProtectedRoute>
              <AnalyticsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/batches/new"
          element={
            <ProtectedRoute>
              <CreateBatchPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/batches/:batchId"
          element={
            <ProtectedRoute>
              <BatchDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/batches/:batchId/review"
          element={
            <ProtectedRoute>
              <ReviewWorkspacePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
              <AdminUsersPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </div>
  );
}

/**
 * Root light-theme application shell with authentication, role-based, and batch routes.
 */
export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
