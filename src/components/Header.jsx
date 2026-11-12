import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLES, formatRoleLabel } from '../services/profileService.js';
import './Header.css';

/**
 * Application top navigation header for FrameCheck.
 * Displays brand identity, role-aware navigation, current user name/role, and sign out.
 */
export function Header() {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
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
            <span className="fc-brand-divider" aria-hidden="true" />
            <span className="fc-brand-tagline">Collaborative Image Review</span>
          </Link>

          {user && profile ? (
            <nav className="fc-nav" aria-label="Primary navigation">
              <NavLink
                to="/dashboard"
                className={({ isActive }) =>
                  `fc-nav-link${isActive ? ' fc-nav-link-active' : ''}`
                }
              >
                Dashboard
              </NavLink>
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
          {loading ? null : user && profile ? (
            <div className="fc-user-controls">
              <div className="fc-user-identity">
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
