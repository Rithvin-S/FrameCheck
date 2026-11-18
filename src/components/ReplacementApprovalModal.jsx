import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatFileSize, getSignedImageUrl } from '../services/imageUploadService.js';
import { approveImageReplacement, rejectImageReplacement } from '../services/imageVersioningService.js';
import {
  clamp,
  normalizedCircleToPixel,
  normalizedRectToPixel,
  normalizedArrowToPixel,
  normalizedLineToPixel,
  normalizedPencilToPixel,
  normalizedHighlighterToPixel,
  normalizedPolygonToPixel,
  normalizedCalloutToPixel,
  normalizedCloudToPixel,
  normalizedTextboxToPixel,
  pointsToSmoothSvgPath,
  calculateArrowheadPoints,
  generateCloudSvgPath,
  pointsToPolygonSvgString,
  calculateCalloutConnector,
  getPencilBadgeCoordinates,
} from '../services/annotationState.js';
import './ReplacementApprovalModal.css';

function formatDateTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function ReadOnlyAnnotationOverlay({ annotations = [], baseWidth = 1000, baseHeight = 750 }) {
  if (!annotations || annotations.length === 0) return null;

  return (
    <svg
      className="fc-ram-annotation-svg"
      viewBox={`0 0 ${baseWidth} ${baseHeight}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {annotations.map((ann, idx) => {
        const tool = ann.geometry?.tool || ann.type || 'circle';
        const strokeColor = ann.style?.strokeColor || ann.color || '#ef4444';
        const labelText = String(ann.displayNumber ?? ann.annotationNumber ?? idx + 1);

        if (tool === 'rectangle') {
          const px = normalizedRectToPixel({
            x: ann.geometry?.x ?? 0.1,
            y: ann.geometry?.y ?? 0.1,
            width: ann.geometry?.width ?? 0.2,
            height: ann.geometry?.height ?? 0.2,
            baseWidth,
            baseHeight,
          });
          return (
            <g key={ann.id || idx}>
              <rect
                x={px.xPx}
                y={px.yPx}
                width={px.widthPx}
                height={px.heightPx}
                fill={strokeColor}
                fillOpacity={0.12}
                stroke={strokeColor}
                strokeWidth={2.5}
                vectorEffect="non-scaling-stroke"
              />
              <text x={px.xPx + 10} y={px.yPx + 16} fill="#ffffff" fontSize="11" fontWeight="bold">
                #{labelText}
              </text>
            </g>
          );
        }

        if (tool === 'arrow' || tool === 'line') {
          const px = normalizedArrowToPixel({
            startX: ann.geometry?.startX ?? 0.1,
            startY: ann.geometry?.startY ?? 0.1,
            endX: ann.geometry?.endX ?? 0.3,
            endY: ann.geometry?.endY ?? 0.3,
            width: baseWidth,
            height: baseHeight,
          });
          return (
            <g key={ann.id || idx}>
              <line
                x1={px.startXPx}
                y1={px.startYPx}
                x2={px.endXPx}
                y2={px.endYPx}
                stroke={strokeColor}
                strokeWidth={2.5}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <text x={px.startXPx} y={px.startYPx - 6} fill="#ffffff" fontSize="11" fontWeight="bold">
                #{labelText}
              </text>
            </g>
          );
        }

        // Circle & default
        const px = normalizedCircleToPixel({
          cx: ann.geometry?.cx ?? ann.cx ?? 0.5,
          cy: ann.geometry?.cy ?? ann.cy ?? 0.5,
          r: ann.geometry?.r ?? ann.r ?? 0.1,
          width: baseWidth,
          height: baseHeight,
        });

        return (
          <g key={ann.id || idx}>
            <circle
              cx={px.cxPx}
              cy={px.cyPx}
              r={px.rPx}
              fill={strokeColor}
              fillOpacity={0.12}
              stroke={strokeColor}
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
            />
            <text x={px.cxPx} y={px.cyPx} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontSize="11" fontWeight="bold">
              #{labelText}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Dedicated Reviewer Replacement Approval & Inspection Modal.
 * Provides Side-by-Side, Before/After toggle, and Overlay with adjustable opacity comparison.
 * Enables reviewers to inspect proposed replacements, reference original annotations read-only,
 * and approve or reject the proposal with atomic concurrency protection.
 */
export function ReplacementApprovalModal({
  isOpen,
  onClose,
  image,
  batch,
  proposedVersion,
  originalAnnotations = [],
  onDecisionCompleted,
  canReview = false,
}) {
  // Modes: 'side-by-side' | 'toggle' | 'overlay'
  const [comparisonMode, setComparisonMode] = useState('side-by-side');
  const [toggleActive, setToggleActive] = useState('replacement'); // 'original' | 'replacement'
  const [overlayOpacity, setOverlayOpacity] = useState(50); // 0 to 100
  const [showOriginalAnnotations, setShowOriginalAnnotations] = useState(false);

  // Zoom & Pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Signed URLs
  const [originalUrl, setOriginalUrl] = useState('');
  const [replacementUrl, setReplacementUrl] = useState('');
  const [loadingUrls, setLoadingUrls] = useState(true);

  // Decision States
  const [isApproving, setIsApproving] = useState(false);
  const [showRejectPrompt, setShowRejectPrompt] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [actionError, setActionError] = useState('');

  // Load image URLs
  useEffect(() => {
    if (!isOpen || !image || !proposedVersion) {
      setOriginalUrl('');
      setReplacementUrl('');
      return;
    }

    let cancelled = false;
    setLoadingUrls(true);
    setActionError('');
    setShowRejectPrompt(false);
    setRejectionReason('');

    Promise.all([
      getSignedImageUrl(image.storage_path).catch(() => ''),
      getSignedImageUrl(proposedVersion.storagePath || proposedVersion.storage_path).catch(() => ''),
    ])
      .then(([origUrl, replUrl]) => {
        if (!cancelled) {
          setOriginalUrl(origUrl);
          setReplacementUrl(replUrl);
          setLoadingUrls(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingUrls(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, image, proposedVersion]);

  // Zoom / Pan handlers
  const handleZoomIn = () => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
  const handleZoomOut = () => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleMouseMove = (e) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPan({
      x: panStartRef.current.panX + dx,
      y: panStartRef.current.panY + dy,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Decision Handlers
  const handleApprove = async () => {
    if (!canReview) {
      setActionError('Only authorized reviewers or admins can approve image replacements.');
      return;
    }
    setIsApproving(true);
    setActionError('');
    try {
      const result = await approveImageReplacement({
        versionId: proposedVersion.id,
      });
      onDecisionCompleted?.({ approved: true, version: result });
      onClose();
    } catch (err) {
      setActionError(err?.message || 'Failed to approve replacement.');
    } finally {
      setIsApproving(false);
    }
  };

  const handleConfirmReject = async (e) => {
    e.preventDefault();
    if (!canReview) {
      setActionError('Only authorized reviewers or admins can reject image replacements.');
      return;
    }
    const trimmed = rejectionReason.trim();
    if (!trimmed) {
      setActionError('Please provide a rejection reason explaining what needs correction.');
      return;
    }

    setIsRejecting(true);
    setActionError('');
    try {
      const result = await rejectImageReplacement({
        versionId: proposedVersion.id,
        rejectionReason: trimmed,
      });
      onDecisionCompleted?.({ approved: false, version: result });
      onClose();
    } catch (err) {
      setActionError(err?.message || 'Failed to reject replacement.');
    } finally {
      setIsRejecting(false);
    }
  };

  if (!isOpen || !image || !proposedVersion) return null;

  const currentVersionNum = image.current_version_number || 1;
  const proposedVersionNum = proposedVersion.versionNumber || proposedVersion.version_number;
  const proposedUploader = proposedVersion.uploaderName || proposedVersion.uploader?.display_name || 'Uploader';
  const proposedDate = proposedVersion.uploadedAt || proposedVersion.uploaded_at || proposedVersion.created_at;
  const proposedFilename = proposedVersion.originalFilename || proposedVersion.original_filename || 'Replacement';
  const proposedSize = proposedVersion.fileSize || proposedVersion.file_size || 0;
  const proposedMessage = proposedVersion.correctionMessage || proposedVersion.correction_message || '';

  return createPortal(
    <div className="fc-ram-overlay" role="dialog" aria-modal="true" aria-labelledby="fc-ram-title">
      <div className="fc-ram-card">
        {/* Top Header */}
        <header className="fc-ram-header">
          <div className="fc-ram-header-left">
            <span className="fc-ram-badge">Replacement Review</span>
            <div className="fc-ram-title-wrap">
              <h2 id="fc-ram-title" className="fc-ram-title">
                Review Replacement for Image #{image.display_order || 1}
              </h2>
              <span className="fc-ram-subtitle">{image.original_filename} (v{currentVersionNum} ➔ v{proposedVersionNum || currentVersionNum + 1})</span>
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="fc-ram-mode-tabs" role="tablist" aria-label="Comparison mode">
            <button
              type="button"
              role="tab"
              aria-selected={comparisonMode === 'side-by-side'}
              className={`fc-ram-mode-tab${comparisonMode === 'side-by-side' ? ' fc-ram-mode-tab-active' : ''}`}
              onClick={() => setComparisonMode('side-by-side')}
            >
              Side-by-Side
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={comparisonMode === 'toggle'}
              className={`fc-ram-mode-tab${comparisonMode === 'toggle' ? ' fc-ram-mode-tab-active' : ''}`}
              onClick={() => setComparisonMode('toggle')}
            >
              Before / After Toggle
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={comparisonMode === 'overlay'}
              className={`fc-ram-mode-tab${comparisonMode === 'overlay' ? ' fc-ram-mode-tab-active' : ''}`}
              onClick={() => setComparisonMode('overlay')}
            >
              Opacity Overlay
            </button>
          </div>

          <div className="fc-ram-header-right">
            <button
              type="button"
              className="fc-ram-close-btn"
              onClick={onClose}
              disabled={isApproving || isRejecting}
              aria-label="Close replacement review"
            >
              ×
            </button>
          </div>
        </header>

        {/* Uploader Proposal Card Banner */}
        <div className="fc-ram-proposal-bar">
          <div className="fc-ram-proposal-meta">
            <span className="fc-ram-meta-item">
              <strong>Proposed by:</strong> {proposedUploader}
            </span>
            <span className="fc-ram-meta-sep">•</span>
            <span className="fc-ram-meta-item">
              <strong>Submitted:</strong> {formatDateTime(proposedDate)}
            </span>
            <span className="fc-ram-meta-sep">•</span>
            <span className="fc-ram-meta-item">
              <strong>Proposed File:</strong> {proposedFilename} ({formatFileSize(proposedSize)})
            </span>
          </div>

          {proposedMessage ? (
            <div className="fc-ram-proposal-note">
              <span className="fc-ram-note-label">Uploader's correction note:</span>
              <span className="fc-ram-note-text">"{proposedMessage}"</span>
            </div>
          ) : null}
        </div>

        {/* Interactive Controls Bar */}
        <div className="fc-ram-controls-bar">
          <div className="fc-ram-controls-left">
            {comparisonMode === 'toggle' ? (
              <div className="fc-ram-toggle-pill-group" role="group" aria-label="Toggle version">
                <button
                  type="button"
                  className={`fc-ram-toggle-btn${toggleActive === 'original' ? ' fc-ram-toggle-btn-active' : ''}`}
                  onClick={() => setToggleActive('original')}
                >
                  Original (v{currentVersionNum})
                </button>
                <button
                  type="button"
                  className={`fc-ram-toggle-btn${toggleActive === 'replacement' ? ' fc-ram-toggle-btn-active' : ''}`}
                  onClick={() => setToggleActive('replacement')}
                >
                  Replacement (v{proposedVersionNum})
                </button>
              </div>
            ) : null}

            {comparisonMode === 'overlay' ? (
              <div className="fc-ram-opacity-slider-wrap">
                <span className="fc-ram-slider-label">Original (0%)</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={overlayOpacity}
                  onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                  className="fc-ram-opacity-slider"
                  aria-label="Replacement overlay opacity"
                />
                <span className="fc-ram-slider-label">Replacement (100%): {overlayOpacity}%</span>
              </div>
            ) : null}

            {/* Original Annotations Reference Toggle */}
            <label className="fc-ram-annotation-toggle" title="Reference saved annotations from the original version">
              <input
                type="checkbox"
                checked={showOriginalAnnotations}
                onChange={(e) => setShowOriginalAnnotations(e.target.checked)}
              />
              <span>Show Original Annotations ({originalAnnotations.length})</span>
            </label>
          </div>

          {/* Zoom controls */}
          <div className="fc-ram-controls-right">
            <button type="button" className="fc-ram-zoom-btn" onClick={handleZoomOut} title="Zoom out">
              −
            </button>
            <span className="fc-ram-zoom-val">{Math.round(zoom * 100)}%</span>
            <button type="button" className="fc-ram-zoom-btn" onClick={handleZoomIn} title="Zoom in">
              +
            </button>
            <button type="button" className="fc-ram-btn-mini" onClick={handleResetZoom}>
              Reset
            </button>
          </div>
        </div>

        {/* Action Error Alert */}
        {actionError ? (
          <div className="fc-ram-alert fc-ram-alert-danger" role="alert">
            <span>{actionError}</span>
          </div>
        ) : null}

        {/* Stage Viewport */}
        <div
          className={`fc-ram-stage-viewport${isPanning ? ' fc-ram-is-panning' : ''}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {loadingUrls ? (
            <div className="fc-ram-stage-status">
              <div className="fc-ram-spinner" />
              <span>Loading high-resolution images…</span>
            </div>
          ) : (
            <div
              className="fc-ram-transform-container"
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              }}
            >
              {/* 1. SIDE-BY-SIDE MODE */}
              {comparisonMode === 'side-by-side' ? (
                <div className="fc-ram-sbs-wrap">
                  {/* Left: Original */}
                  <div className="fc-ram-sbs-pane">
                    <div className="fc-ram-pane-header">
                      <span className="fc-ram-pane-tag fc-ram-tag-orig">Original (v{currentVersionNum})</span>
                      <span className="fc-ram-pane-file">{image.original_filename}</span>
                    </div>
                    <div className="fc-ram-pane-stage">
                      <img src={originalUrl} alt="Original version" className="fc-ram-img" draggable={false} />
                      {showOriginalAnnotations ? (
                        <ReadOnlyAnnotationOverlay annotations={originalAnnotations} />
                      ) : null}
                    </div>
                  </div>

                  {/* Right: Replacement */}
                  <div className="fc-ram-sbs-pane">
                    <div className="fc-ram-pane-header">
                      <span className="fc-ram-pane-tag fc-ram-tag-repl">Proposed Replacement (v{proposedVersionNum})</span>
                      <span className="fc-ram-pane-file">{proposedFilename}</span>
                    </div>
                    <div className="fc-ram-pane-stage">
                      <img src={replacementUrl} alt="Replacement version" className="fc-ram-img" draggable={false} />
                    </div>
                  </div>
                </div>
              ) : null}

              {/* 2. BEFORE / AFTER TOGGLE MODE */}
              {comparisonMode === 'toggle' ? (
                <div className="fc-ram-single-wrap">
                  <div className="fc-ram-pane-header">
                    <span className={`fc-ram-pane-tag ${toggleActive === 'original' ? 'fc-ram-tag-orig' : 'fc-ram-tag-repl'}`}>
                      {toggleActive === 'original'
                        ? `Original (v${currentVersionNum})`
                        : `Proposed Replacement (v${proposedVersionNum})`}
                    </span>
                    <span className="fc-ram-pane-file">
                      {toggleActive === 'original' ? image.original_filename : proposedFilename}
                    </span>
                  </div>
                  <div className="fc-ram-pane-stage">
                    <img
                      src={toggleActive === 'original' ? originalUrl : replacementUrl}
                      alt={toggleActive === 'original' ? 'Original version' : 'Replacement version'}
                      className="fc-ram-img"
                      draggable={false}
                    />
                    {toggleActive === 'original' && showOriginalAnnotations ? (
                      <ReadOnlyAnnotationOverlay annotations={originalAnnotations} />
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* 3. OPACITY OVERLAY MODE */}
              {comparisonMode === 'overlay' ? (
                <div className="fc-ram-single-wrap">
                  <div className="fc-ram-pane-header">
                    <span className="fc-ram-pane-tag fc-ram-tag-repl">
                      Layered Inspection (Overlay Opacity: {overlayOpacity}%)
                    </span>
                  </div>
                  <div className="fc-ram-pane-stage fc-ram-overlay-stage">
                    {/* Base original image */}
                    <img src={originalUrl} alt="Original base" className="fc-ram-img" draggable={false} />
                    {/* Overlaid replacement image */}
                    <img
                      src={replacementUrl}
                      alt="Replacement overlay"
                      className="fc-ram-img fc-ram-img-overlaid"
                      style={{ opacity: overlayOpacity / 100 }}
                      draggable={false}
                    />
                    {showOriginalAnnotations ? (
                      <ReadOnlyAnnotationOverlay annotations={originalAnnotations} />
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Rejection Prompt Form (Expanded when clicking Reject) */}
        {showRejectPrompt ? (
          <form onSubmit={handleConfirmReject} className="fc-ram-reject-form">
            <div className="fc-ram-reject-card">
              <div className="fc-ram-reject-header">
                <span className="fc-ram-reject-title">Reject Replacement Proposal</span>
                <span className="fc-ram-reject-hint">Explain to the uploader why this replacement was rejected:</span>
              </div>
              <textarea
                className="fc-ram-reject-textarea"
                rows={3}
                placeholder="e.g., The alignment is better, but the background artifacts are still visible on the top-right."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                disabled={isRejecting}
                required
                autoFocus
              />
              <div className="fc-ram-reject-actions">
                <button
                  type="button"
                  className="fc-ram-btn-secondary"
                  onClick={() => setShowRejectPrompt(false)}
                  disabled={isRejecting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="fc-ram-btn fc-ram-btn-danger"
                  disabled={!rejectionReason.trim() || isRejecting}
                >
                  {isRejecting ? 'Rejecting Proposal…' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          </form>
        ) : null}

        {/* Bottom Review Action Bar */}
        <footer className="fc-ram-footer">
          <div className="fc-ram-footer-left">
            <span className="fc-ram-footer-hint">
              Approval will make Version {proposedVersionNum} the active image and reset its status to In Review.
            </span>
          </div>

          <div className="fc-ram-footer-actions">
            <button
              type="button"
              className="fc-ram-btn-secondary"
              onClick={onClose}
              disabled={isApproving || isRejecting}
            >
              Close
            </button>

            {canReview && !showRejectPrompt ? (
              <>
                <button
                  type="button"
                  className="fc-ram-btn fc-ram-btn-danger"
                  onClick={() => setShowRejectPrompt(true)}
                  disabled={isApproving || isRejecting}
                >
                  Reject Replacement…
                </button>
                <button
                  type="button"
                  className="fc-ram-btn fc-ram-btn-success"
                  onClick={handleApprove}
                  disabled={isApproving || isRejecting}
                >
                  {isApproving ? 'Approving…' : 'Approve Replacement'}
                </button>
              </>
            ) : null}
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
