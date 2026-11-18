import { useEffect } from 'react';

/**
 * Interactive Correction Comment Card for uploaders.
 * Displays the reviewer's mistake explanation / correction instruction
 * associated with a clicked annotation, along with priority, status, and navigation.
 */
export function UploaderCommentCard({
  annotation,
  totalCount = 1,
  currentIndex = 0,
  onPrev = null,
  onNext = null,
  onClose,
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!annotation) return null;

  const annotationNum = annotation.displayNumber || annotation.annotationNumber || 1;
  const isResolved = annotation.status === 'resolved';
  const reviewerName = annotation.creatorName || 'Reviewer';
  const hasComment = Boolean(annotation.comment && annotation.comment.trim());

  return (
    <div
      className="fc-uiv-comment-card"
      role="region"
      aria-label={`Correction details for Annotation #${annotationNum}`}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="fc-uiv-card-header">
        <div className="fc-uiv-card-header-left">
          <span className="fc-uiv-card-number-badge">#{annotationNum}</span>
          <h3 className="fc-uiv-card-title">Annotation #{annotationNum}</h3>
        </div>

        <div className="fc-uiv-card-header-actions">
          <button
            type="button"
            className="fc-uiv-card-close-btn"
            onClick={onClose}
            title="Close details (Esc)"
            aria-label="Close correction instructions"
          >
            ×
          </button>
        </div>
      </header>

      <div className="fc-uiv-card-body">
        <div className="fc-uiv-card-meta-row">
          <span className="fc-uiv-card-reviewer">
            Marked by <strong>{reviewerName}</strong>
          </span>

          <span
            className={`fc-uiv-card-status-pill ${
              isResolved ? 'fc-uiv-card-status-resolved' : 'fc-uiv-card-status-open'
            }`}
          >
            {isResolved ? '✓ Resolved' : 'Open Feedback'}
          </span>
        </div>

        <div
          className={`fc-uiv-card-comment-box${
            !hasComment ? ' fc-uiv-card-comment-box-empty' : ''
          }`}
        >
          <span className="fc-uiv-card-comment-label">Correction instructions:</span>
          {hasComment ? (
            <p className="fc-uiv-card-comment-text">"{annotation.comment}"</p>
          ) : (
            <p className="fc-uiv-card-comment-empty">
              No written explanation was added to this marker.
            </p>
          )}
        </div>

        {annotation.priority && annotation.priority !== 'none' ? (
          <div className="fc-uiv-card-meta-row">
            <span className="fc-uiv-card-reviewer">
              Priority:{' '}
              <strong style={{ textTransform: 'capitalize' }}>
                {annotation.priority}
              </strong>
            </span>
          </div>
        ) : null}

        {annotation.labels && annotation.labels.length > 0 ? (
          <div className="fc-uiv-card-labels">
            {annotation.labels.map((label) => (
              <span key={label} className="fc-uiv-card-tag">
                #{label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {totalCount > 1 ? (
        <footer className="fc-uiv-card-footer">
          <button
            type="button"
            className="fc-uiv-card-nav-btn"
            onClick={onPrev}
            disabled={currentIndex <= 0}
            title="Previous annotation"
          >
            ‹ Prev
          </button>

          <span className="fc-uiv-card-counter">
            {currentIndex + 1} of {totalCount}
          </span>

          <button
            type="button"
            className="fc-uiv-card-nav-btn"
            onClick={onNext}
            disabled={currentIndex >= totalCount - 1}
            title="Next annotation"
          >
            Next ›
          </button>
        </footer>
      ) : null}
    </div>
  );
}
