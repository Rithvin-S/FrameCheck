import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { REVIEW_STATUS_LABELS } from '../services/batchService.js';
import { formatRoleLabel } from '../services/profileService.js';
import './Header.css';
import './ReviewHeader.css';

/**
 * Compact workspace header for the dedicated batch image review view.
 */
export function ReviewHeader({
  batchId,
  batchName,
  batchReviewStatus = null,
  currentPosition,
  totalImages,
  activeReviewers = [],
}) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const reviewerNames = useMemo(() => {
    if (!Array.isArray(activeReviewers) || activeReviewers.length === 0) {
      return '';
    }
    const names = [];
    const seen = new Set();
    activeReviewers.forEach((r) => {
      const name = (r?.displayName || 'Reviewer').trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    });
    return names.join(', ');
  }, [activeReviewers]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch {
      // Keep current workspace visible if sign-out fails so the user can retry.
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <header className="fc-review-header">
      <div className="fc-review-header-left">
        <Link to="/dashboard" className="fc-brand" title="Go to Dashboard">
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

        <span className="fc-review-divider" aria-hidden="true" />

        <Link
          to={`/batches/${batchId}`}
          className="fc-btn fc-btn-secondary fc-btn-sm"
        >
          ← Back to Batch
        </Link>

        {batchName ? (
          <>
            <span className="fc-review-divider" aria-hidden="true" />
            <h1 className="fc-review-batch-name" title={batchName}>
              {batchName}
            </h1>
            {batchReviewStatus && REVIEW_STATUS_LABELS[batchReviewStatus] ? (
              <span
                className={`fc-review-status-badge fc-review-status-${batchReviewStatus}`}
              >
                {REVIEW_STATUS_LABELS[batchReviewStatus]}
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="fc-review-header-right">
        {reviewerNames ? (
          <div
            className="fc-reviewer-presence-pill"
            title={`Reviewing now: ${reviewerNames}`}
            aria-label={`Reviewing now: ${reviewerNames}`}
          >
            <span className="fc-presence-dot" aria-hidden="true" />
            <span className="fc-presence-label">Reviewing now:</span>
            <span className="fc-presence-names">{reviewerNames}</span>
          </div>
        ) : null}

        {totalImages > 0 && currentPosition > 0 ? (
          <span className="fc-position-pill" aria-live="polite">
            Image {currentPosition} of {totalImages}
          </span>
        ) : null}

        {profile ? (
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
        ) : null}
      </div>
    </header>
  );
}
