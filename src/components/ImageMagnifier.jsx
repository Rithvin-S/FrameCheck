import { useCallback, useEffect, useRef, useState } from 'react';
import './ImageMagnifier.css';

const LENS_DIAMETER = 220;
const HALF_DIAMETER = LENS_DIAMETER / 2;
const MIN_MAG_FACTOR = 1.5;
const MAX_MAG_FACTOR = 5.0;

/**
 * ImageMagnifier
 * High-precision circular loupe lens for inspecting high-resolution image details.
 * Synchronized with pointer position, zero distortion, supports rotated canvas,
 * and includes activation/deactivation controls without blocking pan/zoom.
 */
export function ImageMagnifier({
  imageUrl,
  isActive = false,
  onClose,
  viewportRef,
  dimensions,
  baseWidth = 0,
  baseHeight = 0,
  scale = 1,
  pan = { x: 0, y: 0 },
  rotation = 0,
  zoomFactor: controlledZoomFactor,
  onZoomFactorChange,
}) {
  const [internalZoomFactor, setInternalZoomFactor] = useState(2.5);
  const zoomFactor = controlledZoomFactor ?? internalZoomFactor;

  const [pointerState, setPointerState] = useState({
    isVisible: false,
    vx: 0,
    vy: 0,
    normX: 0.5,
    normY: 0.5,
    isInsideImage: false,
  });

  const handleZoomChange = useCallback(
    (delta) => {
      const next = Math.min(MAX_MAG_FACTOR, Math.max(MIN_MAG_FACTOR, +(zoomFactor + delta).toFixed(1)));
      if (onZoomFactorChange) {
        onZoomFactorChange(next);
      } else {
        setInternalZoomFactor(next);
      }
    },
    [zoomFactor, onZoomFactorChange]
  );

  // Track pointer movements over the viewport container
  useEffect(() => {
    if (!isActive || !viewportRef?.current || !baseWidth || !baseHeight) {
      return undefined;
    }

    const viewport = viewportRef.current;

    const handlePointerMove = (event) => {
      const rect = viewport.getBoundingClientRect();
      const vx = event.clientX - rect.left;
      const vy = event.clientY - rect.top;

      // Frame center in viewport coordinates
      const frameCenterX = rect.width / 2 + pan.x;
      const frameCenterY = rect.height / 2 + pan.y;

      const dx = vx - frameCenterX;
      const dy = vy - frameCenterY;

      // Unrotate vector relative to frame center
      const rad = -((rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const dx_unrot = dx * cos - dy * sin;
      const dy_unrot = dx * sin + dy * cos;

      // Coordinate on base image
      const localX = dx_unrot / (scale || 1) + baseWidth / 2;
      const localY = dy_unrot / (scale || 1) + baseHeight / 2;

      const normX = baseWidth > 0 ? localX / baseWidth : 0.5;
      const normY = baseHeight > 0 ? localY / baseHeight : 0.5;

      const isInsideImage = normX >= 0 && normX <= 1 && normY >= 0 && normY <= 1;

      setPointerState({
        isVisible: true,
        vx,
        vy,
        normX,
        normY,
        isInsideImage,
      });
    };

    const handlePointerLeave = () => {
      setPointerState((prev) => ({ ...prev, isVisible: false }));
    };

    const handleWheel = (event) => {
      // Allow Alt+Wheel or Shift+Wheel inside magnifier to adjust loupe magnification
      if (event.altKey || event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.deltaY < 0 ? 0.25 : -0.25;
        handleZoomChange(delta);
      }
    };

    viewport.addEventListener('pointermove', handlePointerMove);
    viewport.addEventListener('pointerleave', handlePointerLeave);
    viewport.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      viewport.removeEventListener('pointermove', handlePointerMove);
      viewport.removeEventListener('pointerleave', handlePointerLeave);
      viewport.removeEventListener('wheel', handleWheel);
    };
  }, [
    isActive,
    viewportRef,
    baseWidth,
    baseHeight,
    scale,
    pan.x,
    pan.y,
    rotation,
    handleZoomChange,
  ]);

  if (!isActive || !imageUrl) {
    return null;
  }

  // Calculate magnified image dimensions inside the loupe
  // Ensure the loupe shows high-detail pixels (minimum 2.0x or scale * zoomFactor)
  const effectiveLoupeScale = Math.max(scale * zoomFactor, 2.0);
  const loupeImgW = baseWidth * effectiveLoupeScale;
  const loupeImgH = baseHeight * effectiveLoupeScale;

  // Position image so pointer target normX, normY lands on the center of the lens
  const imgLeft = HALF_DIAMETER - pointerState.normX * loupeImgW;
  const imgTop = HALF_DIAMETER - pointerState.normY * loupeImgH;

  const showLens = pointerState.isVisible && pointerState.isInsideImage;

  return (
    <div className="fc-magnifier-root" aria-hidden="true">
      {/* Floating Loupe Lens */}
      {showLens ? (
        <div
          className="fc-magnifier-lens"
          style={{
            width: `${LENS_DIAMETER}px`,
            height: `${LENS_DIAMETER}px`,
            left: `${pointerState.vx}px`,
            top: `${pointerState.vy}px`,
          }}
        >
          <div className="fc-magnifier-lens-viewport">
            <img
              src={imageUrl}
              alt=""
              className="fc-magnifier-lens-img"
              draggable={false}
              style={{
                width: `${loupeImgW}px`,
                height: `${loupeImgH}px`,
                left: `${imgLeft}px`,
                top: `${imgTop}px`,
                transformOrigin: `${pointerState.normX * loupeImgW}px ${pointerState.normY * loupeImgH}px`,
                transform: `rotate(${rotation || 0}deg)`,
              }}
            />
          </div>

          {/* Reticle / Crosshair */}
          <div className="fc-magnifier-reticle">
            <span className="fc-reticle-line fc-reticle-h" />
            <span className="fc-reticle-line fc-reticle-v" />
            <span className="fc-reticle-center" />
          </div>

          {/* Zoom Factor Badge */}
          <div className="fc-magnifier-lens-badge">{zoomFactor.toFixed(1)}×</div>
        </div>
      ) : null}

      {/* Persistent Magnifier Controls Pill inside viewport */}
      <div className="fc-magnifier-dock-bar" role="toolbar" aria-label="Magnifier controls">
        <span className="fc-magnifier-dock-title">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="5" />
            <line x1="11" y1="11" x2="15" y2="15" />
          </svg>
          Magnifier
        </span>

        <div className="fc-magnifier-dock-zoom">
          <button
            type="button"
            className="fc-magnifier-dock-btn"
            onClick={() => handleZoomChange(-0.5)}
            disabled={zoomFactor <= MIN_MAG_FACTOR}
            title="Decrease magnification (Shift+Wheel down)"
            aria-label="Decrease magnification"
          >
            −
          </button>
          <span className="fc-magnifier-dock-value">{zoomFactor.toFixed(1)}×</span>
          <button
            type="button"
            className="fc-magnifier-dock-btn"
            onClick={() => handleZoomChange(0.5)}
            disabled={zoomFactor >= MAX_MAG_FACTOR}
            title="Increase magnification (Shift+Wheel up)"
            aria-label="Increase magnification"
          >
            +
          </button>
        </div>

        <button
          type="button"
          className="fc-magnifier-dock-close-btn"
          onClick={onClose}
          title="Turn off magnifier (Z or Esc)"
          aria-label="Close magnifier"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="3" y1="3" x2="13" y2="13" />
            <line x1="13" y1="3" x2="3" y2="13" />
          </svg>
          <span>Close (Z)</span>
        </button>
      </div>
    </div>
  );
}

