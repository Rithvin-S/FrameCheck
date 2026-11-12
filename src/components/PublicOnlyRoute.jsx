import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './StatusViews.css';

/**
 * Redirects already-authenticated users away from login and registration routes
 * to the application dashboard.
 */
export function PublicOnlyRoute({ children }) {
  const { isConfigured, user, profile, loading } = useAuth();

  if (isConfigured && loading) {
    return (
      <main className="fc-status-main" aria-busy="true">
        <div className="fc-status-card">
          <div className="fc-spinner-row">
            <span className="fc-spinner" aria-hidden="true" />
            <span className="fc-status-text">Loading FrameCheck…</span>
          </div>
        </div>
      </main>
    );
  }

  if (user && profile) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

