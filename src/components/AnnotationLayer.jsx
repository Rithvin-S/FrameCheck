import { useEffect, useRef, useState } from 'react';
import {
  MIN_ANNOTATION_RADIUS_PX,
  clamp,
  clampMovedCirclePx,
  clampResizedRadiusPx,
  normalizedCircleToPixel,
  pixelCircleToNormalized,
} from '../services/annotationState.js';
import './AnnotationLayer.css';

const HANDLE_POSITIONS = [
  { key: 'n', dx: 0, dy: -1, cursor: 'ns-resize' },
  { key: 'e', dx: 1, dy: 0, cursor: 'ew-resize' },
  { key: 's', dx: 0, dy: 1, cursor: 'ns-resize' },
  { key: 'w', dx: -1, dy: 0, cursor: 'ew-resize' },
];

function getBadgeCoordinates({ cxPx, cyPx, rPx, width, height, labelText }) {
  const halfBadgeW =
    labelText.length >= 4
      ? Math.max(18, labelText.length * 4 + 4)
      : labelText.length >= 3
        ? 14
        : 11;
  const halfBadgeH = 11;
  const rawX = cxPx - rPx * Math.SQRT1_2;
  const rawY = cyPx - rPx * Math.SQRT1_2;

  return {
    x: clamp(rawX, halfBadgeW + 2, Math.max(halfBadgeW + 2, width - halfBadgeW - 2)),
    y: clamp(rawY, halfBadgeH + 2, Math.max(halfBadgeH + 2, height - halfBadgeH - 2)),
    width: halfBadgeW * 2,
    height: halfBadgeH * 2,
  };
}

function renderPreviewCircle({
  cxPx,
  cyPx,
  rPx,
  color,
  labelText,
  boxWidth,
  boxHeight,
}) {
  const previewBadge = getBadgeCoordinates({
    cxPx,
    cyPx,
    rPx,
    width: boxWidth,
    height: boxHeight,
    labelText,
  });

  return (
    <g pointerEvents="none">
      <circle
        cx={cxPx}
        cy={cyPx}
        r={rPx}
        fill={color}
        fillOpacity={0.08}
        stroke="#ffffff"
        strokeWidth={5}
        strokeOpacity={0.85}
        strokeDasharray="6 4"
      />
      <circle
        cx={cxPx}
        cy={cyPx}
        r={rPx}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray="6 4"
      />
      <g>
        <rect
          x={previewBadge.x - previewBadge.width / 2}
          y={previewBadge.y - previewBadge.height / 2}
          width={previewBadge.width}
          height={previewBadge.height}
          rx={previewBadge.height / 2}
          fill={color}
          stroke="#ffffff"
          strokeWidth={1.75}
        />
        <text
          x={previewBadge.x}
          y={previewBadge.y}
          textAnchor="middle"
          dominantBaseline="central"
          className="fc-ann-badge-text"
        >
          {labelText}
        </text>
      </g>
    </g>
  );
}

/**
 * Interactive SVG circle annotation overlay aligned 1:1 with the rendered image box.
 * Supports center-out circle drawing (draft preview), selection, creator-only dragging
 * and 4-handle resizing, and normalized coordinate conversion independent of image size.
 */
export function AnnotationLayer({
  imageId,
  annotations,
  currentUserId,
  draftAnnotation = null,
  toolMode,
  activeDrawColor,
  selectedAnnotationId,
  onSelectAnnotation,
  onCreateDraft,
  onCommitGeometry,
  readOnly = false,
  disabled = false,
}) {
  const svgRef = useRef(null);
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });
  const [gesture, setGesture] = useState(null);

  useEffect(() => {
    setGesture(null);
  }, [imageId, readOnly]);

  useEffect(() => {
    const node = svgRef.current;
    if (!node) return undefined;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setBoxSize((prev) =>
        Math.abs(prev.width - rect.width) < 0.5 &&
          Math.abs(prev.height - rect.height) < 0.5
          ? prev
          : { width: rect.width, height: rect.height }
      );
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, [imageId]);

  const getLocalPointer = (event) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
      width: rect.width,
      height: rect.height,
    };
  };

  const releaseCapture = (pointerId) => {
    const node = svgRef.current;
    if (node?.hasPointerCapture?.(pointerId)) {
      node.releasePointerCapture(pointerId);
    }
  };

  const handleStagePointerDown = (event) => {
    if (readOnly) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;

    const pt = getLocalPointer(event);
    if (!pt) return;

    if (toolMode !== 'draw' || disabled) {
      if (toolMode !== 'draw') {
        onSelectAnnotation(null);
      }
      return;
    }

    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);
    onSelectAnnotation(null);

    setGesture({
      type: 'draw',
      pointerId: event.pointerId,
      startX: pt.x,
      startY: pt.y,
      cxPx: pt.x,
      cyPx: pt.y,
      rPx: 0,
    });
  };

  const isEditableAnnotation = (annotation) =>
    Boolean(
      !readOnly &&
        !disabled &&
        currentUserId &&
        annotation?.createdBy === currentUserId
    );

  const handleCirclePointerDown = (event, annotation) => {
    if (readOnly) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();

    onSelectAnnotation(annotation.id);

    if (!isEditableAnnotation(annotation)) {
      return;
    }

    const pt = getLocalPointer(event);
    if (!pt) return;

    const px = normalizedCircleToPixel({
      cx: annotation.cx,
      cy: annotation.cy,
      r: annotation.r,
      width: pt.width,
      height: pt.height,
    });

    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);

    setGesture({
      type: 'move',
      pointerId: event.pointerId,
      annotationId: annotation.id,
      offsetX: pt.x - px.cxPx,
      offsetY: pt.y - px.cyPx,
      cxPx: px.cxPx,
      cyPx: px.cyPx,
      rPx: px.rPx,
    });
  };

  const handleResizePointerDown = (event, annotation) => {
    if (readOnly) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();

    if (!isEditableAnnotation(annotation)) {
      return;
    }

    const pt = getLocalPointer(event);
    if (!pt) return;

    const px = normalizedCircleToPixel({
      cx: annotation.cx,
      cy: annotation.cy,
      r: annotation.r,
      width: pt.width,
      height: pt.height,
    });

    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);

    setGesture({
      type: 'resize',
      pointerId: event.pointerId,
      annotationId: annotation.id,
      cxPx: px.cxPx,
      cyPx: px.cyPx,
      rPx: px.rPx,
    });
  };

  const handlePointerMove = (event) => {
    if (readOnly || !gesture || gesture.pointerId !== event.pointerId) return;

    const pt = getLocalPointer(event);
    if (!pt) return;

    if (gesture.type === 'draw') {
      const rawRadius = Math.hypot(
        pt.x - gesture.startX,
        pt.y - gesture.startY
      );
      const maxRadius = Math.max(
        0,
        Math.min(
          gesture.startX,
          pt.width - gesture.startX,
          gesture.startY,
          pt.height - gesture.startY
        )
      );
      const nextRadius = Math.min(rawRadius, maxRadius);
      setGesture((prev) => (prev ? { ...prev, rPx: nextRadius } : null));
      return;
    }

    if (gesture.type === 'move') {
      const nextPos = clampMovedCirclePx({
        cxPx: pt.x - gesture.offsetX,
        cyPx: pt.y - gesture.offsetY,
        rPx: gesture.rPx,
        width: pt.width,
        height: pt.height,
      });
      setGesture((prev) =>
        prev ? { ...prev, cxPx: nextPos.cxPx, cyPx: nextPos.cyPx } : null
      );
      return;
    }

    if (gesture.type === 'resize') {
      const rawRadius = Math.hypot(pt.x - gesture.cxPx, pt.y - gesture.cyPx);
      const nextRadius = clampResizedRadiusPx({
        cxPx: gesture.cxPx,
        cyPx: gesture.cyPx,
        rawRadiusPx: rawRadius,
        width: pt.width,
        height: pt.height,
      });
      setGesture((prev) => (prev ? { ...prev, rPx: nextRadius } : null));
    }
  };

  const handlePointerUp = (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const pt = getLocalPointer(event);
    const activeGesture = gesture;
    setGesture(null);
    releaseCapture(event.pointerId);

    if (readOnly || !pt) return;

    if (activeGesture.type === 'draw') {
      const minDim = Math.min(pt.width, pt.height);
      const requiredMinPx = Math.min(MIN_ANNOTATION_RADIUS_PX, minDim / 2);
      if (activeGesture.rPx < requiredMinPx || activeGesture.rPx < 4) {
        return;
      }

      const geometry = pixelCircleToNormalized({
        cxPx: activeGesture.cxPx,
        cyPx: activeGesture.cyPx,
        rPx: activeGesture.rPx,
        width: pt.width,
        height: pt.height,
      });
      onSelectAnnotation(null);
      onCreateDraft({
        geometry,
        color: activeDrawColor,
      });
      return;
    }

    if (activeGesture.type === 'move' || activeGesture.type === 'resize') {
      const geometry = pixelCircleToNormalized({
        cxPx: activeGesture.cxPx,
        cyPx: activeGesture.cyPx,
        rPx: activeGesture.rPx,
        width: pt.width,
        height: pt.height,
      });
      onCommitGeometry({
        annotationId: activeGesture.annotationId,
        geometry,
      });
    }
  };

  const handlePointerCancel = (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    setGesture(null);
    releaseCapture(event.pointerId);
  };

  const hasValidBox = boxSize.width > 0 && boxSize.height > 0;
  const isDrawing = !readOnly && gesture?.type === 'draw';
  const openAnnotations = annotations.filter((ann) => ann.status !== 'resolved');
  const effectiveSelectedId = readOnly ? null : selectedAnnotationId;
  const activeDraftForImage =
    !readOnly && draftAnnotation && draftAnnotation.imageId === imageId
      ? draftAnnotation
      : null;

  return (
    <svg
      ref={svgRef}
      className={`fc-annotation-svg${
        readOnly
          ? ' fc-annotation-svg-readonly'
          : toolMode === 'draw'
            ? ' fc-annotation-svg-draw'
            : ''
      }`}
      viewBox={hasValidBox ? `0 0 ${boxSize.width} ${boxSize.height}` : undefined}
      pointerEvents={readOnly ? 'none' : undefined}
      onPointerDown={readOnly ? undefined : handleStagePointerDown}
      onPointerMove={readOnly ? undefined : handlePointerMove}
      onPointerUp={readOnly ? undefined : handlePointerUp}
      onPointerCancel={readOnly ? undefined : handlePointerCancel}
      role="img"
      aria-label="Image circle annotations overlay"
    >
      {hasValidBox
        ? openAnnotations.map((ann) => {
          const isSelected = ann.id === effectiveSelectedId;
          const isEditable = isEditableAnnotation(ann);
          const isGestureTarget =
            gesture &&
            (gesture.type === 'move' || gesture.type === 'resize') &&
            gesture.annotationId === ann.id;

          const px = isGestureTarget
            ? {
              cxPx: gesture.cxPx,
              cyPx: gesture.cyPx,
              rPx: gesture.rPx,
            }
            : normalizedCircleToPixel({
              cx: ann.cx,
              cy: ann.cy,
              r: ann.r,
              width: boxSize.width,
              height: boxSize.height,
            });

          const labelText = String(ann.displayNumber);
          const badge = getBadgeCoordinates({
            cxPx: px.cxPx,
            cyPx: px.cyPx,
            rPx: px.rPx,
            width: boxSize.width,
            height: boxSize.height,
            labelText,
          });

          return (
            <g key={ann.id} className="fc-ann-group">
              {isSelected ? (
                <circle
                  cx={px.cxPx}
                  cy={px.cyPx}
                  r={px.rPx}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={6}
                  strokeOpacity={0.85}
                  pointerEvents="none"
                />
              ) : null}

              <circle
                cx={px.cxPx}
                cy={px.cyPx}
                r={px.rPx}
                fill={isSelected ? ann.color : 'transparent'}
                fillOpacity={isSelected ? 0.08 : 0}
                stroke={ann.color}
                strokeWidth={isSelected ? 3 : 2.5}
                pointerEvents="none"
              />

              {/* Generous hit target so selecting/moving circles does not accidentally draw */}
              <circle
                cx={px.cxPx}
                cy={px.cyPx}
                r={px.rPx}
                fill="transparent"
                stroke="transparent"
                strokeWidth={14}
                className={
                  isEditable ? 'fc-ann-hit' : 'fc-ann-hit fc-ann-hit-readonly'
                }
                pointerEvents={
                  readOnly
                    ? 'none'
                    : toolMode === 'select' || isSelected
                      ? 'all'
                      : 'stroke'
                }
                onPointerDown={
                  readOnly ? undefined : (event) => handleCirclePointerDown(event, ann)
                }
              />

              <g
                className={
                  isEditable
                    ? 'fc-ann-badge-group'
                    : 'fc-ann-badge-group fc-ann-badge-readonly'
                }
                pointerEvents={readOnly ? 'none' : undefined}
                onPointerDown={
                  readOnly ? undefined : (event) => handleCirclePointerDown(event, ann)
                }
              >
                <rect
                  x={badge.x - badge.width / 2}
                  y={badge.y - badge.height / 2}
                  width={badge.width}
                  height={badge.height}
                  rx={badge.height / 2}
                  fill={ann.color}
                  stroke="#ffffff"
                  strokeWidth={1.75}
                />
                <text
                  x={badge.x}
                  y={badge.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fc-ann-badge-text"
                >
                  {labelText}
                </text>
              </g>

              {isSelected && !isDrawing && isEditable
                ? HANDLE_POSITIONS.map((handle) => {
                  const hx = clamp(
                    px.cxPx + handle.dx * px.rPx,
                    4,
                    Math.max(4, boxSize.width - 4)
                  );
                  const hy = clamp(
                    px.cyPx + handle.dy * px.rPx,
                    4,
                    Math.max(4, boxSize.height - 4)
                  );

                  return (
                    <g
                      key={handle.key}
                      style={{ cursor: handle.cursor }}
                      pointerEvents="all"
                      onPointerDown={(event) =>
                        handleResizePointerDown(event, ann)
                      }
                    >
                      <circle cx={hx} cy={hy} r={9} fill="transparent" />
                      <circle
                        cx={hx}
                        cy={hy}
                        r={4.5}
                        fill="#ffffff"
                        stroke={ann.color}
                        strokeWidth={2}
                      />
                    </g>
                  );
                })
                : null}
            </g>
          );
        })
        : null}

      {hasValidBox && isDrawing && gesture.rPx > 2
        ? renderPreviewCircle({
          cxPx: gesture.cxPx,
          cyPx: gesture.cyPx,
          rPx: gesture.rPx,
          color: activeDrawColor,
          labelText: 'Draft',
          boxWidth: boxSize.width,
          boxHeight: boxSize.height,
        })
        : null}

      {hasValidBox && !isDrawing && activeDraftForImage
        ? (() => {
          const draftPx = normalizedCircleToPixel({
            cx: activeDraftForImage.cx,
            cy: activeDraftForImage.cy,
            r: activeDraftForImage.r,
            width: boxSize.width,
            height: boxSize.height,
          });
          return renderPreviewCircle({
            cxPx: draftPx.cxPx,
            cyPx: draftPx.cyPx,
            rPx: draftPx.rPx,
            color: activeDraftForImage.color,
            labelText: 'Draft',
            boxWidth: boxSize.width,
            boxHeight: boxSize.height,
          });
        })()
        : null}
    </svg>
  );
}

