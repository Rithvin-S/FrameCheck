import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './StatusViews.css';

/**
 * Guards routes requiring an authenticated Supabase session and database profile,
 * plus optional role-based access enforcement.
 */
export function ProtectedRoute({ allowedRoles, children }) {
  const { isConfigured, user, profile, loading, profileError, refreshProfile, signOut } =
    useAuth();
  const location = useLocation();

  if (!isConfigured) {
    return (
      <main className="fc-status-main">
        <div className="fc-status-card">
          <h1 className="fc-status-title">Supabase Configuration Required</h1>
          <p className="fc-status-text">
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in
            your local <code>.env</code> file to enable authentication.
          </p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="fc-status-main" aria-busy="true">
        <div className="fc-status-card">
          <div className="fc-spinner-row">
            <span className="fc-spinner" aria-hidden="true" />
            <span className="fc-status-text">Verifying your session…</span>
          </div>
        </div>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (profileError || !profile) {
    return (
      <main className="fc-status-main">
        <div className="fc-status-card" role="alert">
          <h1 className="fc-status-title">Profile Unavailable</h1>
          <p className="fc-status-text">
            {profileError ||
              'Your account is signed in, but your FrameCheck profile could not be loaded.'}
          </p>
          <div className="fc-status-actions">
            <button type="button" className="fc-btn fc-btn-primary" onClick={refreshProfile}>
              Retry
            </button>
            <button type="button" className="fc-btn fc-btn-secondary" onClick={signOut}>
              Sign Out
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (Array.isArray(allowedRoles) && !allowedRoles.includes(profile.role)) {
    return (
      <main className="fc-status-main">
        <div className="fc-status-card" role="alert">
          <h1 className="fc-status-title">Access Restricted</h1>
          <p className="fc-status-text">
            You do not have permission to view this page. Administrator privileges are
            required.
          </p>
          <div className="fc-status-actions">
            <Link to="/dashboard" className="fc-btn fc-btn-primary">
              Return to Dashboard
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return children;
}

