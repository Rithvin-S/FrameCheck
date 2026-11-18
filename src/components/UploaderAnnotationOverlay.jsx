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
import './UploaderAnnotationOverlay.css';

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

function renderUploaderBadge({ x, y, width, height, color, labelText, isSelected, onClick }) {
  if (!labelText) return null;
  return (
    <g
      className={`fc-uiv-ann-badge-group${isSelected ? ' fc-uiv-ann-badge-selected-group' : ''}`}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      role="button"
      tabIndex={0}
      aria-label={`Annotation #${labelText}`}
    >
      <rect
        x={x - width / 2}
        y={y - height / 2}
        width={width}
        height={height}
        rx={height / 2}
        fill={isSelected ? '#0284c7' : color}
        stroke={isSelected ? '#38bdf8' : '#ffffff'}
        strokeWidth={isSelected ? 2.5 : 1.5}
        className={`fc-uiv-ann-badge-rect${isSelected ? ' fc-uiv-ann-badge-selected' : ''}`}
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
        pointerEvents="none"
      >
        #{labelText}
      </text>
    </g>
  );
}

function UploaderAnnotationItem({
  annotation,
  baseWidth,
  baseHeight,
  isSelected,
  onSelect,
}) {
  const tool = annotation.geometry?.tool
    ? String(annotation.geometry.tool).trim().toLowerCase()
    : null;
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
  const fillOpacity = annotation.style?.fillEnabled
    ? (annotation.style?.fillOpacity ?? 0.2)
    : 0;
  const fill = annotation.style?.fillEnabled ? fillColor : 'none';

  const handleClick = (e) => {
    e.stopPropagation();
    onSelect(annotation.id);
  };

  const handlePointerDown = (e) => {
    e.stopPropagation();
  };

  const groupProps = {
    className: `fc-uiv-ann-group${isSelected ? ' fc-uiv-ann-group-selected' : ''}`,
    onClick: handleClick,
    onPointerDown: handlePointerDown,
  };

  // 1. PIN MARKER
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
      <g {...groupProps} key={annotation.id}>
        <path
          d={pinPathD}
          fill={isSelected ? '#0284c7' : strokeColor}
          stroke={isSelected ? '#38bdf8' : '#ffffff'}
          strokeWidth={isSelected ? 3 : 2}
          className="fc-uiv-ann-shape"
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
          pointerEvents="none"
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
      <g {...groupProps} key={annotation.id}>
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
          className="fc-uiv-ann-shape"
          vectorEffect="non-scaling-stroke"
        />
        {/* Invisible wider hit region */}
        <rect
          x={px.xPx - 6}
          y={px.yPx - 6}
          width={px.widthPx + 12}
          height={px.heightPx + 12}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
        />
        {renderUploaderBadge({ ...badge, color: strokeColor, labelText, isSelected, onClick: handleClick })}
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
      <g {...groupProps} key={annotation.id}>
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
          className="fc-uiv-ann-shape"
          vectorEffect="non-scaling-stroke"
        />
        {/* Invisible wider hit line */}
        <line
          x1={px.startXPx}
          y1={px.startYPx}
          x2={px.endXPx}
          y2={px.endYPx}
          stroke="transparent"
          strokeWidth={16}
          strokeLinecap="round"
        />
        {annotation.style?.arrowHead === 'stealth' ? (
          <polygon
            points={arrowhead.stealthPolygonString}
            fill={strokeColor}
            stroke={strokeColor}
            strokeWidth={1}
            fillOpacity={strokeOpacity}
            className="fc-uiv-ann-shape"
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
              className="fc-uiv-ann-shape"
              vectorEffect="non-scaling-stroke"
            />
            <polygon
              points={arrowhead.startPolygonString}
              fill={strokeColor}
              stroke={strokeColor}
              strokeWidth={1}
              fillOpacity={strokeOpacity}
              className="fc-uiv-ann-shape"
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
            className="fc-uiv-ann-shape"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <polygon
            points={arrowhead.polygonString}
            fill={strokeColor}
            stroke={strokeColor}
            strokeWidth={1}
            fillOpacity={strokeOpacity}
            className="fc-uiv-ann-shape"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {renderUploaderBadge({ ...badge, color: strokeColor, labelText, isSelected, onClick: handleClick })}
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
      <g {...groupProps} key={annotation.id}>
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
          className="fc-uiv-ann-shape"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={px.startXPx}
          y1={px.startYPx}
          x2={px.endXPx}
          y2={px.endYPx}
          stroke="transparent"
          strokeWidth={16}
          strokeLinecap="round"
        />
        {renderUploaderBadge({ ...badge, color: strokeColor, labelText, isSelected, onClick: handleClick })}
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
      <g {...groupProps} key={annotation.id}>
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth || 3}
          strokeOpacity={strokeOpacity}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={strokeDasharray}
          className="fc-uiv-ann-shape"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={pathD}
          fill="none"
          stroke="transparent"
          strokeWidth={18}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {renderUploaderBadge({ ...badge, color: strokeColor, labelText, isSelected, onClick: handleClick })}
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
      <g {...groupProps} key={annotation.id} style={{ mixBlendMode: 'multiply' }}>
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth={Math.max(12, (strokeWidth || 3) * 4)}
          strokeOpacity={annotation.style?.strokeOpacity ?? 0.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="fc-uiv-ann-shape"
          vectorEffect="non-scaling-stroke"
        />
        {renderUploaderBadge({ ...badge, color: strokeColor, labelText, isSelected, onClick: handleClick })}
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
    const calloutText = annotation.geometry?.calloutText || annotation.comment || '';
    return (
      <g {...groupProps} key={annotation.id}>
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
          className="fc-uiv-ann-shape"
          vectorEffect="non-scaling-stroke"
        />
        <polygon
          points={connector.arrowhead.polygonString}
          fill={strokeColor}
          stroke={strokeColor}
          strokeWidth={1}
          fillOpacity={strokeOpacity}
          className="fc-uiv-ann-shape"
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
          className="fc-uiv-ann-shape"
          vectorEffect="non-scaling-stroke"
        />
        {calloutText ? (
          <text
            x={px.boxXPx + 6}
            y={px.boxYPx + Math.min(18, px.boxHeightPx / 2 + 5)}
            fill="#1e293b"
            fontSize="11"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            pointerEvents="none"
          >
            {calloutText.length > 20 ? `${calloutText.slice(0, 19)}…` : calloutText}
          </text>
        ) : null}
        {renderUploaderBadge({ ...badge, color: strokeColor, labelText, isSelected, onClick: handleClick })}
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
      <g {...groupProps} key={annotation.id}>
        <path
          d={cloudPath}
          fill={fill}
          fillOpacity={fillOpacity}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          strokeDasharray={strokeDasharray}
          className="fc-uiv-ann-shape"
          vectorEffect="non-scaling-stroke"
        />
        {renderUploaderBadge({ ...badge, color: strokeColor, labelText, isSelected, onClick: handleClick })}
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
      <g {...groupProps} key={annotation.id}>
        <polygon
          points={polygonSvgStr}
          fill={fill}
          fillOpacity={fillOpacity}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          strokeDasharray={strokeDasharray}
          strokeLinejoin="round"
          className="fc-uiv-ann-shape"
          vectorEffect="non-scaling-stroke"
        />
        {renderUploaderBadge({ ...badge, color: strokeColor, labelText, isSelected, onClick: handleClick })}
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
      <g {...groupProps} key={annotation.id}>
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
          className="fc-uiv-ann-shape"
          vectorEffect="non-scaling-stroke"
        />
        {contentText ? (
          <text
            x={px.xPx + 6}
            y={px.yPx + Math.min(18, px.heightPx / 2 + 5)}
            fill={strokeColor}
            fontSize="11"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            pointerEvents="none"
          >
            {contentText.length > 20 ? `${contentText.slice(0, 19)}…` : contentText}
          </text>
        ) : null}
        {renderUploaderBadge({ ...badge, color: strokeColor, labelText, isSelected, onClick: handleClick })}
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
      <g {...groupProps} key={annotation.id}>
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
          className="fc-uiv-ann-shape"
          vectorEffect="non-scaling-stroke"
        />
        {renderUploaderBadge({ ...badge, color: strokeColor, labelText, isSelected, onClick: handleClick })}
      </g>
    );
  }

  // 12. CIRCLE (Default)
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
    <g {...groupProps} key={annotation.id}>
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
        className="fc-uiv-ann-shape"
        vectorEffect="non-scaling-stroke"
      />
      {/* Invisible wider hit ring */}
      <circle
        cx={px.cxPx}
        cy={px.cyPx}
        r={px.rPx}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(16, strokeWidth + 12)}
      />
      {renderUploaderBadge({ ...badge, color: strokeColor, labelText, isSelected, onClick: handleClick })}
    </g>
  );
}

/**
 * Read-Only Annotation Overlay for the Uploader Image Viewer.
 * Accurately renders every annotation type directly over the original image,
 * scales synchronously with zoom & pan, and supports clicking to select and inspect
 * correction comments.
 */
export function UploaderAnnotationOverlay({
  annotations = [],
  baseWidth = 1000,
  baseHeight = 750,
  selectedAnnotationId = null,
  onSelectAnnotation,
}) {
  if (!annotations || annotations.length === 0 || baseWidth <= 0 || baseHeight <= 0) {
    return null;
  }

  return (
    <svg
      className="fc-uiv-annotation-svg"
      viewBox={`0 0 ${baseWidth} ${baseHeight}`}
      preserveAspectRatio="none"
      aria-label="Reviewer annotations overlay"
    >
      <defs>
        <filter id="fc-uiv-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#38bdf8" floodOpacity="0.9" />
        </filter>
      </defs>

      {annotations.map((ann) => (
        <UploaderAnnotationItem
          key={ann.id}
          annotation={ann}
          baseWidth={baseWidth}
          baseHeight={baseHeight}
          isSelected={ann.id === selectedAnnotationId}
          onSelect={onSelectAnnotation}
        />
      ))}
    </svg>
  );
}
