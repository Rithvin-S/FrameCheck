import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './ImageComparisonSlider.css';

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function formatDims(dims) {
  if (!dims || !dims.width || !dims.height) return '';
  return `${dims.width} × ${dims.height} px`;
}

/**
 * ImageComparisonSlider
 * High-precision Before/After image comparison slider.
 * Draggable divider with smooth pointer tracking, clip-path image reveal,
 * 1:1 image alignment, zero aspect-ratio distortion, synchronized zoom/pan,
 * and keyboard accessibility.
 */
export function ImageComparisonSlider({
  originalUrl,
  originalDims,
  originalTitle = 'Original Image',
  originalSubtitle = 'Before',
  referenceUrl,
  referenceDims,
  referenceTitle = 'Reference Image',
  referenceSubtitle = 'After',
  offset = { x: 0, y: 0 },
  isLoading = false,
  error = '',
  onOriginalLoaded = null,
  onReferenceLoaded = null,
  sliderPosition: controlledSliderPos,
  onSliderPositionChange = null,
  initialPosition = 50,
  orientation = 'vertical', // 'vertical' | 'horizontal'
  onOrientationChange = null,
  isSwapped = false,
  onToggleSwap = null,
  zoom = 1,
  pan = { x: 0, y: 0 },
  onZoomChange = null,
  onPanChange = null,
  onResetView = null,
  onFitView = null,
}) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const isDraggingDividerRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ clientX: 0, clientY: 0, panX: 0, panY: 0 });

  const [internalSliderPos, setInternalSliderPos] = useState(initialPosition);
  const sliderPos = controlledSliderPos ?? internalSliderPos;
  const setSliderPos = useCallback(
    (valOrFn) => {
      const nextVal = typeof valOrFn === 'function' ? valOrFn(sliderPos) : valOrFn;
      if (onSliderPositionChange) {
        onSliderPositionChange(nextVal);
      } else {
        setInternalSliderPos(nextVal);
      }
    },
    [sliderPos, onSliderPositionChange]
  );
  const [internalOrientation, setInternalOrientation] = useState(orientation);
  const activeOrientation = onOrientationChange ? orientation : internalOrientation;

  const [internalSwapped, setInternalSwapped] = useState(isSwapped);
  const activeSwapped = onToggleSwap ? isSwapped : internalSwapped;

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  // Measure stage size with ResizeObserver
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

  // Compute base frame dimensions from original image
  const baseW = originalDims?.width || 800;
  const baseH = originalDims?.height || 600;

  // Proportional contain fit for reference layer so aspect ratio is never distorted
  const { refDisplayW, refDisplayH } = useMemo(() => {
    if (!referenceDims?.width || !referenceDims?.height || !originalDims?.width || !originalDims?.height) {
      return { refDisplayW: baseW, refDisplayH: baseH };
    }
    if (referenceDims.width === originalDims.width && referenceDims.height === originalDims.height) {
      return { refDisplayW: originalDims.width, refDisplayH: originalDims.height };
    }
    const scaleToFitOrig = Math.min(
      originalDims.width / referenceDims.width,
      originalDims.height / referenceDims.height
    );
    return {
      refDisplayW: Math.round(referenceDims.width * scaleToFitOrig),
      refDisplayH: Math.round(referenceDims.height * scaleToFitOrig),
    };
  }, [referenceDims, originalDims, baseW, baseH]);

  // Viewport fit scale for the shared frame
  const fitScale = useMemo(() => {
    if (!baseW || !baseH) return 1.0;
    const availW = Math.max(50, (stageSize.width || 800) - 32);
    const availH = Math.max(50, (stageSize.height || 600) - 32);
    return Math.min(availW / baseW, availH / baseH);
  }, [baseW, baseH, stageSize]);

  // Initial automatic fit
  const hasAutoFittedRef = useRef(false);
  useEffect(() => {
    if (originalDims && stageSize.width > 0 && stageSize.height > 0 && !hasAutoFittedRef.current) {
      hasAutoFittedRef.current = true;
      if (onZoomChange) onZoomChange(fitScale);
      if (onPanChange) onPanChange({ x: 0, y: 0 });
    }
  }, [originalDims, stageSize, fitScale, onZoomChange, onPanChange]);

  // Divider pointer drag handlers
  const updateDividerFromPointer = useCallback((clientX, clientY) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    let percentage = 50;
    if (activeOrientation === 'horizontal') {
      percentage = ((clientY - rect.top) / rect.height) * 100;
    } else {
      percentage = ((clientX - rect.left) / rect.width) * 100;
    }
    setSliderPos(clamp(percentage, 0, 100));
  }, [activeOrientation]);

  const handleDividerPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingDividerRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleDividerPointerMove = (e) => {
    if (!isDraggingDividerRef.current) return;
    e.preventDefault();
    updateDividerFromPointer(e.clientX, e.clientY);
  };

  const handleDividerPointerUp = (e) => {
    if (isDraggingDividerRef.current) {
      isDraggingDividerRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  // Keyboard accessibility for divider handle
  const handleDividerKeyDown = (e) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      setSliderPos((p) => clamp(p - step, 0, 100));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      setSliderPos((p) => clamp(p + step, 0, 100));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSliderPos(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setSliderPos(100);
    }
  };

  // Stage pan and wheel zoom handlers
  const handleStagePointerDown = (e) => {
    // Middle-click, spacebar-click, or left-click outside divider initiates pan
    const isMiddleClick = e.button === 1;
    const isLeftClick = e.button === 0;

    if (isMiddleClick || (isLeftClick && (e.spaceKey || e.altKey))) {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
    } else if (isLeftClick) {
      // Direct click on stage moves slider to that position
      updateDividerFromPointer(e.clientX, e.clientY);
    }
  };

  const handleStagePointerMove = (e) => {
    if (!isPanningRef.current) return;
    e.preventDefault();
    const dx = e.clientX - panStartRef.current.clientX;
    const dy = e.clientY - panStartRef.current.clientY;
    if (onPanChange) {
      onPanChange({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      });
    }
  };

  const handleStagePointerUp = (e) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const stage = stageRef.current;
    if (!stage || !onZoomChange || !onPanChange) return;

    const rect = stage.getBoundingClientRect();
    const mouseX = e.clientX - (rect.left + rect.width / 2);
    const mouseY = e.clientY - (rect.top + rect.height / 2);

    const delta = -e.deltaY * 0.0015;
    const currentZoom = zoom || 1.0;
    const minZ = fitScale * 0.1;
    const maxZ = Math.max(15.0, fitScale * 15);
    const nextZoom = clamp(currentZoom * (1 + delta), minZ, maxZ);
    const ratio = nextZoom / currentZoom;

    const nextPan = {
      x: mouseX - (mouseX - pan.x) * ratio,
      y: mouseY - (mouseY - pan.y) * ratio,
    };

    onZoomChange(nextZoom);
    onPanChange(nextPan);
  };

  // Determine Before/After layer assignment based on swap state
  const beforeUrl = activeSwapped ? referenceUrl : originalUrl;
  const beforeDims = activeSwapped ? referenceDims : originalDims;
  const beforeTitle = activeSwapped ? referenceTitle : originalTitle;
  const beforeSubtitle = activeSwapped ? referenceSubtitle : originalSubtitle;
  const beforeBadgeType = activeSwapped ? 'reference' : 'original';

  const afterUrl = activeSwapped ? originalUrl : referenceUrl;
  const afterDims = activeSwapped ? originalDims : referenceDims;
  const afterTitle = activeSwapped ? originalTitle : referenceTitle;
  const afterSubtitle = activeSwapped ? originalSubtitle : referenceSubtitle;
  const afterBadgeType = activeSwapped ? 'original' : 'reference';

  // Compute CSS clip-path for revealing After image
  // Vertical split reveals After image on right side; Horizontal split reveals After image on bottom
  const clipStyle = useMemo(() => {
    const P = sliderPos;
    if (activeOrientation === 'horizontal') {
      return {
        clipPath: `polygon(0% ${P}%, 100% ${P}%, 100% 100%, 0% 100%)`,
        WebkitClipPath: `polygon(0% ${P}%, 100% ${P}%, 100% 100%, 0% 100%)`,
      };
    }
    return {
      clipPath: `polygon(${P}% 0%, 100% 0%, 100% 100%, ${P}% 100%)`,
      WebkitClipPath: `polygon(${P}% 0%, 100% 0%, 100% 100%, ${P}% 100%)`,
    };
  }, [sliderPos, activeOrientation]);

  return (
    <div className="fc-cmp-slider-container" ref={containerRef}>
      {/* Interactive Canvas Viewport */}
      <div
        ref={stageRef}
        className="fc-cmp-slider-stage"
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerUp}
        onWheel={handleWheel}
        tabIndex={0}
        role="region"
        aria-label="Image comparison slider view"
      >
        {isLoading ? (
          <div className="fc-cmp-slider-loading" aria-busy="true">
            <span className="fc-cmp-spinner" aria-hidden="true" />
            <span>Loading comparison images…</span>
          </div>
        ) : error ? (
          <div className="fc-cmp-slider-error" role="alert">
            <span className="fc-cmp-error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        ) : (
          <div className="fc-cmp-slider-viewport">
            {/* Unified Pan/Zoom Coordinate Frame */}
            <div
              className="fc-cmp-slider-frame"
              style={{
                width: `${baseW}px`,
                height: `${baseH}px`,
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
            >
              {/* Bottom Layer: Before Image */}
              <div className="fc-cmp-slider-layer fc-cmp-layer-before">
                <img
                  src={beforeUrl}
                  alt={beforeTitle}
                  className="fc-cmp-layer-img"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                  draggable={false}
                  onLoad={(e) => {
                    const dims = {
                      width: e.currentTarget.naturalWidth,
                      height: e.currentTarget.naturalHeight,
                    };
                    if (activeSwapped) {
                      onReferenceLoaded?.(dims);
                    } else {
                      onOriginalLoaded?.(dims);
                    }
                  }}
                />
              </div>

              {/* Top Layer: After Image (Clipped dynamically by slider position) */}
              <div
                className="fc-cmp-slider-layer fc-cmp-layer-after"
                style={clipStyle}
              >
                <div
                  className="fc-cmp-layer-inner"
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    width: activeSwapped ? `${baseW}px` : `${refDisplayW}px`,
                    height: activeSwapped ? `${baseH}px` : `${refDisplayH}px`,
                    transform: activeSwapped
                      ? 'translate(-50%, -50%)'
                      : `translate(-50%, -50%) translate3d(${offset.x}px, ${offset.y}px, 0)`,
                  }}
                >
                  <img
                    src={afterUrl}
                    alt={afterTitle}
                    className="fc-cmp-layer-img"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      pointerEvents: 'none',
                      userSelect: 'none',
                    }}
                    draggable={false}
                    onLoad={(e) => {
                      const dims = {
                        width: e.currentTarget.naturalWidth,
                        height: e.currentTarget.naturalHeight,
                      };
                      if (activeSwapped) {
                        onOriginalLoaded?.(dims);
                      } else {
                        onReferenceLoaded?.(dims);
                      }
                    }}
                  />
                </div>
              </div>

              {/* Draggable Divider Line & Handle (Inside frame so it pans/zooms with image) */}
              <div
                className={`fc-cmp-slider-divider fc-divider-${activeOrientation}`}
                style={
                  activeOrientation === 'horizontal'
                    ? { top: `${sliderPos}%` }
                    : { left: `${sliderPos}%` }
                }
                onPointerDown={handleDividerPointerDown}
                onPointerMove={handleDividerPointerMove}
                onPointerUp={handleDividerPointerUp}
                onPointerCancel={handleDividerPointerUp}
                tabIndex={0}
                role="slider"
                aria-valuenow={Math.round(sliderPos)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Comparison split position (${Math.round(sliderPos)}%)`}
                onKeyDown={handleDividerKeyDown}
              >
                <div className="fc-cmp-divider-handle" title="Drag to compare (Arrow keys to nudge)">
                  {activeOrientation === 'horizontal' ? (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M8 2l4 4H4l4-4zm0 12l4-4H4l4 4z" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M2 8l4-4v8L2 8zm12 0l-4-4v8l4-4z" />
                    </svg>
                  )}
                  <span className="fc-cmp-handle-badge">{Math.round(sliderPos)}%</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Floating Identity Badges (Always fixed to viewport edges for clear orientation) */}
        {!isLoading && !error && (
          <>
            <div
              className={`fc-cmp-floating-label fc-label-before fc-label-${
                activeOrientation === 'horizontal' ? 'top' : 'left'
              }`}
            >
              <span className={`fc-cmp-badge fc-cmp-badge-${beforeBadgeType}`}>
                {beforeSubtitle.toUpperCase()}
              </span>
              <span className="fc-cmp-label-name">{beforeTitle}</span>
              {beforeDims ? (
                <span className="fc-cmp-label-dims">{formatDims(beforeDims)}</span>
              ) : null}
            </div>

            <div
              className={`fc-cmp-floating-label fc-label-after fc-label-${
                activeOrientation === 'horizontal' ? 'bottom' : 'right'
              }`}
            >
              <span className={`fc-cmp-badge fc-cmp-badge-${afterBadgeType}`}>
                {afterSubtitle.toUpperCase()}
              </span>
              <span className="fc-cmp-label-name">{afterTitle}</span>
              {afterDims ? (
                <span className="fc-cmp-label-dims">{formatDims(afterDims)}</span>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* Floating Bottom Quick Tools Bar */}
      <div className="fc-cmp-slider-controls" role="toolbar" aria-label="Comparison slider controls">
        {/* Preset Jump Positions */}
        <div className="fc-cmp-slider-presets" role="group" aria-label="Split presets">
          <button
            type="button"
            className={`fc-cmp-preset-btn${Math.abs(sliderPos - 0) < 1 ? ' active' : ''}`}
            onClick={() => setSliderPos(0)}
            title="Reveal 100% After image"
          >
            0%
          </button>
          <button
            type="button"
            className={`fc-cmp-preset-btn${Math.abs(sliderPos - 25) < 1 ? ' active' : ''}`}
            onClick={() => setSliderPos(25)}
            title="25% split"
          >
            25%
          </button>
          <button
            type="button"
            className={`fc-cmp-preset-btn${Math.abs(sliderPos - 50) < 1 ? ' active' : ''}`}
            onClick={() => setSliderPos(50)}
            title="50% centered split"
          >
            50%
          </button>
          <button
            type="button"
            className={`fc-cmp-preset-btn${Math.abs(sliderPos - 75) < 1 ? ' active' : ''}`}
            onClick={() => setSliderPos(75)}
            title="75% split"
          >
            75%
          </button>
          <button
            type="button"
            className={`fc-cmp-preset-btn${Math.abs(sliderPos - 100) < 1 ? ' active' : ''}`}
            onClick={() => setSliderPos(100)}
            title="Reveal 100% Before image"
          >
            100%
          </button>
        </div>

        <span className="fc-cmp-controls-sep" aria-hidden="true" />

        {/* Swap Before & After */}
        <button
          type="button"
          className={`fc-cmp-tool-toggle-btn${activeSwapped ? ' active' : ''}`}
          onClick={() => {
            if (onToggleSwap) {
              onToggleSwap();
            } else {
              setInternalSwapped((prev) => !prev);
            }
          }}
          title="Swap Before and After image positions (⇄)"
          aria-label="Swap Before and After"
        >
          ⇄ Swap Sides
        </button>

        {/* Split Orientation (Vertical / Horizontal) */}
        <button
          type="button"
          className="fc-cmp-tool-toggle-btn"
          onClick={() => {
            const next = activeOrientation === 'vertical' ? 'horizontal' : 'vertical';
            if (onOrientationChange) {
              onOrientationChange(next);
            } else {
              setInternalOrientation(next);
            }
          }}
          title={
            activeOrientation === 'vertical'
              ? 'Switch to horizontal top/bottom split'
              : 'Switch to vertical left/right split'
          }
          aria-label="Toggle split orientation"
        >
          {activeOrientation === 'vertical' ? '⬍ Split Horizontal' : '⬌ Split Vertical'}
        </button>

        <span className="fc-cmp-controls-sep" aria-hidden="true" />

        {/* Zoom Controls */}
        <div className="fc-cmp-zoom-btn-group">
          <button
            type="button"
            className="fc-cmp-tool-btn"
            onClick={() => onZoomChange?.(clamp(zoom * 0.8, fitScale * 0.1, 15.0))}
            title="Zoom out"
          >
            −
          </button>
          <span className="fc-cmp-zoom-readout">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="fc-cmp-tool-btn"
            onClick={() => onZoomChange?.(clamp(zoom * 1.25, fitScale * 0.1, 15.0))}
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="fc-cmp-tool-btn fc-cmp-tool-text-btn"
            onClick={() => onFitView?.(fitScale)}
            title="Fit to view"
          >
            Fit
          </button>
          <button
            type="button"
            className="fc-cmp-tool-btn fc-cmp-tool-text-btn"
            onClick={() => {
              if (onZoomChange) onZoomChange(1.0);
              if (onPanChange) onPanChange({ x: 0, y: 0 });
            }}
            title="100% native size"
          >
            100%
          </button>
          <button
            type="button"
            className="fc-cmp-tool-btn"
            onClick={() => onResetView?.(fitScale)}
            title="Reset view and centering"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
