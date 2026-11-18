import { useEffect, useRef, useState } from 'react';
import {
  getReferenceSignedUrl,
  MAX_REFERENCE_COMMENT_LENGTH,
} from '../services/referenceImageService.js';
import './ReferenceViewerModal.css';

function formatTimestamp(isoString) {
  if (!isoString) return '';
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ReferenceViewerModal({
  reference,
  parentAnnotation = null,
  isOpen,
  onClose,
  canManage = false,
  onCompare = null,
  onUpdateComment = null,
  onReplace = null,
  onDelete = null,
}) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [zoomMode, setZoomMode] = useState('fit'); // 'fit' | 'original'

  const [isEditingComment, setIsEditingComment] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState('');
  const [isSavingComment, setIsSavingComment] = useState(false);

  const [isReplacing, setIsReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState('');
  const replaceInputRef = useRef(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const modalRef = useRef(null);

  // Load signed URL when reference opens
  useEffect(() => {
    if (!isOpen || !reference?.storagePath) {
      setSignedUrl(null);
      setLoadingUrl(false);
      setUrlError('');
      setIsEditingComment(false);
      setConfirmDelete(false);
      setDeleteError('');
      setReplaceError('');
      return;
    }

    let isCancelled = false;
    setLoadingUrl(true);
    setUrlError('');
    setCommentText(reference.comment || '');
    setConfirmDelete(false);
    setDeleteError('');
    setReplaceError('');

    getReferenceSignedUrl(reference.storagePath)
      .then((url) => {
        if (!isCancelled) {
          setSignedUrl(url);
          setLoadingUrl(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setUrlError(err?.message || 'Could not load private image preview.');
          setLoadingUrl(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, reference]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (confirmDelete) {
          setConfirmDelete(false);
        } else if (isEditingComment) {
          setIsEditingComment(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, confirmDelete, isEditingComment, onClose]);

  if (!isOpen || !reference) return null;

  const handleSaveComment = async (e) => {
    e?.preventDefault();
    if (!onUpdateComment || isSavingComment) return;

    const trimmed = commentText.trim();
    if (trimmed.length > MAX_REFERENCE_COMMENT_LENGTH) {
      setCommentError(`Comment must be ${MAX_REFERENCE_COMMENT_LENGTH} characters or fewer.`);
      return;
    }

    setIsSavingComment(true);
    setCommentError('');
    try {
      await onUpdateComment(reference.id, trimmed);
      setIsEditingComment(false);
    } catch (err) {
      setCommentError(err?.message || 'Failed to update comment.');
    } finally {
      setIsSavingComment(false);
    }
  };

  const handleFileReplaceSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !onReplace || isReplacing) return;

    setIsReplacing(true);
    setReplaceError('');
    try {
      await onReplace(reference, file);
      // Reset input
      if (replaceInputRef.current) {
        replaceInputRef.current.value = '';
      }
    } catch (err) {
      setReplaceError(err?.message || 'Replacement failed.');
    } finally {
      setIsReplacing(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!onDelete || isDeleting) return;

    setIsDeleting(true);
    setDeleteError('');
    try {
      await onDelete(reference);
      onClose();
    } catch (err) {
      setDeleteError(err?.message || 'Deletion failed.');
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  const handleDownload = () => {
    if (!signedUrl) return;
    const anchor = document.createElement('a');
    anchor.href = signedUrl;
    anchor.download = reference.originalFilename || 'reference-image';
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const toggleZoom = () => {
    setZoomMode((prev) => (prev === 'fit' ? 'original' : 'fit'));
  };

  return (
    <div
      className="fc-ref-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Reference Image: ${reference.originalFilename}`}
    >
      <div className="fc-ref-modal-dialog" ref={modalRef}>
        {/* Header */}
        <div className="fc-ref-modal-header">
          <div className="fc-ref-modal-title-group">
            <div className="fc-ref-modal-badge-row">
              {reference.isAnnotationLevel ? (
                <span className="fc-ref-badge-annotation">
                  Annotation #{parentAnnotation?.displayNumber || 'Ref'}
                </span>
              ) : (
                <span className="fc-ref-badge-image">Image Reference</span>
              )}
              <span className="fc-ref-badge-format">{reference.formatLabel}</span>
              <span className="fc-ref-badge-size">{reference.formattedSize}</span>
            </div>
            <h2 className="fc-ref-modal-filename" title={reference.originalFilename}>
              {reference.originalFilename}
            </h2>
            <p className="fc-ref-modal-meta">
              Added by <strong>{reference.creatorName}</strong> ·{' '}
              {formatTimestamp(reference.createdAt)}
            </p>
          </div>

          <div className="fc-ref-modal-header-actions">
            {onCompare ? (
              <button
                type="button"
                className="fc-ref-btn-secondary"
                onClick={() => {
                  onClose();
                  onCompare(reference);
                }}
                title="Compare side-by-side with original batch image"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="9" height="18" rx="2" />
                  <rect x="13" y="3" width="9" height="18" rx="2" />
                </svg>
                <span>Compare</span>
              </button>
            ) : null}

            <button
              type="button"
              className="fc-ref-btn-secondary"
              onClick={toggleZoom}
              title={zoomMode === 'fit' ? 'View 100% size' : 'Fit to screen'}
            >
              {zoomMode === 'fit' ? (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    <line x1="11" y1="8" x2="11" y2="14" />
                    <line x1="8" y1="11" x2="14" y2="11" />
                  </svg>
                  <span>100%</span>
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="4 14 10 14 10 20" />
                    <polyline points="20 10 14 10 14 4" />
                    <line x1="14" y1="10" x2="21" y2="3" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                  <span>Fit</span>
                </>
              )}
            </button>

            {signedUrl ? (
              <button
                type="button"
                className="fc-ref-btn-secondary"
                onClick={handleDownload}
                title="Download original file"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Download</span>
              </button>
            ) : null}

            <button
              type="button"
              className="fc-ref-modal-close-btn"
              onClick={onClose}
              title="Close viewer (Esc)"
              aria-label="Close viewer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Alerts */}
        {replaceError ? (
          <div className="fc-ref-modal-alert fc-ref-alert-error">{replaceError}</div>
        ) : null}
        {deleteError ? (
          <div className="fc-ref-modal-alert fc-ref-alert-error">{deleteError}</div>
        ) : null}

        {/* Viewport */}
        <div className={`fc-ref-modal-viewport fc-ref-viewport-${zoomMode}`}>
          {loadingUrl ? (
            <div className="fc-ref-modal-loading">
              <span className="fc-ref-spinner" aria-hidden="true" />
              <span>Loading secure reference preview…</span>
            </div>
          ) : urlError ? (
            <div className="fc-ref-modal-error">
              <span className="fc-ref-error-icon" aria-hidden="true">⚠️</span>
              <p>{urlError}</p>
            </div>
          ) : signedUrl ? (
            <img
              src={signedUrl}
              alt={reference.originalFilename}
              className={`fc-ref-modal-image fc-ref-image-${zoomMode}`}
              onClick={toggleZoom}
              title="Click to toggle zoom"
            />
          ) : null}
        </div>

        {/* Footer: Comments and Management Actions */}
        <div className="fc-ref-modal-footer">
          <div className="fc-ref-modal-comment-section">
            <div className="fc-ref-modal-comment-header">
              <span className="fc-ref-comment-title">Explanatory Comment</span>
              {canManage && !isEditingComment ? (
                <button
                  type="button"
                  className="fc-ref-comment-edit-btn"
                  onClick={() => {
                    setCommentText(reference.comment || '');
                    setCommentError('');
                    setIsEditingComment(true);
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  <span>{reference.comment ? 'Edit' : 'Add Comment'}</span>
                </button>
              ) : null}
            </div>

            {isEditingComment ? (
              <form onSubmit={handleSaveComment} className="fc-ref-comment-form">
                <textarea
                  className="fc-ref-comment-input"
                  rows={2}
                  maxLength={MAX_REFERENCE_COMMENT_LENGTH}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Explain how this reference clarifies the issue…"
                  autoFocus
                />
                {commentError ? (
                  <p className="fc-ref-comment-error">{commentError}</p>
                ) : null}
                <div className="fc-ref-comment-actions">
                  <button
                    type="button"
                    className="fc-ref-btn-cancel"
                    onClick={() => {
                      setIsEditingComment(false);
                      setCommentText(reference.comment || '');
                      setCommentError('');
                    }}
                    disabled={isSavingComment}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="fc-ref-btn-save"
                    disabled={isSavingComment}
                  >
                    {isSavingComment ? 'Saving…' : 'Save Comment'}
                  </button>
                </div>
              </form>
            ) : (
              <p className="fc-ref-modal-comment-text">
                {reference.comment ? (
                  reference.comment
                ) : (
                  <em className="fc-ref-no-comment">No explanatory comment added.</em>
                )}
              </p>
            )}
          </div>

          {canManage ? (
            <div className="fc-ref-modal-management-actions">
              {confirmDelete ? (
                <div className="fc-ref-confirm-delete-box">
                  <span>Delete this reference image permanently?</span>
                  <div className="fc-ref-confirm-buttons">
                    <button
                      type="button"
                      className="fc-ref-btn-cancel-small"
                      onClick={() => setConfirmDelete(false)}
                      disabled={isDeleting}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="fc-ref-btn-danger"
                      onClick={handleDeleteConfirmed}
                      disabled={isDeleting}
                    >
                      {isDeleting ? 'Deleting…' : 'Yes, Delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="fc-ref-management-buttons">
                  <input
                    ref={replaceInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    className="fc-ref-hidden-file-input"
                    onChange={handleFileReplaceSelected}
                  />
                  <button
                    type="button"
                    className="fc-ref-btn-replace"
                    onClick={() => replaceInputRef.current?.click()}
                    disabled={isReplacing}
                    title="Replace this reference image with a new file"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                    <span>{isReplacing ? 'Replacing…' : 'Replace Image'}</span>
                  </button>

                  <button
                    type="button"
                    className="fc-ref-btn-delete"
                    onClick={() => setConfirmDelete(true)}
                    title="Delete this reference image"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    <span>Delete</span>
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

