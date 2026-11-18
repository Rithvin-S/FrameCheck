import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_ANNOTATION_COMMENT_LENGTH } from '../services/annotationService.js';
import {
  ANNOTATION_PRIORITIES,
  ANNOTATION_STAMPS,
  DEFAULT_ANNOTATION_PRIORITY,
  PRESET_LABELS,
  PRIORITY_CONFIG,
  getReviewerColor,
} from '../services/annotationState.js';
import { MentionInput } from './MentionInput.jsx';
import { ReactionPills } from './ReactionPills.jsx';
import { ActivityTimeline } from './ActivityTimeline.jsx';
import { ReferenceImagesPanel } from './ReferenceImagesPanel.jsx';
import { getReferenceSignedUrl } from '../services/referenceImageService.js';
import {
  formatActivityRelativeTime,
  getActivityActionText,
  getAnnotationHistory,
} from '../services/activityService.js';
import {
  CHECKLIST_CATEGORIES,
  calculateChecklistProgress,
} from '../services/checklistService.js';
import './ReviewSidebar.css';

function getInitials(name) {
  if (!name) return 'R';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
];

const EMPTY_MESSAGES = {
  all: {
    title: 'No annotations yet',
    body: 'Draw a circle over an image to add the first annotation and explanation.',
  },
  open: {
    title: 'No open annotations',
    body: 'Unresolved review items across this batch will appear here.',
  },
  resolved: {
    title: 'No resolved annotations',
    body: 'Annotations marked as resolved will appear here for reference.',
  },
};

function formatTimestamp(isoString) {
  if (!isoString) return '';
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function highlightSearchText(text, query, keyPrefix = 'hl') {
  if (!text || typeof text !== 'string') return text;
  const trimmed = query ? query.trim() : '';
  if (!trimmed) return text;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let regex;
  try {
    regex = new RegExp(`(${escaped})`, 'gi');
  } catch {
    return text;
  }
  const parts = text.split(regex);
  if (parts.length <= 1) return text;

  return parts.map((part, index) => {
    if (part.toLowerCase() === trimmed.toLowerCase()) {
      return (
        <mark key={`${keyPrefix}-${index}`} className="fc-search-highlight">
          {part}
        </mark>
      );
    }
    return part;
  });
}

function formatCommentWithMentions(text, searchQuery = '') {
  if (!text) return '';
  const regex = /(@[A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)?)/g;
  const parts = text.split(regex);

  return parts.flatMap((part, i) => {
    if (part.startsWith('@')) {
      return (
        <span key={`mention-${i}`} className="fc-comment-mention">
          {highlightSearchText(part, searchQuery, `m-${i}`)}
        </span>
      );
    }
    return highlightSearchText(part, searchQuery, `t-${i}`);
  });
}

function matchesSearch(ann, query, layerMap, reviewerMap, discussionsMap = {}) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;

  // 1. Annotation numbers: match '#3', '3', etc.
  const displayNum = String(ann.displayNumber || '');
  if (displayNum) {
    const strippedQ = q.replace(/^#/, '').trim();
    if (strippedQ && (displayNum === strippedQ || displayNum.startsWith(strippedQ))) {
      return true;
    }
    if (q === `#${displayNum}`) {
      return true;
    }
  }

  // 2. Comments:
  if (ann.comment && ann.comment.toLowerCase().includes(q)) {
    return true;
  }

  // 3. Labels:
  if (Array.isArray(ann.labels)) {
    for (const l of ann.labels) {
      const name = String(l.name || l.text || l || '').toLowerCase();
      if (name && name.includes(q)) return true;
    }
  }

  // 4. Custom properties: name and value
  if (Array.isArray(ann.customProperties)) {
    for (const prop of ann.customProperties) {
      const propName = String(prop.name || '').toLowerCase();
      const propVal = String(prop.value ?? '').toLowerCase();
      if (propName.includes(q) || propVal.includes(q)) return true;
    }
  }

  // 5. Callout note text:
  const calloutText = String(
    ann.geometry?.calloutText ||
    ann.geometry?.callout?.calloutText ||
    ann.style?.calloutText ||
    ''
  ).toLowerCase();
  if (calloutText && calloutText.includes(q)) return true;

  // 6. Textbox text:
  const textboxText = String(
    ann.geometry?.text ||
    ann.text ||
    ''
  ).toLowerCase();
  if (textboxText && textboxText.includes(q)) return true;

  // 7. Creator name:
  const creatorName = String(ann.creatorName || '').toLowerCase();
  if (creatorName && creatorName.includes(q)) return true;

  // 8. Assignee name:
  if (ann.assignedTo) {
    const assigneeName = String(reviewerMap?.get(ann.assignedTo) || '').toLowerCase();
    if (assigneeName && assigneeName.includes(q)) return true;
  }

  // 9. Tool / type:
  const annType = String(
    ann.geometry?.tool ||
    ann.type ||
    (ann.geometry?.type ? ann.geometry.type : '')
  ).toLowerCase();
  if (annType && annType.includes(q)) return true;

  // 10. Layer name:
  const layerId = ann.layerId || 'default';
  const layerName = String(layerMap?.get(layerId) || (layerId === 'default' ? 'Default' : '')).toLowerCase();
  if (layerName && layerName.includes(q)) return true;

  // 11. Marker / Stamp:
  if (ann.style?.marker && String(ann.style.marker).toLowerCase().includes(q)) return true;
  if (ann.style?.stamp && String(ann.style.stamp).toLowerCase().includes(q)) return true;

  // 12. Discussion messages:
  const annDiscussions = discussionsMap ? discussionsMap[ann.id] : null;
  if (Array.isArray(annDiscussions)) {
    for (const d of annDiscussions) {
      if (d.message && d.message.toLowerCase().includes(q)) return true;
      if (d.authorName && d.authorName.toLowerCase().includes(q)) return true;
    }
  }

  return false;
}

export function DraftCommentComposer({
  draftAnnotation,
  imageLabel,
  isSubmitting,
  onConfirm,
  onCancel,
  mentionableUsers = [],
}) {
  const [comment, setComment] = useState('');
  const [priority, setPriority] = useState(draftAnnotation?.priority || DEFAULT_ANNOTATION_PRIORITY);
  const [assignedTo, setAssignedTo] = useState(draftAnnotation?.assignedTo || '');
  const [validationError, setValidationError] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    setComment('');
    setPriority(draftAnnotation?.priority || DEFAULT_ANNOTATION_PRIORITY);
    setAssignedTo(draftAnnotation?.assignedTo || '');
    setValidationError('');
    const frameId = requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => cancelAnimationFrame(frameId);
  }, [draftAnnotation]);

  const handleSubmit = (event) => {
    event?.preventDefault();
    if (isSubmitting) return;

    const trimmed = comment.trim();
    if (!trimmed) {
      setValidationError('Enter an explanation for this annotation before saving.');
      textareaRef.current?.focus();
      return;
    }
    if (trimmed.length > MAX_ANNOTATION_COMMENT_LENGTH) {
      setValidationError(
        `Comment must be ${MAX_ANNOTATION_COMMENT_LENGTH} characters or fewer.`
      );
      return;
    }

    setValidationError('');
    onConfirm(trimmed, {
      priority,
      assignedTo: assignedTo ? assignedTo.trim() : null,
    });
  };

  const handleKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      handleSubmit();
    } else if (event.key === 'Escape' && !isSubmitting) {
      event.preventDefault();
      onCancel();
    }
  };

  const eligibleReviewers = useMemo(() => {
    return (mentionableUsers || []).filter(
      (u) => u.role === 'reviewer' || u.role === 'admin'
    );
  }, [mentionableUsers]);

  return (
    <form
      className="fc-draft-card"
      onSubmit={handleSubmit}
      aria-label="New annotation comment"
    >
      <div className="fc-draft-card-header">
        <span className="fc-draft-pill">
          <span
            className="fc-draft-color-dot"
            style={{ backgroundColor: draftAnnotation.color }}
            aria-hidden="true"
          />
          <span>
            New Draft{' '}
            {draftAnnotation.type
              ? draftAnnotation.type.charAt(0).toUpperCase() +
              draftAnnotation.type.slice(1)
              : 'Circle'}
          </span>
        </span>
        {imageLabel ? (
          <span className="fc-draft-image-label" title={imageLabel}>
            {imageLabel}
          </span>
        ) : null}
      </div>

      <label className="fc-draft-label" htmlFor="fc-draft-comment-input">
        Describe the issue spotted here (type @ to mention a reviewer)
      </label>
      <MentionInput
        id="fc-draft-comment-input"
        className="fc-sidebar-textarea"
        rows={3}
        maxLength={MAX_ANNOTATION_COMMENT_LENGTH}
        placeholder="Explain what needs attention (type @ to mention)…"
        value={comment}
        disabled={isSubmitting}
        mentionableUsers={mentionableUsers}
        onChange={(nextVal) => {
          setComment(nextVal);
          if (validationError) setValidationError('');
        }}
        onKeyDown={handleKeyDown}
      />

      <div className="fc-draft-meta-row">
        <div className="fc-draft-meta-item">
          <label className="fc-draft-meta-label">Priority:</label>
          <div className="fc-draft-priority-buttons" role="radiogroup" aria-label="Annotation priority">
            {ANNOTATION_PRIORITIES.map((pId) => {
              const cfg = PRIORITY_CONFIG[pId];
              const isSelected = priority === pId;
              return (
                <button
                  key={pId}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={`fc-draft-priority-btn${isSelected ? ' fc-draft-priority-active' : ''}`}
                  style={{
                    borderColor: isSelected ? cfg.color : undefined,
                    backgroundColor: isSelected ? cfg.bgColor : undefined,
                    color: isSelected ? cfg.color : undefined,
                  }}
                  onClick={() => setPriority(pId)}
                  title={`Priority: ${cfg.label}`}
                >
                  <span className="fc-draft-p-icon" aria-hidden="true">{cfg.icon}</span>
                  <span>{cfg.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="fc-draft-meta-item">
          <label className="fc-draft-meta-label" htmlFor="fc-draft-assignee">Assignee:</label>
          <select
            id="fc-draft-assignee"
            className="fc-draft-assignee-select"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            disabled={isSubmitting}
            title="Assign this annotation to an eligible reviewer"
          >
            <option value="">Unassigned</option>
            {eligibleReviewers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.role === 'admin' ? 'Admin' : 'Reviewer'})
              </option>
            ))}
          </select>
        </div>
      </div>

      {validationError ? (
        <p className="fc-sidebar-field-error" role="alert">
          {validationError}
        </p>
      ) : null}

      <div className="fc-draft-footer">
        <span className="fc-sidebar-char-count">
          {comment.trim().length}/{MAX_ANNOTATION_COMMENT_LENGTH}
        </span>
        <div className="fc-draft-actions">
          <button
            type="button"
            className="fc-btn fc-btn-secondary fc-btn-sm"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="fc-btn fc-btn-primary fc-btn-sm"
            disabled={isSubmitting || !comment.trim()}
          >
            {isSubmitting ? 'Saving…' : 'Save Annotation'}
          </button>
        </div>
      </div>
    </form>
  );
}

function ReferenceThumbnailMini({ storagePath, filename }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let active = true;
    if (!storagePath) return;
    getReferenceSignedUrl(storagePath)
      .then((u) => {
        if (active) setUrl(u);
      })
      .catch(() => { });
    return () => {
      active = false;
    };
  }, [storagePath]);

  if (!url) {
    return <span className="fc-ann-ref-mini-placeholder" aria-hidden="true">📎</span>;
  }
  return <img src={url} alt={filename} className="fc-ann-ref-thumb-mini-img" />;
}

function calculateCardPopupCoords(cardEl, dockSide = 'right') {
  if (!cardEl) return null;
  const rect = cardEl.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const popupWidth = Math.min(400, viewportWidth - 24);
  const gap = 12;
  const margin = 12;

  let left;
  if (dockSide === 'right') {
    if (rect.left - popupWidth - gap >= margin) {
      left = rect.left - popupWidth - gap;
    } else if (viewportWidth - rect.right - gap >= popupWidth + margin) {
      left = rect.right + gap;
    } else {
      left = Math.max(margin, rect.left - popupWidth - gap);
    }
  } else {
    if (viewportWidth - rect.right - gap >= popupWidth + margin) {
      left = rect.right + gap;
    } else if (rect.left - popupWidth - gap >= margin) {
      left = rect.left - popupWidth - gap;
    } else {
      left = Math.max(margin, viewportWidth - popupWidth - margin);
    }
  }

  const estimatedHeight = 480;
  let top = rect.top;
  if (top + estimatedHeight > viewportHeight - margin) {
    top = Math.max(margin, viewportHeight - estimatedHeight - margin);
  }
  if (top < margin) {
    top = margin;
  }
  const maxHeight = Math.max(260, viewportHeight - top - margin);

  return {
    top: Math.round(top),
    left: Math.round(left),
    width: Math.round(popupWidth),
    maxHeight: Math.round(maxHeight),
  };
}

function AnnotationCompactCard({
  annotation,
  isCreator,
  isSelected,
  searchQuery = '',
  onSelect,
}) {
  const isResolved = annotation.status === 'resolved';

  return (
    <article
      data-annotation-id={annotation.id}
      className={`fc-ann-card-compact${isSelected ? ' fc-ann-card-compact-selected' : ''}${
        isResolved ? ' fc-ann-card-compact-resolved' : ''
      }`}
      role="button"
      tabIndex={0}
      onClick={(e) => onSelect?.(annotation, e)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(annotation, event);
        }
      }}
      aria-label={`Annotation #${annotation.displayNumber} by ${annotation.creatorName || 'Reviewer'}`}
      aria-pressed={isSelected}
    >
      <div className="fc-ann-compact-top">
        <div className="fc-ann-compact-header-left">
          <span
            className={`fc-ann-num-badge${
              searchQuery &&
              String(annotation.displayNumber) === searchQuery.trim().replace(/^#/, '')
                ? ' fc-num-badge-highlight'
                : ''
            }`}
            style={{ backgroundColor: annotation.color || '#3b82f6' }}
          >
            #{annotation.displayNumber}
          </span>
          <span className="fc-ann-compact-creator" title={annotation.creatorName || 'Reviewer'}>
            {highlightSearchText(annotation.creatorName || 'Reviewer', searchQuery, `cc-cr-${annotation.id}`)}
            {isCreator ? ' (You)' : ''}
          </span>
        </div>
        <div className="fc-ann-compact-header-right">
          {annotation.createdAt ? (
            <span className="fc-ann-compact-time">
              {formatTimestamp(annotation.createdAt)}
            </span>
          ) : null}
          <span
            className={`fc-ann-status-pill-sm ${
              isResolved ? 'fc-ann-status-resolved' : 'fc-ann-status-open'
            }`}
          >
            {isResolved ? 'Resolved' : 'Open'}
          </span>
        </div>
      </div>
      <p className="fc-ann-compact-preview">
        {annotation.comment?.trim() ? (
          formatCommentWithMentions(annotation.comment, searchQuery)
        ) : (
          <em className="fc-ann-empty-comment">No comment</em>
        )}
      </p>
    </article>
  );
}

const AnnotationDetailsPopup = forwardRef(function AnnotationDetailsPopup(
  {
    coords,
    onClose,
    annotation,
    imageMeta,
    isCurrentImage,
    isSelected,
    isLocked = false,
    isCreator,
    isAdmin = false,
    isBusy,
    readOnly = false,
    onSelect,
    onSaveComment,
    onToggleStatus,
    onDelete,
    liveSelectors = [],
    reactions = [],
    onToggleReaction = null,
    mentionableUsers = [],
    currentUserId = null,
    attachedReferences = [],
    onSelectReferenceForView = null,
    onAttachReference = null,
    canAttachReference = false,
    onOpenComparison = null,
    layers = [],
    onOpenPropertiesModal = null,
    onUpdateAnnotationLabels = null,
    onUpdateAnnotationAssignment = null,
    onUpdateAnnotationPriority = null,
    searchQuery = '',
    discussions = [],
    onCreateDiscussionMessage = null,
    onDeleteDiscussionMessage = null,
    activities = [],
  },
  ref
) {
  const canManage = !readOnly && (isCreator || isAdmin) && !isLocked;
  const isAssignee = Boolean(currentUserId && annotation?.assignedTo === currentUserId);
  const canAssignOrHandoff = !readOnly && !isLocked && (isCreator || isAdmin || isAssignee);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(annotation?.comment || '');
  const [editError, setEditError] = useState('');
  const [isLabelMenuOpen, setIsLabelMenuOpen] = useState(false);
  const [isPriorityMenuOpen, setIsPriorityMenuOpen] = useState(false);
  const [isAssigneeMenuOpen, setIsAssigneeMenuOpen] = useState(false);
  const [isDiscussionOpen, setIsDiscussionOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [replyError, setReplyError] = useState('');
  const [customLabelInput, setCustomLabelInput] = useState('');
  const [customLabelColor, setCustomLabelColor] = useState('#6366f1');
  const editInputRef = useRef(null);
  const priorityMenuRef = useRef(null);
  const assigneeMenuRef = useRef(null);

  const handleSendReply = async (e) => {
    e?.preventDefault();
    if (readOnly || isSubmittingReply) return;
    const trimmed = replyText.trim();
    if (!trimmed) {
      setReplyError('Message cannot be empty.');
      return;
    }
    if (trimmed.length > 2000) {
      setReplyError('Message must be 2000 characters or fewer.');
      return;
    }

    setIsSubmittingReply(true);
    setReplyError('');
    try {
      const ok = await onCreateDiscussionMessage?.(annotation.id, trimmed);
      if (ok) {
        setReplyText('');
      } else {
        setReplyError('Failed to post reply.');
      }
    } catch (err) {
      setReplyError(err?.message || 'Failed to post reply.');
    } finally {
      setIsSubmittingReply(false);
    }
  };

  useEffect(() => {
    if (!isPriorityMenuOpen && !isAssigneeMenuOpen) return;
    const handleOutsideClick = (e) => {
      if (isPriorityMenuOpen && priorityMenuRef.current && !priorityMenuRef.current.contains(e.target)) {
        setIsPriorityMenuOpen(false);
      }
      if (isAssigneeMenuOpen && assigneeMenuRef.current && !assigneeMenuRef.current.contains(e.target)) {
        setIsAssigneeMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => document.removeEventListener('pointerdown', handleOutsideClick);
  }, [isPriorityMenuOpen, isAssigneeMenuOpen]);

  const layer = layers.find((l) => l.id === (annotation.layerId || 'default')) || {
    name: 'Default Layer',
    color: '#6366f1',
  };

  const priorityConfig =
    PRIORITY_CONFIG[annotation.priority || 'medium'] || PRIORITY_CONFIG.medium;

  const eligibleReviewers = useMemo(() => {
    return (mentionableUsers || []).filter(
      (u) => u.role === 'reviewer' || u.role === 'admin'
    );
  }, [mentionableUsers]);

  const matchedAssignee = eligibleReviewers.find(
    (u) => u.id === annotation.assignedTo
  );
  const assigneeDisplayName =
    matchedAssignee?.displayName ||
    annotation.assigneeName ||
    (annotation.assignedTo ? 'Reviewer' : null);

  const markerIconMap = {
    star: '★',
    flag: '⚑',
    bug: '🪲',
    pin: '📌',
    warning: '⚠️',
  };
  const markerGlyph = annotation.style?.marker
    ? markerIconMap[annotation.style.marker] || '★'
    : null;

  const stampItem = annotation.style?.stamp
    ? ANNOTATION_STAMPS.find((s) => s.id === annotation.style.stamp)
    : null;

  const annotationHistory = useMemo(() => {
    return getAnnotationHistory(activities, annotation, discussions);
  }, [activities, annotation, discussions]);

  const latestHandoff = useMemo(() => {
    return annotationHistory.find(
      (h) =>
        h.eventType === 'reviewer_handoff' ||
        (h.eventType === 'annotation_assigned' && h.metadata?.subType === 'reviewer_handoff') ||
        h.metadata?.subType === 'reviewer_handoff'
    );
  }, [annotationHistory]);

  const handleToggleLabel = (labelObj) => {
    const existing = Array.isArray(annotation.labels) ? annotation.labels : [];
    const idx = existing.findIndex(
      (l) => (l.name || l.text || l).toLowerCase() === labelObj.name.toLowerCase()
    );
    let nextLabels;
    if (idx !== -1) {
      nextLabels = existing.filter((_, i) => i !== idx);
    } else {
      if (existing.length >= 50) return;
      nextLabels = [
        ...existing,
        { id: labelObj.name, name: labelObj.name, color: labelObj.color },
      ];
    }
    onUpdateAnnotationLabels?.(annotation.id, nextLabels);
  };

  const handleAddCustomLabel = (e) => {
    e?.preventDefault();
    const trimmed = customLabelInput.trim();
    if (!trimmed || trimmed.length > 50) return;
    const existing = Array.isArray(annotation.labels) ? annotation.labels : [];
    if (existing.length >= 50) return;
    handleToggleLabel({ name: trimmed, color: customLabelColor });
    setCustomLabelInput('');
  };

  useEffect(() => {
    if (readOnly && isEditing) {
      setIsEditing(false);
      setEditText(annotation?.comment || '');
      setEditError('');
    }
  }, [annotation?.comment, isEditing, readOnly]);

  useEffect(() => {
    if (!isEditing) {
      setEditText(annotation?.comment || '');
      setEditError('');
    }
  }, [annotation?.comment, isEditing]);

  useEffect(() => {
    if (!isEditing || readOnly) return;
    const frameId = requestAnimationFrame(() => {
      editInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frameId);
  }, [isEditing, readOnly]);

  const startEditing = () => {
    if (readOnly || isBusy) return;
    setEditText(annotation.comment);
    setEditError('');
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditText(annotation.comment);
    setEditError('');
  };

  const submitEdit = async (event) => {
    event?.preventDefault();
    if (readOnly || isBusy) return;

    const trimmed = editText.trim();
    if (!trimmed) {
      setEditError('Comment cannot be empty.');
      editInputRef.current?.focus();
      return;
    }
    if (trimmed.length > MAX_ANNOTATION_COMMENT_LENGTH) {
      setEditError(
        `Comment must be ${MAX_ANNOTATION_COMMENT_LENGTH} characters or fewer.`
      );
      return;
    }
    if (trimmed === annotation.comment.trim()) {
      setIsEditing(false);
      return;
    }

    const ok = await onSaveComment(annotation, trimmed);
    if (ok) {
      setIsEditing(false);
      setEditError('');
    }
  };

  const effectiveEditing = !readOnly && isEditing;
  const isResolved = annotation.status === 'resolved';
  const wasEdited =
    annotation.updatedAt &&
    annotation.createdAt &&
    annotation.updatedAt !== annotation.createdAt &&
    (!annotation.resolvedAt || annotation.updatedAt !== annotation.resolvedAt);

  return (
    <div
      ref={ref}
      className="fc-ann-details-popup"
      style={{
        top: coords?.top != null ? `${coords.top}px` : 'auto',
        left: coords?.left != null ? `${coords.left}px` : 'auto',
        width: coords?.width != null ? `${coords.width}px` : 'auto',
        maxHeight: coords?.maxHeight != null ? `${coords.maxHeight}px` : 'auto',
      }}
      role="dialog"
      aria-label={`Annotation #${annotation?.displayNumber || ''} details`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="fc-ann-details-header">
        <div className="fc-ann-details-header-left">
          <span
            className="fc-ann-num-badge"
            style={{ backgroundColor: annotation.color || '#3b82f6' }}
          >
            #{annotation.displayNumber}
          </span>
          <span className="fc-ann-details-header-title">
            Comment Details
          </span>
        </div>
        <button
          type="button"
          className="fc-ann-details-close-btn"
          onClick={onClose}
          title="Close details (Esc)"
          aria-label="Close comment details"
        >
          ×
        </button>
      </div>

      <div className="fc-ann-details-body">
        <div className="fc-ann-card-top">
          <span
            className={`fc-ann-num-badge${searchQuery && String(annotation.displayNumber) === searchQuery.trim().replace(/^#/, '') ? ' fc-num-badge-highlight' : ''}`}
            style={{ backgroundColor: annotation.color }}
          >
            #{annotation.displayNumber}
          </span>

          {markerGlyph ? (
            <span
              className="fc-ann-marker-badge"
              style={{
                backgroundColor: annotation.style?.markerColor || '#f59e0b',
                color: '#ffffff',
              }}
              title={`Marker: ${annotation.style?.marker}`}
            >
              {markerGlyph}
            </span>
          ) : null}

          {stampItem ? (
            <span
              className="fc-ann-stamp-pill"
              style={{
                backgroundColor: `${annotation.style?.stampColor || stampItem.color}20`,
                borderColor: `${annotation.style?.stampColor || stampItem.color}60`,
                color: annotation.style?.stampColor || stampItem.color,
                fontWeight: 600,
                fontSize: '11px',
                padding: '1px 6px',
                borderRadius: '4px',
                border: '1px solid',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
              }}
              title={`Stamp: ${stampItem.label}`}
            >
              <span>{stampItem.icon}</span>
              <span>{stampItem.label}</span>
            </span>
          ) : null}

          {/* Phase 20A: Priority Pill */}
          <div className="fc-ann-priority-wrap" ref={priorityMenuRef} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`fc-ann-priority-pill fc-ann-priority-${priorityConfig.id}${canManage ? ' fc-ann-priority-interactive' : ''}`}
              style={{
                backgroundColor: priorityConfig.bgColor,
                borderColor: priorityConfig.borderColor,
                color: priorityConfig.color,
              }}
              onClick={() => canManage && setIsPriorityMenuOpen(!isPriorityMenuOpen)}
              disabled={!canManage}
              title={canManage ? `Priority: ${priorityConfig.label} (click to change)` : `Priority: ${priorityConfig.label}`}
            >
              <span className="fc-ann-priority-icon" aria-hidden="true">{priorityConfig.icon}</span>
              <span className="fc-ann-priority-text">{priorityConfig.label}</span>
              {canManage ? <span className="fc-ann-dropdown-arrow" aria-hidden="true">▾</span> : null}
            </button>

            {canManage && isPriorityMenuOpen ? (
              <div className="fc-ann-popover-menu fc-ann-priority-menu">
                <div className="fc-ann-popover-title">Set Priority</div>
                {ANNOTATION_PRIORITIES.map((pId) => {
                  const cfg = PRIORITY_CONFIG[pId];
                  const isCurrent = (annotation.priority || 'medium') === pId;
                  return (
                    <button
                      key={pId}
                      type="button"
                      className={`fc-ann-popover-item${isCurrent ? ' fc-ann-popover-item-active' : ''}`}
                      onClick={() => {
                        onUpdateAnnotationPriority?.(annotation.id, pId);
                        setIsPriorityMenuOpen(false);
                      }}
                    >
                      <span style={{ marginRight: '6px' }}>{cfg.icon}</span>
                      <span>{cfg.label}</span>
                      {isCurrent ? <span className="fc-ann-popover-check">✓</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <span className="fc-ann-type-pill">
            {annotation.geometry?.tool === 'marker' || annotation.type === 'marker'
              ? 'Marker'
              : annotation.type
                ? annotation.type.charAt(0).toUpperCase() + annotation.type.slice(1)
                : 'Circle'}
          </span>

          <span
            className="fc-ann-layer-pill"
            style={{
              borderColor: `${layer.color}60`,
              backgroundColor: `${layer.color}15`,
              color: layer.color,
            }}
            title={`Layer: ${layer.name}`}
          >
            {layer.name}
          </span>

          {isLocked ? (
            <span
              className="fc-ann-locked-pill"
              title="Layer is locked. Modifications and deletion are disabled."
            >
              🔒 Locked
            </span>
          ) : null}

          {liveSelectors && liveSelectors.length > 0 ? (
            <span
              className="fc-ann-collab-pill"
              style={{
                borderColor: `${liveSelectors[0].color}60`,
                backgroundColor: `${liveSelectors[0].color}15`,
                color: liveSelectors[0].color,
              }}
              title={`Selected by ${liveSelectors.map((s) => s.displayName).join(', ')}`}
            >
              <span
                className="fc-ann-collab-dot"
                style={{ backgroundColor: liveSelectors[0].color }}
              />
              {liveSelectors.map((s) => s.displayName).join(', ')}
            </span>
          ) : null}

          {imageMeta ? (
            <span
              className={`fc-ann-image-tag${isCurrentImage ? ' fc-ann-image-tag-current' : ''
                }`}
              title={`Image ${imageMeta.position}: ${imageMeta.filename}`}
            >
              Img {imageMeta.position} · {imageMeta.filename}
            </span>
          ) : null}

          <span
            className={`fc-ann-status-pill ${isResolved ? 'fc-ann-status-resolved' : 'fc-ann-status-open'
              }`}
          >
            {isResolved ? 'Resolved' : 'Open'}
          </span>
        </div>

        <div className="fc-ann-card-meta">
          <div className="fc-ann-creator-info">
            <span
              className="fc-ann-creator-avatar"
              style={{ backgroundColor: getReviewerColor(annotation.createdBy || annotation.creatorName) }}
              aria-hidden="true"
            >
              {getInitials(annotation.creatorName)}
            </span>
            <span className="fc-ann-creator">
              {highlightSearchText(annotation.creatorName, searchQuery, `cr-${annotation.id}`)}
              {isCreator ? ' (You)' : ''}
            </span>
          </div>
          {annotation.createdAt ? (
            <span className="fc-ann-time">
              {formatTimestamp(annotation.createdAt)}
              {wasEdited ? ' · Edited' : ''}
            </span>
          ) : null}
        </div>

        {/* Phase 20A & 20D: Assignee Display, Handoff & Dropdown */}
        <div className="fc-ann-assignee-row" onClick={(e) => e.stopPropagation()}>
          <span className="fc-ann-assignee-label">Assignee:</span>
          <div className="fc-ann-assignee-wrap" ref={assigneeMenuRef}>
            <button
              type="button"
              className={`fc-ann-assignee-pill${annotation.assignedTo ? ' fc-ann-assignee-assigned' : ' fc-ann-assignee-unassigned'}${canAssignOrHandoff ? ' fc-ann-assignee-interactive' : ''}`}
              onClick={() => canAssignOrHandoff && setIsAssigneeMenuOpen(!isAssigneeMenuOpen)}
              disabled={!canAssignOrHandoff}
              title={
                canAssignOrHandoff
                  ? (annotation.assignedTo ? `Assigned to ${assigneeDisplayName} (click to hand off / reassign)` : 'Unassigned (click to assign)')
                  : (annotation.assignedTo ? `Assigned to ${assigneeDisplayName}` : 'Unassigned')
              }
            >
              {annotation.assignedTo ? (
                <>
                  <span
                    className="fc-ann-assignee-avatar"
                    style={{ backgroundColor: getReviewerColor(annotation.assignedTo || assigneeDisplayName) }}
                  >
                    {getInitials(assigneeDisplayName)}
                  </span>
                  <span className="fc-ann-assignee-name">
                    {highlightSearchText(assigneeDisplayName, searchQuery, `asg-${annotation.id}`)}
                  </span>
                </>
              ) : (
                <span className="fc-ann-unassigned-text">Unassigned</span>
              )}
              {canAssignOrHandoff ? <span className="fc-ann-dropdown-arrow" aria-hidden="true">▾</span> : null}
            </button>

            {canAssignOrHandoff && isAssigneeMenuOpen ? (
              <div className="fc-ann-popover-menu fc-ann-assignee-menu">
                <div className="fc-ann-popover-title">
                  {annotation.assignedTo ? '🤝 Hand Off Annotation' : 'Assign Reviewer'}
                </div>
                <button
                  type="button"
                  className={`fc-ann-popover-item${!annotation.assignedTo ? ' fc-ann-popover-item-active' : ''}`}
                  onClick={() => {
                    onUpdateAnnotationAssignment?.(annotation.id, null);
                    setIsAssigneeMenuOpen(false);
                  }}
                >
                  <span className="fc-ann-unassigned-dot" />
                  <span>Unassigned</span>
                  {!annotation.assignedTo ? <span className="fc-ann-popover-check">✓</span> : null}
                </button>
                {eligibleReviewers.map((rev) => {
                  const isCurrent = annotation.assignedTo === rev.id;
                  return (
                    <button
                      key={rev.id}
                      type="button"
                      className={`fc-ann-popover-item${isCurrent ? ' fc-ann-popover-item-active' : ''}`}
                      onClick={() => {
                        onUpdateAnnotationAssignment?.(annotation.id, rev.id);
                        setIsAssigneeMenuOpen(false);
                      }}
                    >
                      <span
                        className="fc-ann-assignee-avatar-sm"
                        style={{ backgroundColor: getReviewerColor(rev.id || rev.displayName) }}
                      >
                        {getInitials(rev.displayName)}
                      </span>
                      <span className="fc-ann-popover-item-name">{rev.displayName}</span>
                      {isCurrent ? <span className="fc-ann-popover-check">✓</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {latestHandoff?.metadata?.fromName ? (
            <span
              className="fc-ann-handoff-pill"
              title={`Handed off from ${latestHandoff.metadata.fromName} to ${latestHandoff.metadata.toName || assigneeDisplayName}`}
            >
              🤝 From {latestHandoff.metadata.fromName}
            </span>
          ) : null}
        </div>

        {annotation.type === 'callout' && (annotation.geometry?.calloutText || annotation.geometry?.callout?.calloutText) ? (
          <div className="fc-ann-callout-preview">
            Note: &ldquo;{highlightSearchText(annotation.geometry?.calloutText || annotation.geometry?.callout?.calloutText, searchQuery, `co-${annotation.id}`)}&rdquo;
          </div>
        ) : null}

        {!effectiveEditing ? (
          <>
            <p className="fc-ann-comment-text">
              {formatCommentWithMentions(annotation.comment, searchQuery)}
            </p>
            {attachedReferences && attachedReferences.length > 0 ? (
              <div className="fc-ann-refs-row">
                <span className="fc-ann-refs-label">
                  📎 {attachedReferences.length} {attachedReferences.length === 1 ? 'ref' : 'refs'}:
                </span>
                <div className="fc-ann-refs-list">
                  {attachedReferences.map((ref) => (
                    <button
                      key={ref.id}
                      type="button"
                      className="fc-ann-ref-thumb-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectReferenceForView?.(ref);
                      }}
                      title={`${ref.originalFilename} (click to view)`}
                    >
                      <ReferenceThumbnailMini
                        storagePath={ref.storagePath}
                        filename={ref.originalFilename}
                      />
                    </button>
                  ))}
                  {onOpenComparison ? (
                    <button
                      type="button"
                      className="fc-ann-ref-compare-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenComparison(attachedReferences[0]);
                      }}
                      title="Compare reference with original image"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="3" width="9" height="18" rx="2" />
                        <rect x="13" y="3" width="9" height="18" rx="2" />
                      </svg>
                      <span>Compare</span>
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <ReactionPills
              annotationId={annotation.id}
              reactions={reactions}
              currentUserId={currentUserId}
              onToggleReaction={onToggleReaction}
              disabled={readOnly}
            />

            {/* Phase 19: Labels list & inline adder */}
            {((annotation.labels && annotation.labels.length > 0) || canManage) ? (
              <div className="fc-ann-labels-row" onClick={(e) => e.stopPropagation()}>
                {annotation.labels &&
                  annotation.labels.map((lbl, idx) => (
                    <span
                      key={lbl.id || idx}
                      className="fc-ann-label-pill"
                      style={{
                        backgroundColor: `${lbl.color}18`,
                        borderColor: `${lbl.color}60`,
                        color: lbl.color,
                      }}
                    >
                      <span>{highlightSearchText(lbl.name, searchQuery, `lbl-${annotation.id}-${idx}`)}</span>
                      {canManage ? (
                        <button
                          type="button"
                          className="fc-ann-label-remove-btn"
                          onClick={() => handleToggleLabel(lbl)}
                          title={`Remove ${lbl.name}`}
                          aria-label={`Remove ${lbl.name}`}
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  ))}

                {canManage ? (
                  <div className="fc-ann-label-picker-wrap">
                    <button
                      type="button"
                      className="fc-ann-add-label-btn"
                      onClick={() => setIsLabelMenuOpen(!isLabelMenuOpen)}
                      title="Add label to annotation"
                    >
                      + Label
                    </button>
                    {isLabelMenuOpen ? (
                      <div className="fc-ann-label-menu" onClick={(e) => e.stopPropagation()}>
                        <div className="fc-ann-label-menu-title">Assign Labels</div>
                        <div className="fc-ann-label-presets">
                          {PRESET_LABELS.map((p) => {
                            const isAssigned = (annotation.labels || []).some(
                              (l) => (l.name || l.text || l).toLowerCase() === p.name.toLowerCase()
                            );
                            return (
                              <button
                                key={p.name}
                                type="button"
                                className={`fc-ann-label-preset-chip${isAssigned ? ' fc-label-preset-active' : ''}`}
                                style={{
                                  borderColor: p.color,
                                  color: isAssigned ? '#ffffff' : p.color,
                                  backgroundColor: isAssigned ? p.color : 'transparent',
                                }}
                                onClick={() => handleToggleLabel(p)}
                              >
                                {isAssigned ? '✓ ' : ''}{p.name}
                              </button>
                            );
                          })}
                        </div>
                        <form onSubmit={handleAddCustomLabel} className="fc-ann-custom-label-form">
                          <input
                            type="text"
                            className="fc-input fc-ann-custom-label-input"
                            placeholder="Custom label…"
                            value={customLabelInput}
                            onChange={(e) => setCustomLabelInput(e.target.value)}
                          />
                          <input
                            type="color"
                            className="fc-ann-custom-label-color"
                            value={customLabelColor}
                            onChange={(e) => setCustomLabelColor(e.target.value)}
                            title="Label color"
                          />
                          <button
                            type="submit"
                            className="fc-btn fc-btn-primary fc-btn-xs"
                            disabled={!customLabelInput.trim()}
                          >
                            Add
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Phase 19: Custom Properties */}
            {annotation.customProperties && annotation.customProperties.length > 0 ? (
              <div className="fc-ann-props-row" onClick={(e) => e.stopPropagation()}>
                <span className="fc-ann-props-label">Properties:</span>
                <div className="fc-ann-props-chips">
                  {annotation.customProperties.map((p, idx) => (
                    <span key={p.id || idx} className="fc-ann-prop-chip">
                      <span className="fc-ann-prop-chip-name">{highlightSearchText(p.name, searchQuery, `prop-n-${annotation.id}-${idx}`)}:</span>
                      <span className="fc-ann-prop-chip-val">
                        {p.type === 'boolean'
                          ? (p.value ? 'Yes' : 'No')
                          : highlightSearchText(String(p.value ?? '—'), searchQuery, `prop-v-${annotation.id}-${idx}`)}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {isResolved && annotation.resolvedAt ? (
          <p className="fc-ann-resolved-note">
            Resolved {formatTimestamp(annotation.resolvedAt)}
          </p>
        ) : null}

        {/* Phase 20C & 20D: Annotation Discussion & History */}
        <div className="fc-ann-subpanels-wrap" onClick={(e) => e.stopPropagation()}>
          <div className="fc-ann-subpanels-bar">
            <button
              type="button"
              className={`fc-ann-subpanel-toggle-btn${isDiscussionOpen ? ' fc-ann-subpanel-toggle-active' : ''}`}
              onClick={() => {
                setIsDiscussionOpen(!isDiscussionOpen);
                if (!isDiscussionOpen) setIsHistoryOpen(false);
              }}
              title={isDiscussionOpen ? 'Collapse discussion' : 'Open discussion'}
              aria-expanded={isDiscussionOpen}
            >
              <span className="fc-ann-subpanel-icon" aria-hidden="true">💬</span>
              <span>Discussion</span>
              {discussions && discussions.length > 0 ? (
                <span className="fc-ann-subpanel-badge">{discussions.length}</span>
              ) : null}
              <span className="fc-ann-subpanel-arrow" aria-hidden="true">{isDiscussionOpen ? '▴' : '▾'}</span>
            </button>

            <button
              type="button"
              className={`fc-ann-subpanel-toggle-btn${isHistoryOpen ? ' fc-ann-subpanel-toggle-active' : ''}`}
              onClick={() => {
                setIsHistoryOpen(!isHistoryOpen);
                if (!isHistoryOpen) setIsDiscussionOpen(false);
              }}
              title={isHistoryOpen ? 'Collapse history' : 'View history'}
              aria-expanded={isHistoryOpen}
            >
              <span className="fc-ann-subpanel-icon" aria-hidden="true">🕒</span>
              <span>History</span>
              {annotationHistory && annotationHistory.length > 0 ? (
                <span className="fc-ann-subpanel-badge">{annotationHistory.length}</span>
              ) : null}
              <span className="fc-ann-subpanel-arrow" aria-hidden="true">{isHistoryOpen ? '▴' : '▾'}</span>
            </button>
          </div>

          {isDiscussionOpen ? (
            <div className="fc-ann-discussion-panel">
              {discussions && discussions.length > 0 ? (
                <div className="fc-ann-discussion-list">
                  {discussions.map((msg) => {
                    const isAuthor = currentUserId && msg.userId === currentUserId;
                    const canDeleteThis = !readOnly && (isAdmin || isAuthor);
                    const initials = getInitials(msg.authorName);
                    const avatarColor = getReviewerColor(msg.userId || msg.authorName);

                    return (
                      <div key={msg.id} className="fc-ann-discussion-item">
                        <div className="fc-ann-discussion-item-header">
                          <span
                            className="fc-ann-discussion-avatar"
                            style={{ backgroundColor: avatarColor }}
                            aria-hidden="true"
                          >
                            {initials}
                          </span>
                          <span className="fc-ann-discussion-author-name">
                            {highlightSearchText(msg.authorName, searchQuery, `msg-auth-${msg.id}`)}
                            {isAuthor ? ' (You)' : ''}
                          </span>
                          <span className="fc-ann-discussion-time">
                            {formatTimestamp(msg.createdAt)}
                          </span>
                          {canDeleteThis ? (
                            <button
                              type="button"
                              className="fc-ann-discussion-delete-btn"
                              onClick={() => onDeleteDiscussionMessage?.(annotation.id, msg.id)}
                              title="Delete reply"
                              aria-label="Delete reply"
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                        <div className="fc-ann-discussion-text">
                          {formatCommentWithMentions(msg.message, searchQuery)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="fc-ann-discussion-empty-text">No replies yet.</p>
              )}

              {!readOnly ? (
                <form onSubmit={handleSendReply} className="fc-ann-discussion-composer">
                  <MentionInput
                    value={replyText}
                    onChange={(val) => {
                      setReplyText(val);
                      if (replyError) setReplyError('');
                    }}
                    placeholder="Reply to this annotation… (type @ to mention)"
                    rows={2}
                    maxLength={2000}
                    mentionableUsers={mentionableUsers}
                    disabled={isSubmittingReply}
                    className="fc-ann-discussion-input"
                  />
                  {replyError ? <p className="fc-ann-discussion-error">{replyError}</p> : null}
                  <div className="fc-ann-discussion-actions">
                    <button
                      type="submit"
                      className="fc-btn fc-btn-primary fc-btn-xs fc-ann-reply-btn"
                      disabled={!replyText.trim() || isSubmittingReply}
                    >
                      {isSubmittingReply ? 'Sending…' : 'Reply'}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="fc-ann-discussion-readonly-notice">
                  Only reviewers can participate in discussions.
                </p>
              )}
            </div>
          ) : null}

          {/* Phase 20D: Annotation History Timeline Panel */}
          {isHistoryOpen ? (
            <div className="fc-ann-history-panel">
              <div className="fc-ann-history-list">
                {annotationHistory.length > 0 ? (
                  annotationHistory.map((hist) => {
                    const actionText = getActivityActionText(hist);
                    const timeText = formatActivityRelativeTime(hist.occurredAt);
                    const actorName = hist.actorName || 'Reviewer';
                    const avatarBg = getReviewerColor(actorName || hist.actorId || 'reviewer');
                    const initials = getInitials(actorName);

                    return (
                      <div key={hist.id} className="fc-ann-history-item">
                        <span
                          className="fc-ann-history-avatar"
                          style={{ backgroundColor: avatarBg }}
                          title={actorName}
                        >
                          {initials}
                        </span>
                        <div className="fc-ann-history-item-body">
                          <div className="fc-ann-history-item-header">
                            <span className="fc-ann-history-actor">{actorName}</span>
                            <time className="fc-ann-history-time" dateTime={hist.occurredAt}>
                              {timeText}
                            </time>
                          </div>
                          <div className="fc-ann-history-action">{actionText}</div>
                          {hist.details && (hist.eventType === 'comment_added' || hist.metadata?.isDiscussion) ? (
                            <div className="fc-ann-history-snippet">"{hist.details}"</div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="fc-ann-history-empty-text">No recorded history for this annotation yet.</p>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {effectiveEditing ? (
        <form className="fc-ann-edit-form" onSubmit={submitEdit}>
          <MentionInput
            className="fc-sidebar-textarea"
            rows={3}
            maxLength={MAX_ANNOTATION_COMMENT_LENGTH}
            value={editText}
            disabled={isBusy}
            mentionableUsers={mentionableUsers}
            onChange={(nextVal) => {
              setEditText(nextVal);
              if (editError) setEditError('');
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                submitEdit();
              } else if (event.key === 'Escape' && !isBusy) {
                event.preventDefault();
                cancelEditing();
              }
            }}
          />
          {editError ? (
            <p className="fc-sidebar-field-error" role="alert">
              {editError}
            </p>
          ) : null}
          <div className="fc-ann-edit-actions">
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-sm"
              onClick={cancelEditing}
              disabled={isBusy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="fc-btn fc-btn-primary fc-btn-sm"
              disabled={isBusy || !editText.trim()}
            >
              {isBusy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      ) : null}

            </div>

      {!readOnly && (canManage || canAttachReference) && !effectiveEditing ? (
        <div className="fc-ann-details-footer">
          {canAttachReference ? (
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-sm"
              onClick={() => onAttachReference?.(annotation)}
              title="Attach reference image to this annotation"
            >
              + Ref
            </button>
          ) : null}
          {canManage ? (
            <>
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-sm"
                onClick={startEditing}
                disabled={isBusy}
              >
                Edit
              </button>
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-sm"
                onClick={() => onOpenPropertiesModal?.(annotation)}
                title="View/edit structured properties"
              >
                Props{annotation.customProperties?.length ? ` (${annotation.customProperties.length})` : ''}
              </button>
            </>
          ) : null}

          <button
            type="button"
            className="fc-btn fc-btn-secondary fc-btn-sm"
            onClick={() => onToggleStatus(annotation)}
            disabled={isBusy || isLocked}
            title={isLocked ? 'Layer is locked' : undefined}
          >
            {isResolved ? 'Reopen' : 'Resolve'}
          </button>
          {canManage ? (
            <button
              type="button"
              className="fc-btn fc-btn-danger-outline fc-btn-sm"
              onClick={() => onDelete(annotation)}
              disabled={isBusy}
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});/**
 * Phase 20D: Review Checklists Panel
 * Displays structured quality assurance criteria, completion progress, and custom checklist items.
 */
function ReviewChecklistPanel({
  checklists = [],
  onToggleChecklistItem,
  onAddCustomChecklistItem,
  onDeleteChecklistItem,
  readOnly = false,
  canReview = true,
  currentUserId = null,
}) {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customCat, setCustomCat] = useState('Custom');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const progress = useMemo(() => calculateChecklistProgress(checklists), [checklists]);

  const filteredChecklists = useMemo(() => {
    if (selectedCategory === 'All') return checklists;
    return checklists.filter(
      (c) => (c.category || 'Custom').toLowerCase() === selectedCategory.toLowerCase()
    );
  }, [checklists, selectedCategory]);

  const handleAddSubmit = async (e) => {
    e?.preventDefault();
    if (!customTitle.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onAddCustomChecklistItem?.({
        title: customTitle.trim(),
        description: customDesc.trim(),
        category: customCat,
      });
      setCustomTitle('');
      setCustomDesc('');
      setIsAddingCustom(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fc-checklist-panel" aria-label="Review checklist verification">
      {/* Progress Header Card */}
      <div className="fc-checklist-progress-card">
        <div className="fc-checklist-progress-top">
          <div className="fc-checklist-progress-stats">
            <span className="fc-checklist-progress-pct">{progress.percentage}%</span>
            <span className="fc-checklist-progress-label">
              {progress.completed} of {progress.total} criteria verified
            </span>
          </div>
          <span
            className={`fc-checklist-status-badge${progress.isAllCompleted ? ' fc-checklist-status-complete' : ''}`}
          >
            {progress.isAllCompleted ? '✓ All Verified' : 'In Progress'}
          </span>
        </div>
        <div
          className="fc-checklist-progress-track"
          role="progressbar"
          aria-valuenow={progress.percentage}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            className="fc-checklist-progress-bar"
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
      </div>

      {/* Manual completion workflow reminder */}
      <div className="fc-checklist-notice-banner" role="note">
        <span className="fc-checklist-notice-icon" aria-hidden="true">ℹ️</span>
        <span className="fc-checklist-notice-text">
          Checklists ensure quality compliance across images. Completing items does not automatically finalize the review.
        </span>
      </div>

      {/* Category Filter Pills */}
      <div className="fc-checklist-categories-bar" role="tablist" aria-label="Checklist categories">
        {CHECKLIST_CATEGORIES.map((cat) => {
          const isSelected = selectedCategory === cat;
          const count =
            cat === 'All'
              ? checklists.length
              : checklists.filter(
                  (c) => (c.category || 'Custom').toLowerCase() === cat.toLowerCase()
                ).length;

          return (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className={`fc-checklist-cat-pill${isSelected ? ' fc-checklist-cat-pill-active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              <span>{cat}</span>
              <span className="fc-checklist-cat-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Checklist Items Scroll Area */}
      <div className="fc-checklist-scroll">
        <div className="fc-checklist-list">
          {filteredChecklists.length === 0 ? (
            <div className="fc-checklist-empty">
              <span className="fc-checklist-empty-icon" aria-hidden="true">📋</span>
              <p className="fc-checklist-empty-title">No criteria in this category</p>
            </div>
          ) : (
            filteredChecklists.map((item) => (
              <div
                key={item.id}
                className={`fc-checklist-item${item.isCompleted ? ' fc-checklist-item-completed' : ''}`}
              >
                <label className="fc-checklist-item-checkbox-label">
                  <input
                    type="checkbox"
                    className="fc-checklist-checkbox"
                    checked={item.isCompleted}
                    onChange={(e) => {
                      if (!readOnly && canReview) {
                        onToggleChecklistItem?.(item.id, e.target.checked);
                      }
                    }}
                    disabled={readOnly || !canReview}
                    aria-label={`Mark "${item.title}" as ${item.isCompleted ? 'uncompleted' : 'completed'}`}
                  />
                  <span className="fc-checklist-custom-checkbox" aria-hidden="true" />
                </label>

                <div className="fc-checklist-item-content">
                  <div className="fc-checklist-item-header">
                    <span className="fc-checklist-item-title">{item.title}</span>
                    <span className={`fc-checklist-item-category fc-cat-${(item.category || 'general').toLowerCase()}`}>
                      {item.category || 'General'}
                    </span>
                    {!item.isDefault && !readOnly && canReview && (
                      <button
                        type="button"
                        className="fc-checklist-item-delete-btn"
                        onClick={() => onDeleteChecklistItem?.(item.id)}
                        title="Delete custom criterion"
                        aria-label="Delete custom criterion"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {item.description ? (
                    <p className="fc-checklist-item-desc">{item.description}</p>
                  ) : null}
                  {item.isCompleted && (
                    <div className="fc-checklist-item-meta">
                      ✓ Completed{item.completedByName ? ` by ${item.completedByName}` : ''}
                      {item.completedAt ? ` · ${formatActivityRelativeTime(item.completedAt)}` : ''}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add Custom Criterion Form */}
        {!readOnly && canReview ? (
          <div className="fc-checklist-add-wrap">
            {isAddingCustom ? (
              <form onSubmit={handleAddSubmit} className="fc-checklist-add-form">
                <input
                  type="text"
                  className="fc-input fc-checklist-input"
                  placeholder="Criterion title (e.g., Contrast ratio check)…"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  maxLength={100}
                  autoFocus
                />
                <input
                  type="text"
                  className="fc-input fc-checklist-desc-input"
                  placeholder="Optional details or instructions…"
                  value={customDesc}
                  onChange={(e) => setCustomDesc(e.target.value)}
                  maxLength={250}
                />
                <div className="fc-checklist-add-actions">
                  <select
                    className="fc-checklist-cat-select"
                    value={customCat}
                    onChange={(e) => setCustomCat(e.target.value)}
                    aria-label="Category"
                  >
                    {CHECKLIST_CATEGORIES.filter((c) => c !== 'All').map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="fc-btn fc-btn-secondary fc-btn-xs"
                    onClick={() => {
                      setIsAddingCustom(false);
                      setCustomTitle('');
                      setCustomDesc('');
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="fc-btn fc-btn-primary fc-btn-xs"
                    disabled={!customTitle.trim() || isSubmitting}
                  >
                    {isSubmitting ? 'Adding…' : 'Add Criterion'}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className="fc-checklist-open-add-btn"
                onClick={() => setIsAddingCustom(true)}
              >
                + Add Custom Criterion
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Fixed-width desktop review sidebar displaying batch annotations,
 * All/Open/Resolved filters, draft comment composer, and creator actions.
 */
export function ReviewSidebar({
  activeTab,
  onTabChange,
  selectedImage,
  images = [],
  annotations = [],
  currentUserId = null,
  selectedAnnotationId = null,
  onSelectAnnotationCard,
  draftAnnotation = null,
  isSubmittingDraft = false,
  onConfirmDraft,
  onCancelDraft,
  busyAnnotationIds = [],
  onSaveComment,
  onToggleStatus,
  onDeleteAnnotation,
  annotationsLoading = false,
  readOnly = false,
  actionError = '',
  onClearActionError,
  isCollapsed = false,
  onToggleCollapse,
  liveSelections = [],
  reactions = {},
  onToggleReaction = null,
  mentionableUsers = [],
  sidebarMode = 'comments',
  onSidebarModeChange = null,
  activities = [],
  activitiesLoading = false,
  activitiesError = '',
  onRetryActivities = null,
  onNavigateAnnotation = null,
  onNavigateImage = null,
  onNavigateWhiteboard = null,
  batchId = null,
  // Phase 18B additions
  references = [],
  referencesLoading = false,
  referencesError = '',
  onRetryReferences = null,
  onUploadReference = null,
  onUpdateReferenceComment = null,
  onReplaceReference = null,
  onDeleteReference = null,
  onSelectReferenceForView = null,
  userRole = 'reviewer',
  onAttachReferenceToAnnotation = null,
  onOpenComparison = null,
  layers = [],
  hiddenLayerIds = new Set(),
  onToggleLayerVisibility = null,
  onOpenLayerManager = null,
  onToggleLayerManager = null,
  isLayerManagerOpen = false,
  onOpenPropertiesModal = null,
  onUpdateAnnotationLabels = null,
  selectedAnnotationIds = [],
  lockedLayerIds = new Set(),
  onBulkMoveLayer = null,
  onBulkDelete = null,
  onClearSelection = null,
  onSelectAllImageAnnotations = null,
  onToggleLayerLock = null,
  onUpdateAnnotationAssignment = null,
  onUpdateAnnotationPriority = null,
  discussions = {},
  onCreateDiscussionMessage = null,
  onDeleteDiscussionMessage = null,
  checklists = [],
  onToggleChecklistItem = null,
  onAddCustomChecklistItem = null,
  onDeleteChecklistItem = null,
  width = 360,
  onReposition = null,
  dockSide = 'right',
  onHide = null,
  canHide = true,
}) {
  const scrollContainerRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activePopupAnnotationId, setActivePopupAnnotationId] = useState(null);
  const [popupCoords, setPopupCoords] = useState(null);
  const popupRef = useRef(null);
  const [selectedLayerFilter, setSelectedLayerFilter] = useState('all');
  const [selectedLabelFilter, setSelectedLabelFilter] = useState('all');
  const [selectedPriorityFilter, setSelectedPriorityFilter] = useState('all');
  const [selectedAssigneeFilter, setSelectedAssigneeFilter] = useState('all');

  const layerMap = useMemo(() => {
    const map = new Map();
    map.set('default', 'Default');
    for (const l of layers) {
      map.set(l.id, l.name);
    }
    return map;
  }, [layers]);

  const reviewerMap = useMemo(() => {
    const map = new Map();
    for (const u of mentionableUsers) {
      if (u.id) map.set(u.id, u.displayName || u.username || u.name);
    }
    return map;
  }, [mentionableUsers]);

  const eligibleReviewers = useMemo(() => {
    return (mentionableUsers || []).filter(
      (u) => u.role === 'reviewer' || u.role === 'admin' || u.role === 'owner'
    );
  }, [mentionableUsers]);

  const allBatchLabels = useMemo(() => {
    const set = new Set();
    for (const ann of annotations) {
      if (Array.isArray(ann.labels)) {
        for (const l of ann.labels) {
          const name = String(l.name || l.text || l || '').trim();
          if (name) set.add(name);
        }
      }
    }
    return Array.from(set).sort();
  }, [annotations]);

  const referencesByAnnotation = useMemo(() => {
    const map = new Map();
    for (const ref of references) {
      if (ref.annotationId) {
        if (!map.has(ref.annotationId)) {
          map.set(ref.annotationId, []);
        }
        map.get(ref.annotationId).push(ref);
      }
    }
    return map;
  }, [references]);

  const imageMetaById = useMemo(() => {
    const map = new Map();
    images.forEach((img, index) => {
      map.set(img.id, {
        position: index + 1,
        filename: img.original_filename,
      });
    });
    return map;
  }, [images]);

  const counts = useMemo(() => {
    let open = 0;
    let resolved = 0;
    for (const ann of annotations) {
      if (ann.status === 'resolved') {
        resolved += 1;
      } else {
        open += 1;
      }
    }
    return {
      all: annotations.length,
      open,
      resolved,
    };
  }, [annotations]);

  const priorityCounts = useMemo(() => {
    const pCounts = { all: annotations.length, critical: 0, high: 0, medium: 0, low: 0 };
    for (const ann of annotations) {
      const p = ann.priority || 'medium';
      if (pCounts[p] !== undefined) pCounts[p]++;
    }
    return pCounts;
  }, [annotations]);

  const assigneeFilterCounts = useMemo(() => {
    let unassigned = 0;
    let assignedToMe = 0;
    for (const ann of annotations) {
      if (!ann.assignedTo) {
        unassigned++;
      } else if (currentUserId && ann.assignedTo === currentUserId) {
        assignedToMe++;
      }
    }
    return { unassigned, assignedToMe };
  }, [annotations, currentUserId]);

  const visibleAnnotations = useMemo(() => {
    return annotations.filter((ann) => {
      if (activeTab === 'open' && ann.status === 'resolved') return false;
      if (activeTab === 'resolved' && ann.status !== 'resolved') return false;

      // Layer filter
      if (selectedLayerFilter !== 'all') {
        const lid = ann.layerId || 'default';
        if (lid !== selectedLayerFilter) return false;
      }

      // Label filter
      if (selectedLabelFilter !== 'all') {
        const annLabels = Array.isArray(ann.labels) ? ann.labels : [];
        const hasLabel = annLabels.some(
          (l) => (l.name || l.text || l).toLowerCase() === selectedLabelFilter.toLowerCase()
        );
        if (!hasLabel) return false;
      }

      // Phase 20A: Priority filter
      if (selectedPriorityFilter !== 'all') {
        const p = ann.priority || 'medium';
        if (p !== selectedPriorityFilter) return false;
      }

      // Phase 20A: Assignee filter
      if (selectedAssigneeFilter !== 'all') {
        if (selectedAssigneeFilter === 'unassigned') {
          if (ann.assignedTo) return false;
        } else if (selectedAssigneeFilter === 'assigned_to_me') {
          if (!currentUserId || ann.assignedTo !== currentUserId) return false;
        } else {
          if (ann.assignedTo !== selectedAssigneeFilter) return false;
        }
      }

      // Phase 20B & 20C: Search Query filter
      if (searchQuery.trim()) {
        if (!matchesSearch(ann, searchQuery, layerMap, reviewerMap, discussions)) {
          return false;
        }
      }

      return true;
    });
  }, [
    activeTab,
    annotations,
    selectedLayerFilter,
    selectedLabelFilter,
    selectedPriorityFilter,
    selectedAssigneeFilter,
    searchQuery,
    layerMap,
    reviewerMap,
    discussions,
    currentUserId,
  ]);

  const activeFilters = useMemo(() => {
    const list = [];
    if (activeTab !== 'all') {
      list.push({
        id: 'status',
        label: `Status: ${activeTab === 'open' ? 'Open' : 'Resolved'}`,
        onClear: () => onTabChange('all'),
      });
    }
    if (selectedLayerFilter !== 'all') {
      const layerName = layerMap.get(selectedLayerFilter) || selectedLayerFilter;
      list.push({
        id: 'layer',
        label: `Layer: ${layerName}`,
        onClear: () => setSelectedLayerFilter('all'),
      });
    }
    if (selectedLabelFilter !== 'all') {
      list.push({
        id: 'label',
        label: `Label: ${selectedLabelFilter}`,
        onClear: () => setSelectedLabelFilter('all'),
      });
    }
    if (selectedPriorityFilter !== 'all') {
      const pLabel = PRIORITY_CONFIG[selectedPriorityFilter]?.label || selectedPriorityFilter;
      list.push({
        id: 'priority',
        label: `Priority: ${pLabel}`,
        onClear: () => setSelectedPriorityFilter('all'),
      });
    }
    if (selectedAssigneeFilter !== 'all') {
      let aLabel = 'Assignee';
      if (selectedAssigneeFilter === 'unassigned') {
        aLabel = 'Assignee: Unassigned';
      } else if (selectedAssigneeFilter === 'assigned_to_me') {
        aLabel = 'Assignee: Assigned to me';
      } else {
        const revName = reviewerMap.get(selectedAssigneeFilter) || 'Reviewer';
        aLabel = `Assignee: ${revName}`;
      }
      list.push({
        id: 'assignee',
        label: aLabel,
        onClear: () => setSelectedAssigneeFilter('all'),
      });
    }
    if (searchQuery.trim()) {
      list.push({
        id: 'search',
        label: `Search: "${searchQuery.trim()}"`,
        onClear: () => setSearchQuery(''),
      });
    }
    return list;
  }, [
    activeTab,
    selectedLayerFilter,
    selectedLabelFilter,
    selectedPriorityFilter,
    selectedAssigneeFilter,
    searchQuery,
    layerMap,
    reviewerMap,
    onTabChange,
  ]);

  const handleResetAllFilters = useCallback(() => {
    onTabChange('all');
    setSelectedLayerFilter('all');
    setSelectedLabelFilter('all');
    setSelectedPriorityFilter('all');
    setSelectedAssigneeFilter('all');
    setSearchQuery('');
  }, [onTabChange]);

  useEffect(() => {
    if (!draftAnnotation || !scrollContainerRef.current) return;
    scrollContainerRef.current.scrollTop = 0;
  }, [draftAnnotation]);

  useEffect(() => {
    if (!selectedAnnotationId || !scrollContainerRef.current) return;
    const cardEl = scrollContainerRef.current.querySelector(
      `[data-annotation-id="${selectedAnnotationId}"]`
    );
    cardEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedAnnotationId, activeTab]);

  const hasActiveFilters = activeFilters.length > 0;
  const emptyState =
    annotations.length > 0 && hasActiveFilters
      ? {
        title: 'No matching annotations',
        body: 'No annotations match your active search and filter criteria. Try clearing some filters or searching for different terms.',
      }
      : readOnly && activeTab === 'all'
        ? {
          title: 'No annotations yet',
          body: 'Annotations created by reviewers will appear here.',
        }
        : EMPTY_MESSAGES[activeTab] ?? EMPTY_MESSAGES.all;
  const busySet = useMemo(() => new Set(busyAnnotationIds), [busyAnnotationIds]);
  const draftImageMeta =
    !readOnly && draftAnnotation
      ? imageMetaById.get(draftAnnotation.imageId)
      : null;

  const isActivity = sidebarMode === 'activity';
  const isReferences = sidebarMode === 'references';
  const isChecklist = sidebarMode === 'checklist';
  const label = isActivity ? 'Activity' : isReferences ? 'References' : isChecklist ? 'Checklist' : 'Comments';

  const prevSelectedAnnotationIdRef = useRef(selectedAnnotationId);
  useEffect(() => {
    if (selectedAnnotationId && selectedAnnotationId !== prevSelectedAnnotationIdRef.current) {
      setActivePopupAnnotationId(selectedAnnotationId);
    }
    prevSelectedAnnotationIdRef.current = selectedAnnotationId;
  }, [selectedAnnotationId]);

  useEffect(() => {
    if (isCollapsed || sidebarMode !== 'comments') {
      setActivePopupAnnotationId(null);
    }
  }, [isCollapsed, sidebarMode]);

  const updatePopupCoords = useCallback(() => {
    if (!activePopupAnnotationId) {
      setPopupCoords(null);
      return;
    }
    const cardEl = scrollContainerRef.current?.querySelector(
      `[data-annotation-id="${activePopupAnnotationId}"]`
    );
    if (!cardEl) {
      setPopupCoords(null);
      return;
    }
    const coords = calculateCardPopupCoords(cardEl, dockSide);
    setPopupCoords(coords);
  }, [activePopupAnnotationId, dockSide]);

  useEffect(() => {
    if (!activePopupAnnotationId) {
      setPopupCoords(null);
      return;
    }

    updatePopupCoords();
    const frameId = requestAnimationFrame(updatePopupCoords);

    const container = scrollContainerRef.current;
    container?.addEventListener('scroll', updatePopupCoords, { passive: true });
    window.addEventListener('resize', updatePopupCoords, { passive: true });

    return () => {
      cancelAnimationFrame(frameId);
      container?.removeEventListener('scroll', updatePopupCoords);
      window.removeEventListener('resize', updatePopupCoords);
    };
  }, [activePopupAnnotationId, updatePopupCoords]);

  useEffect(() => {
    if (!activePopupAnnotationId) return;

    const handlePointerDown = (e) => {
      if (popupRef.current && popupRef.current.contains(e.target)) {
        return;
      }
      if (
        e.target.closest?.(
          '.fc-modal, .fc-modal-backdrop, .fc-ref-viewer-overlay, .fc-comparison-modal, .fc-ann-popover-menu'
        )
      ) {
        return;
      }
      if (e.target.closest?.('.fc-ann-card-compact')) {
        return;
      }
      setActivePopupAnnotationId(null);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setActivePopupAnnotationId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activePopupAnnotationId]);

  const activeAnnotation = useMemo(() => {
    if (!activePopupAnnotationId) return null;
    return annotations.find((a) => a.id === activePopupAnnotationId) || null;
  }, [annotations, activePopupAnnotationId]);

  const activeImageMeta = activeAnnotation ? (imageMetaById.get(activeAnnotation.imageId) ?? null) : null;
  const isActiveCurrentImage = Boolean(selectedImage && activeAnnotation && activeAnnotation.imageId === selectedImage.id);
  const isActiveCreator = Boolean(!readOnly && currentUserId && activeAnnotation && activeAnnotation.createdBy === currentUserId);
  const activeAttachedRefs = activeAnnotation ? (referencesByAnnotation.get(activeAnnotation.id) || []) : [];
  const canActiveAttachRef = Boolean(!readOnly && (userRole === 'admin' || (currentUserId && activeAnnotation && activeAnnotation.createdBy === currentUserId)));
  const isActiveLocked = activeAnnotation ? lockedLayerIds.has(activeAnnotation.layerId || 'default') : false;
  const activeLiveSelectors = activeAnnotation ? (liveSelections?.filter((s) => s.annotationId === activeAnnotation.id) || []) : [];
  const activeReactions = activeAnnotation ? (reactions[activeAnnotation.id] || []) : [];
  const activeDiscussions = activeAnnotation ? (discussions[activeAnnotation.id] || []) : [];

  if (isCollapsed) {
    return (
      <aside
        className={`fc-review-sidebar fc-review-sidebar-collapsed${
          dockSide === 'left' ? ' fc-review-sidebar-left' : ''
        }`}
        aria-label={`${label} (collapsed)`}
      >
        <button
          type="button"
          className="fc-panel-expand-btn"
          onClick={onToggleCollapse}
          title={`Expand ${label.toLowerCase()} panel`}
          aria-label={`Expand ${label.toLowerCase()} panel`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {dockSide === 'left' ? (
              <polyline points="9 18 15 12 9 6" />
            ) : (
              <polyline points="15 18 9 12 15 6" />
            )}
          </svg>
        </button>

        <div
          className="fc-collapsed-rail-body"
          onClick={onToggleCollapse}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggleCollapse?.();
            }
          }}
          title={`Click to expand ${label.toLowerCase()} panel`}
        >
          <span className="fc-collapsed-icon" aria-hidden="true">
            {isActivity ? (
              <svg
                width="16"
                height="16"
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
            ) : isReferences ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            ) : isChecklist ? (
              <span style={{ fontSize: '15px' }}>☑️</span>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            )}
          </span>
          {isActivity ? (
            activities.length > 0 ? (
              <span className="fc-collapsed-badge-neutral">{activities.length}</span>
            ) : null
          ) : isReferences ? (
            references.length > 0 ? (
              <span className="fc-collapsed-badge-neutral">{references.length}</span>
            ) : null
          ) : isChecklist ? (
            checklists.length > 0 ? (
              <span className="fc-collapsed-badge-neutral">
                {checklists.filter((c) => c.isCompleted).length}/{checklists.length}
              </span>
            ) : null
          ) : counts.open > 0 ? (
            <span
              className="fc-collapsed-badge"
              title={`${counts.open} open feedback items`}
            >
              {counts.open}
            </span>
          ) : (
            <span className="fc-collapsed-badge-neutral">{counts.all}</span>
          )}
          <span className="fc-collapsed-vertical-text">
            {label}
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`fc-review-sidebar${
        dockSide === 'left' ? ' fc-review-sidebar-left' : ''
      }`}
      style={width ? { width: `${width}px` } : undefined}
      aria-label="Image review sidebar"
    >
      <div className="fc-sidebar-header">
        <div className="fc-sidebar-title-row">
          <div className="fc-sidebar-nav-tabs" role="tablist" aria-label="Review sidebar mode">
            <button
              type="button"
              role="tab"
              id="fc-sidebar-mode-comments"
              aria-selected={sidebarMode === 'comments'}
              className={`fc-sidebar-nav-tab${sidebarMode === 'comments' ? ' fc-sidebar-nav-tab-active' : ''}`}
              onClick={() => onSidebarModeChange?.('comments')}
            >
              <span>Comments</span>
              <span className="fc-sidebar-nav-badge">{counts.all}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="fc-sidebar-mode-activity"
              aria-selected={sidebarMode === 'activity'}
              className={`fc-sidebar-nav-tab${sidebarMode === 'activity' ? ' fc-sidebar-nav-tab-active' : ''}`}
              onClick={() => onSidebarModeChange?.('activity')}
            >
              <span>Activity</span>
              {activities?.length > 0 ? (
                <span className="fc-sidebar-nav-badge">{activities.length}</span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              id="fc-sidebar-mode-references"
              aria-selected={sidebarMode === 'references'}
              className={`fc-sidebar-nav-tab${sidebarMode === 'references' ? ' fc-sidebar-nav-tab-active' : ''}`}
              onClick={() => onSidebarModeChange?.('references')}
              title="References"
              aria-label="References"
            >
              <span>Refs</span>
              {references?.length > 0 ? (
                <span className="fc-sidebar-nav-badge">{references.length}</span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              id="fc-sidebar-mode-checklist"
              aria-selected={sidebarMode === 'checklist'}
              className={`fc-sidebar-nav-tab${sidebarMode === 'checklist' ? ' fc-sidebar-nav-tab-active' : ''}`}
              onClick={() => onSidebarModeChange?.('checklist')}
            >
              <span>Checklist</span>
              {checklists?.length > 0 ? (
                <span className="fc-sidebar-nav-badge">
                  {checklists.filter((c) => c.isCompleted).length}/{checklists.length}
                </span>
              ) : null}
            </button>
          </div>

          <div className="fc-panel-header-actions">
            {onReposition ? (
              <button
                type="button"
                className="fc-panel-reposition-btn"
                onClick={onReposition}
                title={dockSide === 'right' ? 'Move sidebar to left side' : 'Move sidebar to right side'}
                aria-label={dockSide === 'right' ? 'Move sidebar to left side' : 'Move sidebar to right side'}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </button>
            ) : null}

            <button
              type="button"
              className="fc-panel-toggle-btn"
              onClick={onToggleCollapse}
              title={`Collapse ${label.toLowerCase()} panel`}
              aria-label={`Collapse ${label.toLowerCase()} panel`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {dockSide === 'left' ? (
                  <polyline points="15 18 9 12 15 6" />
                ) : (
                  <polyline points="9 18 15 12 9 6" />
                )}
              </svg>
            </button>

            {onHide ? (
              <button
                type="button"
                className="fc-panel-hide-btn"
                onClick={onHide}
                disabled={!canHide}
                title={
                  canHide
                    ? 'Hide review sidebar (restore via Layout menu or Alt+2)'
                    : 'At least one panel must stay visible'
                }
                aria-label="Hide review sidebar"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>

        {sidebarMode === 'comments' && selectedImage ? (
          <p className="fc-sidebar-subtitle" title={selectedImage.original_filename}>
            Viewing: {selectedImage.original_filename}
          </p>
        ) : null}

        {/* Phase 20B: Search Bar */}
        {sidebarMode === 'comments' ? (
          <div className="fc-sidebar-search-wrap">
            <span className="fc-sidebar-search-icon" aria-hidden="true">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              type="text"
              className="fc-sidebar-search-input"
              placeholder="Search comments, #number, labels, users…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search annotations"
            />
            {searchQuery ? (
              <button
                type="button"
                className="fc-sidebar-search-clear-btn"
                onClick={() => setSearchQuery('')}
                title="Clear search"
                aria-label="Clear search"
              >
                ×
              </button>
            ) : null}
            {searchQuery.trim() ? (
              <span
                className="fc-sidebar-search-count-pill"
                title={`${visibleAnnotations.length} matching annotations`}
              >
                {visibleAnnotations.length} {visibleAnnotations.length === 1 ? 'result' : 'results'}
              </span>
            ) : null}
          </div>
        ) : null}

        {sidebarMode === 'comments' ? (
          <div className="fc-sidebar-tabs" role="tablist" aria-label="Comment filter">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`fc-tab-${tab.id}`}
                  aria-selected={isActive}
                  aria-controls={`fc-tabpanel-${tab.id}`}
                  className={`fc-sidebar-tab${isActive ? ' fc-sidebar-tab-active' : ''}`}
                  onClick={() => onTabChange(tab.id)}
                >
                  <span>{tab.label}</span>
                  <span className="fc-tab-count">{counts[tab.id] ?? 0}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Layer Filter Bar */}
        {sidebarMode === 'comments' && layers.length > 0 ? (
          <div className="fc-sidebar-filter-bar fc-sidebar-layers-filter-bar">
            <span className="fc-filter-bar-label">Layers:</span>
            <button
              type="button"
              className={`fc-filter-pill${selectedLayerFilter === 'all' ? ' fc-filter-pill-active' : ''}`}
              onClick={() => setSelectedLayerFilter('all')}
            >
              All ({annotations.length})
            </button>
            {layers.map((l) => {
              const isSelected = selectedLayerFilter === l.id;
              const isHidden = hiddenLayerIds.has(l.id);
              const isLocked = lockedLayerIds.has(l.id);
              const count = annotations.filter((a) => (a.layerId || 'default') === l.id).length;
              return (
                <button
                  key={l.id}
                  type="button"
                  className={`fc-filter-pill${isSelected ? ' fc-filter-pill-active' : ''}${isHidden ? ' fc-filter-pill-hidden' : ''}`}
                  onClick={() => setSelectedLayerFilter(isSelected ? 'all' : l.id)}
                  title={`Filter by ${l.name}${isLocked ? ' (Locked)' : ''}${isHidden ? ' (Hidden on canvas)' : ''}`}
                  style={{
                    borderColor: isSelected ? (l.color || 'var(--fc-accent)') : undefined,
                    backgroundColor: isSelected ? (l.color || 'var(--fc-accent)') : undefined,
                    color: isSelected ? '#ffffff' : undefined,
                  }}
                >
                  <span
                    className="fc-filter-layer-dot"
                    style={{ backgroundColor: l.color || '#6366f1' }}
                  />
                  <span>{l.name}</span>
                  <span className="fc-filter-pill-count">({count})</span>
                  {isLocked ? <span title="Layer is locked">🔒</span> : null}
                  {isHidden ? <span title="Hidden on canvas">👁️‍🗨️</span> : null}
                </button>
              );
            })}
            {onToggleLayerManager || onOpenLayerManager ? (
              <button
                type="button"
                className={`fc-layer-manager-trigger-btn${isLayerManagerOpen ? ' fc-layer-manager-trigger-active' : ''}`}
                onClick={(e) => {
                  if (onToggleLayerManager) {
                    onToggleLayerManager(e.currentTarget);
                  } else {
                    onOpenLayerManager?.(e.currentTarget);
                  }
                }}
                title={isLayerManagerOpen ? 'Close layer manager' : 'Manage layers'}
                aria-label="Manage layers"
                aria-expanded={isLayerManagerOpen}
                aria-haspopup="dialog"
              >
                ⚙️
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Custom Label Filter Bar */}
        {sidebarMode === 'comments' && allBatchLabels.length > 0 ? (
          <div className="fc-sidebar-filter-bar fc-sidebar-labels-filter-bar">
            <span className="fc-filter-bar-label">Labels:</span>
            <button
              type="button"
              className={`fc-filter-pill${selectedLabelFilter === 'all' ? ' fc-filter-pill-active' : ''}`}
              onClick={() => setSelectedLabelFilter('all')}
            >
              All
            </button>
            {allBatchLabels.map((lbl) => {
              const isSelected = selectedLabelFilter.toLowerCase() === lbl.toLowerCase();
              return (
                <button
                  key={lbl}
                  type="button"
                  className={`fc-filter-pill${isSelected ? ' fc-filter-pill-active' : ''}`}
                  onClick={() => setSelectedLabelFilter(isSelected ? 'all' : lbl)}
                >
                  {lbl}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Phase 20A: Priority Filter Bar */}
        {sidebarMode === 'comments' ? (
          <div className="fc-sidebar-priority-filter-bar">
            <span className="fc-filter-bar-label">Priority:</span>
            <button
              type="button"
              className={`fc-filter-pill${selectedPriorityFilter === 'all' ? ' fc-filter-pill-active' : ''}`}
              onClick={() => setSelectedPriorityFilter('all')}
            >
              All ({annotations.length})
            </button>
            {ANNOTATION_PRIORITIES.map((pId) => {
              const cfg = PRIORITY_CONFIG[pId];
              const isSelected = selectedPriorityFilter === pId;
              const count = priorityCounts[pId] || 0;
              return (
                <button
                  key={pId}
                  type="button"
                  className={`fc-filter-pill${isSelected ? ' fc-filter-pill-active' : ''}`}
                  onClick={() => setSelectedPriorityFilter(isSelected ? 'all' : pId)}
                  style={{
                    borderColor: isSelected ? cfg.color : undefined,
                    backgroundColor: isSelected ? cfg.color : undefined,
                    color: isSelected ? '#ffffff' : undefined,
                  }}
                  title={`Filter by ${cfg.label} priority`}
                >
                  <span>{cfg.icon}</span>
                  <span>{cfg.label}</span>
                  <span className="fc-filter-pill-count">({count})</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Phase 20A & 20B: Assignee Filter Bar */}
        {sidebarMode === 'comments' ? (
          <div className="fc-sidebar-assignee-filter-bar">
            <span className="fc-filter-bar-label">Assignee:</span>
            <button
              type="button"
              className={`fc-filter-pill${selectedAssigneeFilter === 'all' ? ' fc-filter-pill-active' : ''}`}
              onClick={() => setSelectedAssigneeFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`fc-filter-pill${selectedAssigneeFilter === 'unassigned' ? ' fc-filter-pill-active' : ''}`}
              onClick={() => setSelectedAssigneeFilter(selectedAssigneeFilter === 'unassigned' ? 'all' : 'unassigned')}
              title="Filter by unassigned annotations"
            >
              Unassigned ({assigneeFilterCounts.unassigned})
            </button>
            {currentUserId ? (
              <button
                type="button"
                className={`fc-filter-pill${selectedAssigneeFilter === 'assigned_to_me' ? ' fc-filter-pill-active' : ''}`}
                onClick={() => setSelectedAssigneeFilter(selectedAssigneeFilter === 'assigned_to_me' ? 'all' : 'assigned_to_me')}
                title="Filter by annotations assigned to me"
              >
                Assigned to me ({assigneeFilterCounts.assignedToMe})
              </button>
            ) : null}
            {!['all', 'unassigned', 'assigned_to_me'].includes(selectedAssigneeFilter) ? (
              <button
                type="button"
                className="fc-filter-pill fc-filter-pill-active"
                onClick={() => setSelectedAssigneeFilter('all')}
                title="Clear reviewer filter"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
              >
                <span>{reviewerMap.get(selectedAssigneeFilter) || 'Reviewer'} ({annotations.filter((a) => a.assignedTo === selectedAssigneeFilter).length})</span>
                <span>×</span>
              </button>
            ) : null}
            {eligibleReviewers.length > 0 ? (
              <select
                className="fc-filter-select"
                value={!['all', 'unassigned', 'assigned_to_me'].includes(selectedAssigneeFilter) ? selectedAssigneeFilter : ''}
                onChange={(e) => {
                  if (e.target.value) {
                    setSelectedAssigneeFilter(e.target.value);
                  }
                }}
                aria-label="Filter by specific reviewer"
              >
                <option value="" disabled>Specific reviewer…</option>
                {eligibleReviewers.map((rev) => {
                  const revCount = annotations.filter((a) => a.assignedTo === rev.id).length;
                  return (
                    <option key={rev.id} value={rev.id}>
                      {rev.displayName} ({revCount})
                    </option>
                  );
                })}
              </select>
            ) : null}
          </div>
        ) : null}

        {/* Phase 20B: Active Filters Summary Bar */}
        {sidebarMode === 'comments' && activeFilters.length > 0 ? (
          <div className="fc-sidebar-active-filters" role="region" aria-label="Active filters">
            <span className="fc-active-filters-label">Active:</span>
            <div className="fc-active-filters-list">
              {activeFilters.map((f) => (
                <span key={f.id} className="fc-active-filter-chip">
                  <span>{f.label}</span>
                  <button
                    type="button"
                    className="fc-active-filter-chip-remove"
                    onClick={f.onClear}
                    title={`Clear ${f.label}`}
                    aria-label={`Clear ${f.label}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <button
              type="button"
              className="fc-reset-all-filters-btn"
              onClick={handleResetAllFilters}
              title="Reset all filters and search"
            >
              Reset all
            </button>
          </div>
        ) : null}
      </div>

      {sidebarMode === 'activity' ? (
        <ActivityTimeline
          activities={activities}
          isLoading={activitiesLoading}
          error={activitiesError}
          onRetry={onRetryActivities}
          onNavigateAnnotation={onNavigateAnnotation}
          onNavigateImage={onNavigateImage}
          onNavigateWhiteboard={onNavigateWhiteboard}
          batchId={batchId}
        />
      ) : sidebarMode === 'references' ? (
        <ReferenceImagesPanel
          references={references}
          isLoading={referencesLoading}
          error={referencesError}
          onRetry={onRetryReferences}
          onUploadReference={onUploadReference}
          onUpdateComment={onUpdateReferenceComment}
          onReplaceReference={onReplaceReference}
          onDeleteReference={onDeleteReference}
          onSelectReferenceForView={onSelectReferenceForView}
          onOpenComparison={onOpenComparison}
          readOnly={readOnly}
          canReview={!readOnly}
          currentUserId={currentUserId}
          userRole={userRole}
          selectedImage={selectedImage}
          annotations={annotations}
          selectedAnnotationId={selectedAnnotationId}
          onNavigateAnnotation={onNavigateAnnotation}
        />
      ) : sidebarMode === 'checklist' ? (
        <ReviewChecklistPanel
          checklists={checklists}
          onToggleChecklistItem={onToggleChecklistItem}
          onAddCustomChecklistItem={onAddCustomChecklistItem}
          onDeleteChecklistItem={onDeleteChecklistItem}
          readOnly={readOnly}
          canReview={!readOnly}
          currentUserId={currentUserId}
        />
      ) : (
        <div
          ref={scrollContainerRef}
          className="fc-sidebar-scroll"
          role="tabpanel"
          id={`fc-tabpanel-${activeTab}`}
          aria-labelledby={`fc-tab-${activeTab}`}
        >
          <div className="fc-sidebar-list">
            {actionError ? (
              <div className="fc-alert fc-alert-error fc-sidebar-alert" role="alert">
                <span>{actionError}</span>
                {onClearActionError ? (
                  <button
                    type="button"
                    className="fc-sidebar-alert-close"
                    onClick={onClearActionError}
                    aria-label="Dismiss error"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* Bulk Selection Actions Bar */}
            {selectedAnnotationIds.length > 1 ? (
              <div className="fc-sidebar-bulk-bar">
                <div className="fc-bulk-count-badge">
                  <span className="fc-bulk-count">{selectedAnnotationIds.length}</span>
                  <span>selected</span>
                </div>
                <div className="fc-bulk-actions">
                  <select
                    className="fc-bulk-layer-select"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        onBulkMoveLayer?.(selectedAnnotationIds, e.target.value);
                        e.target.value = '';
                      }
                    }}
                    title="Move selected annotations to layer"
                  >
                    <option value="" disabled>Move to layer…</option>
                    {layers.map((l) => (
                      <option key={l.id} value={l.id} disabled={lockedLayerIds.has(l.id)}>
                        {l.name} {lockedLayerIds.has(l.id) ? '(Locked)' : ''}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="fc-btn fc-btn-danger-outline fc-btn-xs fc-bulk-delete-btn"
                    onClick={() => onBulkDelete?.(selectedAnnotationIds)}
                    title="Delete selected annotations"
                  >
                    🗑️ Delete ({selectedAnnotationIds.length})
                  </button>

                  <button
                    type="button"
                    className="fc-btn fc-btn-secondary fc-btn-xs"
                    onClick={onClearSelection}
                    title="Clear selection"
                  >
                    Clear
                  </button>
                </div>
              </div>
            ) : null}

            {!readOnly && draftAnnotation ? (
              <DraftCommentComposer
                draftAnnotation={draftAnnotation}
                imageLabel={
                  draftImageMeta
                    ? `Img ${draftImageMeta.position} · ${draftImageMeta.filename}`
                    : ''
                }
                isSubmitting={isSubmittingDraft}
                onConfirm={onConfirmDraft}
                onCancel={onCancelDraft}
                mentionableUsers={mentionableUsers}
              />
            ) : null}

            {annotationsLoading ? (
              <div className="fc-sidebar-loading-state" aria-busy="true">
                <div className="fc-spinner-row fc-sidebar-loading-row">
                  <span className="fc-spinner" aria-hidden="true" />
                  <span>Loading annotations…</span>
                </div>
              </div>
            ) : visibleAnnotations.length === 0 ? (
              readOnly || !draftAnnotation ? (
                <div className="fc-sidebar-empty">
                  <h3 className="fc-sidebar-empty-title">{emptyState.title}</h3>
                  <p className="fc-sidebar-empty-text">{emptyState.body}</p>
                  {hasActiveFilters ? (
                    <button
                      type="button"
                      className="fc-btn fc-btn-secondary fc-btn-xs"
                      style={{ marginTop: '10px' }}
                      onClick={handleResetAllFilters}
                    >
                      Clear all filters
                    </button>
                  ) : null}
                </div>
              ) : null
            ) : (
              visibleAnnotations.map((annotation) => {
                const isCreator = Boolean(
                  !readOnly && currentUserId && annotation.createdBy === currentUserId
                );
                const isSelected = selectedAnnotationIds.length > 0
                  ? selectedAnnotationIds.includes(annotation.id)
                  : annotation.id === selectedAnnotationId;

                return (
                  <AnnotationCompactCard
                    key={annotation.id}
                    annotation={annotation}
                    isCreator={isCreator}
                    isSelected={isSelected}
                    searchQuery={searchQuery.trim()}
                    onSelect={(ann, e) => {
                      onSelectAnnotationCard?.(ann, { shiftKey: e?.shiftKey });
                      setActivePopupAnnotationId(ann.id);
                    }}
                  />
                );
              })
            )}
          </div>
        </div>
      )}
      {activeAnnotation && popupCoords && typeof document !== 'undefined' && document.body
        ? createPortal(
            <AnnotationDetailsPopup
              ref={popupRef}
              coords={popupCoords}
              annotation={activeAnnotation}
              imageMeta={activeImageMeta}
              isCurrentImage={isActiveCurrentImage}
              isLocked={isActiveLocked}
              isCreator={isActiveCreator}
              isAdmin={userRole === 'admin'}
              isBusy={busySet.has(activeAnnotation.id)}
              readOnly={readOnly}
              onClose={() => setActivePopupAnnotationId(null)}
              onSaveComment={onSaveComment}
              onToggleStatus={onToggleStatus}
              onDelete={(ann) => {
                setActivePopupAnnotationId(null);
                setPopupCoords(null);
                onDeleteAnnotation?.(ann);
              }}
              liveSelectors={activeLiveSelectors}
              reactions={activeReactions}
              onToggleReaction={onToggleReaction}
              mentionableUsers={mentionableUsers}
              currentUserId={currentUserId}
              attachedReferences={activeAttachedRefs}
              onSelectReferenceForView={onSelectReferenceForView}
              onAttachReference={onAttachReferenceToAnnotation}
              canAttachReference={canActiveAttachRef}
              onOpenComparison={onOpenComparison}
              layers={layers}
              onOpenPropertiesModal={onOpenPropertiesModal}
              onUpdateAnnotationLabels={onUpdateAnnotationLabels}
              onUpdateAnnotationAssignment={onUpdateAnnotationAssignment}
              onUpdateAnnotationPriority={onUpdateAnnotationPriority}
              searchQuery={searchQuery.trim()}
              discussions={activeDiscussions}
              onCreateDiscussionMessage={onCreateDiscussionMessage}
              onDeleteDiscussionMessage={onDeleteDiscussionMessage}
              activities={activities}
            />,
            document.body
          )
        : null}
    </aside>
  );
}
