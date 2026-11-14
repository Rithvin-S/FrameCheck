import { formatActivityTimestamp } from '../../services/analyticsService.js';
import { formatRoleLabel } from '../../services/profileService.js';

/**
 * Displays reviewer contribution metrics across visible batches.
 * Clarifies that counts reflect recorded contributions (not current online presence).
 */
export function ReviewerLeaderboard({
  reviewers = [],
  isUploader = false,
  currentUserId = null,
}) {
  const list = Array.isArray(reviewers) ? reviewers : [];

  return (
    <section className="fc-analytics-card fc-leaderboard-card">
      <div className="fc-analytics-card-header">
        <div>
          <h2 className="fc-analytics-card-title">
            {isUploader
              ? 'Reviewers Contributing to Your Batches'
              : 'Contributing Reviewers Leaderboard'}
          </h2>
          <p className="fc-analytics-card-subtitle">
            {isUploader
              ? 'Members who have reviewed images or placed annotations on your uploaded batches.'
              : 'Cumulative contributions recorded across all visible batches.'}
          </p>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="fc-analytics-empty">
          <p className="fc-analytics-empty-text">
            No reviewer contributions recorded yet.
          </p>
        </div>
      ) : (
        <div className="fc-table-responsive">
          <table className="fc-analytics-table">
            <thead>
              <tr>
                <th scope="col">Reviewer</th>
                <th scope="col" className="fc-text-right">
                  Annotations Created
                </th>
                <th scope="col" className="fc-text-right">
                  Annotations Resolved*
                </th>
                <th scope="col" className="fc-text-right">
                  Images Completed
                </th>
                <th scope="col" className="fc-text-right">
                  Last Active
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const isMe = currentUserId && r.reviewer_id === currentUserId;
                return (
                  <tr
                    key={r.reviewer_id || r.display_name}
                    className={isMe ? 'fc-table-row-highlight' : ''}
                  >
                    <td>
                      <div className="fc-reviewer-cell">
                        <span className="fc-reviewer-avatar" aria-hidden="true">
                          {(r.display_name || 'R').charAt(0).toUpperCase()}
                        </span>
                        <div className="fc-reviewer-info">
                          <span className="fc-reviewer-name">
                            {r.display_name || 'Reviewer'}
                            {isMe ? (
                              <span className="fc-badge-pill fc-badge-pill-self">
                                You
                              </span>
                            ) : null}
                          </span>
                          {r.role ? (
                            <span className={`fc-role-badge fc-role-${r.role}`}>
                              {formatRoleLabel(r.role)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="fc-text-right fc-numeric-cell">
                      {Number(r.annotations_created) || 0}
                    </td>
                    <td className="fc-text-right fc-numeric-cell">
                      {Number(r.annotations_resolved) || 0}
                    </td>
                    <td className="fc-text-right fc-numeric-cell">
                      {Number(r.images_completed) || 0}
                    </td>
                    <td className="fc-text-right fc-timestamp-cell">
                      {formatActivityTimestamp(r.last_active)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="fc-analytics-footnote">
            * Resolved count reflects currently resolved annotations. Reopened annotations clear their resolved state.
          </p>
        </div>
      )}
    </section>
  );
}

