import { useEffect, useMemo, useRef, useState } from 'react';
import {
  canManageReference,
  canAddAnnotationReference,
  getReferenceSignedUrl,
  MAX_REFERENCE_COMMENT_LENGTH,
  validateReferenceFile,
} from '../services/referenceImageService.js';
import './ReferenceImagesPanel.css';

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

/**
 * Thumbnail component with cached signed URL loading and placeholder states.
 */
function ReferenceThumbnail({ storagePath, filename, onClick }) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    if (!storagePath) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(false);

    getReferenceSignedUrl(storagePath)
      .then((signedUrl) => {
        if (!isCancelled) {
          setUrl(signedUrl);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [storagePath]);

  return (
    <div
      className="fc-ref-thumb-wrapper"
      onClick={onClick}
      role="button"
      tabIndex={0}
      title="Click to view full reference image"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      {loading ? (
        <div className="fc-ref-thumb-loading">
          <span className="fc-ref-thumb-spinner" />
        </div>
      ) : error || !url ? (
        <div className="fc-ref-thumb-fallback">
          <span>🖼️</span>
        </div>
      ) : (
        <img src={url} alt={filename} className="fc-ref-thumb-img" />
      )}
      <div className="fc-ref-thumb-hover-overlay">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </div>
    </div>
  );
}

/**
 * Single Reference Card in the list.
 */
function ReferenceCard({
  reference,
  parentAnnotation,
  currentUserId,
  userRole,
  onView,
  onCompare = null,
  onUpdateComment,
  onReplace,
  onDelete,
  onNavigateAnnotation,
}) {
  const canManage = canManageReference({
    reference,
    currentUserId,
    userRole,
    parentAnnotation,
  });

  const [isEditing, setIsEditing] = useState(false);
  const [commentText, setCommentText] = useState(reference.comment || '');
  const [commentError, setCommentError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isReplacing, setIsReplacing] = useState(false);
  const replaceFileInputRef = useRef(null);

  const handleSaveComment = async (e) => {
    e?.preventDefault();
    if (!onUpdateComment || isSaving) return;

    const trimmed = commentText.trim();
    if (trimmed.length > MAX_REFERENCE_COMMENT_LENGTH) {
      setCommentError(`Max ${MAX_REFERENCE_COMMENT_LENGTH} characters.`);
      return;
    }

    setIsSaving(true);
    setCommentError('');
    try {
      await onUpdateComment(reference.id, trimmed);
      setIsEditing(false);
    } catch (err) {
      setCommentError(err?.message || 'Failed to save comment.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileReplaced = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !onReplace || isReplacing) return;

    setIsReplacing(true);
    try {
      await onReplace(reference, file);
      if (replaceFileInputRef.current) {
        replaceFileInputRef.current.value = '';
      }
    } catch (err) {
      alert(err?.message || 'Failed to replace image.');
    } finally {
      setIsReplacing(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete(reference);
    } catch (err) {
      alert(err?.message || 'Failed to delete reference.');
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <article className="fc-ref-card" data-reference-id={reference.id}>
      <div className="fc-ref-card-body">
        <ReferenceThumbnail
          storagePath={reference.storagePath}
          filename={reference.originalFilename}
          onClick={() => onView(reference)}
        />

        <div className="fc-ref-card-content">
          <div className="fc-ref-card-header">
            <div className="fc-ref-card-tag-row">
              {reference.isAnnotationLevel ? (
                <button
                  type="button"
                  className="fc-ref-tag-ann"
                  onClick={() => onNavigateAnnotation?.(reference.annotationId)}
                  title="Click to jump to this annotation"
                >
                  <span
                    className="fc-ref-ann-dot"
                    style={{ backgroundColor: parentAnnotation?.color || '#7c3aed' }}
                  />
                  <span>#{parentAnnotation?.displayNumber || 'Annotation'}</span>
                </button>
              ) : (
                <span className="fc-ref-tag-img">Image Ref</span>
              )}

              <span className="fc-ref-pill-info">{reference.formatLabel}</span>
              <span className="fc-ref-pill-info">{reference.formattedSize}</span>
            </div>

            <div className="fc-ref-card-actions">
              {onCompare ? (
                <button
                  type="button"
                  className="fc-ref-action-icon-btn fc-ref-compare-icon-btn"
                  onClick={() => onCompare(reference)}
                  title="Compare side-by-side with original image"
                  aria-label="Compare reference"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="9" height="18" rx="2" />
                    <rect x="13" y="3" width="9" height="18" rx="2" />
                  </svg>
                </button>
              ) : null}

              <button
                type="button"
                className="fc-ref-action-icon-btn"
                onClick={() => onView(reference)}
                title="View full reference"
                aria-label="View reference"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>

              {canManage ? (
                <>
                  <input
                    ref={replaceFileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    className="fc-ref-hidden-input"
                    onChange={handleFileReplaced}
                  />
                  <button
                    type="button"
                    className="fc-ref-action-icon-btn"
                    onClick={() => replaceFileInputRef.current?.click()}
                    disabled={isReplacing}
                    title="Replace image"
                    aria-label="Replace reference"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    className="fc-ref-action-icon-btn fc-ref-delete-icon-btn"
                    onClick={() => setConfirmDelete(true)}
                    title="Delete reference"
                    aria-label="Delete reference"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <h4
            className="fc-ref-card-filename"
            onClick={() => onView(reference)}
            title={reference.originalFilename}
          >
            {reference.originalFilename}
          </h4>

          <p className="fc-ref-card-meta">
            By <strong>{reference.creatorName}</strong> · {formatTimestamp(reference.createdAt)}
          </p>

          {/* Comment */}
          {isEditing ? (
            <form onSubmit={handleSaveComment} className="fc-ref-card-edit-form">
              <textarea
                className="fc-ref-card-edit-textarea"
                rows={2}
                maxLength={MAX_REFERENCE_COMMENT_LENGTH}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                autoFocus
              />
              {commentError ? <p className="fc-ref-card-edit-err">{commentError}</p> : null}
              <div className="fc-ref-card-edit-btns">
                <button
                  type="button"
                  className="fc-ref-mini-btn"
                  onClick={() => {
                    setIsEditing(false);
                    setCommentText(reference.comment || '');
                    setCommentError('');
                  }}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="fc-ref-mini-btn fc-ref-mini-primary"
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          ) : (
            <div className="fc-ref-card-comment-box">
              <p className="fc-ref-card-comment-text">
                {reference.comment ? (
                  reference.comment
                ) : (
                  <span className="fc-ref-card-no-comment">No comment added.</span>
                )}
              </p>
              {canManage ? (
                <button
                  type="button"
                  className="fc-ref-card-edit-trigger"
                  onClick={() => {
                    setCommentText(reference.comment || '');
                    setCommentError('');
                    setIsEditing(true);
                  }}
                  title="Edit explanation comment"
                >
                  {reference.comment ? 'Edit' : '+ Add comment'}
                </button>
              ) : null}
            </div>
          )}

          {/* Confirm Delete */}
          {confirmDelete ? (
            <div className="fc-ref-card-delete-prompt">
              <span>Delete reference?</span>
              <div className="fc-ref-card-delete-btns">
                <button
                  type="button"
                  className="fc-ref-mini-btn"
                  onClick={() => setConfirmDelete(false)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="fc-ref-mini-btn fc-ref-mini-danger"
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          ) : null}
          {/* Card Footer Actions */}
          {onCompare ? (
            <div className="fc-ref-card-footer-actions">
              <button
                type="button"
                className="fc-ref-card-compare-btn"
                onClick={() => onCompare(reference)}
                title="Compare side-by-side with original image"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="2" y="3" width="9" height="18" rx="2" />
                  <rect x="13" y="3" width="9" height="18" rx="2" />
                </svg>
                <span>Compare</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/**
 * Main Reference Images Sidebar Panel.
 */
export function ReferenceImagesPanel({
  references = [],
  isLoading = false,
  error = '',
  onRetry = null,
  onUploadReference,
  onUpdateComment,
  onReplaceReference,
  onDeleteReference,
  onSelectReferenceForView,
  onOpenComparison = null,
  readOnly = false,
  canReview = false,
  currentUserId,
  userRole,
  selectedImage,
  annotations = [],
  selectedAnnotationId = null,
  onNavigateAnnotation,
}) {
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'image' | 'annotation'
  const [showUploadForm, setShowUploadForm] = useState(false);

  // Upload Form State
  const [targetType, setTargetType] = useState('image'); // 'image' | 'annotation'
  const [targetAnnotationId, setTargetAnnotationId] = useState(selectedAnnotationId || '');
  const [uploadComment, setUploadComment] = useState('');
  const [stagedFile, setStagedFile] = useState(null);
  const [stagedPreviewUrl, setStagedPreviewUrl] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  // Sync selected annotation into upload target if active
  useEffect(() => {
    if (selectedAnnotationId) {
      setTargetType('annotation');
      setTargetAnnotationId(selectedAnnotationId);
    }
  }, [selectedAnnotationId]);

  // Clean up object preview URL
  useEffect(() => {
    return () => {
      if (stagedPreviewUrl) {
        URL.revokeObjectURL(stagedPreviewUrl);
      }
    };
  }, [stagedPreviewUrl]);

  // Filter references for the current image
  const imageReferences = useMemo(() => {
    return references.filter((r) => !r.isAnnotationLevel);
  }, [references]);

  const annotationReferences = useMemo(() => {
    return references.filter((r) => r.isAnnotationLevel);
  }, [references]);

  const visibleReferences = useMemo(() => {
    if (filterMode === 'image') return imageReferences;
    if (filterMode === 'annotation') return annotationReferences;
    return references;
  }, [filterMode, references, imageReferences, annotationReferences]);

  // Annotation map for quick lookup
  const annotationMap = useMemo(() => {
    const map = new Map();
    annotations.forEach((ann) => {
      map.set(ann.id, ann);
    });
    return map;
  }, [annotations]);

  // Active annotations eligible for reference attachment
  const availableAnnotations = useMemo(() => {
    return annotations.filter((ann) => {
      return canAddAnnotationReference({
        annotation: ann,
        currentUserId,
        userRole,
      });
    });
  }, [annotations, currentUserId, userRole]);

  // Handle file staging
  const handleStageFile = async (file) => {
    if (!file) return;
    setUploadError('');

    const check = await validateReferenceFile(file);
    if (!check.valid) {
      setUploadError(check.reason);
      return;
    }

    if (stagedPreviewUrl) {
      URL.revokeObjectURL(stagedPreviewUrl);
    }

    setStagedFile(file);
    setStagedPreviewUrl(URL.createObjectURL(file));
    setShowUploadForm(true);
  };

  const handleFilePicked = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleStageFile(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!readOnly && canReview) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (readOnly || !canReview) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleStageFile(file);
    }
  };

  // Clipboard paste handler inside the panel
  const handlePaste = (e) => {
    if (readOnly || !canReview) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          handleStageFile(file);
          break;
        }
      }
    }
  };

  // Submit Upload
  const handleSubmitUpload = async (e) => {
    e?.preventDefault();
    if (!stagedFile || isUploading || !onUploadReference) return;

    const chosenAnnotationId =
      targetType === 'annotation' ? targetAnnotationId || null : null;

    if (targetType === 'annotation' && !chosenAnnotationId) {
      setUploadError('Please select which annotation to attach this reference to.');
      return;
    }

    setIsUploading(true);
    setUploadError('');

    try {
      await onUploadReference({
        file: stagedFile,
        comment: uploadComment.trim(),
        annotationId: chosenAnnotationId,
      });

      // Reset form
      setStagedFile(null);
      if (stagedPreviewUrl) {
        URL.revokeObjectURL(stagedPreviewUrl);
        setStagedPreviewUrl(null);
      }
      setUploadComment('');
      setShowUploadForm(false);
    } catch (err) {
      setUploadError(err?.message || 'Failed to upload reference image.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancelUpload = () => {
    setStagedFile(null);
    if (stagedPreviewUrl) {
      URL.revokeObjectURL(stagedPreviewUrl);
      setStagedPreviewUrl(null);
    }
    setUploadComment('');
    setUploadError('');
    setShowUploadForm(false);
  };

  return (
    <div
      className="fc-ref-panel"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
      tabIndex={0}
    >
      {/* Subheader / Tabs */}
      <div className="fc-ref-panel-header">
        <div className="fc-ref-filter-tabs" role="tablist" aria-label="Reference categories">
          <button
            type="button"
            role="tab"
            aria-selected={filterMode === 'all'}
            className={`fc-ref-filter-tab${filterMode === 'all' ? ' fc-ref-filter-tab-active' : ''}`}
            onClick={() => setFilterMode('all')}
          >
            <span>All</span>
            <span className="fc-ref-tab-badge">{references.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterMode === 'image'}
            className={`fc-ref-filter-tab${filterMode === 'image' ? ' fc-ref-filter-tab-active' : ''}`}
            onClick={() => setFilterMode('image')}
          >
            <span>Image</span>
            <span className="fc-ref-tab-badge">{imageReferences.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterMode === 'annotation'}
            className={`fc-ref-filter-tab${filterMode === 'annotation' ? ' fc-ref-filter-tab-active' : ''}`}
            onClick={() => setFilterMode('annotation')}
          >
            <span>Annotations</span>
            <span className="fc-ref-tab-badge">{annotationReferences.length}</span>
          </button>
        </div>

        <div className="fc-ref-header-actions-group">
          {references.length > 0 && onOpenComparison ? (
            <button
              type="button"
              className="fc-ref-panel-compare-btn"
              onClick={() => onOpenComparison(filteredReferences[0] || references[0])}
              title="Open side-by-side reference comparison"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="2" y="3" width="9" height="18" rx="2" />
                <rect x="13" y="3" width="9" height="18" rx="2" />
              </svg>
              <span>Compare</span>
            </button>
          ) : null}

          {!readOnly && canReview ? (
            <button
              type="button"
              className="fc-ref-add-btn"
              onClick={() => setShowUploadForm((prev) => !prev)}
              title="Attach a new reference image"
            >
              {showUploadForm ? 'Cancel' : '+ Add Reference'}
            </button>
          ) : null}
        </div>
      </div>

      {/* Upload Zone / Form */}
      {!readOnly && canReview && (showUploadForm || isDragOver) ? (
        <div className={`fc-ref-upload-card${isDragOver ? ' fc-ref-upload-dragover' : ''}`}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            className="fc-ref-hidden-input"
            onChange={handleFilePicked}
          />

          {!stagedFile ? (
            <div
              ref={dropZoneRef}
              className="fc-ref-dropzone"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="fc-ref-drop-icon">📎</div>
              <p className="fc-ref-drop-text">
                <strong>Click to browse</strong> or drag & drop reference image
              </p>
              <p className="fc-ref-drop-hint">
                JPEG, PNG, or WEBP up to 50 MB (or press Ctrl+V to paste)
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmitUpload} className="fc-ref-staged-form">
              <div className="fc-ref-staged-preview-row">
                <img
                  src={stagedPreviewUrl}
                  alt={stagedFile.name}
                  className="fc-ref-staged-preview-img"
                />
                <div className="fc-ref-staged-file-info">
                  <span className="fc-ref-staged-filename" title={stagedFile.name}>
                    {stagedFile.name}
                  </span>
                  <span className="fc-ref-staged-filesize">
                    {(stagedFile.size / (1024 * 1024)).toFixed(2)} MB
                  </span>
                  <button
                    type="button"
                    className="fc-ref-change-file-btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Change file
                  </button>
                </div>
              </div>

              {/* Target Selector */}
              <div className="fc-ref-target-selector">
                <label className="fc-ref-form-label">Attach To:</label>
                <div className="fc-ref-target-radios">
                  <label className="fc-ref-radio-label">
                    <input
                      type="radio"
                      name="targetType"
                      value="image"
                      checked={targetType === 'image'}
                      onChange={() => setTargetType('image')}
                    />
                    <span>Entire Image</span>
                  </label>
                  <label className="fc-ref-radio-label">
                    <input
                      type="radio"
                      name="targetType"
                      value="annotation"
                      checked={targetType === 'annotation'}
                      onChange={() => setTargetType('annotation')}
                      disabled={availableAnnotations.length === 0}
                    />
                    <span>
                      Specific Annotation
                      {availableAnnotations.length === 0 ? ' (No owned annotations)' : ''}
                    </span>
                  </label>
                </div>

                {targetType === 'annotation' && availableAnnotations.length > 0 ? (
                  <select
                    className="fc-ref-annotation-select"
                    value={targetAnnotationId}
                    onChange={(e) => setTargetAnnotationId(e.target.value)}
                  >
                    <option value="">-- Choose Annotation --</option>
                    {availableAnnotations.map((ann) => (
                      <option key={ann.id} value={ann.id}>
                        #{ann.displayNumber} ({ann.type || 'Circle'}):{' '}
                        {ann.comment ? ann.comment.slice(0, 32) + '…' : 'No comment'}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>

              {/* Comment Input */}
              <div className="fc-ref-comment-field">
                <label className="fc-ref-form-label" htmlFor="fc-ref-comment-input">
                  Explanatory Comment (optional):
                </label>
                <textarea
                  id="fc-ref-comment-input"
                  className="fc-ref-textarea"
                  rows={2}
                  maxLength={MAX_REFERENCE_COMMENT_LENGTH}
                  placeholder="Explain what this reference illustrates…"
                  value={uploadComment}
                  onChange={(e) => setUploadComment(e.target.value)}
                  disabled={isUploading}
                />
              </div>

              {uploadError ? <p className="fc-ref-form-error">{uploadError}</p> : null}

              <div className="fc-ref-staged-actions">
                <button
                  type="button"
                  className="fc-ref-btn-cancel"
                  onClick={handleCancelUpload}
                  disabled={isUploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="fc-ref-btn-upload"
                  disabled={isUploading}
                >
                  {isUploading ? 'Uploading…' : 'Upload Reference'}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : null}

      {/* Reference List */}
      <div className="fc-ref-list-scroll">
        {isLoading ? (
          <div className="fc-ref-loading-state">
            <span className="fc-ref-spinner" />
            <p>Loading reference images…</p>
          </div>
        ) : error ? (
          <div className="fc-ref-error-state">
            <p className="fc-ref-error-msg">{error}</p>
            {onRetry ? (
              <button type="button" className="fc-ref-retry-btn" onClick={onRetry}>
                Retry
              </button>
            ) : null}
          </div>
        ) : visibleReferences.length === 0 ? (
          <div className="fc-ref-empty-state">
            <div className="fc-ref-empty-icon">📁</div>
            <h4 className="fc-ref-empty-title">
              {filterMode === 'image'
                ? 'No image-level references'
                : filterMode === 'annotation'
                ? 'No annotation-level references'
                : 'No reference images yet'}
            </h4>
            <p className="fc-ref-empty-body">
              {readOnly
                ? 'Reference images uploaded by reviewers will appear here.'
                : 'Attach reference designs, style guides, or error screenshots to guide revisions.'}
            </p>
            {!readOnly && canReview && !showUploadForm ? (
              <button
                type="button"
                className="fc-ref-empty-upload-btn"
                onClick={() => setShowUploadForm(true)}
              >
                Upload Reference Image
              </button>
            ) : null}
          </div>
        ) : (
          <div className="fc-ref-card-list">
            {visibleReferences.map((ref) => (
              <ReferenceCard
                key={ref.id}
                reference={ref}
                parentAnnotation={ref.annotationId ? annotationMap.get(ref.annotationId) : null}
                currentUserId={currentUserId}
                userRole={userRole}
                onView={onSelectReferenceForView}
                onCompare={onOpenComparison}
                onUpdateComment={onUpdateComment}
                onReplace={onReplaceReference}
                onDelete={onDeleteReference}
                onNavigateAnnotation={onNavigateAnnotation}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

