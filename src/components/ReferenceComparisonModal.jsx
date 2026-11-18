import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSignedImageUrl } from '../services/imageUploadService.js';
import { getReferenceSignedUrl } from '../services/referenceImageService.js';
import { ImageComparisonSlider } from './ImageComparisonSlider.jsx';
import './ReferenceComparisonModal.css';

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function formatDims(dims) {
  if (!dims || !dims.width || !dims.height) return '';
  return `${dims.width} × ${dims.height} px`;
}

/**
 * Single Viewport Stage for Side-by-Side Mode.
 * Accurately centers the image inside the panel using flexbox viewport alignment,
 * automatically fits the image to the available stage space on load and resize,
 * and supports independent or synchronized zoom/pan.
 */
function SingleComparisonStage({
  title,
  subtitle,
  badgeText,
  badgeType = 'original', // 'original' | 'reference'
  imageUrl,
  isLoading,
  error,
  dimensions,
  onImageLoaded,
  zoom,
  pan,
  onZoomChange,
  onPanChange,
  onReset,
  onFit,
  syncActive = false,
}) {
  const stageRef = useRef(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ clientX: 0, clientY: 0, panX: 0, panY: 0 });

  // Observe stage container resize with ResizeObserver
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageSize((prev) =>
          Math.abs(prev.width - rect.width) < 1 && Math.abs(prev.height - rect.height) < 1
            ? prev
            : { width: rect.width, height: rect.height }
        );
      }
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => updateSize());
      ro.observe(el);
      return () => ro.disconnect();
    }

    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Compute mathematically correct fit-to-viewport scale factor
  const fitScale = useMemo(() => {
    if (!dimensions?.width || !dimensions?.height) return 1.0;
    const availW = Math.max(50, (stageSize.width || 600) - 32);
    const availH = Math.max(50, (stageSize.height || 400) - 32);
    return Math.min(availW / dimensions.width, availH / dimensions.height);
  }, [dimensions, stageSize]);

  // Initial automatic fit once natural dimensions and stage dimensions are available
  const hasAutoFittedRef = useRef(false);
  useEffect(() => {
    if (dimensions && stageSize.width > 0 && stageSize.height > 0 && !hasAutoFittedRef.current) {
      hasAutoFittedRef.current = true;
      onZoomChange(fitScale);
      onPanChange({ x: 0, y: 0 });
    }
  }, [dimensions, stageSize, fitScale, onZoomChange, onPanChange]);

  const handleMouseDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    isDraggingRef.current = true;
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    e.currentTarget.style.cursor = 'grabbing';
  };

  const handleMouseMove = (e) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.clientX;
    const dy = e.clientY - dragStartRef.current.clientY;
    const delta = {
      x: dx - (pan.x - dragStartRef.current.panX),
      y: dy - (pan.y - dragStartRef.current.panY),
    };
    onPanChange(
      {
        x: dragStartRef.current.panX + dx,
        y: dragStartRef.current.panY + dy,
      },
      delta
    );
  };

  const handleMouseUp = (e) => {
    isDraggingRef.current = false;
    if (e.currentTarget) {
      e.currentTarget.style.cursor = 'grab';
    }
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Mouse position relative to center of stage
    const mouseX = e.clientX - (rect.left + rect.width / 2);
    const mouseY = e.clientY - (rect.top + rect.height / 2);

    const delta = -e.deltaY * 0.0015;
    const nextZoom = clamp(zoom * (1 + delta), fitScale * 0.1, Math.max(15.0, fitScale * 15));
    const ratio = nextZoom / zoom;

    // Point under cursor remains anchored
    const nextPan = {
      x: mouseX - (mouseX - pan.x) * ratio,
      y: mouseY - (mouseY - pan.y) * ratio,
    };

    onZoomChange(nextZoom, ratio);
    onPanChange(nextPan);
  };

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="fc-cmp-pane">
      {/* Pane Subheader */}
      <div className="fc-cmp-pane-header">
        <div className="fc-cmp-pane-title-group">
          <span className={`fc-cmp-badge fc-cmp-badge-${badgeType}`}>
            {badgeText}
          </span>
          <span className="fc-cmp-pane-title" title={title}>
            {title}
          </span>
          {subtitle ? (
            <span className="fc-cmp-pane-subtitle" title={subtitle}>
              {subtitle}
            </span>
          ) : null}
        </div>

        <div className="fc-cmp-pane-controls">
          {dimensions ? (
            <span className="fc-cmp-meta-dims">{formatDims(dimensions)}</span>
          ) : null}

          <div className="fc-cmp-zoom-btn-group" role="group" aria-label="Zoom controls">
            <button
              type="button"
              className="fc-cmp-tool-btn"
              onClick={() => {
                const nextZ = clamp(zoom * 0.8, fitScale * 0.1, 15.0);
                onZoomChange(nextZ, nextZ / zoom);
              }}
              title="Zoom out"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="fc-cmp-zoom-readout">{zoomPercent}%</span>
            <button
              type="button"
              className="fc-cmp-tool-btn"
              onClick={() => {
                const nextZ = clamp(zoom * 1.25, fitScale * 0.1, 15.0);
                onZoomChange(nextZ, nextZ / zoom);
              }}
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="fc-cmp-tool-btn fc-cmp-tool-text-btn"
              onClick={() => {
                onFit?.(fitScale);
              }}
              title="Fit to available view"
            >
              Fit
            </button>
            <button
              type="button"
              className="fc-cmp-tool-btn fc-cmp-tool-text-btn"
              onClick={() => {
                onZoomChange(1.0, 1.0 / zoom);
                onPanChange({ x: 0, y: 0 });
              }}
              title="100% native resolution"
            >
              100%
            </button>
            <button
              type="button"
              className="fc-cmp-tool-btn"
              onClick={() => {
                onReset?.(fitScale);
              }}
              title="Reset position and zoom"
              aria-label="Reset position and zoom"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Pane Stage Canvas */}
      <div
        ref={stageRef}
        className="fc-cmp-stage"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{ cursor: 'grab' }}
      >
        {isLoading ? (
          <div className="fc-cmp-loading-state">
            <span className="fc-cmp-spinner" aria-hidden="true" />
            <span>Loading image…</span>
          </div>
        ) : error ? (
          <div className="fc-cmp-error-state">
            <span className="fc-cmp-error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        ) : imageUrl ? (
          <div className="fc-cmp-viewport">
            {/* Centered Image Frame */}
            <div
              className="fc-cmp-frame"
              style={{
                width: dimensions ? `${dimensions.width}px` : 'auto',
                height: dimensions ? `${dimensions.height}px` : 'auto',
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
            >
              <img
                src={imageUrl}
                alt={title}
                className="fc-cmp-img"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: 'block',
                }}
                onLoad={(e) => {
                  onImageLoaded?.({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  });
                }}
                draggable={false}
              />
            </div>
          </div>
        ) : null}

        {syncActive ? (
          <div className="fc-cmp-sync-indicator" title="Synchronized Zoom & Pan active">
            🔗 Synced
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Reference Comparison Modal
 * Provides Side-by-Side (default) and Overlay inspection modes for reviewing
 * the original batch image against an attached reference image.
 */
export function ReferenceComparisonModal({
  isOpen,
  originalImage,
  currentReference,
  allReferences = [],
  allAnnotations = [],
  onSelectReference,
  onClose,
  initialMode = 'slider',
}) {
  // Mode: 'slider' | 'side-by-side' | 'overlay'
  const [mode, setMode] = useState(initialMode);

  // Before/After slider viewport state
  const [sliderZoom, setSliderZoom] = useState(1);
  const [sliderPan, setSliderPan] = useState({ x: 0, y: 0 });
  const [sliderPosition, setSliderPosition] = useState(50);
  const [sliderOrientation, setSliderOrientation] = useState('vertical');
  const [sliderSwapped, setSliderSwapped] = useState(false);

  // Side-by-side viewports state
  const [leftZoom, setLeftZoom] = useState(1);
  const [leftPan, setLeftPan] = useState({ x: 0, y: 0 });
  const [rightZoom, setRightZoom] = useState(1);
  const [rightPan, setRightPan] = useState({ x: 0, y: 0 });
  const [syncPanZoom, setSyncPanZoom] = useState(false);

  // Overlay viewport state
  const [overlayZoom, setOverlayZoom] = useState(1);
  const [overlayPan, setOverlayPan] = useState({ x: 0, y: 0 });
  const [overlayOpacity, setOverlayOpacity] = useState(50); // 0 to 100
  const [overlayOffset, setOverlayOffset] = useState({ x: 0, y: 0 }); // In unscaled image coordinates
  const [isRepositioning, setIsRepositioning] = useState(false);
  const [isBlinking, setIsBlinking] = useState(false);
  const [blinkPhase, setBlinkPhase] = useState('overlay'); // 'overlay' | 'original'
  const [isHoldingOriginal, setIsHoldingOriginal] = useState(false);

  // URLs & natural dimensions
  const [origUrl, setOrigUrl] = useState('');
  const [origLoading, setOrigLoading] = useState(false);
  const [origError, setOrigError] = useState('');
  const [origDims, setOrigDims] = useState(null);

  const [refUrl, setRefUrl] = useState('');
  const [refLoading, setRefLoading] = useState(false);
  const [refError, setRefError] = useState('');
  const [refDims, setRefDims] = useState(null);

  // Overlay stage measurement
  const overlayStageRef = useRef(null);
  const [overlayStageSize, setOverlayStageSize] = useState({ width: 0, height: 0 });
  const overlayDragRef = useRef(false);
  const overlayDragStartRef = useRef({ clientX: 0, clientY: 0, panX: 0, panY: 0, offX: 0, offY: 0 });

  // Load original image signed URL
  useEffect(() => {
    if (!isOpen || !originalImage?.storage_path) return undefined;
    let isCancelled = false;
    setOrigLoading(true);
    setOrigError('');

    getSignedImageUrl(originalImage.storage_path)
      .then((url) => {
        if (!isCancelled) {
          setOrigUrl(url);
          setOrigLoading(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setOrigError(err?.message || 'Could not load original image.');
          setOrigLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, originalImage?.storage_path]);

  // Load reference image signed URL when currentReference changes
  useEffect(() => {
    if (!isOpen || !currentReference?.storagePath) return undefined;
    let isCancelled = false;
    setRefLoading(true);
    setRefError('');

    getReferenceSignedUrl(currentReference.storagePath)
      .then((url) => {
        if (!isCancelled) {
          setRefUrl(url);
          setRefLoading(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setRefError(err?.message || 'Could not load reference image.');
          setRefLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, currentReference?.storagePath]);

  // Track Overlay Stage container size via ResizeObserver
  useEffect(() => {
    if (!isOpen || mode !== 'overlay') return undefined;
    const el = overlayStageRef.current;
    if (!el) return undefined;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setOverlayStageSize((prev) =>
          Math.abs(prev.width - rect.width) < 1 && Math.abs(prev.height - rect.height) < 1
            ? prev
            : { width: rect.width, height: rect.height }
        );
      }
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => updateSize());
      ro.observe(el);
      return () => ro.disconnect();
    }

    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [isOpen, mode]);

  // Calculate overlay layout dimensions
  const baseW = origDims?.width || 800;
  const baseH = origDims?.height || 600;

  // Contain-fitted dimensions of reference overlay within the base original frame
  const { refDisplayW, refDisplayH } = useMemo(() => {
    if (!refDims?.width || !refDims?.height || !origDims?.width || !origDims?.height) {
      return { refDisplayW: baseW, refDisplayH: baseH };
    }
    // If dimensions match exactly, 1:1 pixel registration
    if (refDims.width === origDims.width && refDims.height === origDims.height) {
      return { refDisplayW: origDims.width, refDisplayH: origDims.height };
    }
    // Proportional contain fit inside original canvas bounds without distortion
    const scaleToFitOrig = Math.min(
      origDims.width / refDims.width,
      origDims.height / refDims.height
    );
    return {
      refDisplayW: Math.round(refDims.width * scaleToFitOrig),
      refDisplayH: Math.round(refDims.height * scaleToFitOrig),
    };
  }, [refDims, origDims, baseW, baseH]);

  // Scale factor to fit the entire shared overlay stage into available viewport
  const overlayFitScale = useMemo(() => {
    if (!origDims?.width || !origDims?.height) return 1.0;
    const availW = Math.max(50, (overlayStageSize.width || 800) - 40);
    const availH = Math.max(50, (overlayStageSize.height || 600) - 40);
    return Math.min(availW / origDims.width, availH / origDims.height);
  }, [origDims, overlayStageSize]);

  // Auto-fit overlay stage upon opening overlay mode or loading images
  const overlayAutoFittedRef = useRef(false);
  useEffect(() => {
    if (
      mode === 'overlay' &&
      origDims &&
      refDims &&
      overlayStageSize.width > 0 &&
      overlayStageSize.height > 0 &&
      !overlayAutoFittedRef.current
    ) {
      overlayAutoFittedRef.current = true;
      setOverlayZoom(overlayFitScale);
      setOverlayPan({ x: 0, y: 0 });
      setOverlayOffset({ x: 0, y: 0 });
    }
  }, [mode, origDims, refDims, overlayStageSize, overlayFitScale]);

  // Reset overlay auto-fit flag when switching references
  useEffect(() => {
    overlayAutoFittedRef.current = false;
    setOverlayOffset({ x: 0, y: 0 });
  }, [currentReference?.id]);

  // Keyboard navigation, Escape, and arrow-key nudging
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // In overlay mode when repositioning, arrow keys nudge alignment
      if (mode === 'overlay' && isRepositioning) {
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setOverlayOffset((prev) => ({ ...prev, x: prev.x - step }));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setOverlayOffset((prev) => ({ ...prev, x: prev.x + step }));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setOverlayOffset((prev) => ({ ...prev, y: prev.y - step }));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setOverlayOffset((prev) => ({ ...prev, y: prev.y + step }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, mode, isRepositioning, onClose]);

  // Blink comparator interval
  useEffect(() => {
    if (!isBlinking || mode !== 'overlay') return undefined;
    const interval = setInterval(() => {
      setBlinkPhase((prev) => (prev === 'overlay' ? 'original' : 'overlay'));
    }, 400);
    return () => clearInterval(interval);
  }, [isBlinking, mode]);

  // Group references into image-level and annotation-level
  const { imageLevelRefs, annotationRefsGrouped, currentIndex } = useMemo(() => {
    const imgLevel = [];
    const byAnnotationMap = new Map();

    for (const ref of allReferences) {
      if (!ref.annotationId) {
        imgLevel.push(ref);
      } else {
        if (!byAnnotationMap.has(ref.annotationId)) {
          const ann = allAnnotations.find((a) => a.id === ref.annotationId) || {
            id: ref.annotationId,
            displayNumber: '?',
            comment: '',
          };
          byAnnotationMap.set(ref.annotationId, { annotation: ann, refs: [] });
        }
        byAnnotationMap.get(ref.annotationId).refs.push(ref);
      }
    }

    const annGrouped = Array.from(byAnnotationMap.values());
    const idx = allReferences.findIndex((r) => r.id === currentReference?.id);

    return {
      imageLevelRefs: imgLevel,
      annotationRefsGrouped: annGrouped,
      currentIndex: idx >= 0 ? idx : 0,
    };
  }, [allReferences, allAnnotations, currentReference?.id]);

  const activeParentAnnotation = useMemo(() => {
    if (!currentReference?.annotationId) return null;
    return (
      allAnnotations.find((a) => a.id === currentReference.annotationId) || null
    );
  }, [currentReference?.annotationId, allAnnotations]);

  // Cycle references handlers
  const handlePrevRef = useCallback(() => {
    if (allReferences.length <= 1) return;
    const prevIdx = (currentIndex - 1 + allReferences.length) % allReferences.length;
    onSelectReference(allReferences[prevIdx]);
  }, [allReferences, currentIndex, onSelectReference]);

  const handleNextRef = useCallback(() => {
    if (allReferences.length <= 1) return;
    const nextIdx = (currentIndex + 1) % allReferences.length;
    onSelectReference(allReferences[nextIdx]);
  }, [allReferences, currentIndex, onSelectReference]);

  // Synchronized Zoom/Pan Handlers
  const handleLeftZoom = (z, ratio) => {
    setLeftZoom(z);
    if (syncPanZoom && ratio) {
      setRightZoom((prev) => clamp(prev * ratio, 0.05, 20.0));
    }
  };
  const handleLeftPan = (p, delta) => {
    setLeftPan(p);
    if (syncPanZoom && delta) {
      setRightPan((prev) => ({ x: prev.x + delta.x, y: prev.y + delta.y }));
    }
  };
  const handleRightZoom = (z, ratio) => {
    setRightZoom(z);
    if (syncPanZoom && ratio) {
      setLeftZoom((prev) => clamp(prev * ratio, 0.05, 20.0));
    }
  };
  const handleRightPan = (p, delta) => {
    setRightPan(p);
    if (syncPanZoom && delta) {
      setLeftPan((prev) => ({ x: prev.x + delta.x, y: prev.y + delta.y }));
    }
  };

  const handleResetBoth = (fitScale) => {
    const scale = fitScale || 1.0;
    setLeftZoom(scale);
    setLeftPan({ x: 0, y: 0 });
    setRightZoom(scale);
    setRightPan({ x: 0, y: 0 });
  };

  const handleFitBoth = () => {
    // Left and right stages each fit their respective images
    if (origDims && refDims) {
      const availW = 600;
      const availH = 400;
      const lFit = Math.min(availW / origDims.width, availH / origDims.height);
      const rFit = Math.min(availW / refDims.width, availH / refDims.height);
      setLeftZoom(lFit);
      setLeftPan({ x: 0, y: 0 });
      setRightZoom(rFit);
      setRightPan({ x: 0, y: 0 });
    }
  };

  // Overlay dragging and wheel events
  const handleOverlayMouseDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    overlayDragRef.current = true;
    overlayDragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: overlayPan.x,
      panY: overlayPan.y,
      offX: overlayOffset.x,
      offY: overlayOffset.y,
    };
    e.currentTarget.style.cursor = isRepositioning ? 'grabbing' : 'grabbing';
  };

  const handleOverlayMouseMove = (e) => {
    if (!overlayDragRef.current) return;
    const dx = e.clientX - overlayDragStartRef.current.clientX;
    const dy = e.clientY - overlayDragStartRef.current.clientY;

    if (isRepositioning) {
      // Reposition reference overlay in unscaled image coordinates
      const currentZoom = overlayZoom || 1.0;
      setOverlayOffset({
        x: Math.round(overlayDragStartRef.current.offX + dx / currentZoom),
        y: Math.round(overlayDragStartRef.current.offY + dy / currentZoom),
      });
    } else {
      // Pan the shared stage
      setOverlayPan({
        x: overlayDragStartRef.current.panX + dx,
        y: overlayDragStartRef.current.panY + dy,
      });
    }
  };

  const handleOverlayMouseUp = (e) => {
    overlayDragRef.current = false;
    if (e.currentTarget) {
      e.currentTarget.style.cursor = isRepositioning ? 'move' : 'grab';
    }
  };

  const handleOverlayWheel = (e) => {
    e.preventDefault();
    const rect = overlayStageRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - (rect.left + rect.width / 2);
    const mouseY = e.clientY - (rect.top + rect.height / 2);

    const delta = -e.deltaY * 0.0015;
    const nextZoom = clamp(
      overlayZoom * (1 + delta),
      overlayFitScale * 0.1,
      Math.max(15.0, overlayFitScale * 15)
    );
    const ratio = nextZoom / overlayZoom;

    setOverlayZoom(nextZoom);
    setOverlayPan({
      x: mouseX - (mouseX - overlayPan.x) * ratio,
      y: mouseY - (mouseY - overlayPan.y) * ratio,
    });
  };

  if (!isOpen || !originalImage || !currentReference) return null;

  // Effective opacity calculation
  const effectiveOpacity = isHoldingOriginal
    ? 0
    : isBlinking && blinkPhase === 'original'
    ? 0
    : overlayOpacity / 100;

  return (
    <div
      className="fc-cmp-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Reference image comparison workspace"
    >
      {/* Top Workspace Header Bar */}
      <header className="fc-cmp-header">
        <div className="fc-cmp-header-left">
          <button
            type="button"
            className="fc-cmp-back-btn"
            onClick={onClose}
            title="Return to review workspace (Esc)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back to Review</span>
          </button>

          <div className="fc-cmp-header-title-block">
            <h2 className="fc-cmp-header-title">Reference Comparison</h2>
            <span className="fc-cmp-header-context">
              Image #{originalImage.display_order || 1}:{' '}
              <strong>{originalImage.original_filename}</strong>
            </span>
          </div>
        </div>

        {/* Center: Mode Switcher & Tools */}
        <div className="fc-cmp-header-center">
          <div className="fc-cmp-mode-segmented" role="tablist" aria-label="Comparison mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'slider'}
              className={`fc-cmp-mode-tab${mode === 'slider' ? ' active' : ''}`}
              onClick={() => setMode('slider')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="2 2" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
              <span>Before/After Slider</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'side-by-side'}
              className={`fc-cmp-mode-tab${mode === 'side-by-side' ? ' active' : ''}`}
              onClick={() => setMode('side-by-side')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="9" height="18" rx="2" />
                <rect x="13" y="3" width="9" height="18" rx="2" />
              </svg>
              <span>Side-by-Side</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'overlay'}
              className={`fc-cmp-mode-tab${mode === 'overlay' ? ' active' : ''}`}
              onClick={() => setMode('overlay')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
              <span>Overlay Blend</span>
            </button>
          </div>

          {mode === 'slider' ? (
            <div className="fc-cmp-slider-header-tools">
              <div className="fc-cmp-slider-presets" role="group" aria-label="Split presets">
                <button
                  type="button"
                  className={`fc-cmp-preset-btn${Math.abs(sliderPosition - 0) < 1 ? ' active' : ''}`}
                  onClick={() => setSliderPosition(0)}
                  title="Reveal 100% After"
                >
                  0%
                </button>
                <button
                  type="button"
                  className={`fc-cmp-preset-btn${Math.abs(sliderPosition - 25) < 1 ? ' active' : ''}`}
                  onClick={() => setSliderPosition(25)}
                  title="25% split"
                >
                  25%
                </button>
                <button
                  type="button"
                  className={`fc-cmp-preset-btn${Math.abs(sliderPosition - 50) < 1 ? ' active' : ''}`}
                  onClick={() => setSliderPosition(50)}
                  title="50% centered split"
                >
                  50%
                </button>
                <button
                  type="button"
                  className={`fc-cmp-preset-btn${Math.abs(sliderPosition - 75) < 1 ? ' active' : ''}`}
                  onClick={() => setSliderPosition(75)}
                  title="75% split"
                >
                  75%
                </button>
                <button
                  type="button"
                  className={`fc-cmp-preset-btn${Math.abs(sliderPosition - 100) < 1 ? ' active' : ''}`}
                  onClick={() => setSliderPosition(100)}
                  title="Reveal 100% Before"
                >
                  100%
                </button>
              </div>

              <button
                type="button"
                className={`fc-cmp-tool-toggle-btn${sliderSwapped ? ' active' : ''}`}
                onClick={() => setSliderSwapped((prev) => !prev)}
                title="Swap Before and After image sides"
              >
                ⇄ Swap Sides
              </button>

              <button
                type="button"
                className="fc-cmp-tool-toggle-btn"
                onClick={() =>
                  setSliderOrientation((prev) => (prev === 'vertical' ? 'horizontal' : 'vertical'))
                }
                title="Toggle split orientation"
              >
                {sliderOrientation === 'vertical' ? '⬍ Horizontal' : '⬌ Vertical'}
              </button>
            </div>
          ) : mode === 'side-by-side' ? (
            <div className="fc-cmp-sync-group">
              <button
                type="button"
                className={`fc-cmp-sync-toggle-btn${syncPanZoom ? ' active' : ''}`}
                onClick={() => setSyncPanZoom((prev) => !prev)}
                title={
                  syncPanZoom
                    ? 'Click to unlock zoom/pan (independent control)'
                    : 'Click to link zoom/pan on both images'
                }
              >
                <span>🔗 Sync Pan & Zoom</span>
                <span className={`fc-cmp-sync-status-dot${syncPanZoom ? ' on' : ''}`} />
              </button>

              <button
                type="button"
                className="fc-cmp-btn-subtle"
                onClick={handleFitBoth}
                title="Fit both images to screen"
              >
                Fit Both
              </button>
              <button
                type="button"
                className="fc-cmp-btn-subtle"
                onClick={() => handleResetBoth(1.0)}
                title="Reset zoom and pan on both images"
              >
                Reset Both
              </button>
            </div>
          ) : (
            <div className="fc-cmp-overlay-tools">
              {/* Opacity Slider */}
              <div className="fc-cmp-opacity-group">
                <label htmlFor="fc-cmp-opacity-slider" className="fc-cmp-tool-label">
                  Opacity
                </label>
                <input
                  id="fc-cmp-opacity-slider"
                  type="range"
                  min="0"
                  max="100"
                  value={overlayOpacity}
                  onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                  className="fc-cmp-opacity-slider"
                  aria-label="Reference image overlay opacity"
                />
                <span className="fc-cmp-opacity-val">{overlayOpacity}%</span>

                {/* Quick Presets */}
                <div className="fc-cmp-preset-btns">
                  <button
                    type="button"
                    className="fc-cmp-preset-btn"
                    onClick={() => setOverlayOpacity(0)}
                    title="0% (Show Original only)"
                  >
                    Orig
                  </button>
                  <button
                    type="button"
                    className="fc-cmp-preset-btn"
                    onClick={() => setOverlayOpacity(50)}
                    title="50% Blend"
                  >
                    50%
                  </button>
                  <button
                    type="button"
                    className="fc-cmp-preset-btn"
                    onClick={() => setOverlayOpacity(100)}
                    title="100% (Show Reference only)"
                  >
                    Ref
                  </button>
                </div>
              </div>

              {/* Blink Comparator Button */}
              <button
                type="button"
                className={`fc-cmp-tool-toggle-btn${isBlinking ? ' active' : ''}`}
                onClick={() => setIsBlinking((prev) => !prev)}
                title="Toggle rapid blink comparator between original and reference"
              >
                ⚡ Blink {isBlinking ? 'ON' : 'OFF'}
              </button>

              {/* Hold to View Original */}
              <button
                type="button"
                className="fc-cmp-tool-toggle-btn"
                onMouseDown={() => setIsHoldingOriginal(true)}
                onMouseUp={() => setIsHoldingOriginal(false)}
                onMouseLeave={() => setIsHoldingOriginal(false)}
                onTouchStart={() => setIsHoldingOriginal(true)}
                onTouchEnd={() => setIsHoldingOriginal(false)}
                title="Press and hold to temporarily reveal original image"
              >
                Hold for Orig
              </button>

              {/* Reposition Mode Toggle */}
              <button
                type="button"
                className={`fc-cmp-tool-toggle-btn${isRepositioning ? ' active' : ''}`}
                onClick={() => setIsRepositioning((prev) => !prev)}
                title="When enabled, dragging moves only the reference overlay for alignment"
              >
                ✥ Reposition
              </button>

              {/* Offset readout & Reset */}
              {(overlayOffset.x !== 0 || overlayOffset.y !== 0) && (
                <div className="fc-cmp-offset-badge">
                  <span>
                    Offset: {overlayOffset.x > 0 ? `+${overlayOffset.x}` : overlayOffset.x}px,{' '}
                    {overlayOffset.y > 0 ? `+${overlayOffset.y}` : overlayOffset.y}px
                  </span>
                  <button
                    type="button"
                    className="fc-cmp-reset-offset-btn"
                    onClick={() => setOverlayOffset({ x: 0, y: 0 })}
                    title="Reset overlay alignment to center"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Reference Selection Switcher */}
        <div className="fc-cmp-header-right">
          <div className="fc-cmp-ref-switcher" role="group" aria-label="Reference selector">
            <button
              type="button"
              className="fc-cmp-cycle-btn"
              onClick={handlePrevRef}
              disabled={allReferences.length <= 1}
              title="Previous reference"
              aria-label="Previous reference"
            >
              ◀
            </button>

            <select
              className="fc-cmp-ref-select"
              value={currentReference.id}
              onChange={(e) => {
                const found = allReferences.find((r) => r.id === e.target.value);
                if (found) onSelectReference(found);
              }}
              aria-label="Select reference to compare"
            >
              {imageLevelRefs.length > 0 && (
                <optgroup label="📌 Image-Level References">
                  {imageLevelRefs.map((r) => (
                    <option key={r.id} value={r.id}>
                      Image · {r.originalFilename}
                    </option>
                  ))}
                </optgroup>
              )}

              {annotationRefsGrouped.map(({ annotation, refs }) => (
                <optgroup
                  key={annotation.id}
                  label={`💬 Annotation #${annotation.displayNumber}${
                    annotation.comment
                      ? ` (${annotation.comment.slice(0, 24)}…)`
                      : ''
                  }`}
                >
                  {refs.map((r) => (
                    <option key={r.id} value={r.id}>
                      #{annotation.displayNumber} · {r.originalFilename}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <button
              type="button"
              className="fc-cmp-cycle-btn"
              onClick={handleNextRef}
              disabled={allReferences.length <= 1}
              title="Next reference"
              aria-label="Next reference"
            >
              ▶
            </button>
          </div>

          <span className="fc-cmp-ref-count-pill">
            {currentIndex + 1} of {allReferences.length}
          </span>
        </div>
      </header>

      {/* Main Comparison Canvas Stage */}
      <main className="fc-cmp-main">
        {mode === 'slider' ? (
          <ImageComparisonSlider
            originalUrl={origUrl}
            originalDims={origDims}
            originalTitle={originalImage.original_filename}
            originalSubtitle="Before"
            referenceUrl={refUrl}
            referenceDims={refDims}
            referenceTitle={currentReference.originalFilename}
            referenceSubtitle={
              activeParentAnnotation
                ? `Annotation #${activeParentAnnotation.displayNumber} Ref`
                : 'After'
            }
            offset={overlayOffset}
            isLoading={origLoading || refLoading}
            error={origError || refError}
            onOriginalLoaded={setOrigDims}
            onReferenceLoaded={setRefDims}
            sliderPosition={sliderPosition}
            onSliderPositionChange={setSliderPosition}
            orientation={sliderOrientation}
            onOrientationChange={setSliderOrientation}
            isSwapped={sliderSwapped}
            onToggleSwap={() => setSliderSwapped((prev) => !prev)}
            zoom={sliderZoom}
            pan={sliderPan}
            onZoomChange={setSliderZoom}
            onPanChange={setSliderPan}
            onResetView={(fs) => {
              setSliderZoom(fs || 1.0);
              setSliderPan({ x: 0, y: 0 });
            }}
            onFitView={(fs) => {
              setSliderZoom(fs || 1.0);
              setSliderPan({ x: 0, y: 0 });
            }}
          />
        ) : mode === 'side-by-side' ? (
          <div className="fc-cmp-split-view">
            {/* Left: Original Batch Image */}
            <SingleComparisonStage
              title={originalImage.original_filename}
              subtitle={`Batch Image #${originalImage.display_order || 1}`}
              badgeText="Original Image"
              badgeType="original"
              imageUrl={origUrl}
              isLoading={origLoading}
              error={origError}
              dimensions={origDims}
              onImageLoaded={setOrigDims}
              zoom={leftZoom}
              pan={leftPan}
              onZoomChange={handleLeftZoom}
              onPanChange={handleLeftPan}
              onReset={(fitScale) => {
                setLeftZoom(fitScale);
                setLeftPan({ x: 0, y: 0 });
              }}
              onFit={(fitScale) => {
                setLeftZoom(fitScale);
                setLeftPan({ x: 0, y: 0 });
              }}
              syncActive={syncPanZoom}
            />

            {/* Right: Attached Reference Image */}
            <SingleComparisonStage
              title={currentReference.originalFilename}
              subtitle={
                activeParentAnnotation
                  ? `Annotation #${activeParentAnnotation.displayNumber} · ${
                      activeParentAnnotation.comment
                        ? `"${activeParentAnnotation.comment.slice(0, 40)}…"`
                        : 'Review feedback'
                    }`
                  : `Image-level reference by ${currentReference.creatorName}`
              }
              badgeText={
                activeParentAnnotation
                  ? `Annotation #${activeParentAnnotation.displayNumber} Ref`
                  : 'Reference Image'
              }
              badgeType={activeParentAnnotation ? 'annotation' : 'reference'}
              imageUrl={refUrl}
              isLoading={refLoading}
              error={refError}
              dimensions={refDims}
              onImageLoaded={setRefDims}
              zoom={rightZoom}
              pan={rightPan}
              onZoomChange={handleRightZoom}
              onPanChange={handleRightPan}
              onReset={(fitScale) => {
                setRightZoom(fitScale);
                setRightPan({ x: 0, y: 0 });
              }}
              onFit={(fitScale) => {
                setRightZoom(fitScale);
                setRightPan({ x: 0, y: 0 });
              }}
              syncActive={syncPanZoom}
            />
          </div>
        ) : (
          /* Overlay Blend Mode */
          <div className="fc-cmp-overlay-view">
            <div className="fc-cmp-overlay-toolbar">
              <div className="fc-cmp-overlay-context-tags">
                <span className="fc-cmp-badge fc-cmp-badge-original">
                  Base: Original Image ({formatDims(origDims)})
                </span>
                <span className="fc-cmp-plus-symbol">+</span>
                <span
                  className={`fc-cmp-badge fc-cmp-badge-${
                    activeParentAnnotation ? 'annotation' : 'reference'
                  }`}
                >
                  Overlay: {currentReference.originalFilename} ({formatDims(refDims)})
                </span>

                {isRepositioning && (
                  <span className="fc-cmp-reposition-banner">
                    ✥ Reposition Mode: Drag overlay or use arrow keys to align
                  </span>
                )}
              </div>

              {/* Viewport Zoom Controls */}
              <div className="fc-cmp-zoom-btn-group">
                <button
                  type="button"
                  className="fc-cmp-tool-btn"
                  onClick={() => setOverlayZoom((z) => clamp(z * 0.8, overlayFitScale * 0.1, 15.0))}
                  title="Zoom out"
                >
                  −
                </button>
                <span className="fc-cmp-zoom-readout">
                  {Math.round(overlayZoom * 100)}%
                </span>
                <button
                  type="button"
                  className="fc-cmp-tool-btn"
                  onClick={() => setOverlayZoom((z) => clamp(z * 1.25, overlayFitScale * 0.1, 15.0))}
                  title="Zoom in"
                >
                  +
                </button>
                <button
                  type="button"
                  className="fc-cmp-tool-btn fc-cmp-tool-text-btn"
                  onClick={() => {
                    setOverlayZoom(overlayFitScale);
                    setOverlayPan({ x: 0, y: 0 });
                  }}
                  title="Fit to view"
                >
                  Fit
                </button>
                <button
                  type="button"
                  className="fc-cmp-tool-btn fc-cmp-tool-text-btn"
                  onClick={() => {
                    setOverlayZoom(1.0);
                    setOverlayPan({ x: 0, y: 0 });
                  }}
                  title="100% native size"
                >
                  100%
                </button>
                <button
                  type="button"
                  className="fc-cmp-tool-btn"
                  onClick={() => {
                    setOverlayZoom(overlayFitScale);
                    setOverlayPan({ x: 0, y: 0 });
                    setOverlayOffset({ x: 0, y: 0 });
                  }}
                  title="Reset all transforms and offsets"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Overlay Interactive Stage */}
            <div
              ref={overlayStageRef}
              className={`fc-cmp-stage fc-cmp-overlay-stage${isRepositioning ? ' fc-cmp-reposition-active' : ''}`}
              onMouseDown={handleOverlayMouseDown}
              onMouseMove={handleOverlayMouseMove}
              onMouseUp={handleOverlayMouseUp}
              onMouseLeave={handleOverlayMouseUp}
              onWheel={handleOverlayWheel}
              style={{ cursor: isRepositioning ? 'move' : 'grab' }}
            >
              {origLoading || refLoading ? (
                <div className="fc-cmp-loading-state">
                  <span className="fc-cmp-spinner" aria-hidden="true" />
                  <span>Loading comparison layers…</span>
                </div>
              ) : origError || refError ? (
                <div className="fc-cmp-error-state">
                  <span className="fc-cmp-error-icon">⚠️</span>
                  <span>{origError || refError}</span>
                </div>
              ) : (
                <div className="fc-cmp-viewport">
                  {/* Shared Frame: both images share this unified stage and transform origin */}
                  <div
                    className="fc-cmp-overlay-frame"
                    style={{
                      width: `${baseW}px`,
                      height: `${baseH}px`,
                      transform: `translate3d(${overlayPan.x}px, ${overlayPan.y}px, 0) scale(${overlayZoom})`,
                      transformOrigin: 'center center',
                    }}
                  >
                    {/* Layer 1: Base Original Image */}
                    {origUrl && (
                      <img
                        src={origUrl}
                        alt="Original base"
                        className="fc-cmp-base-layer"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: `${baseW}px`,
                          height: `${baseH}px`,
                          objectFit: 'contain',
                          display: 'block',
                          pointerEvents: 'none',
                          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.6)',
                          borderRadius: '2px',
                        }}
                        draggable={false}
                        onLoad={(e) => {
                          setOrigDims({
                            width: e.currentTarget.naturalWidth,
                            height: e.currentTarget.naturalHeight,
                          });
                        }}
                      />
                    )}

                    {/* Layer 2: Overlay Reference Image */}
                    {refUrl && (
                      <div
                        className="fc-cmp-ref-overlay-layer"
                        style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          width: `${refDisplayW}px`,
                          height: `${refDisplayH}px`,
                          transform: `translate(-50%, -50%) translate3d(${overlayOffset.x}px, ${overlayOffset.y}px, 0)`,
                          transformOrigin: 'center center',
                          opacity: effectiveOpacity,
                          pointerEvents: 'none',
                          transition: isRepositioning ? 'none' : 'opacity 80ms ease',
                        }}
                      >
                        <img
                          src={refUrl}
                          alt="Reference overlay"
                          className="fc-cmp-overlay-img"
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            display: 'block',
                          }}
                          draggable={false}
                          onLoad={(e) => {
                            setRefDims({
                              width: e.currentTarget.naturalWidth,
                              height: e.currentTarget.naturalHeight,
                            });
                          }}
                        />
                        {isRepositioning && (
                          <div className="fc-cmp-alignment-outline" aria-hidden="true" />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Drawer: Explanatory Reference Comment & Details */}
      {currentReference.comment || activeParentAnnotation?.comment ? (
        <footer className="fc-cmp-footer-note">
          <div className="fc-cmp-footer-content">
            <span className="fc-cmp-footer-icon" aria-hidden="true">💡</span>
            <div className="fc-cmp-footer-text">
              {currentReference.comment ? (
                <p className="fc-cmp-footer-ref-comment">
                  <strong>Reference Note:</strong> {currentReference.comment}
                </p>
              ) : null}
              {activeParentAnnotation?.comment ? (
                <p className="fc-cmp-footer-ann-comment">
                  <strong>Annotation #{activeParentAnnotation.displayNumber} Issue:</strong>{' '}
                  {activeParentAnnotation.comment}
                </p>
              ) : null}
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
