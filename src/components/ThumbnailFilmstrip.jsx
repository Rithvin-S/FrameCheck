import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  normalizedBlurToPixel,
  pointsToSmoothSvgPath,
  calculateArrowheadPoints,
  generateCloudSvgPath,
  pointsToPolygonSvgString,
  calculateCalloutConnector,
  getPencilBadgeCoordinates,
} from '../services/annotationState.js';
import { getSignedImageUrl } from '../services/imageUploadService.js';
import './ThumbnailFilmstrip.css';

function getBadgeDimensions(labelText) {
  const halfBadgeW =
    labelText.length >= 4
      ? Math.max(18, labelText.length * 4 + 4)
      : labelText.length >= 3
        ? 14
        : 11;
  const halfBadgeH = 11;
  return { halfBadgeW, halfBadgeH, width: halfBadgeW * 2, height: halfBadgeH * 2 };
}

function getCircleBadgeCoordinates({ cxPx, cyPx, rPx, width, height, labelText }) {
  const { halfBadgeW, halfBadgeH, width: badgeW, height: badgeH } = getBadgeDimensions(labelText);
  const rawX = cxPx - rPx * Math.SQRT1_2;
  const rawY = cyPx - rPx * Math.SQRT1_2;

  return {
    x: clamp(rawX, halfBadgeW + 2, Math.max(halfBadgeW + 2, width - halfBadgeW - 2)),
    y: clamp(rawY, halfBadgeH + 2, Math.max(halfBadgeH + 2, height - halfBadgeH - 2)),
    width: badgeW,
    height: badgeH,
  };
}

function getArrowBadgeCoordinates({ startXPx, startYPx, width, height, labelText }) {
  const { halfBadgeW, halfBadgeH, width: badgeW, height: badgeH } = getBadgeDimensions(labelText);
  return {
    x: clamp(startXPx, halfBadgeW + 2, Math.max(halfBadgeW + 2, width - halfBadgeW - 2)),
    y: clamp(startYPx - 14, halfBadgeH + 2, Math.max(halfBadgeH + 2, height - halfBadgeH - 2)),
    width: badgeW,
    height: badgeH,
  };
}

function getRectBadgeCoordinates({ xPx, yPx, width, height, labelText }) {
  const { halfBadgeW, halfBadgeH, width: badgeW, height: badgeH } = getBadgeDimensions(labelText);
  return {
    x: clamp(xPx, halfBadgeW + 2, Math.max(halfBadgeW + 2, width - halfBadgeW - 2)),
    y: clamp(yPx - 14, halfBadgeH + 2, Math.max(halfBadgeH + 2, height - halfBadgeH - 2)),
    width: badgeW,
    height: badgeH,
  };
}

function renderHoverBadge({ x, y, width, height, color, labelText }) {
  if (!labelText) return null;
  return (
    <g pointerEvents="none">
      <rect
        x={x - width / 2}
        y={y - height / 2}
        width={width}
        height={height}
        rx={height / 2}
        fill={color}
        stroke="#ffffff"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ffffff"
        fontSize="10.5"
        fontWeight="bold"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
      >
        {labelText}
      </text>
    </g>
  );
}

function HoverAnnotationItem({ annotation, baseWidth, baseHeight }) {
  const tool = annotation.geometry?.tool ? String(annotation.geometry.tool).trim().toLowerCase() : null;
  const annType = tool || String(annotation.type || 'circle').trim().toLowerCase();
  const labelText = String(
    annotation.displayNumber ??
    annotation.annotationNumber ??
    annotation.annotation_number ??
    ''
  );
  const strokeColor = annotation.style?.strokeColor || annotation.color || '#ef4444';
  const strokeWidth = annotation.style?.strokeWidth || 2.5;
  const strokeOpacity = annotation.style?.strokeOpacity ?? 1.0;
  const strokeDasharray =
    annotation.style?.lineStyle === 'dashed'
      ? '8 6'
      : annotation.style?.lineStyle === 'dotted'
        ? '2 4'
        : undefined;
  const fillColor = annotation.style?.fillColor || strokeColor;
  const fillOpacity = annotation.style?.fillEnabled ? (annotation.style?.fillOpacity ?? 0.2) : 0;
  const fill = annotation.style?.fillEnabled ? fillColor : 'none';

  // 1. NUMBERED MARKER PIN
  if (annType === 'marker') {
    const px = normalizedCircleToPixel({
      cx: annotation.geometry?.cx ?? annotation.cx ?? 0.5,
      cy: annotation.geometry?.cy ?? annotation.cy ?? 0.5,
      r: annotation.geometry?.r ?? annotation.r ?? 0.015,
      width: baseWidth,
      height: baseHeight,
    });
    const pinPathD = `M ${px.cxPx} ${px.cyPx} C ${px.cxPx - 5} ${px.cyPx - 9}, ${px.cxPx - 14} ${px.cyPx - 16}, ${px.cxPx - 14} ${px.cyPx - 26} A 14 14 0 1 1 ${px.cxPx + 14} ${px.cyPx - 26} C ${px.cxPx + 14} ${px.cyPx - 16}, ${px.cxPx + 5} ${px.cyPx - 9}, ${px.cxPx} ${px.cyPx} Z`;

    return (
      <g key={annotation.id} pointerEvents="none">
        <path
          d={pinPathD}
          fill={strokeColor}
          stroke="#ffffff"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={px.cxPx}
          cy={px.cyPx}
          r={2.5}
          fill="#ffffff"
          stroke={strokeColor}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={px.cxPx}
          y={px.cyPx - 26}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#ffffff"
          fontSize={labelText.length > 3 ? '9.5' : '11'}
          fontWeight="bold"
          fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        >
          #{labelText}
        </text>
      </g>
    );
  }

  // 2. RECTANGLE
  if (annType === 'rectangle') {
    const px = normalizedRectToPixel({
      x: annotation.geometry?.x ?? 0.1,
      y: annotation.geometry?.y ?? 0.1,
      width: annotation.geometry?.width ?? 0.2,
      height: annotation.geometry?.height ?? 0.2,
      baseWidth,
      baseHeight,
    });
    const badge = getRectBadgeCoordinates({
      xPx: px.xPx,
      yPx: px.yPx,
      width: baseWidth,
      height: baseHeight,
      labelText,
    });
    return (
      <g key={annotation.id} pointerEvents="none">
        <rect
          x={px.xPx}
          y={px.yPx}
          width={px.widthPx}
          height={px.heightPx}
          rx={1.5}
          fill={fill}
          fillOpacity={fillOpacity}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          strokeDasharray={strokeDasharray}
          vectorEffect="non-scaling-stroke"
        />
        {renderHoverBadge({ ...badge, color: strokeColor, labelText })}
      </g>
    );
  }

  // 3. ARROW
  if (annType === 'arrow') {
    const px = normalizedArrowToPixel({
      startX: annotation.geometry?.startX ?? 0.1,
      startY: annotation.geometry?.startY ?? 0.1,
      endX: annotation.geometry?.endX ?? 0.3,
      endY: annotation.geometry?.endY ?? 0.3,
      width: baseWidth,
      height: baseHeight,
    });
    const arrowhead = calculateArrowheadPoints({
      startXPx: px.startXPx,
      startYPx: px.startYPx,
      endXPx: px.endXPx,
      endYPx: px.endYPx,
    });
    const badge = getArrowBadgeCoordinates({
      startXPx: px.startXPx,
      startYPx: px.startYPx,
      width: baseWidth,
      height: baseHeight,
      labelText,
    });
    return (
      <g key={annotation.id} pointerEvents="none">
        <line
          x1={px.startXPx}
          y1={px.startYPx}
          x2={px.endXPx}
          y2={px.endYPx}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          strokeDasharray={strokeDasharray}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {annotation.style?.arrowHead === 'stealth' ? (
          <polygon
            points={arrowhead.stealthPolygonString}
            fill={strokeColor}
            stroke={strokeColor}
            strokeWidth={1}
            fillOpacity={strokeOpacity}
            vectorEffect="non-scaling-stroke"
          />
        ) : annotation.style?.arrowHead === 'double' ? (
          <>
            <polygon
              points={arrowhead.polygonString}
              fill={strokeColor}
              stroke={strokeColor}
              strokeWidth={1}
              fillOpacity={strokeOpacity}
              vectorEffect="non-scaling-stroke"
            />
            <polygon
              points={arrowhead.startPolygonString}
              fill={strokeColor}
              stroke={strokeColor}
              strokeWidth={1}
              fillOpacity={strokeOpacity}
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : annotation.style?.arrowHead === 'standard' ? (
          <polyline
            points={`${arrowhead.left[0]},${arrowhead.left[1]} ${arrowhead.tip[0]},${arrowhead.tip[1]} ${arrowhead.right[0]},${arrowhead.right[1]}`}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={strokeOpacity}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <polygon
            points={arrowhead.polygonString}
            fill={strokeColor}
            stroke={strokeColor}
            strokeWidth={1}
            fillOpacity={strokeOpacity}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {renderHoverBadge({ ...badge, color: strokeColor, labelText })}
      </g>
    );
  }

  // 4. LINE
  if (annType === 'line') {
    const px = normalizedLineToPixel({
      startX: annotation.geometry?.startX ?? 0.1,
      startY: annotation.geometry?.startY ?? 0.1,
      endX: annotation.geometry?.endX ?? 0.3,
      endY: annotation.geometry?.endY ?? 0.3,
      width: baseWidth,
      height: baseHeight,
    });
    const badge = getArrowBadgeCoordinates({
      startXPx: px.startXPx,
      startYPx: px.startYPx,
      width: baseWidth,
      height: baseHeight,
      labelText,
    });
    return (
      <g key={annotation.id} pointerEvents="none">
        <line
          x1={px.startXPx}
          y1={px.startYPx}
          x2={px.endXPx}
          y2={px.endYPx}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          strokeDasharray={strokeDasharray}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {renderHoverBadge({ ...badge, color: strokeColor, labelText })}
      </g>
    );
  }

  // 5. PENCIL / FREEHAND
  if (annType === 'pencil') {
    const { pointsPx } = normalizedPencilToPixel({
      points: annotation.geometry?.points ?? [],
      width: baseWidth,
      height: baseHeight,
    });
    if (!pointsPx || pointsPx.length === 0) return null;
    const pathD = pointsToSmoothSvgPath(pointsPx);
    const badge = getPencilBadgeCoordinates({
      pointsPx,
      width: baseWidth,
      height: baseHeight,
      labelText,
    });
    return (
      <g key={annotation.id} pointerEvents="none">
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth || 3}
          strokeOpacity={strokeOpacity}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={strokeDasharray}
          vectorEffect="non-scaling-stroke"
        />
        {renderHoverBadge({ ...badge, color: strokeColor, labelText })}
      </g>
    );
  }

  // 6. HIGHLIGHTER
  if (annType === 'highlighter') {
    const { pointsPx } = normalizedHighlighterToPixel({
      points: annotation.geometry?.points ?? [],
      width: baseWidth,
      height: baseHeight,
    });
    if (!pointsPx || pointsPx.length === 0) return null;
    const pathD = pointsToSmoothSvgPath(pointsPx);
    const badge = getPencilBadgeCoordinates({
      pointsPx,
      width: baseWidth,
      height: baseHeight,
      labelText,
    });
    return (
      <g key={annotation.id} pointerEvents="none" style={{ mixBlendMode: 'multiply' }}>
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth={Math.max(12, (strokeWidth || 3) * 4)}
          strokeOpacity={annotation.style?.strokeOpacity ?? 0.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {renderHoverBadge({ ...badge, color: strokeColor, labelText })}
      </g>
    );
  }

  // 7. CALLOUT
  if (annType === 'callout') {
    const px = normalizedCalloutToPixel({
      pointerX: annotation.geometry?.pointerX ?? 0.5,
      pointerY: annotation.geometry?.pointerY ?? 0.5,
      boxX: annotation.geometry?.boxX ?? 0.6,
      boxY: annotation.geometry?.boxY ?? 0.4,
      boxWidth: annotation.geometry?.boxWidth ?? 0.2,
      boxHeight: annotation.geometry?.boxHeight ?? 0.1,
      width: baseWidth,
      height: baseHeight,
    });
    const connector = calculateCalloutConnector({
      pointerXPx: px.pointerXPx,
      pointerYPx: px.pointerYPx,
      boxXPx: px.boxXPx,
      boxYPx: px.boxYPx,
      boxWidthPx: px.boxWidthPx,
      boxHeightPx: px.boxHeightPx,
    });
    const badge = getRectBadgeCoordinates({
      xPx: px.boxXPx,
      yPx: px.boxYPx,
      width: baseWidth,
      height: baseHeight,
      labelText,
    });
    const calloutText = annotation.geometry?.calloutText || '';
    return (
      <g key={annotation.id} pointerEvents="none">
        <line
          x1={connector.attachXPx}
          y1={connector.attachYPx}
          x2={connector.pointerXPx}
          y2={connector.pointerYPx}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          strokeDasharray={strokeDasharray}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <polygon
          points={connector.arrowhead.polygonString}
          fill={strokeColor}
          stroke={strokeColor}
          strokeWidth={1}
          fillOpacity={strokeOpacity}
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={px.pointerXPx}
          cy={px.pointerYPx}
          r={3.5}
          fill={strokeColor}
          stroke="#ffffff"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <rect
          x={px.boxXPx}
          y={px.boxYPx}
          width={px.boxWidthPx}
          height={px.boxHeightPx}
          rx={6}
          fill={annotation.style?.fillColor || '#ffffff'}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          vectorEffect="non-scaling-stroke"
        />
        {calloutText ? (
          <text
            x={px.boxXPx + 6}
            y={px.boxYPx + Math.min(18, px.boxHeightPx / 2 + 5)}
            fill="#1e293b"
            fontSize="11"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          >
            {calloutText.length > 20 ? `${calloutText.slice(0, 19)}…` : calloutText}
          </text>
        ) : null}
        {renderHoverBadge({ ...badge, color: strokeColor, labelText })}
      </g>
    );
  }

  // 8. CLOUD / REVISION CLOUD
  if (annType === 'cloud') {
    const px = normalizedCloudToPixel({
      x: annotation.geometry?.x ?? 0.1,
      y: annotation.geometry?.y ?? 0.1,
      width: annotation.geometry?.width ?? 0.2,
      height: annotation.geometry?.height ?? 0.2,
      baseWidth,
      baseHeight,
    });
    const cloudPath = generateCloudSvgPath({
      xPx: px.xPx,
      yPx: px.yPx,
      widthPx: px.widthPx,
      heightPx: px.heightPx,
    });
    const badge = getRectBadgeCoordinates({
      xPx: px.xPx,
      yPx: px.yPx,
      width: baseWidth,
      height: baseHeight,
      labelText,
    });
    return (
      <g key={annotation.id} pointerEvents="none">
        <path
          d={cloudPath}
          fill={fill}
          fillOpacity={fillOpacity}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          strokeDasharray={strokeDasharray}
          vectorEffect="non-scaling-stroke"
        />
        {renderHoverBadge({ ...badge, color: strokeColor, labelText })}
      </g>
    );
  }

  // 9. POLYGON
  if (annType === 'polygon') {
    const { pointsPx } = normalizedPolygonToPixel({
      points: annotation.geometry?.points ?? [],
      width: baseWidth,
      height: baseHeight,
    });
    if (!pointsPx || pointsPx.length === 0) return null;
    const polygonSvgStr = pointsToPolygonSvgString(pointsPx);
    const startPt = pointsPx[0] || [0, 0];
    const badge = {
      x: clamp(startPt[0], 20, Math.max(20, baseWidth - 20)),
      y: clamp(startPt[1] - 16, 16, Math.max(16, baseHeight - 16)),
      width: 24,
      height: 22,
    };
    return (
      <g key={annotation.id} pointerEvents="none">
        <polygon
          points={polygonSvgStr}
          fill={fill}
          fillOpacity={fillOpacity}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          strokeDasharray={strokeDasharray}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {renderHoverBadge({ ...badge, color: strokeColor, labelText })}
      </g>
    );
  }

  // 10. TEXTBOX
  if (annType === 'textbox') {
    const px = normalizedTextboxToPixel({
      x: annotation.geometry?.x ?? 0.1,
      y: annotation.geometry?.y ?? 0.1,
      width: annotation.geometry?.width ?? 0.2,
      height: annotation.geometry?.height ?? 0.1,
      baseWidth,
      baseHeight,
    });
    const badge = getRectBadgeCoordinates({
      xPx: px.xPx,
      yPx: px.yPx,
      width: baseWidth,
      height: baseHeight,
      labelText,
    });
    const contentText = annotation.geometry?.text || annotation.comment || '';
    return (
      <g key={annotation.id} pointerEvents="none">
        <rect
          x={px.xPx}
          y={px.yPx}
          width={px.widthPx}
          height={px.heightPx}
          rx={4}
          fill={fill}
          fillOpacity={fillOpacity}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          strokeDasharray={strokeDasharray}
          vectorEffect="non-scaling-stroke"
        />
        {contentText ? (
          <text
            x={px.xPx + 6}
            y={px.yPx + Math.min(18, px.heightPx / 2 + 5)}
            fill={strokeColor}
            fontSize="11"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          >
            {contentText.length > 20 ? `${contentText.slice(0, 19)}…` : contentText}
          </text>
        ) : null}
        {renderHoverBadge({ ...badge, color: strokeColor, labelText })}
      </g>
    );
  }

  // 11. BLUR / PIXELATE
  if (annType === 'blur') {
    const px = normalizedBlurToPixel({
      x: annotation.geometry?.x ?? 0.1,
      y: annotation.geometry?.y ?? 0.1,
      width: annotation.geometry?.width ?? 0.2,
      height: annotation.geometry?.height ?? 0.2,
      baseWidth,
      baseHeight,
    });
    const badge = getRectBadgeCoordinates({
      xPx: px.xPx,
      yPx: px.yPx,
      width: baseWidth,
      height: baseHeight,
      labelText,
    });
    return (
      <g key={annotation.id} pointerEvents="none">
        <rect
          x={px.xPx}
          y={px.yPx}
          width={px.widthPx}
          height={px.heightPx}
          rx={2}
          fill="rgba(255, 255, 255, 0.45)"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          strokeDasharray="5 3"
          vectorEffect="non-scaling-stroke"
        />
        {renderHoverBadge({ ...badge, color: strokeColor, labelText })}
      </g>
    );
  }

  // 12. CIRCLE (Default / Backward Compatible)
  const px = normalizedCircleToPixel({
    cx: annotation.geometry?.cx ?? annotation.cx ?? 0.5,
    cy: annotation.geometry?.cy ?? annotation.cy ?? 0.5,
    r: annotation.geometry?.r ?? annotation.r ?? 0.1,
    width: baseWidth,
    height: baseHeight,
  });
  const badge = getCircleBadgeCoordinates({
    cxPx: px.cxPx,
    cyPx: px.cyPx,
    rPx: px.rPx,
    width: baseWidth,
    height: baseHeight,
    labelText,
  });

  return (
    <g key={annotation.id} pointerEvents="none">
      <circle
        cx={px.cxPx}
        cy={px.cyPx}
        r={px.rPx}
        fill={fill}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeOpacity={strokeOpacity}
        strokeDasharray={strokeDasharray}
        vectorEffect="non-scaling-stroke"
      />
      {renderHoverBadge({ ...badge, color: strokeColor, labelText })}
    </g>
  );
}

function LazyThumbnail({
  image,
  index,
  isSelected,
  onSelect,
  scrollRootRef,
  imageAnnotations = [],
  canReview = false,
  onHoverStart,
  onHoverEnd,
}) {
  const itemRef = useRef(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const node = itemRef.current;
    if (!node || shouldLoad) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      {
        root: scrollRootRef.current ?? null,
        rootMargin: '240px',
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollRootRef, shouldLoad]);

  useEffect(() => {
    if (!shouldLoad || url) return undefined;

    let cancelled = false;
    setLoading(true);
    setHasError(false);

    getSignedImageUrl(image.storage_path)
      .then((signedUrl) => {
        if (!cancelled) {
          setUrl(signedUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasError(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [image.storage_path, shouldLoad, url]);

  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [isSelected]);

  const openAnnotations = imageAnnotations.filter((a) => a.status !== 'resolved');
  const resolvedAnnotations = imageAnnotations.filter((a) => a.status === 'resolved');

  const handleMouseEnter = () => {
    if (!itemRef.current) return;
    const rect = itemRef.current.getBoundingClientRect();
    onHoverStart?.({
      image,
      index,
      rect,
      url,
      annotations: imageAnnotations,
      openCount: openAnnotations.length,
      resolvedCount: resolvedAnnotations.length,
    });
  };

  const handleMouseLeave = () => {
    onHoverEnd?.();
  };

  return (
    <button
      ref={itemRef}
      type="button"
      className={`fc-thumb-btn${isSelected ? ' fc-thumb-btn-selected' : ''}`}
      onClick={() => onSelect(image.id)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      title={image.relative_path || image.original_filename}
      aria-current={isSelected ? 'true' : undefined}
      aria-label={`Image #${index + 1}: ${image.original_filename}`}
    >
      <div className="fc-thumb-frame">
        {!shouldLoad || (loading && !hasError) ? (
          <div className="fc-thumb-placeholder" aria-hidden="true">
            <span className="fc-thumb-skeleton" />
          </div>
        ) : null}

        {hasError ? (
          <div className="fc-thumb-error">Unavailable</div>
        ) : url ? (
          <img
            src={url}
            alt={image.original_filename}
            className={`fc-thumb-img${loading ? ' fc-thumb-img-hidden' : ''}`}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setHasError(true);
            }}
          />
        ) : null}

        <span className="fc-thumb-index">#{index + 1}</span>
        {(image.current_version_number || 1) > 1 && (
          <span
            className="fc-thumb-version-pill"
            title={`Version ${image.current_version_number}`}
            aria-label={`Version ${image.current_version_number}`}
          >
            v{image.current_version_number}
          </span>
        )}
        {canReview && image.replacement_status === 'pending_approval' && (
          <span
            className="fc-thumb-pending-badge"
            title="Replacement Pending Review"
            aria-label="Replacement Pending Review"
          >
            ⚡
          </span>
        )}

        {/* Status badges visible only to Reviewers and Admins; strictly hidden for Uploaders */}
        {canReview ? (
          image.is_completed ? (
            <span
              className="fc-thumb-status-badge fc-thumb-status-completed"
              title="Image marked as completed"
              aria-label="Completed"
            >
              ✓
            </span>
          ) : openAnnotations.length > 0 ? (
            <span
              className="fc-thumb-status-badge fc-thumb-status-open"
              title={`${openAnnotations.length} open ${
                openAnnotations.length === 1 ? 'annotation' : 'annotations'
              }`}
              aria-label={`${openAnnotations.length} open annotations`}
            >
              {openAnnotations.length}
            </span>
          ) : resolvedAnnotations.length > 0 ? (
            <span
              className="fc-thumb-status-badge fc-thumb-status-resolved"
              title="All feedback resolved"
              aria-label="All feedback resolved"
            >
              ✓
            </span>
          ) : null
        ) : null}
      </div>
      <span className="fc-thumb-caption">{image.original_filename}</span>
    </button>
  );
}

function HoverPreviewCard({ hoverState, canReview = false, onMouseEnter, onMouseLeave }) {
  if (!hoverState || !hoverState.rect) return null;

  const { image, index, rect, url, openCount, annotations = [] } = hoverState;

  const PREVIEW_WIDTH = 360;
  const PREVIEW_HEIGHT = 280;
  const GAP = 10;
  const MARGIN = 12;

  let left = rect.left + rect.width / 2 - PREVIEW_WIDTH / 2;
  left = Math.max(MARGIN, Math.min(left, window.innerWidth - PREVIEW_WIDTH - MARGIN));

  let top;
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  if (spaceBelow >= PREVIEW_HEIGHT + GAP) {
    top = rect.bottom + GAP;
  } else if (spaceAbove >= PREVIEW_HEIGHT + GAP) {
    top = rect.top - PREVIEW_HEIGHT - GAP;
  } else {
    top = Math.max(MARGIN, (window.innerHeight - PREVIEW_HEIGHT) / 2);
  }

  const [naturalDimensions, setNaturalDimensions] = useState(null);
  const imgRef = useRef(null);

  useEffect(() => {
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      setNaturalDimensions({
        naturalWidth: imgRef.current.naturalWidth,
        naturalHeight: imgRef.current.naturalHeight,
      });
    } else {
      setNaturalDimensions(null);
    }
  }, [url]);

  const handleImgLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) {
      setNaturalDimensions({ naturalWidth, naturalHeight });
    }
  };

  const baseWidth = 1000;
  const baseHeight = naturalDimensions
    ? Math.max(10, Math.round((1000 * naturalDimensions.naturalHeight) / naturalDimensions.naturalWidth))
    : 750;

  // Compute unique reviewers count
  const uniqueReviewersCount = useMemo(() => {
    if (!annotations || annotations.length === 0) return 0;
    const reviewerKeys = new Set();
    for (const ann of annotations) {
      const key =
        ann.created_by ||
        ann.createdBy ||
        ann.creatorName ||
        ann.creator?.display_name ||
        ann.creator_name;
      if (key) reviewerKeys.add(String(key));
    }
    return reviewerKeys.size || (annotations.length > 0 ? 1 : 0);
  }, [annotations]);

  // Review status badge & summary text (Reviewers/Admins only)
  const statusLabel = image.is_completed
    ? 'Completed'
    : annotations && annotations.length > 0
      ? openCount > 0
        ? `In Review (${openCount} Open)`
        : 'In Review (Resolved)'
      : 'Not Started';

  const statusClass = image.is_completed
    ? 'fc-hover-status-completed'
    : annotations && annotations.length > 0
      ? 'fc-hover-status-in-review'
      : 'fc-hover-status-not-started';

  const summaryText = useMemo(() => {
    if (!canReview) return null;
    if (!annotations || annotations.length === 0) {
      return 'No feedback';
    }
    const annCount = annotations.length;
    const annLabel = annCount === 1 ? '1 annotation' : `${annCount} annotations`;
    const revLabel = uniqueReviewersCount === 1 ? '1 reviewer' : `${uniqueReviewersCount} reviewers`;
    return `${annLabel} · ${revLabel}`;
  }, [annotations, canReview, uniqueReviewersCount]);

  return createPortal(
    <div
      className="fc-hover-preview-card"
      style={{ left: `${left}px`, top: `${top}px` }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="tooltip"
      aria-label={`Preview of Image #${index + 1}`}
    >
      <div className="fc-hover-preview-media">
        {url ? (
          <div className="fc-hover-preview-stage">
            <img
              ref={imgRef}
              src={url}
              alt={image.original_filename}
              className="fc-hover-preview-img"
              onLoad={handleImgLoad}
            />
            {canReview && naturalDimensions && annotations && annotations.length > 0 ? (
              <svg
                className="fc-hover-preview-overlay"
                viewBox={`0 0 ${baseWidth} ${baseHeight}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {annotations.map((ann, idx) => (
                  <HoverAnnotationItem
                    key={ann.id || idx}
                    annotation={ann}
                    baseWidth={baseWidth}
                    baseHeight={baseHeight}
                  />
                ))}
              </svg>
            ) : null}
          </div>
        ) : (
          <div className="fc-hover-preview-placeholder">
            <span className="fc-hover-preview-spinner" />
            <span>Loading preview…</span>
          </div>
        )}
      </div>

      <div className="fc-hover-preview-meta">
        <div className="fc-hover-preview-row">
          <span className="fc-hover-preview-number">#{index + 1}</span>
          {(image.current_version_number || 1) > 1 && (
            <span className="fc-hover-preview-vpill" title={`Version ${image.current_version_number}`}>
              v{image.current_version_number}
            </span>
          )}
          <span className="fc-hover-preview-filename" title={image.original_filename}>
            {image.original_filename}
          </span>
        </div>

        <div className="fc-hover-preview-footer">
          {canReview ? (
            <>
              {image.replacement_status === 'pending_approval' ? (
                <span className="fc-hover-status-tag fc-hover-status-replacement" title="A corrected replacement version is awaiting review">
                  <span className="fc-hover-status-dot" aria-hidden="true" />
                  Replacement Pending
                </span>
              ) : (
                <span className={`fc-hover-status-tag ${statusClass}`}>
                  <span className="fc-hover-status-dot" aria-hidden="true" />
                  {statusLabel}
                </span>
              )}

              {annotations && annotations.length > 0 ? (
                <span className="fc-hover-annotation-count" title={summaryText}>
                  {summaryText}
                </span>
              ) : (
                <span className="fc-hover-no-feedback">No feedback</span>
              )}
            </>
          ) : (
            <span className="fc-hover-status-tag fc-hover-status-neutral">
              <span className="fc-hover-status-dot" aria-hidden="true" />
              Asset Preview
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Horizontally scrollable thumbnail filmstrip with interactive hover previews,
 * review status indicators, and annotation-aware overlays.
 */
export function ThumbnailFilmstrip({
  images,
  selectedImageId,
  onSelectImage,
  annotations = [],
  variant = 'default',
  canReview = false,
}) {
  const stripRef = useRef(null);
  const [hoverState, setHoverState] = useState(null);
  const hoverTimerRef = useRef(null);
  const dismissTimerRef = useRef(null);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const annotationsByImageId = useMemo(() => {
    const map = new Map();
    for (const ann of annotations) {
      const imgId = ann.imageId || ann.image_id;
      if (!imgId) continue;
      if (!map.has(imgId)) {
        map.set(imgId, []);
      }
      map.get(imgId).push(ann);
    }
    return map;
  }, [annotations]);

  const checkScrollability = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 6);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 6);
  }, []);

  useEffect(() => {
    checkScrollability();
    const el = stripRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScrollability, { passive: true });
    window.addEventListener('resize', checkScrollability);
    return () => {
      el.removeEventListener('scroll', checkScrollability);
      window.removeEventListener('resize', checkScrollability);
    };
  }, [checkScrollability, images.length]);

  const handleScrollBy = (amount) => {
    if (!stripRef.current) return;
    stripRef.current.scrollBy({ left: amount, behavior: 'smooth' });
  };

  const handleHoverStart = useCallback((data) => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (hoverState) {
      setHoverState(data);
    } else {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => {
        setHoverState(data);
      }, 70);
    }
  }, [hoverState]);

  const handleHoverEnd = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    dismissTimerRef.current = setTimeout(() => {
      setHoverState(null);
    }, 120);
  }, []);

  const handlePreviewMouseEnter = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const handlePreviewMouseLeave = useCallback(() => {
    setHoverState(null);
  }, []);

  useEffect(() => {
    if (!hoverState) return;

    const handleDismiss = () => {
      setHoverState(null);
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setHoverState(null);
      }
    };

    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hoverState]);

  if (images.length === 0) {
    return null;
  }

  return (
    <section
      className={`fc-filmstrip-section${
        variant === 'workspace' ? ' fc-filmstrip-workspace' : ''
      }`}
      aria-label="Batch image thumbnails"
    >
      <div className="fc-filmstrip-outer">
        {canScrollLeft ? (
          <button
            type="button"
            className="fc-filmstrip-scroll-btn fc-filmstrip-scroll-left"
            onClick={() => handleScrollBy(-320)}
            title="Scroll left"
            aria-label="Scroll left"
          >
            ‹
          </button>
        ) : null}

        <div ref={stripRef} className="fc-filmstrip-scroll">
          {images.map((image, index) => (
            <LazyThumbnail
              key={image.id}
              image={image}
              index={index}
              isSelected={image.id === selectedImageId}
              onSelect={onSelectImage}
              scrollRootRef={stripRef}
              imageAnnotations={annotationsByImageId.get(image.id) || []}
              canReview={canReview}
              onHoverStart={handleHoverStart}
              onHoverEnd={handleHoverEnd}
            />
          ))}
        </div>

        {canScrollRight ? (
          <button
            type="button"
            className="fc-filmstrip-scroll-btn fc-filmstrip-scroll-right"
            onClick={() => handleScrollBy(320)}
            title="Scroll right"
            aria-label="Scroll right"
          >
            ›
          </button>
        ) : null}
      </div>

      <HoverPreviewCard
        hoverState={hoverState}
        canReview={canReview}
        onMouseEnter={handlePreviewMouseEnter}
        onMouseLeave={handlePreviewMouseLeave}
      />
    </section>
  );
}
