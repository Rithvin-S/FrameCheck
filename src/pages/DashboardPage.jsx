import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { subscribeToDashboardReviewRealtime } from '../services/annotationService.js';
import {
  REVIEW_STATUSES,
  REVIEW_STATUS_LABELS,
  listBatches,
} from '../services/batchService.js';
import { ROLES, formatRoleLabel } from '../services/profileService.js';
import './DashboardPage.css';

const ROLE_SUBTITLES = {
  [ROLES.UPLOADER]: 'Create batches and upload image sets for collaborative review.',
  [ROLES.REVIEWER]: 'Inspect all uploaded batches or create and manage your own batches.',
  [ROLES.ADMIN]: 'View all FrameCheck batches and manage uploaded image sets.',
};

function formatDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Authenticated Batch Dashboard listing visible batches based on user role.
 */
export function DashboardPage() {
  const { user, profile } = useAuth();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const refreshSeqRef = useRef(0);

  const loadBatches = useCallback(async ({ silent = false } = {}) => {
    const requestSeq = ++refreshSeqRef.current;
    if (!silent) {
      setLoading(true);
      setErrorMessage('');
    }
    try {
      const rows = await listBatches();
      if (requestSeq === refreshSeqRef.current) {
        setBatches(rows);
      }
    } catch (error) {
      if (!silent && requestSeq === refreshSeqRef.current) {
        setErrorMessage(error?.message || 'Unable to load batches.');
      }
    } finally {
      if (!silent && requestSeq === refreshSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadBatches();
    return () => {
      refreshSeqRef.current += 1;
    };
  }, [loadBatches]);

  useEffect(() => {
    if (!user?.id) return undefined;

    let disposed = false;
    let debounceTimer = null;
    let wasDisconnected = false;

    const scheduleSilentRefresh = () => {
      if (disposed) return;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!disposed) {
          loadBatches({ silent: true });
        }
      }, 350);
    };

    const unsubscribe = subscribeToDashboardReviewRealtime({
      onRelevantChange: scheduleSilentRefresh,
      onStatusChange: (status) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          if (wasDisconnected) {
            wasDisconnected = false;
            scheduleSilentRefresh();
          }
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          wasDisconnected = true;
        }
      },
    });

    return () => {
      disposed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      unsubscribe();
    };
  }, [loadBatches, user?.id]);

  const totalImages = useMemo(
    () => batches.reduce((sum, batch) => sum + (batch.imageCount ?? 0), 0),
    [batches]
  );

  const showOwnerColumn =
    profile.role === ROLES.REVIEWER || profile.role === ROLES.ADMIN;

  return (
    <main className="fc-page-main">
      <div className="fc-page-header">
        <div className="fc-page-title-group">
          <h1 className="fc-page-title">Image Batches</h1>
          <p className="fc-page-subtitle">
            {ROLE_SUBTITLES[profile.role] ?? ROLE_SUBTITLES[ROLES.UPLOADER]}
          </p>
        </div>

        <div className="fc-page-header-actions">
          <button
            type="button"
            className="fc-btn fc-btn-secondary"
            onClick={() => loadBatches()}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <Link to="/batches/new" className="fc-btn fc-btn-primary">
            Create Batch
          </Link>
        </div>
      </div>

      <section className="fc-dashboard-summary" aria-label="Batch overview">
        <div className="fc-stat-card">
          <span className="fc-stat-label">
            {showOwnerColumn ? 'Visible Batches' : 'Your Batches'}
          </span>
          <span className="fc-stat-value">{loading ? '—' : batches.length}</span>
        </div>
        <div className="fc-stat-card">
          <span className="fc-stat-label">Total Images</span>
          <span className="fc-stat-value">{loading ? '—' : totalImages}</span>
        </div>
        <div className="fc-stat-card">
          <span className="fc-stat-label">Signed-in Role</span>
          <span className="fc-stat-value">{formatRoleLabel(profile.role)}</span>
        </div>
      </section>

      {errorMessage ? (
        <div className="fc-alert fc-alert-error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      <section className="fc-batch-panel" aria-label="Batches list">
        {loading ? (
          <div className="fc-empty-state" aria-busy="true">
            <div className="fc-spinner-row">
              <span className="fc-spinner" aria-hidden="true" />
              <span>Loading batches…</span>
            </div>
          </div>
        ) : batches.length === 0 ? (
          <div className="fc-empty-state">
            <h2 className="fc-empty-title">No batches yet</h2>
            <p className="fc-empty-text">
              Create your first batch to upload JPG, JPEG, PNG, or WEBP images or an
              entire folder.
            </p>
            <Link to="/batches/new" className="fc-btn fc-btn-primary">
              Create Batch
            </Link>
          </div>
        ) : (
          <div className="fc-batch-table-scroll">
            <table className="fc-batch-table">
              <thead>
                <tr>
                  <th>Batch Name</th>
                  {showOwnerColumn ? <th>Owner</th> : null}
                  <th>Images</th>
                  <th>Created</th>
                  <th>Last Updated</th>
                  <th>Review Status</th>
                  <th className="fc-action-col">Action</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const isOwn = batch.owner_id === user.id;
                  const reviewStatus =
                    batch.reviewStatus ?? REVIEW_STATUSES.NOT_STARTED;
                  const reviewStatusLabel =
                    REVIEW_STATUS_LABELS[reviewStatus] ??
                    REVIEW_STATUS_LABELS[REVIEW_STATUSES.NOT_STARTED];
                  return (
                    <tr key={batch.id}>
                      <td>
                        <Link
                          to={`/batches/${batch.id}`}
                          className="fc-batch-name-link"
                        >
                          {batch.name}
                        </Link>
                      </td>
                      {showOwnerColumn ? (
                        <td>
                          <div className="fc-owner-cell">
                            <span>{batch.ownerName}</span>
                            {isOwn ? <span className="fc-owner-tag">You</span> : null}
                          </div>
                        </td>
                      ) : null}
                      <td className="fc-count-cell">
                        {batch.imageCount}{' '}
                        {batch.imageCount === 1 ? 'image' : 'images'}
                      </td>
                      <td>{formatDate(batch.created_at)}</td>
                      <td>{formatDate(batch.updated_at)}</td>
                      <td>
                        <span
                          className={`fc-review-status-badge fc-review-status-${reviewStatus}`}
                        >
                          {reviewStatusLabel}
                        </span>
                      </td>
                      <td className="fc-action-col">
                        <div className="fc-row-actions">
                          {batch.imageCount > 0 ? (
                            <Link
                              to={`/batches/${batch.id}/review`}
                              className="fc-btn fc-btn-primary fc-btn-sm"
                            >
                              Review
                            </Link>
                          ) : null}
                          <Link
                            to={`/batches/${batch.id}`}
                            className="fc-btn fc-btn-secondary fc-btn-sm"
                          >
                            Open Batch
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
