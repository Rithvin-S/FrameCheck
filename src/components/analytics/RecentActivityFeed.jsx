import { Link } from 'react-router-dom';
import {
  formatActivityTimestamp,
  getActivityMeta,
} from '../../services/analyticsService.js';

/**
 * Activity feed rendering real database review events in reverse chronological order.
 * Strictly respects actual schema data: soft-deleted annotations show tombstone status
 * without fabricating actors.
 */
export function RecentActivityFeed({
  activities = [],
  loading = false,
  title = 'Recent Review Activity',
  subtitle = 'Chronological events across your accessible batches and review workspaces.',
  emptyMessage = 'No recent review activity recorded.',
}) {
  const list = Array.isArray(activities) ? activities : [];

  return (
    <section className="fc-analytics-card fc-activity-card">
      <div className="fc-analytics-card-header">
        <div>
          <h2 className="fc-analytics-card-title">{title}</h2>
          {subtitle ? (
            <p className="fc-analytics-card-subtitle">{subtitle}</p>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="fc-analytics-loading">Loading recent activity…</div>
      ) : list.length === 0 ? (
        <div className="fc-analytics-empty">
          <p className="fc-analytics-empty-text">{emptyMessage}</p>
        </div>
      ) : (
        <ul className="fc-activity-list" aria-label="Recent activity log">
          {list.map((item, index) => {
            const meta = getActivityMeta(item);
            const key = item.event_id || `${item.event_type}-${item.event_timestamp}-${index}`;

            return (
              <li key={key} className="fc-activity-item">
                <div className="fc-activity-indicator" aria-hidden="true">
                  <span className={`fc-activity-dot ${meta.badgeClass}`} />
                  {index < list.length - 1 ? (
                    <span className="fc-activity-line" />
                  ) : null}
                </div>

                <div className="fc-activity-content">
                  <div className="fc-activity-row">
                    <div className="fc-activity-header-left">
                      <span className={`fc-activity-tag ${meta.badgeClass}`}>
                        {meta.badgeLabel}
                      </span>
                      <span className="fc-activity-summary">
                        {meta.summary}
                      </span>
                    </div>

                    <time
                      dateTime={item.event_timestamp}
                      className="fc-activity-time"
                    >
                      {formatActivityTimestamp(item.event_timestamp)}
                    </time>
                  </div>

                  <div className="fc-activity-details-row">
                    {item.details && item.event_type !== 'annotation_deleted' ? (
                      <p className="fc-activity-details-text">
                        &ldquo;{item.details}&rdquo;
                      </p>
                    ) : null}

                    {meta.targetLink ? (
                      <Link
                        to={meta.targetLink}
                        className="fc-activity-link"
                      >
                        {meta.targetLabel}
                        <span aria-hidden="true" className="fc-activity-link-arrow">
                          &rarr;
                        </span>
                      </Link>
                    ) : item.batch_name ? (
                      <span className="fc-activity-static-target">
                        {item.batch_name}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

