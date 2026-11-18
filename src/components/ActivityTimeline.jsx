import { useMemo, useState } from 'react';
import { getReviewerColor } from '../services/annotationState.js';
import {
  ACTIVITY_FILTERS,
  formatActivityRelativeTime,
  getActivityActionText,
  getActivityCategory,
} from '../services/activityService.js';
import './ActivityTimeline.css';

const FILTER_EMPTY_STATES = {
  all: {
    title: 'No review activity yet',
    body: 'Annotations, comments, whiteboard changes, and reviewer actions will appear here in chronological order.',
  },
  comments: {
    title: 'No comments or discussions',
    body: 'Reviewer explanations, discussion replies, and @mentions will appear here.',
  },
  status: {
    title: 'No status changes',
    body: 'Resolved and reopened feedback actions will be logged here.',
  },
  handoffs: {
    title: 'No assignments or handoffs',
    body: 'Reviewer assignments and annotation handoffs will appear here.',
  },
  completions: {
    title: 'No completion activity',
    body: 'Image completions, batch review completions, and review checklist progress will appear here.',
  },
  annotations: {
    title: 'No drawing or geometry edits',
    body: 'Created annotations and geometry adjustments will be logged here.',
  },
  whiteboard: {
    title: 'No whiteboard activity',
    body: 'Sticky notes, shapes, and collaborative elements on the batch whiteboard will appear here.',
  },
  presence: {
    title: 'No presence activity',
    body: 'Reviewer joins and leaves will appear here during live collaboration.',
  },
};

function ActivityTypeIcon({ eventType, elementType }) {
  switch (eventType) {
    case 'annotation_created':
      return '✏️';
    case 'annotation_geometry_edited':
      return '📐';
    case 'annotation_resolved':
      return '✅';
    case 'annotation_reopened':
      return '🔄';
    case 'annotation_deleted':
      return '🗑️';
    case 'annotation_edited':
      return '📝';
    case 'reviewer_handoff':
      return '🤝';
    case 'annotation_assigned':
      return '👤';
    case 'checklist_item_completed':
      return '☑️';
    case 'checklist_item_reopened':
      return '↩️';
    case 'comment_added':
      return '💬';
    case 'comment_mention':
      return '@';
    case 'whiteboard_created':
    case 'whiteboard_updated':
      return elementType === 'sticky' ? '📌' : '📋';
    case 'image_completed':
      return '✓';
    case 'batch_review_completed':
      return '🎉';
    case 'presence_joined':
      return '👋';
    case 'presence_left':
      return '🚪';
    case 'reaction_added':
      return '💬';
    default:
      return '•';
  }
}

export function ActivityTimeline({
  activities = [],
  isLoading = false,
  error = '',
  onRetry = null,
  onNavigateAnnotation = null,
  onNavigateImage = null,
  onNavigateWhiteboard = null,
  batchId = null,
}) {
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedActorFilter, setSelectedActorFilter] = useState('all');

  // Extract distinct reviewers who have performed activities
  const distinctReviewers = useMemo(() => {
    const map = new Map();
    activities.forEach((act) => {
      if (act.actorId && !map.has(act.actorId)) {
        map.set(act.actorId, {
          id: act.actorId,
          name: act.actorName || 'Reviewer',
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [activities]);

  const filterCounts = useMemo(() => {
    const counts = {
      all: activities.length,
      comments: 0,
      status: 0,
      handoffs: 0,
      completions: 0,
      annotations: 0,
      whiteboard: 0,
      presence: 0,
    };

    activities.forEach((item) => {
      const cat = getActivityCategory(item.eventType, item.metadata);
      if (counts[cat] !== undefined) {
        counts[cat] += 1;
      }
    });

    return counts;
  }, [activities]);

  const filteredActivities = useMemo(() => {
    return activities.filter((item) => {
      if (activeFilter !== 'all') {
        const cat = getActivityCategory(item.eventType, item.metadata);
        if (cat !== activeFilter) return false;
      }
      if (selectedActorFilter !== 'all') {
        if (item.actorId !== selectedActorFilter) return false;
      }
      return true;
    });
  }, [activities, activeFilter, selectedActorFilter]);

  const handleItemClick = (activity) => {
    if (activity.annotationId && activity.imageId) {
      onNavigateAnnotation?.({
        imageId: activity.imageId,
        annotationId: activity.annotationId,
      });
    } else if (activity.elementId) {
      onNavigateWhiteboard?.(batchId, activity.elementId);
    } else if (activity.imageId) {
      onNavigateImage?.(activity.imageId);
    }
  };

  const isItemNavigable = (activity) => {
    return Boolean(
      (activity.annotationId && activity.imageId) ||
        activity.elementId ||
        activity.imageId
    );
  };

  const emptyState = FILTER_EMPTY_STATES[activeFilter] || FILTER_EMPTY_STATES.all;

  return (
    <div className="fc-activity-timeline" aria-label="Batch activity feed">
      <div className="fc-activity-filter-bar" role="tablist" aria-label="Activity filter">
        {ACTIVITY_FILTERS.map((f) => {
          const isActive = activeFilter === f.id;
          const count = filterCounts[f.id] ?? 0;
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`fc-activity-filter-chip${
                isActive ? ' fc-activity-filter-chip-active' : ''
              }`}
              onClick={() => setActiveFilter(f.id)}
            >
              <span>{f.label}</span>
              <span className="fc-activity-filter-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Reviewer Filter Controls */}
      <div className="fc-activity-controls-bar">
        <div className="fc-activity-actor-filter">
          <label htmlFor="fc-activity-actor-select" className="fc-activity-actor-label">
            Reviewer:
          </label>
          <select
            id="fc-activity-actor-select"
            className="fc-activity-actor-select"
            value={selectedActorFilter}
            onChange={(e) => setSelectedActorFilter(e.target.value)}
            aria-label="Filter activity by reviewer"
          >
            <option value="all">All reviewers ({activities.length})</option>
            {distinctReviewers.map((rev) => {
              const count = activities.filter((a) => a.actorId === rev.id).length;
              return (
                <option key={rev.id} value={rev.id}>
                  {rev.name} ({count})
                </option>
              );
            })}
          </select>
        </div>
        {selectedActorFilter !== 'all' ? (
          <button
            type="button"
            className="fc-activity-reset-actor-btn"
            onClick={() => setSelectedActorFilter('all')}
            title="Show all reviewers"
          >
            Reset
          </button>
        ) : null}
      </div>

      <div className="fc-activity-scroll" tabIndex={0} aria-label="Activity timeline list">
        {isLoading ? (
          <div className="fc-activity-loading" aria-busy="true">
            <span className="fc-spinner" aria-hidden="true" />
            <span>Loading batch activity…</span>
          </div>
        ) : error ? (
          <div className="fc-activity-error" role="alert">
            <div className="fc-activity-error-icon" aria-hidden="true">⚠️</div>
            <h4 className="fc-activity-error-title">Unable to load activity</h4>
            <p className="fc-activity-error-text">{error}</p>
            {onRetry ? (
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-sm fc-activity-retry-btn"
                onClick={onRetry}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : filteredActivities.length === 0 ? (
          <div className="fc-activity-empty">
            <div className="fc-activity-empty-icon" aria-hidden="true">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h4 className="fc-activity-empty-title">{emptyState.title}</h4>
            <p className="fc-activity-empty-text">
              {selectedActorFilter !== 'all'
                ? 'No activities match the selected reviewer in this category.'
                : emptyState.body}
            </p>
          </div>
        ) : (
          <div className="fc-activity-list">
            {filteredActivities.map((act) => {
              const navigable = isItemNavigable(act);
              const actorInitial = (act.actorName || 'R')[0].toUpperCase();
              const avatarBg = getReviewerColor(act.actorName || act.actorId || 'reviewer');
              const actionText = getActivityActionText(act);
              const timeText = formatActivityRelativeTime(act.occurredAt);

              return (
                <div
                  key={act.id}
                  className={`fc-activity-item${
                    navigable ? '' : ' fc-activity-item-static'
                  }`}
                  onClick={navigable ? () => handleItemClick(act) : undefined}
                  role={navigable ? 'button' : undefined}
                  tabIndex={navigable ? 0 : undefined}
                  onKeyDown={
                    navigable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleItemClick(act);
                          }
                        }
                      : undefined
                  }
                  title={navigable ? 'Click to navigate to this item' : undefined}
                >
                  <div
                    className="fc-activity-avatar"
                    style={{ backgroundColor: avatarBg }}
                    aria-hidden="true"
                  >
                    <span>{actorInitial}</span>
                    <span className="fc-activity-icon-badge">
                      <ActivityTypeIcon
                        eventType={act.eventType}
                        elementType={act.elementType}
                      />
                    </span>
                  </div>

                  <div className="fc-activity-content">
                    <div className="fc-activity-header">
                      <span className="fc-activity-actor">{act.actorName}</span>
                      <time
                        className="fc-activity-time"
                        dateTime={act.occurredAt}
                        title={act.occurredAt ? new Date(act.occurredAt).toLocaleString() : ''}
                      >
                        {timeText}
                      </time>
                    </div>

                    <div className="fc-activity-action">{actionText}</div>

                    {act.imageFilename || act.imagePosition ? (
                      <span className="fc-activity-target-pill fc-activity-target-pill-image">
                        📷 Img {act.imagePosition || 1}
                        {act.imageFilename ? ` · ${act.imageFilename}` : ''}
                      </span>
                    ) : act.elementId ? (
                      <span className="fc-activity-target-pill fc-activity-target-pill-whiteboard">
                        🎨 Batch Whiteboard
                      </span>
                    ) : null}

                    {act.details &&
                    act.eventType !== 'image_completed' &&
                    act.eventType !== 'annotation_resolved' &&
                    act.eventType !== 'annotation_reopened' &&
                    act.eventType !== 'reviewer_handoff' &&
                    act.eventType !== 'checklist_item_completed' &&
                    act.eventType !== 'checklist_item_reopened' ? (
                      <div className="fc-activity-snippet">"{act.details}"</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
