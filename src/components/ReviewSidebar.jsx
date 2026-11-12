import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ANNOTATION_COMMENT_LENGTH } from '../services/annotationService.js';
import './ReviewSidebar.css';

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

function DraftCommentComposer({
  draftAnnotation,
  imageLabel,
  isSubmitting,
  onConfirm,
  onCancel,
}) {
  const [comment, setComment] = useState('');
  const [validationError, setValidationError] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    setComment('');
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
    onConfirm(trimmed);
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
          <span>New Draft Circle</span>
        </span>
        {imageLabel ? (
          <span className="fc-draft-image-label" title={imageLabel}>
            {imageLabel}
          </span>
        ) : null}
      </div>

      <label className="fc-draft-label" htmlFor="fc-draft-comment-input">
        Describe the issue spotted here
      </label>
      <textarea
        id="fc-draft-comment-input"
        ref={textareaRef}
        className="fc-sidebar-textarea"
        rows={3}
        maxLength={MAX_ANNOTATION_COMMENT_LENGTH}
        placeholder="Explain what needs attention in this area…"
        value={comment}
        disabled={isSubmitting}
        onChange={(event) => {
          setComment(event.target.value);
          if (validationError) setValidationError('');
        }}
        onKeyDown={handleKeyDown}
      />

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

function AnnotationCard({
  annotation,
  imageMeta,
  isCurrentImage,
  isSelected,
  isCreator,
  isBusy,
  readOnly = false,
  onSelect,
  onSaveComment,
  onToggleStatus,
  onDelete,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(annotation.comment);
  const [editError, setEditError] = useState('');
  const editInputRef = useRef(null);

  useEffect(() => {
    if (readOnly && isEditing) {
      setIsEditing(false);
      setEditText(annotation.comment);
      setEditError('');
    }
  }, [annotation.comment, isEditing, readOnly]);

  useEffect(() => {
    if (!isEditing) {
      setEditText(annotation.comment);
      setEditError('');
    }
  }, [annotation.comment, isEditing]);

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
    <article
      data-annotation-id={annotation.id}
      className={`fc-ann-card${!readOnly && isSelected ? ' fc-ann-card-selected' : ''}${
        isResolved ? ' fc-ann-card-resolved' : ''
      }`}
    >
      <div
        className="fc-ann-card-main"
        role="button"
        tabIndex={0}
        onClick={() => onSelect(annotation)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(annotation);
          }
        }}
        aria-pressed={readOnly ? undefined : isSelected}
      >
        <div className="fc-ann-card-top">
          <span
            className="fc-ann-num-badge"
            style={{ backgroundColor: annotation.color }}
          >
            #{annotation.displayNumber}
          </span>

          {imageMeta ? (
            <span
              className={`fc-ann-image-tag${
                isCurrentImage ? ' fc-ann-image-tag-current' : ''
              }`}
              title={`Image ${imageMeta.position}: ${imageMeta.filename}`}
            >
              Img {imageMeta.position} · {imageMeta.filename}
            </span>
          ) : null}

          <span
            className={`fc-ann-status-pill ${
              isResolved ? 'fc-ann-status-resolved' : 'fc-ann-status-open'
            }`}
          >
            {isResolved ? 'Resolved' : 'Open'}
          </span>
        </div>

        <div className="fc-ann-card-meta">
          <span className="fc-ann-creator">
            {annotation.creatorName}
            {isCreator ? ' (You)' : ''}
          </span>
          {annotation.createdAt ? (
            <span className="fc-ann-time">
              {formatTimestamp(annotation.createdAt)}
              {wasEdited ? ' · Edited' : ''}
            </span>
          ) : null}
        </div>

        {!effectiveEditing ? (
          <p className="fc-ann-comment-text">{annotation.comment}</p>
        ) : null}

        {isResolved && annotation.resolvedAt ? (
          <p className="fc-ann-resolved-note">
            Resolved {formatTimestamp(annotation.resolvedAt)}
          </p>
        ) : null}
      </div>

      {effectiveEditing ? (
        <form className="fc-ann-edit-form" onSubmit={submitEdit}>
          <textarea
            ref={editInputRef}
            className="fc-sidebar-textarea"
            rows={3}
            maxLength={MAX_ANNOTATION_COMMENT_LENGTH}
            value={editText}
            disabled={isBusy}
            onChange={(event) => {
              setEditText(event.target.value);
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

      {!readOnly && isCreator && !effectiveEditing ? (
        <div className="fc-ann-card-actions">
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
            onClick={() => onToggleStatus(annotation)}
            disabled={isBusy}
          >
            {isResolved ? 'Reopen' : 'Resolve'}
          </button>
          <button
            type="button"
            className="fc-btn fc-btn-danger-outline fc-btn-sm"
            onClick={() => onDelete(annotation)}
            disabled={isBusy}
          >
            Delete
          </button>
        </div>
      ) : null}
    </article>
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
}) {
  const scrollContainerRef = useRef(null);

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

  const visibleAnnotations = useMemo(() => {
    if (activeTab === 'open') {
      return annotations.filter((ann) => ann.status !== 'resolved');
    }
    if (activeTab === 'resolved') {
      return annotations.filter((ann) => ann.status === 'resolved');
    }
    return annotations;
  }, [activeTab, annotations]);

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

  const emptyState =
    readOnly && activeTab === 'all'
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

  return (
    <aside className="fc-review-sidebar" aria-label="Image review comments">
      <div className="fc-sidebar-header">
        <div className="fc-sidebar-title-row">
          <h2 className="fc-sidebar-title">Annotations &amp; Comments</h2>
          <span className="fc-sidebar-count">{counts.all}</span>
        </div>
        {selectedImage ? (
          <p className="fc-sidebar-subtitle" title={selectedImage.original_filename}>
            Viewing: {selectedImage.original_filename}
          </p>
        ) : null}

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
      </div>

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
            />
          ) : null}

          {annotationsLoading ? (
            <div className="fc-sidebar-empty" aria-busy="true">
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
              </div>
            ) : null
          ) : (
            visibleAnnotations.map((annotation) => {
              const imageMeta = imageMetaById.get(annotation.imageId) ?? null;
              const isCurrentImage = Boolean(
                selectedImage && annotation.imageId === selectedImage.id
              );
              const isCreator = Boolean(
                !readOnly && currentUserId && annotation.createdBy === currentUserId
              );
              return (
                <AnnotationCard
                  key={annotation.id}
                  annotation={annotation}
                  imageMeta={imageMeta}
                  isCurrentImage={isCurrentImage}
                  isSelected={!readOnly && annotation.id === selectedAnnotationId}
                  isCreator={isCreator}
                  isBusy={busySet.has(annotation.id)}
                  readOnly={readOnly}
                  onSelect={onSelectAnnotationCard}
                  onSaveComment={onSaveComment}
                  onToggleStatus={onToggleStatus}
                  onDelete={onDeleteAnnotation}
                />
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
