import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatFileSize, getSignedImageUrl, validateImageFile } from '../services/imageUploadService.js';
import { submitImageReplacement } from '../services/imageVersioningService.js';
import './ReplaceImageModal.css';

/**
 * Modal dialog for uploaders to submit a corrected replacement image version.
 * Includes drag & drop selection, validation, dual preview, and correction message.
 */
export function ReplaceImageModal({
  isOpen,
  onClose,
  image,
  batch,
  onReplacementSubmitted,
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [originalUrl, setOriginalUrl] = useState('');
  const [correctionMessage, setCorrectionMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const fileInputRef = useRef(null);

  // Load original image signed URL
  useEffect(() => {
    if (!isOpen || !image?.storage_path) {
      setOriginalUrl('');
      return;
    }
    let cancelled = false;
    getSignedImageUrl(image.storage_path)
      .then((url) => {
        if (!cancelled) setOriginalUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, image?.storage_path]);

  // Clean up object preview URL
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setSelectedFile(null);
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl('');
      setCorrectionMessage('');
      setValidationError('');
      setSubmitError('');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleProcessFile = useCallback(async (file) => {
    if (!file) return;
    setValidationError('');
    setSubmitError('');

    const validation = await validateImageFile(file);
    if (!validation.valid) {
      setValidationError(validation.reason);
      setSelectedFile(null);
      setPreviewUrl('');
      return;
    }

    setSelectedFile(file);
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(URL.createObjectURL(file));
  }, [previewUrl]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setValidationError('Please select a corrected replacement image file.');
      return;
    }
    if (!batch?.owner_id) {
      setSubmitError('Unable to identify batch ownership.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');

    try {
      const result = await submitImageReplacement({
        batchId: batch.id,
        imageId: image.id,
        ownerId: batch.owner_id,
        file: selectedFile,
        correctionMessage: correctionMessage.trim(),
      });

      onReplacementSubmitted?.(result);
      onClose();
    } catch (err) {
      setSubmitError(err?.message || 'Failed to submit replacement proposal.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const currentVersionNum = image.current_version_number || 1;
  const nextVersionNum = currentVersionNum + 1;

  return createPortal(
    <div className="fc-rim-overlay" role="dialog" aria-modal="true" aria-labelledby="fc-rim-title">
      <div className="fc-rim-card">
        {/* Header */}
        <header className="fc-rim-header">
          <div className="fc-rim-header-content">
            <span className="fc-rim-badge">Version {nextVersionNum} Proposal</span>
            <h2 id="fc-rim-title" className="fc-rim-title">
              Replace Image #{image.display_order || 1}
            </h2>
            <p className="fc-rim-subtitle">
              Submit a corrected version of <span className="fc-rim-filename">{image.original_filename}</span> for reviewer approval.
            </p>
          </div>
          <button
            type="button"
            className="fc-rim-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close replacement modal"
          >
            ×
          </button>
        </header>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="fc-rim-form">
          {submitError ? (
            <div className="fc-rim-alert fc-rim-alert-danger" role="alert">
              <span>{submitError}</span>
            </div>
          ) : null}

          {/* Dual Preview Comparison (Original vs Proposed) */}
          <div className="fc-rim-preview-grid">
            {/* Current Active Image */}
            <div className="fc-rim-preview-col">
              <div className="fc-rim-col-header">
                <span className="fc-rim-col-title">Current Version (v{currentVersionNum})</span>
                <span className="fc-rim-col-tag fc-rim-tag-active">Active</span>
              </div>
              <div className="fc-rim-col-media">
                {originalUrl ? (
                  <img src={originalUrl} alt="Current active image" className="fc-rim-col-img" />
                ) : (
                  <div className="fc-rim-media-placeholder">Loading original…</div>
                )}
              </div>
              <div className="fc-rim-col-meta">
                <span>{image.original_filename}</span>
                {image.file_size ? <span>{formatFileSize(image.file_size)}</span> : null}
              </div>
            </div>

            {/* Proposed Replacement Image */}
            <div className="fc-rim-preview-col">
              <div className="fc-rim-col-header">
                <span className="fc-rim-col-title">Proposed Replacement (v{nextVersionNum})</span>
                <span className="fc-rim-col-tag fc-rim-tag-proposed">Proposed</span>
              </div>
              <div className="fc-rim-col-media">
                {previewUrl ? (
                  <img src={previewUrl} alt="Replacement preview" className="fc-rim-col-img" />
                ) : (
                  <div
                    className={`fc-rim-drop-target${isDraggingOver ? ' fc-rim-drop-target-active' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span>Click or drag image file here</span>
                    <span className="fc-rim-drop-hint">JPG, PNG, or WEBP (up to 50MB)</span>
                  </div>
                )}
              </div>
              <div className="fc-rim-col-meta">
                {selectedFile ? (
                  <>
                    <span className="fc-rim-filename">{selectedFile.name}</span>
                    <span>{formatFileSize(selectedFile.size)}</span>
                  </>
                ) : (
                  <span className="fc-rim-text-muted">No file selected</span>
                )}
              </div>
            </div>
          </div>

          {/* Change File Trigger if already selected */}
          {selectedFile ? (
            <div className="fc-rim-file-actions">
              <button
                type="button"
                className="fc-rim-btn-secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
              >
                Choose Different File
              </button>
            </div>
          ) : null}

          {validationError ? (
            <div className="fc-rim-alert fc-rim-alert-warning" role="alert">
              <span>{validationError}</span>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            className="fc-rim-hidden-input"
            onChange={handleFileChange}
          />

          {/* Optional Correction Message */}
          <div className="fc-rim-form-group">
            <label htmlFor="fc-rim-correction-msg" className="fc-rim-label">
              Correction Notes for Reviewer <span className="fc-rim-label-optional">(Optional)</span>
            </label>
            <textarea
              id="fc-rim-correction-msg"
              className="fc-rim-textarea"
              rows={3}
              placeholder="e.g., Corrected the alignment, fixed background color, and updated typography."
              value={correctionMessage}
              onChange={(e) => setCorrectionMessage(e.target.value)}
              disabled={isSubmitting}
              maxLength={1000}
            />
            <span className="fc-rim-char-count">{correctionMessage.length} / 1000</span>
          </div>

          {/* Workflow Notice */}
          <div className="fc-rim-notice">
            <div className="fc-rim-notice-icon">ℹ️</div>
            <div className="fc-rim-notice-text">
              The current image and its annotations will remain active until an authorized reviewer compares and approves this replacement.
            </div>
          </div>

          {/* Modal Footer Actions */}
          <footer className="fc-rim-footer">
            <button
              type="button"
              className="fc-rim-btn fc-rim-btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="fc-rim-btn fc-rim-btn-primary"
              disabled={!selectedFile || isSubmitting}
            >
              {isSubmitting ? 'Uploading & Submitting…' : 'Submit for Reviewer Approval'}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body
  );
}
