import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { MetricCard } from '../components/analytics/MetricCard.jsx';
import { ProgressBar } from '../components/analytics/ProgressBar.jsx';
import { RecentActivityFeed } from '../components/analytics/RecentActivityFeed.jsx';
import { ReviewerLeaderboard } from '../components/analytics/ReviewerLeaderboard.jsx';
import { SvgDonutChart } from '../components/analytics/SvgDonutChart.jsx';
import { SvgTrendChart } from '../components/analytics/SvgTrendChart.jsx';
import { subscribeToDashboardReviewRealtime } from '../services/annotationService.js';
import {
  fetchAnalyticsSummary,
  fetchRecentActivity,
  formatPercent,
  formatStorageBytes,
} from '../services/analyticsService.js';
import { REVIEW_STATUS_LABELS } from '../services/batchService.js';
import { ROLES, formatRoleLabel } from '../services/profileService.js';
import './AnalyticsPage.css';

// Lightweight inline icons
const ICONS = {
  folder: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  image: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  annotation: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  ),
  storage: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  check: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  users: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  star: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
};

const BATCH_STATUS_COLORS = {
  not_started: '#94a3b8',
  in_review: '#2563eb',
  review_completed: '#16a34a',
};

const FORMAT_COLORS = {
  'image/jpeg': '#2563eb',
  'image/png': '#0d9488',
  'image/webp': '#9333ea',
};

/**
 * Advanced Analytics Dashboard for FrameCheck.
 * Provides role-tailored intelligence for Admins, Reviewers, and Uploaders.
 */
export function AnalyticsPage() {
  const { user, profile } = useAuth();
  const [summary, setSummary] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const refreshSeqRef = useRef(0);

  const role = profile?.role || ROLES.UPLOADER;
  const isAdmin = role === ROLES.ADMIN;
  const isReviewer = role === ROLES.REVIEWER;
  const isUploader = role === ROLES.UPLOADER;

  const loadData = useCallback(async ({ silent = false } = {}) => {
    const seq = ++refreshSeqRef.current;
    if (!silent) {
      setLoading(true);
      setErrorMessage('');
    } else {
      setRefreshing(true);
    }

    try {
      const [sum, acts] = await Promise.all([
        fetchAnalyticsSummary(),
        fetchRecentActivity(20),
      ]);

      if (seq === refreshSeqRef.current) {
        setSummary(sum);
        setActivities(acts);
      }
    } catch (err) {
      if (!silent && seq === refreshSeqRef.current) {
        setErrorMessage(err?.message || 'Unable to load analytics data.');
      }
    } finally {
      if (seq === refreshSeqRef.current) {
        if (!silent) setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadData();
    return () => {
      refreshSeqRef.current += 1;
    };
  }, [loadData]);

  // Realtime subscription for silent updates
  useEffect(() => {
    if (!user?.id) return undefined;

    let disposed = false;
    let timer = null;

    const scheduleSilentRefresh = () => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!disposed) {
          loadData({ silent: true });
        }
      }, 500);
    };

    const unsubscribe = subscribeToDashboardReviewRealtime({
      onRelevantChange: scheduleSilentRefresh,
      onStatusChange: (status) => {
        if (status === 'SUBSCRIBED' && !disposed) {
          scheduleSilentRefresh();
        }
      },
    });

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [user?.id, loadData]);

  const overview = summary?.overview || {
    total_batches: 0,
    total_images: 0,
    completed_images: 0,
    pending_images: 0,
    completion_percentage: 0,
    total_annotations: 0,
    open_annotations: 0,
    resolved_annotations: 0,
    resolution_percentage: 0,
    total_storage_bytes: 0,
  };

  const batchStatusData = [
    {
      label: 'Not Started',
      value: summary?.batch_statuses?.not_started || 0,
      color: BATCH_STATUS_COLORS.not_started,
    },
    {
      label: 'In Review',
      value: summary?.batch_statuses?.in_review || 0,
      color: BATCH_STATUS_COLORS.in_review,
    },
    {
      label: 'Completed',
      value: summary?.batch_statuses?.review_completed || 0,
      color: BATCH_STATUS_COLORS.review_completed,
    },
  ];

  const annotationStatusData = [
    {
      label: 'Open Feedback',
      value: overview.open_annotations,
      color: '#ea580c',
    },
    {
      label: 'Resolved Feedback',
      value: overview.resolved_annotations,
      color: '#16a34a',
    },
  ];

  const imageCompletionSegments = [
    {
      label: 'Completed',
      value: overview.completed_images,
      pct: overview.total_images > 0
        ? (overview.completed_images / overview.total_images) * 100
        : 0,
      color: '#16a34a',
    },
    {
      label: 'Pending',
      value: overview.pending_images,
      pct: overview.total_images > 0
        ? (overview.pending_images / overview.total_images) * 100
        : 0,
      color: '#e2e8f0',
    },
  ];

  return (
    <main className="fc-analytics-main">
      {/* Page Header */}
      <header className="fc-analytics-header">
        <div className="fc-analytics-title-group">
          <div className="fc-analytics-title-row">
            <h1 className="fc-analytics-title">Advanced Analytics</h1>
            <span className={`fc-role-badge fc-role-${role}`}>
              {formatRoleLabel(role)} View
            </span>
          </div>
          <p className="fc-analytics-subtitle">
            {isAdmin &&
              'System-wide review intelligence, platform storage volume, and cross-batch reviewer metrics.'}
            {isReviewer &&
              'Personal review performance, contribution breakdown, and collaborative workspace activity.'}
            {isUploader &&
              'Review progress, feedback status, and reviewer contributions across your uploaded batches.'}
          </p>
        </div>

        <div className="fc-analytics-header-actions">
          <button
            type="button"
            className="fc-btn fc-btn-secondary fc-btn-sm"
            onClick={() => loadData({ silent: false })}
            disabled={loading || refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Error state */}
      {errorMessage ? (
        <div className="fc-analytics-error" role="alert">
          <span>{errorMessage}</span>
          <button
            type="button"
            className="fc-btn fc-btn-sm fc-btn-secondary"
            onClick={() => loadData({ silent: false })}
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Loading state on initial fetch */}
      {loading && !summary ? (
        <div className="fc-analytics-loading">Loading analytics metrics…</div>
      ) : (
        <>
          {/* SECTION 1: PRIMARY METRICS */}
          {isAdmin && (
            <section
              className="fc-analytics-metric-grid"
              aria-label="System Metrics"
            >
              <MetricCard
                title="Total Batches"
                value={overview.total_batches}
                subtitle={`${summary?.batch_statuses?.in_review || 0} currently in review`}
                icon={ICONS.folder}
              />
              <MetricCard
                title="Total Images"
                value={overview.total_images}
                subtitle={`${overview.completed_images} completed (${formatPercent(overview.completion_percentage)})`}
                icon={ICONS.image}
              />
              <MetricCard
                title="Total Annotations"
                value={overview.total_annotations}
                subtitle={`${overview.resolved_annotations} resolved (${formatPercent(overview.resolution_percentage)})`}
                icon={ICONS.annotation}
              />
              <MetricCard
                title="Storage Volume"
                value={formatStorageBytes(overview.total_storage_bytes)}
                subtitle="Original batch images"
                icon={ICONS.storage}
              />
              <MetricCard
                title="Resolution Rate"
                value={formatPercent(overview.resolution_percentage)}
                badge={overview.resolution_percentage >= 80 ? 'Optimal' : 'Active'}
                badgeType={overview.resolution_percentage >= 80 ? 'success' : 'accent'}
                subtitle={`${overview.open_annotations} open feedback items`}
                icon={ICONS.check}
              />
            </section>
          )}

          {isUploader && (
            <section
              className="fc-analytics-metric-grid"
              aria-label="Batch Metrics"
            >
              <MetricCard
                title="Your Batches"
                value={overview.total_batches}
                subtitle={`${summary?.batch_statuses?.in_review || 0} currently in review`}
                icon={ICONS.folder}
              />
              <MetricCard
                title="Images Uploaded"
                value={overview.total_images}
                subtitle={`${overview.completed_images} completed (${formatPercent(overview.completion_percentage)})`}
                icon={ICONS.image}
              />
              <MetricCard
                title="Storage Consumed"
                value={formatStorageBytes(overview.total_storage_bytes)}
                subtitle="Your uploaded images"
                icon={ICONS.storage}
              />
              <MetricCard
                title="Review Progress"
                value={formatPercent(overview.completion_percentage)}
                badge={overview.completed_images === overview.total_images && overview.total_images > 0 ? 'Completed' : 'In Progress'}
                badgeType={overview.completed_images === overview.total_images && overview.total_images > 0 ? 'success' : 'accent'}
                subtitle={`${overview.pending_images} images awaiting review`}
                icon={ICONS.check}
              />
              <MetricCard
                title="Feedback Received"
                value={overview.total_annotations}
                subtitle={`${overview.open_annotations} open, ${overview.resolved_annotations} resolved`}
                icon={ICONS.annotation}
              />
            </section>
          )}

          {isReviewer && (
            <section
              className="fc-analytics-metric-grid"
              aria-label="Reviewer Personal Metrics"
            >
              <MetricCard
                title="My Annotations"
                value={summary?.my_contributions?.annotations_created || 0}
                subtitle="Circles and notes placed"
                icon={ICONS.annotation}
              />
              <MetricCard
                title="My Resolved Items"
                value={summary?.my_contributions?.annotations_resolved || 0}
                subtitle="Currently marked resolved"
                icon={ICONS.check}
              />
              <MetricCard
                title="Images Completed"
                value={summary?.my_contributions?.images_completed || 0}
                subtitle="Marked ready / reviewed"
                icon={ICONS.image}
              />
              <MetricCard
                title="Batches Reviewed"
                value={summary?.my_contributions?.batches_contributed || 0}
                subtitle="Distinct batches touched"
                icon={ICONS.folder}
              />
              <MetricCard
                title="Workspace Progress"
                value={formatPercent(overview.completion_percentage)}
                subtitle={`${overview.completed_images} of ${overview.total_images} images done`}
                icon={ICONS.star}
              />
            </section>
          )}

          {/* ADMIN ONLY: USER DISTRIBUTION */}
          {isAdmin && summary?.user_distribution && (
            <section className="fc-analytics-card fc-user-dist-card">
              <div className="fc-analytics-card-header">
                <div>
                  <h2 className="fc-analytics-card-title">Registered Users</h2>
                  <p className="fc-analytics-card-subtitle">
                    Platform membership by authorization role.
                  </p>
                </div>
                <Link
                  to="/admin/users"
                  className="fc-btn fc-btn-secondary fc-btn-sm"
                >
                  Manage Users
                </Link>
              </div>

              <div className="fc-user-dist-stats">
                <div className="fc-user-dist-item">
                  <span className="fc-user-dist-label">Total Accounts</span>
                  <span className="fc-user-dist-val">
                    {summary.user_distribution.total_users}
                  </span>
                </div>
                <div className="fc-user-dist-item">
                  <span className="fc-user-dist-label">Uploaders</span>
                  <span className="fc-user-dist-val">
                    {summary.user_distribution.uploaders}
                  </span>
                </div>
                <div className="fc-user-dist-item">
                  <span className="fc-user-dist-label">Reviewers</span>
                  <span className="fc-user-dist-val">
                    {summary.user_distribution.reviewers}
                  </span>
                </div>
                <div className="fc-user-dist-item">
                  <span className="fc-user-dist-label">Administrators</span>
                  <span className="fc-user-dist-val">
                    {summary.user_distribution.admins}
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* SECTION 2: CHARTS & STATUS BREAKDOWNS */}
          <div className="fc-analytics-grid-3col">
            {/* Batch Status Donut */}
            <article className="fc-analytics-card">
              <div className="fc-analytics-card-header">
                <div>
                  <h2 className="fc-analytics-card-title">Batch Statuses</h2>
                  <p className="fc-analytics-card-subtitle">
                    Distribution of review lifecycle states.
                  </p>
                </div>
              </div>
              <SvgDonutChart
                data={batchStatusData}
                centerTitle={overview.total_batches}
                centerSubtitle="Batches"
              />
            </article>

            {/* Image Completion Progress */}
            <article className="fc-analytics-card">
              <div className="fc-analytics-card-header">
                <div>
                  <h2 className="fc-analytics-card-title">Image Completion</h2>
                  <p className="fc-analytics-card-subtitle">
                    Completed vs. pending review images.
                  </p>
                </div>
              </div>
              <div style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <ProgressBar
                  value={overview.completion_percentage}
                  label="Completion Rate"
                  helperText={`${overview.completed_images} of ${overview.total_images} images`}
                  segments={imageCompletionSegments}
                  height={14}
                />
                <div className="fc-user-dist-stats" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 0 }}>
                  <div className="fc-user-dist-item">
                    <span className="fc-user-dist-label">Completed</span>
                    <span className="fc-user-dist-val" style={{ color: '#16a34a' }}>
                      {overview.completed_images}
                    </span>
                  </div>
                  <div className="fc-user-dist-item">
                    <span className="fc-user-dist-label">Pending</span>
                    <span className="fc-user-dist-val" style={{ color: '#ea580c' }}>
                      {overview.pending_images}
                    </span>
                  </div>
                </div>
              </div>
            </article>

            {/* Open vs. Resolved Feedback Donut */}
            <article className="fc-analytics-card">
              <div className="fc-analytics-card-header">
                <div>
                  <h2 className="fc-analytics-card-title">Feedback Status</h2>
                  <p className="fc-analytics-card-subtitle">
                    Active open vs. resolved annotations.
                  </p>
                </div>
              </div>
              <SvgDonutChart
                data={annotationStatusData}
                centerTitle={overview.total_annotations}
                centerSubtitle="Annotations"
              />
            </article>
          </div>

          {/* ADMIN ONLY: IMAGE FORMAT DISTRIBUTION */}
          {isAdmin && summary?.image_formats && summary.image_formats.length > 0 && (
            <section className="fc-analytics-card">
              <div className="fc-analytics-card-header">
                <div>
                  <h2 className="fc-analytics-card-title">
                    Image Format &amp; Storage Distribution
                  </h2>
                  <p className="fc-analytics-card-subtitle">
                    Storage breakdown by uploaded image MIME type.
                  </p>
                </div>
              </div>

              <div className="fc-format-list">
                {summary.image_formats.map((fmt) => {
                  const pct = overview.total_images > 0
                    ? (fmt.image_count / overview.total_images) * 100
                    : 0;
                  const color = FORMAT_COLORS[fmt.mime_type] || '#64748b';

                  return (
                    <div key={fmt.mime_type} className="fc-format-item">
                      <div className="fc-format-meta">
                        <span className="fc-format-badge">{fmt.mime_type}</span>
                        <div>
                          <span className="fc-format-counts">
                            {fmt.image_count} images ({pct.toFixed(1)}%)
                          </span>
                          <span className="fc-format-storage">
                            {formatStorageBytes(fmt.storage_bytes)}
                          </span>
                        </div>
                      </div>
                      <div className="fc-progress-track" style={{ height: '6px' }}>
                        <div
                          className="fc-progress-fill"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* UPLOADER ONLY: OWN-BATCH PROGRESS BREAKDOWN */}
          {isUploader && summary?.top_batches && summary.top_batches.length > 0 && (
            <section className="fc-analytics-card">
              <div className="fc-analytics-card-header">
                <div>
                  <h2 className="fc-analytics-card-title">
                    Batch Review Progress
                  </h2>
                  <p className="fc-analytics-card-subtitle">
                    Status and completion rates across your uploaded batches.
                  </p>
                </div>
                <Link to="/batches/new" className="fc-btn fc-btn-primary fc-btn-sm">
                  Upload New Batch
                </Link>
              </div>

              <div className="fc-table-responsive">
                <table className="fc-analytics-table">
                  <thead>
                    <tr>
                      <th scope="col">Batch Name</th>
                      <th scope="col">Status</th>
                      <th scope="col" style={{ minWidth: '160px' }}>
                        Progress
                      </th>
                      <th scope="col" className="fc-text-right">
                        Completed
                      </th>
                      <th scope="col" className="fc-text-right">
                        Feedback
                      </th>
                      <th scope="col" className="fc-text-right">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.top_batches.map((b) => {
                      const pct = b.total_images > 0
                        ? (b.completed_images / b.total_images) * 100
                        : 0;

                      return (
                        <tr key={b.batch_id}>
                          <td>
                            <strong style={{ color: 'var(--fc-text-primary)' }}>
                              {b.name}
                            </strong>
                          </td>
                          <td>
                            <span className={`fc-status-badge fc-status-${b.review_status}`}>
                              {REVIEW_STATUS_LABELS[b.review_status] || b.review_status}
                            </span>
                          </td>
                          <td>
                            <ProgressBar value={pct} height={6} />
                          </td>
                          <td className="fc-text-right fc-numeric-cell">
                            {b.completed_images} / {b.total_images}
                          </td>
                          <td className="fc-text-right fc-numeric-cell">
                            {b.open_annotations} open ({b.total_annotations} total)
                          </td>
                          <td className="fc-text-right">
                            <Link
                              to={`/batches/${b.batch_id}`}
                              className="fc-btn fc-btn-secondary fc-btn-sm"
                            >
                              Inspect
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* SECTION 3: 30-DAY ACTIVITY TRENDS */}
          <section className="fc-analytics-card">
            <SvgTrendChart data={summary?.time_trends || []} />
          </section>

          {/* SECTION 4: REVIEWER LEADERBOARD & RECENT ACTIVITY */}
          <div className="fc-analytics-grid-2col">
            <ReviewerLeaderboard
              reviewers={summary?.reviewer_contributions || []}
              isUploader={isUploader}
              currentUserId={user?.id}
            />

            <RecentActivityFeed
              activities={activities}
              loading={loading && activities.length === 0}
              title={isUploader ? 'Recent Activity on Your Batches' : 'Recent Review Activity'}
              subtitle={
                isUploader
                  ? 'Chronological review events across your uploaded batches.'
                  : 'Latest events across all visible batches.'
              }
            />
          </div>
        </>
      )}
    </main>
  );
}

