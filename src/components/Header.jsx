import { useState } from 'react';
import { Link, NavLink, useNavigate, useMatch } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { NotificationBell } from './NotificationBell.jsx';
import { ROLES, formatRoleLabel } from '../services/profileService.js';
import './Header.css';

/**
 * Application top navigation header for FrameCheck.
 * Displays brand identity, role-aware navigation, current user name/role, theme toggle, and sign out.
 */
export function Header() {
  const { user, profile, loading, signOut } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const isBatchDetails = Boolean(useMatch('/batches/:batchId'));
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch {
      // Even if network fails, clear local redirect flow only if signOut succeeds;
      // errors keep current session visible for retry.
    } finally {
      setSigningOut(false);
    }
  };

  const brandTarget = user && profile ? '/dashboard' : '/login';

  return (
    <header className="fc-header">
      <div className="fc-header-inner">
        <div className="fc-header-left">
          <Link to={brandTarget} className="fc-brand">
            <span className="fc-brand-mark" aria-hidden="true">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="3"
                  y="3"
                  width="18"
                  height="18"
                  rx="4"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="4.5"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
            </span>
            <span className="fc-brand-name">FrameCheck</span>
          </Link>

          {user && profile ? (
            <nav className="fc-nav" aria-label="Primary navigation">
              {isBatchDetails ? (
                <Link
                  to="/dashboard"
                  className="fc-nav-back-btn"
                  title="Return to Dashboard"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="19" y1="12" x2="5" y2="12" />
                    <polyline points="12 19 5 12 12 5" />
                  </svg>
                  <span>Back to Dashboard</span>
                </Link>
              ) : (
                <>
                  <NavLink
                    to="/dashboard"
                    className={({ isActive }) =>
                      `fc-nav-link${isActive ? ' fc-nav-link-active' : ''}`
                    }
                  >
                    Dashboard
                  </NavLink>
                  <NavLink
                    to="/analytics"
                    className={({ isActive }) =>
                      `fc-nav-link${isActive ? ' fc-nav-link-active' : ''}`
                    }
                  >
                    Analytics
                  </NavLink>
                </>
              )}
              {profile.role === ROLES.ADMIN ? (
                <NavLink
                  to="/admin/users"
                  className={({ isActive }) =>
                    `fc-nav-link${isActive ? ' fc-nav-link-active' : ''}`
                  }
                >
                  User Management
                </NavLink>
              ) : null}
            </nav>
          ) : null}
        </div>

        <div className="fc-header-meta">
          <button
            type="button"
            className="fc-theme-toggle-btn"
            onClick={toggleTheme}
            title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
            aria-label={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          >
            {isDark ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          {user ? <NotificationBell /> : null}
          {loading ? null : user && profile ? (
            <div className="fc-user-controls">
              <div className="fc-user-identity" title={`${profile.display_name} (${formatRoleLabel(profile.role)})`}>
                <span className="fc-user-avatar-initial" aria-hidden="true">
                  {(profile.display_name || 'U').slice(0, 1).toUpperCase()}
                </span>
                <span className="fc-user-name">{profile.display_name}</span>
                <span className={`fc-role-badge fc-role-${profile.role}`}>
                  {formatRoleLabel(profile.role)}
                </span>
              </div>
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-sm"
                onClick={handleSignOut}
                disabled={signingOut}
              >
                {signingOut ? 'Signing out…' : 'Sign Out'}
              </button>
            </div>
          ) : user ? (
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-sm"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign Out'}
            </button>
          ) : (
            <nav className="fc-auth-links" aria-label="Authentication navigation">
              <NavLink
                to="/login"
                className={({ isActive }) =>
                  `fc-nav-link${isActive ? ' fc-nav-link-active' : ''}`
                }
              >
                Sign In
              </NavLink>
              <NavLink to="/register" className="fc-btn fc-btn-primary fc-btn-sm">
                Register
              </NavLink>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
