import React, { useState } from 'react';
import { exportAnnotatedImage, EXPORT_FORMATS } from '../services/imageExportService.js';
import './ImageExportModal.css';

export function ImageExportModal({
  isOpen,
  onClose,
  image,
  annotations = [],
  hiddenLayerIds = new Set(),
}) {
  const [format, setFormat] = useState(EXPORT_FORMATS.PNG);
  const [quality, setQuality] = useState(0.92);
  const [includeResolved, setIncludeResolved] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [errorNotice, setErrorNotice] = useState('');
  const [successNotice, setSuccessNotice] = useState('');

  if (!isOpen || !image) return null;

  const visibleCount = (annotations || []).filter((ann) => {
    if (!includeResolved && ann.status === 'resolved') return false;
    if (hiddenLayerIds.has(ann.layerId || 'default')) return false;
    return true;
  }).length;

  const handleExport = async (e) => {
    e.preventDefault();
    setIsExporting(true);
    setErrorNotice('');
    setSuccessNotice('');

    try {
      const result = await exportAnnotatedImage({
        image,
        annotations,
        options: {
          format,
          quality: Number(quality),
          includeResolved,
          hiddenLayerIds,
        },
      });

      setSuccessNotice(`Successfully exported ${result.filename}!`);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      console.error('[ImageExportModal] Export failed:', err);
      setErrorNotice(err.message || 'Failed to export annotated image.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      className="fc-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fc-export-title"
    >
      <div className="fc-export-modal">
        {/* Header */}
        <div className="fc-export-header">
          <div className="fc-export-header-title">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <h2 id="fc-export-title">Export Annotated Image</h2>
          </div>
          <button
            type="button"
            className="fc-export-close-btn"
            onClick={onClose}
            aria-label="Close export dialog"
            disabled={isExporting}
          >
            ×
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleExport} className="fc-export-body">
          {/* Target image info card */}
          <div className="fc-export-info-card">
            <div className="fc-export-info-filename" title={image.original_filename}>
              {image.original_filename || 'Selected Image'}
            </div>
            <div className="fc-export-info-meta">
              <span>{annotations.length} Total Markings</span>
              <span>•</span>
              <span>{visibleCount} Rendered on Canvas</span>
            </div>
          </div>

          {/* Notices */}
          {successNotice ? (
            <div className="fc-export-notice fc-export-notice-success" role="status">
              ✓ {successNotice}
            </div>
          ) : null}
          {errorNotice ? (
            <div className="fc-export-notice fc-export-notice-error" role="alert">
              ⚠️ {errorNotice}
            </div>
          ) : null}

          {/* Format selection */}
          <div className="fc-export-form-group">
            <label className="fc-export-label">Image File Format</label>
            <div className="fc-export-format-options">
              <label
                className={`fc-export-format-card ${format === EXPORT_FORMATS.PNG ? 'is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="format"
                  value={EXPORT_FORMATS.PNG}
                  checked={format === EXPORT_FORMATS.PNG}
                  onChange={() => setFormat(EXPORT_FORMATS.PNG)}
                />
                <div className="fc-export-format-content">
                  <span className="fc-export-format-name">PNG (Lossless)</span>
                  <span className="fc-export-format-desc">Crisp vector markings, transparency support</span>
                </div>
              </label>

              <label
                className={`fc-export-format-card ${format === EXPORT_FORMATS.JPEG ? 'is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="format"
                  value={EXPORT_FORMATS.JPEG}
                  checked={format === EXPORT_FORMATS.JPEG}
                  onChange={() => setFormat(EXPORT_FORMATS.JPEG)}
                />
                <div className="fc-export-format-content">
                  <span className="fc-export-format-name">JPEG (Standard)</span>
                  <span className="fc-export-format-desc">Smaller file size, ideal for photo sharing</span>
                </div>
              </label>

              <label
                className={`fc-export-format-card ${format === EXPORT_FORMATS.WEBP ? 'is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="format"
                  value={EXPORT_FORMATS.WEBP}
                  checked={format === EXPORT_FORMATS.WEBP}
                  onChange={() => setFormat(EXPORT_FORMATS.WEBP)}
                />
                <div className="fc-export-format-content">
                  <span className="fc-export-format-name">WebP (Modern)</span>
                  <span className="fc-export-format-desc">High compression with crisp quality</span>
                </div>
              </label>
            </div>
          </div>

          {/* Quality slider if JPEG or WebP */}
          {format !== EXPORT_FORMATS.PNG ? (
            <div className="fc-export-form-group">
              <div className="fc-export-quality-header">
                <label className="fc-export-label" htmlFor="export-quality">
                  Compression Quality
                </label>
                <span className="fc-export-quality-val">{Math.round(quality * 100)}%</span>
              </div>
              <input
                id="export-quality"
                type="range"
                min="0.4"
                max="1.0"
                step="0.05"
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="fc-export-range"
              />
            </div>
          ) : null}

          {/* Filter options */}
          <div className="fc-export-checkbox-group">
            <label className="fc-export-checkbox-label">
              <input
                type="checkbox"
                checked={includeResolved}
                onChange={(e) => setIncludeResolved(e.target.checked)}
              />
              <span>Include resolved annotations</span>
            </label>
          </div>

          {/* Footer Actions */}
          <div className="fc-export-footer">
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-sm"
              onClick={onClose}
              disabled={isExporting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="fc-btn fc-btn-primary fc-btn-sm fc-export-submit-btn"
              disabled={isExporting}
            >
              {isExporting ? (
                <>
                  <span className="fc-export-spinner" aria-hidden="true" />
                  <span>Rendering Image…</span>
                </>
              ) : (
                <>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>Download Image</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

