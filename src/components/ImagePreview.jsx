import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from 'react';
import { clamp } from '../services/annotationState.js';
import {
  formatFileSize,
  getFormatLabel,
  getSignedImageUrl,
} from '../services/imageUploadService.js';
import { ImageMagnifier } from './ImageMagnifier.jsx';
import './ImagePreview.css';

function clampPan(pan, scaledW, scaledH, stageW, stageH) {
  // Allow panning as long as at least 60px of the image remains visible in the viewport
  const boundX = Math.max(stageW / 2, (scaledW + stageW) / 2 - 60);
  const boundY = Math.max(stageH / 2, (scaledH + stageH) / 2 - 60);
  return {
    x: clamp(pan.x, -boundX, boundX),
    y: clamp(pan.y, -boundY, boundY),
  };
}

/**
 * Large preview stage for the currently selected batch image.
 * Supports aspect-ratio fit-to-screen, 100% native pixel size, smooth zoom in/out,
 * cursor-anchored mouse wheel zooming, spacebar/middle-click/pan-tool dragging,
 * and seamless coordinate locking for circle annotations.
 */
export function ImagePreview({
  image,
  imageIndex,
  totalImages,
  onPrev,
  onNext,
  variant = 'default',
  prepareAnnotationLayer = false,
  headerActions = null,
  toolbarSlot = null,
  annotationOverlay = null,
  toolMode = 'draw',
  readOnly = false,
  externalViewport = null,
  onViewportChange = null,
  onManualViewportInteraction = null,
  isFocusMode = false,
  onToggleFocusMode = null,
  onExitFocusMode = null,
  zoomPreference = 'fit',
  rotation = 0,
  onRotateCW = null,
  onRotateCCW = null,
  onResetRotation = null,
  isMagnifierActive = false,
  onToggleMagnifier = null,
  onSelectImageIndex = null,
  canUndo = false,
  canRedo = false,
  onUndo = null,
  onRedo = null,
}) {
  const [signedUrl, setSignedUrl] = useState('');
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [decodingImage, setDecodingImage] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [dimensions, setDimensions] = useState(null);

  // Magnifier internal toggle state
  const [internalMagnifier, setInternalMagnifier] = useState(false);
  const activeMagnifier = onToggleMagnifier ? isMagnifierActive : internalMagnifier;
  const handleToggleMagnifier = useCallback(() => {
    if (onToggleMagnifier) {
      onToggleMagnifier();
    } else {
      setInternalMagnifier((prev) => !prev);
    }
  }, [onToggleMagnifier]);

  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isFitMode, setIsFitMode] = useState(true);
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const stageRef = useRef(null);
  const viewportRef = useRef(null);
  const panStartRef = useRef(null);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const isFitModeRef = useRef(isFitMode);
  isFitModeRef.current = isFitMode;

  const preFocusViewportRef = useRef(null);
  const prevFocusModeRef = useRef(isFocusMode);

  // Automatically fit image into full canvas upon entering Focus Mode,
  // and restore previous workspace zoom/pan state upon exiting.
  useEffect(() => {
    if (prevFocusModeRef.current === isFocusMode) return;
    const wasFocusMode = prevFocusModeRef.current;
    prevFocusModeRef.current = isFocusMode;

    if (isFocusMode && !wasFocusMode) {
      preFocusViewportRef.current = {
        zoom: zoomRef.current,
        pan: { ...panRef.current },
        isFitMode: isFitModeRef.current,
      };
      onManualViewportInteraction?.();
      setIsFitMode(true);
      setPan({ x: 0, y: 0 });
    } else if (!isFocusMode && wasFocusMode) {
      onManualViewportInteraction?.();
      if (preFocusViewportRef.current) {
        const prev = preFocusViewportRef.current;
        preFocusViewportRef.current = null;
        if (prev.isFitMode) {
          setIsFitMode(true);
          setPan({ x: 0, y: 0 });
        } else {
          setIsFitMode(false);
          setZoom(prev.zoom);
          setPan(prev.pan);
        }
      } else {
        setIsFitMode(true);
        setPan({ x: 0, y: 0 });
      }
    }
  }, [isFocusMode, onManualViewportInteraction]);

  const loadSignedUrl = useCallback(async (storagePath, forceRefresh = false) => {
    setLoadingUrl(true);
    setDecodingImage(true);
    setErrorMessage('');
    setDimensions(null);
    setSignedUrl('');

    try {
      const nextUrl = await getSignedImageUrl(storagePath, { forceRefresh });
      return nextUrl;
    } catch (error) {
      setDecodingImage(false);
      throw error;
    } finally {
      setLoadingUrl(false);
    }
  }, []);

  useEffect(() => {
    if (!image?.storage_path) return undefined;

    let cancelled = false;

    loadSignedUrl(image.storage_path, false)
      .then((nextUrl) => {
        if (!cancelled) {
          setSignedUrl(nextUrl);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error?.message || 'Unable to load image preview.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [image?.storage_path, loadSignedUrl]);

  // Apply zoom preference on image switch
  useEffect(() => {
    if (zoomPreference === 'actual') {
      setPan({ x: 0, y: 0 });
      setZoom(1.0);
      setIsFitMode(false);
    } else if (zoomPreference === 'remember') {
      // Retain current zoom & pan when navigating across batch images
      if (isFitModeRef.current) {
        setPan({ x: 0, y: 0 });
        setIsFitMode(true);
      }
    } else {
      // Default 'fit' mode
      setPan({ x: 0, y: 0 });
      setIsFitMode(true);
    }
  }, [image?.id, zoomPreference]);

  // Observe stage container resize (e.g. panel collapse/expand or window resize)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const updateStageSize = () => {
      const rect = stage.getBoundingClientRect();
      setStageSize((prev) =>
        Math.abs(prev.width - rect.width) < 1 && Math.abs(prev.height - rect.height) < 1
          ? prev
          : { width: rect.width, height: rect.height }
      );
    };

    updateStageSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateStageSize);
      return () => window.removeEventListener('resize', updateStageSize);
    }

    const observer = new ResizeObserver(() => {
      updateStageSize();
    });
    observer.observe(stage);

    return () => observer.disconnect();
  }, []);

  // Compute fitted dimensions and zoom factors
  const stageWidth = stageSize.width || 800;
  const stageHeight = stageSize.height || 600;
  const availW = Math.max(100, stageWidth - 32);
  const availH = Math.max(100, stageHeight - 32);

  const isRotatedPerpendicular = rotation % 180 !== 0;
  const effectiveW = dimensions
    ? isRotatedPerpendicular
      ? dimensions.height
      : dimensions.width
    : 800;
  const effectiveH = dimensions
    ? isRotatedPerpendicular
      ? dimensions.width
      : dimensions.height
    : 600;

  const fitScale = dimensions
    ? Math.min(availW / effectiveW, availH / effectiveH)
    : 1;

  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const minZoom = Math.min(0.25, fitScale);
  const maxZoom = Math.max(5.0, fitScale * 5);

  const effectiveZoom = isFitMode ? fitScale : zoom;
  const baseWidth = dimensions ? Math.round(dimensions.width * fitScale) : 0;
  const baseHeight = dimensions ? Math.round(dimensions.height * fitScale) : 0;
  const scale = fitScale > 0 ? effectiveZoom / fitScale : 1;

  // Zoom control handlers
  const handleZoomIn = useCallback(() => {
    onManualViewportInteraction?.();
    setZoom((curr) => {
      const activeZoom = isFitModeRef.current ? fitScaleRef.current : curr;
      const target = Math.floor(activeZoom / 0.25 + 0.001) * 0.25 + 0.25;
      const nextZoom = clamp(target, minZoom, maxZoom);
      const ratio = nextZoom / activeZoom;
      setPan((prev) => ({ x: prev.x * ratio, y: prev.y * ratio }));
      return nextZoom;
    });
    setIsFitMode(false);
  }, [minZoom, maxZoom, onManualViewportInteraction]);

  const handleZoomOut = useCallback(() => {
    onManualViewportInteraction?.();
    setZoom((curr) => {
      const activeZoom = isFitModeRef.current ? fitScaleRef.current : curr;
      const target = Math.ceil(activeZoom / 0.25 - 0.001) * 0.25 - 0.25;
      const nextZoom = clamp(target, minZoom, maxZoom);
      const ratio = nextZoom / activeZoom;
      setPan((prev) => ({ x: prev.x * ratio, y: prev.y * ratio }));
      return nextZoom;
    });
    setIsFitMode(false);
  }, [minZoom, maxZoom, onManualViewportInteraction]);

  const handleFitToScreen = useCallback(() => {
    onManualViewportInteraction?.();
    setIsFitMode(true);
    setZoom(fitScaleRef.current);
    setPan({ x: 0, y: 0 });
  }, [onManualViewportInteraction]);

  const handleActualSize = useCallback(() => {
    onManualViewportInteraction?.();
    setIsFitMode(false);
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  }, [onManualViewportInteraction]);

  const handleResetView = useCallback(() => {
    onManualViewportInteraction?.();
    setIsFitMode(true);
    setZoom(fitScaleRef.current);
    setPan({ x: 0, y: 0 });
  }, [onManualViewportInteraction]);

  // External viewport synchronization when following a reviewer
  useEffect(() => {
    if (!externalViewport) return;
    if (externalViewport.isFitMode) {
      setIsFitMode(true);
      setPan({ x: 0, y: 0 });
    } else {
      setIsFitMode(false);
      if (typeof externalViewport.zoom === 'number') {
        setZoom(clamp(externalViewport.zoom, minZoom, maxZoom));
      }
      if (externalViewport.pan) {
        setPan({
          x: externalViewport.pan.x || 0,
          y: externalViewport.pan.y || 0,
        });
      }
    }
  }, [externalViewport, minZoom, maxZoom]);

  // Viewport broadcast change notification (only when not following)
  useEffect(() => {
    if (typeof onViewportChange === 'function' && !externalViewport) {
      onViewportChange({
        zoom: effectiveZoom,
        pan,
        isFitMode,
      });
    }
  }, [effectiveZoom, pan.x, pan.y, isFitMode, onViewportChange, externalViewport]);

  // Cursor-anchored mouse wheel zoom with passive: false to prevent page scrolling
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    const onWheel = (event) => {
      event.preventDefault();
      onManualViewportInteraction?.();

      const rect = viewport.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;

      // Mouse position relative to viewport center
      const vx = event.clientX - rect.left - W / 2;
      const vy = event.clientY - rect.top - H / 2;

      const currentZoom = isFitModeRef.current ? fitScaleRef.current : zoomRef.current;
      const currentPan = panRef.current;

      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      const currentMinZoom = Math.min(0.25, fitScaleRef.current);
      const currentMaxZoom = Math.max(5.0, fitScaleRef.current * 5);

      const nextZoom = clamp(currentZoom * factor, currentMinZoom, currentMaxZoom);
      if (Math.abs(nextZoom - currentZoom) < 0.0001) return;

      const ratio = nextZoom / currentZoom;
      const nextPanX = vx - (vx - currentPan.x) * ratio;
      const nextPanY = vy - (vy - currentPan.y) * ratio;

      setZoom(nextZoom);
      setPan({ x: nextPanX, y: nextPanY });
      setIsFitMode(false);
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Spacebar pan listener and zoom keyboard shortcuts
  useEffect(() => {
    const isInputFocused = () => {
      const active = document.activeElement;
      if (!active) return false;
      const tag = active.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || active.isContentEditable;
    };

    const handleKeyDown = (event) => {
      if (isInputFocused()) return;

      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        setIsSpacePressed(true);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        handleZoomIn();
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        handleZoomOut();
      } else if (event.key === '0') {
        event.preventDefault();
        handleFitToScreen();
      } else if (event.key === '1') {
        event.preventDefault();
        handleActualSize();
      } else if (
        (event.key === 'z' || event.key === 'Z') &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        handleToggleMagnifier();
      } else if (
        event.key === '[' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        onRotateCCW
      ) {
        event.preventDefault();
        onRotateCCW();
      } else if (
        event.key === ']' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        onRotateCW
      ) {
        event.preventDefault();
        onRotateCW();
      }
    };

    const handleKeyUp = (event) => {
      if (event.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    const handleBlur = () => {
      setIsSpacePressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [
    handleZoomIn,
    handleZoomOut,
    handleFitToScreen,
    handleActualSize,
    handleToggleMagnifier,
    onRotateCCW,
    onRotateCW,
  ]);

  // Pan drag pointer handlers
  const handleViewportPointerDown = (event) => {
    const isPanTool = toolMode === 'pan';
    const isMiddleClick = event.button === 1;
    const isSpacePan = isSpacePressed && event.button === 0;
    const isReadOnlyPan = readOnly && event.button === 0;

    if (isPanTool || isMiddleClick || isSpacePan || isReadOnlyPan) {
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
      panStartRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        initPanX: pan.x,
        initPanY: pan.y,
      };
      setIsPanning(true);
    }
  };

  const handleViewportPointerMove = (event) => {
    if (!panStartRef.current || panStartRef.current.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - panStartRef.current.startX;
    const dy = event.clientY - panStartRef.current.startY;

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      onManualViewportInteraction?.();
    }

    const scaledW = baseWidth * scale;
    const scaledH = baseHeight * scale;

    const nextPan = clampPan(
      {
        x: panStartRef.current.initPanX + dx,
        y: panStartRef.current.initPanY + dy,
      },
      scaledW,
      scaledH,
      stageWidth,
      stageHeight
    );

    setPan(nextPan);
  };

  const handleViewportPointerUp = (event) => {
    if (panStartRef.current && panStartRef.current.pointerId === event.pointerId) {
      panStartRef.current = null;
      setIsPanning(false);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {}
    }
  };

  const handleViewportPointerCancel = (event) => {
    if (panStartRef.current && panStartRef.current.pointerId === event.pointerId) {
      panStartRef.current = null;
      setIsPanning(false);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {}
    }
  };

  const handleRetry = () => {
    if (!image?.storage_path) return;
    loadSignedUrl(image.storage_path, true)
      .then((nextUrl) => {
        setSignedUrl(nextUrl);
      })
      .catch((error) => {
        setErrorMessage(error?.message || 'Unable to load image preview.');
      });
  };

  if (!image) {
    return null;
  }

  const isLoading = (loadingUrl || decodingImage) && !errorMessage;
  const isWorkspace = variant === 'workspace';

  const zoomControlProps = {
    zoom: effectiveZoom,
    zoomPercent: Math.round(effectiveZoom * 100),
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onFitToScreen: handleFitToScreen,
    onActualSize: handleActualSize,
    onResetView: handleResetView,
    isAtMinZoom: effectiveZoom <= minZoom,
    isAtMaxZoom: effectiveZoom >= maxZoom,
    toolMode,
    isSpacePressed,
    isFocusMode,
    onToggleFocusMode,
    onExitFocusMode,
    rotation,
    onRotateCW,
    onRotateCCW,
    onResetRotation,
    isMagnifierActive: activeMagnifier,
    onToggleMagnifier: handleToggleMagnifier,
  };

  const renderedToolbar =
    typeof toolbarSlot === 'function'
      ? toolbarSlot(zoomControlProps)
      : isValidElement(toolbarSlot)
        ? cloneElement(toolbarSlot, zoomControlProps)
        : toolbarSlot;

  const overlayProps = {
    zoom: effectiveZoom,
    scale,
    baseWidth,
    baseHeight,
    isPanning,
    isSpacePressed,
    rotation,
    isMagnifierActive: activeMagnifier,
  };

  const renderedOverlay =
    typeof annotationOverlay === 'function'
      ? annotationOverlay(overlayProps)
      : isValidElement(annotationOverlay)
        ? cloneElement(annotationOverlay, overlayProps)
        : annotationOverlay;

  const isPanActive = toolMode === 'pan' || isSpacePressed || readOnly;
  const viewportCursorClass = isPanning
    ? ' fc-canvas-viewport-panning'
    : isPanActive
      ? ' fc-canvas-viewport-pan-ready'
      : activeMagnifier
        ? ' fc-canvas-viewport-magnifier'
        : '';

  const frameClass = `fc-canvas-frame${decodingImage ? ' fc-preview-img-hidden' : ''}${
    isPanning ? ' fc-canvas-frame-interacting' : ''
  }`;

  const frameStyle =
    baseWidth > 0 && baseHeight > 0
      ? {
          width: `${baseWidth}px`,
          height: `${baseHeight}px`,
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale}) rotate(${rotation || 0}deg)`,
          transformOrigin: 'center center',
        }
      : undefined;

  return (
    <section
      className={`fc-preview-panel${isWorkspace ? ' fc-preview-workspace' : ''}${
        isFocusMode ? ' fc-preview-focus' : ''
      }`}
      aria-label="Selected image preview"
    >
      {!isFocusMode ? (
        <div className="fc-preview-toolbar">
          <div className="fc-preview-title-group">
            {!isWorkspace ? (
              <>
                <span className="fc-preview-counter">
                  Image {imageIndex + 1} of {totalImages}
                </span>
                {(image?.current_version_number || 1) > 1 && (
                  <span
                    className="fc-preview-version-pill"
                    title={`Active Version ${image.current_version_number}`}
                    aria-label={`Active Version ${image.current_version_number}`}
                  >
                    v{image.current_version_number}
                  </span>
                )}
              </>
            ) : null}
            {image?.replacement_status === 'pending_approval' && (
              <span
                className="fc-preview-pending-badge"
                title="A corrected replacement version is awaiting review"
                aria-label="Replacement Pending Approval"
              >
                ⚡ Replacement Pending
              </span>
            )}
          </div>

          <div className="fc-preview-nav-center">
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-sm"
              onClick={() => {
                onManualViewportInteraction?.();
                onPrev?.();
              }}
              disabled={imageIndex <= 0}
              title="Previous Image (PageUp or Alt+Left)"
              aria-label="Previous image"
            >
              Previous
            </button>
            <button
              type="button"
              className="fc-btn fc-btn-secondary fc-btn-sm"
              onClick={() => {
                onManualViewportInteraction?.();
                onNext?.();
              }}
              disabled={imageIndex >= totalImages - 1}
              title="Next Image (PageDown or Alt+Right)"
              aria-label="Next image"
            >
              Next
            </button>
          </div>

          <div className="fc-preview-nav">
            {/* History Controls: Undo & Redo */}
            {onUndo || onRedo ? (
              <div className="fc-nav-group fc-nav-history-group" role="group" aria-label="Undo and Redo">
                {onUndo ? (
                  <button
                    type="button"
                    className="fc-btn fc-btn-secondary fc-btn-sm fc-nav-icon-btn"
                    onClick={onUndo}
                    disabled={!canUndo}
                    title="Undo last action (Ctrl+Z)"
                    aria-label="Undo last action"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="4 7 1 4 4 1" />
                      <path d="M1 4h9a4 4 0 0 1 4 4v2" />
                    </svg>
                  </button>
                ) : null}
                {onRedo ? (
                  <button
                    type="button"
                    className="fc-btn fc-btn-secondary fc-btn-sm fc-nav-icon-btn"
                    onClick={onRedo}
                    disabled={!canRedo}
                    title="Redo last undone action (Ctrl+Y)"
                    aria-label="Redo last undone action"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="12 7 15 4 12 1" />
                      <path d="M15 4H6a4 4 0 0 0-4 4v2" />
                    </svg>
                  </button>
                ) : null}
              </div>
            ) : null}

            {onUndo || onRedo ? <span className="fc-toolbar-divider" aria-hidden="true" /> : null}

            {/* View Inspection Controls: Rotate, Loupe, Focus */}
            <div className="fc-nav-group fc-nav-view-group" role="group" aria-label="View controls">
              {onRotateCCW ? (
                <button
                  type="button"
                  className="fc-btn fc-btn-secondary fc-btn-sm fc-nav-icon-btn fc-nav-rot-btn"
                  onClick={onRotateCCW}
                  title="Rotate 90° CCW ([)"
                  aria-label="Rotate 90 degrees counter-clockwise"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                </button>
              ) : null}
              {onRotateCW ? (
                <button
                  type="button"
                  className="fc-btn fc-btn-secondary fc-btn-sm fc-nav-icon-btn fc-nav-rot-btn"
                  onClick={onRotateCW}
                  title="Rotate 90° CW (])"
                  aria-label="Rotate 90 degrees clockwise"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              ) : null}
              {rotation % 360 !== 0 && onResetRotation ? (
                <button
                  type="button"
                  className="fc-btn fc-btn-secondary fc-btn-sm fc-nav-rot-reset"
                  onClick={onResetRotation}
                  title="Reset rotation to 0°"
                  aria-label="Reset rotation to 0 degrees"
                >
                  {rotation}° ✕
                </button>
              ) : null}

              {/* Magnifier Loupe Toggle */}
              <button
                type="button"
                className={`fc-btn fc-btn-sm ${
                  activeMagnifier ? 'fc-btn-primary fc-nav-magnifier-active' : 'fc-btn-secondary'
                }`}
                onClick={handleToggleMagnifier}
                title="Magnifier Loupe Lens (Z)"
                aria-label="Toggle Magnifier Lens"
                aria-pressed={activeMagnifier}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.5" />
                  <line x1="10.5" y1="10.5" x2="14" y2="14" />
                </svg>
                <span className="fc-preview-btn-label">Loupe</span>
              </button>

              {/* Focus Mode Canvas Control */}
              {onToggleFocusMode ? (
                <button
                  type="button"
                  className={`fc-btn fc-btn-sm fc-nav-focus-btn${
                    isFocusMode ? ' fc-btn-primary fc-nav-focus-active' : ' fc-btn-secondary'
                  }`}
                  onClick={onToggleFocusMode}
                  title="Full-Screen Focus Mode (F) - Expand image to fill screen and hide panels"
                  aria-label="Full-Screen Focus Mode (F)"
                  aria-pressed={isFocusMode}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2 6V2h4m8 4V2h-4M2 10v4h4m8-4v4h-4" />
                  </svg>
                  <span className="fc-preview-btn-label">Focus</span>
                  <kbd className="fc-shortcut-kbd">F</kbd>
                </button>
              ) : null}
            </div>

            {headerActions ? <span className="fc-toolbar-divider" aria-hidden="true" /> : null}

            {/* Actions: More Menu, Status, Mark Completed */}
            {headerActions}
          </div>
        </div>
      ) : null}

      <div className="fc-preview-stage">
        <div ref={stageRef} className="fc-preview-stage-inner">
          {isFocusMode ? (
            <div className="fc-focus-exit-corner">
              <button
                type="button"
                className="fc-focus-exit-btn"
                onClick={onExitFocusMode || onToggleFocusMode}
                title="Exit Focus Mode (Esc or F)"
                aria-label="Exit Focus Mode"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 2v4H2m8-4v4h4M6 14v-4H2m8 4v-4h4" />
                </svg>
                <span>Exit Focus Mode</span>
                <kbd className="fc-shortcut-kbd">Esc</kbd>
              </button>
            </div>
          ) : null}

          {/* Unified floating toolbar container: prevents stage height shifting when open/collapsed */}
          <div className="fc-ann-toolbar-floating-container">
            {renderedToolbar}
          </div>
          {isLoading ? (
            <div className="fc-preview-state" aria-busy="true">
              <div className="fc-spinner-row">
                <span className="fc-spinner" aria-hidden="true" />
                <span>Loading image…</span>
              </div>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="fc-preview-state" role="alert">
              <p className="fc-preview-error-text">{errorMessage}</p>
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-sm"
                onClick={handleRetry}
              >
                Retry Preview
              </button>
            </div>
          ) : signedUrl ? (
            <div
              ref={viewportRef}
              className={`fc-canvas-viewport${viewportCursorClass}`}
              onPointerDown={handleViewportPointerDown}
              onPointerMove={handleViewportPointerMove}
              onPointerUp={handleViewportPointerUp}
              onPointerCancel={handleViewportPointerCancel}
            >
              <div className={frameClass} style={frameStyle}>
                <img
                  key={image.id}
                  src={signedUrl}
                  alt={image.original_filename}
                  className="fc-preview-img"
                  style={
                    baseWidth > 0 && baseHeight > 0
                      ? { width: `${baseWidth}px`, height: `${baseHeight}px` }
                      : undefined
                  }
                  draggable={false}
                  decoding="async"
                  onLoad={(event) => {
                    setDecodingImage(false);
                    setDimensions({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    });
                  }}
                  onError={() => {
                    setDecodingImage(false);
                    setErrorMessage('Image failed to load from storage.');
                  }}
                />
                {!decodingImage && renderedOverlay
                  ? renderedOverlay
                  : prepareAnnotationLayer && !decodingImage ? (
                      <div
                        className="fc-annotation-layer"
                        data-annotation-layer="ready"
                        aria-hidden="true"
                      />
                    ) : null}
              </div>

              {/* High-precision Circular Loupe Magnifier */}
              <ImageMagnifier
                imageUrl={signedUrl}
                isActive={activeMagnifier}
                onClose={() => {
                  if (onToggleMagnifier) {
                    onToggleMagnifier();
                  } else {
                    setInternalMagnifier(false);
                  }
                }}
                viewportRef={viewportRef}
                dimensions={dimensions}
                baseWidth={baseWidth}
                baseHeight={baseHeight}
                scale={scale}
                pan={pan}
                rotation={rotation}
              />
            </div>
          ) : null}

          {/* Standalone floating zoom controls fallback when toolbarSlot is not provided */}
          {!toolbarSlot && dimensions && !isLoading && !errorMessage ? (
            <div className="fc-canvas-floating-controls" role="group" aria-label="Zoom controls">
              <button
                type="button"
                className="fc-ann-zoom-btn"
                onClick={handleZoomOut}
                disabled={effectiveZoom <= minZoom}
                title="Zoom Out (-)"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="3" y1="8" x2="13" y2="8" />
                </svg>
              </button>
              <span className="fc-ann-zoom-value">{Math.round(effectiveZoom * 100)}%</span>
              <button
                type="button"
                className="fc-ann-zoom-btn"
                onClick={handleZoomIn}
                disabled={effectiveZoom >= maxZoom}
                title="Zoom In (+)"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="8" y1="3" x2="8" y2="13" />
                  <line x1="3" y1="8" x2="13" y2="8" />
                </svg>
              </button>
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-xs"
                onClick={handleFitToScreen}
                title="Fit to Screen"
              >
                Fit
              </button>
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-xs"
                onClick={handleActualSize}
                title="Actual Size (100%)"
              >
                100%
              </button>
              <button
                type="button"
                className="fc-btn fc-btn-secondary fc-btn-xs"
                onClick={handleResetView}
                title="Reset View"
              >
                Reset
              </button>

              {/* Standalone Rotation Controls */}
              {onRotateCCW ? (
                <button
                  type="button"
                  className="fc-ann-zoom-btn"
                  onClick={onRotateCCW}
                  title="Rotate 90° CCW ([)"
                  aria-label="Rotate 90 degrees counter-clockwise"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                </button>
              ) : null}
              {onRotateCW ? (
                <button
                  type="button"
                  className="fc-ann-zoom-btn"
                  onClick={onRotateCW}
                  title="Rotate 90° CW (])"
                  aria-label="Rotate 90 degrees clockwise"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              ) : null}
              {rotation % 360 !== 0 && onResetRotation ? (
                <button
                  type="button"
                  className="fc-btn fc-btn-secondary fc-btn-xs"
                  onClick={onResetRotation}
                  title="Reset rotation to 0°"
                >
                  {rotation}° ✕
                </button>
              ) : null}

              {/* Standalone Magnifier Button */}
              <button
                type="button"
                className={`fc-btn fc-btn-xs ${
                  activeMagnifier ? 'fc-btn-primary fc-ann-magnifier-active' : 'fc-btn-secondary'
                }`}
                onClick={handleToggleMagnifier}
                title="Magnifier Loupe (Z)"
                aria-pressed={activeMagnifier}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.5" />
                  <line x1="10.5" y1="10.5" x2="14" y2="14" />
                </svg>
                <span>Loupe</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="fc-preview-meta">
        <span>Format: {getFormatLabel(image.mime_type)}</span>
        <span>Size: {formatFileSize(image.file_size)}</span>
        {dimensions ? (
          <span>
            Dimensions: {dimensions.width} × {dimensions.height} px
          </span>
        ) : null}
        <span>Zoom: {Math.round(effectiveZoom * 100)}%</span>
        {rotation % 360 !== 0 ? <span>Rotation: {rotation}°</span> : null}
      </div>
    </section>
  );
}
