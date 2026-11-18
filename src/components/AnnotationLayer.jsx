import { useEffect, useRef, useState } from 'react';
import {
  ANNOTATION_TYPES,
  MIN_ANNOTATION_RADIUS_PX,
  clamp,
  clampMovedCirclePx,
  clampResizedRadiusPx,
  normalizedCircleToPixel,
  pixelCircleToNormalized,
  pixelArrowToNormalized,
  normalizedArrowToPixel,
  clampMovedArrowPx,
  calculateArrowheadPoints,
  pixelLineToNormalized,
  normalizedLineToPixel,
  clampMovedLinePx,
  pixelRectToNormalized,
  normalizedRectToPixel,
  clampMovedRectPx,
  clampResizedRectPx,
  pixelCloudToNormalized,
  normalizedCloudToPixel,
  generateCloudSvgPath,
  pixelTextboxToNormalized,
  normalizedTextboxToPixel,
  pixelBlurToNormalized,
  normalizedBlurToPixel,
  pixelPencilToNormalized,
  normalizedPencilToPixel,
  simplifyPencilStroke,
  pointsToSmoothSvgPath,
  clampMovedPencilPx,
  getPencilBadgeCoordinates,
  pixelPolygonToNormalized,
  normalizedPolygonToPixel,
  clampMovedPolygonPx,
  pointsToPolygonSvgString,
  pixelHighlighterToNormalized,
  normalizedHighlighterToPixel,
  clampMovedHighlighterPx,
  pixelCalloutToNormalized,
  normalizedCalloutToPixel,
  calculateCalloutConnector,
  clampMovedCalloutPx,
  clampMovedCalloutPointerPx,
  clampResizedCalloutBoxPx,
  getCalloutBadgeCoordinates,
  getReviewerColor,
  translateAnnotationGeometry,
} from '../services/annotationState.js';
import './AnnotationLayer.css';

const CIRCLE_HANDLE_POSITIONS = [
  { key: 'n', dx: 0, dy: -1, cursor: 'ns-resize' },
  { key: 'e', dx: 1, dy: 0, cursor: 'ew-resize' },
  { key: 's', dx: 0, dy: 1, cursor: 'ns-resize' },
  { key: 'w', dx: -1, dy: 0, cursor: 'ew-resize' },
];

const RECT_HANDLE_POSITIONS = [
  { key: 'nw', cursor: 'nwse-resize' },
  { key: 'n', cursor: 'ns-resize' },
  { key: 'ne', cursor: 'nesw-resize' },
  { key: 'e', cursor: 'ew-resize' },
  { key: 'se', cursor: 'nwse-resize' },
  { key: 's', cursor: 'ns-resize' },
  { key: 'sw', cursor: 'nesw-resize' },
  { key: 'w', cursor: 'ew-resize' },
];

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

function renderBadge({
  x,
  y,
  width,
  height,
  color,
  labelText,
  marker = null,
  markerColor = '#f59e0b',
  stamp = null,
  stampColor = null,
  labels = [],
  isEditable = false,
  onPointerDown = null,
  isNavigating = false,
  selectors = [],
}) {
  const markerIconMap = {
    star: '★',
    flag: '⚑',
    bug: '🪲',
    pin: '📌',
    warning: '⚠️',
  };
  const stampConfig = {
    priority: { icon: '⚡', label: 'Priority', color: '#ef4444' },
    warning: { icon: '⚠️', label: 'Warning', color: '#f59e0b' },
    suggestion: { icon: '💡', label: 'Suggestion', color: '#06b6d4' },
    issue: { icon: '🪲', label: 'Issue', color: '#8b5cf6' },
  };
  const markerGlyph = marker ? markerIconMap[marker] || '★' : null;
  const stampInfo = stamp ? stampConfig[stamp] : null;
  const effectiveStampColor = stampColor || stampInfo?.color || '#ef4444';

  return (
    <g
      className={isEditable ? 'fc-ann-badge-group' : 'fc-ann-badge-group fc-ann-badge-readonly'}
      pointerEvents={isNavigating ? 'none' : undefined}
      onPointerDown={isNavigating ? undefined : onPointerDown}
    >
      <rect
        x={x - width / 2}
        y={y - height / 2}
        width={width}
        height={height}
        rx={height / 2}
        fill={color}
        stroke="#ffffff"
        strokeWidth={1.75}
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        className="fc-ann-badge-text"
      >
        {labelText}
      </text>

      {/* Visual Marker Tag */}
      {markerGlyph && !stampInfo ? (
        <g transform={`translate(${x - width / 2 - 14}, ${y - 8})`}>
          <circle
            cx="7"
            cy="7"
            r="7"
            fill={markerColor || '#f59e0b'}
            stroke="#ffffff"
            strokeWidth="1.2"
          />
          <text
            x="7"
            y="7.5"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#ffffff"
            fontSize="9"
            fontWeight="bold"
          >
            {markerGlyph}
          </text>
        </g>
      ) : null}

      {/* Visual Stamp Tag (Priority, Warning, Suggestion, Issue) */}
      {stampInfo ? (
        <g transform={`translate(${x - width / 2 - 18}, ${y - 9})`}>
          <rect
            x="0"
            y="0"
            width="17"
            height="17"
            rx="8.5"
            fill={effectiveStampColor}
            stroke="#ffffff"
            strokeWidth="1.2"
          />
          <text
            x="8.5"
            y="9"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="9.5"
          >
            {stampInfo.icon}
          </text>
        </g>
      ) : null}

      {/* Custom Annotation Labels */}
      {Array.isArray(labels) && labels.length > 0 ? (
        <g className="fc-ann-canvas-labels" transform={`translate(${x - width / 2}, ${y + height / 2 + 2})`}>
          {labels.slice(0, 2).map((lbl, lIdx) => {
            const lblName = typeof lbl === 'string' ? lbl : (lbl?.name || '');
            const lblColor = (typeof lbl === 'object' && lbl?.color) ? lbl.color : '#334155';
            const pillWidth = Math.min(65, Math.max(16, (lblName.length || 4) * 5.2 + 8));
            return (
              <g key={lIdx} transform={`translate(${lIdx * (pillWidth + 3)}, 0)`}>
                <rect
                  x="0"
                  y="0"
                  width={pillWidth}
                  height="12"
                  rx="3"
                  fill={lblColor}
                  fillOpacity={0.92}
                  stroke="#ffffff"
                  strokeWidth="0.8"
                />
                <text
                  x={pillWidth / 2}
                  y="6.5"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#ffffff"
                  fontSize="7.5"
                  fontWeight="600"
                >
                  {lblName.length > 8 ? `${lblName.slice(0, 7)}…` : lblName}
                </text>
              </g>
            );
          })}
          {labels.length > 2 ? (
            <text
              x={labels.slice(0, 2).reduce((acc, lbl) => {
                const n = typeof lbl === 'string' ? lbl : (lbl?.name || '');
                return acc + Math.min(65, Math.max(16, n.length * 5.2 + 8)) + 3;
              }, 0)}
              y="6.5"
              dominantBaseline="central"
              fill="#94a3b8"
              fontSize="7.5"
              fontWeight="bold"
            >
              +{labels.length - 2}
            </text>
          ) : null}
        </g>
      ) : null}

      {selectors && selectors.length > 0 ? (
        <g className="fc-ann-collab-badges" pointerEvents="none">
          {selectors.map((sel, idx) => {
            const pillW = Math.max(22, (sel.displayName?.length || 6) * 6.8 + 10);
            const pillH = 16;
            const offsetX = x + width / 2 + 5 + idx * (pillW + 4);
            const offsetY = y - pillH / 2;
            return (
              <g key={sel.userId || idx} transform={`translate(${offsetX}, ${offsetY})`}>
                <rect
                  x="0"
                  y="0"
                  width={pillW}
                  height={pillH}
                  rx="8"
                  fill={sel.color}
                  stroke="#ffffff"
                  strokeWidth="1.2"
                />
                <text
                  x={pillW / 2}
                  y="11.5"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="9.5"
                  fontWeight="bold"
                  fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                >
                  {sel.displayName}
                </text>
              </g>
            );
          })}
        </g>
      ) : null}
    </g>
  );
}

function renderPreviewCircle({ cxPx, cyPx, rPx, color, labelText, boxWidth, boxHeight }) {
  const badge = getCircleBadgeCoordinates({
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
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={cxPx}
        cy={cyPx}
        r={rPx}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      {renderBadge({ ...badge, color, labelText })}
    </g>
  );
}

function renderPreviewArrow({ startXPx, startYPx, endXPx, endYPx, color, labelText, boxWidth, boxHeight }) {
  const badge = getArrowBadgeCoordinates({
    startXPx,
    startYPx,
    width: boxWidth,
    height: boxHeight,
    labelText,
  });
  const arrowhead = calculateArrowheadPoints({
    startXPx,
    startYPx,
    endXPx,
    endYPx,
  });

  return (
    <g pointerEvents="none">
      <line
        x1={startXPx}
        y1={startYPx}
        x2={endXPx}
        y2={endYPx}
        stroke="#ffffff"
        strokeWidth={5}
        strokeOpacity={0.85}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={arrowhead.polygonString}
        fill="#ffffff"
        fillOpacity={0.85}
        stroke="#ffffff"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={startXPx}
        y1={startYPx}
        x2={endXPx}
        y2={endYPx}
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={arrowhead.polygonString}
        fill={color}
        stroke={color}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {renderBadge({ ...badge, color, labelText })}
    </g>
  );
}

function renderPreviewLine({ startXPx, startYPx, endXPx, endYPx, color, labelText, boxWidth, boxHeight }) {
  const badge = getArrowBadgeCoordinates({
    startXPx,
    startYPx,
    width: boxWidth,
    height: boxHeight,
    labelText,
  });

  return (
    <g pointerEvents="none">
      <line
        x1={startXPx}
        y1={startYPx}
        x2={endXPx}
        y2={endYPx}
        stroke="#ffffff"
        strokeWidth={5}
        strokeOpacity={0.85}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={startXPx}
        y1={startYPx}
        x2={endXPx}
        y2={endYPx}
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      {renderBadge({ ...badge, color, labelText })}
    </g>
  );
}

function renderPreviewCloud({ xPx, yPx, widthPx, heightPx, color, labelText, boxWidth, boxHeight }) {
  const badge = getRectBadgeCoordinates({
    xPx,
    yPx,
    width: boxWidth,
    height: boxHeight,
    labelText,
  });
  const cloudPath = generateCloudSvgPath({ xPx, yPx, widthPx, heightPx });

  return (
    <g pointerEvents="none">
      <path
        d={cloudPath}
        fill={color}
        fillOpacity={0.08}
        stroke="#ffffff"
        strokeWidth={5}
        strokeOpacity={0.85}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={cloudPath}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      {renderBadge({ ...badge, color, labelText })}
    </g>
  );
}

function renderPreviewHighlighter({ pointsPx, color, labelText, boxWidth, boxHeight }) {
  const pathD = pointsToSmoothSvgPath(pointsPx);
  const badge = getPencilBadgeCoordinates({
    pointsPx,
    width: boxWidth,
    height: boxHeight,
    labelText,
  });

  return (
    <g pointerEvents="none">
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={14}
        strokeOpacity={0.45}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ mixBlendMode: 'multiply' }}
        vectorEffect="non-scaling-stroke"
      />
      {renderBadge({ ...badge, color, labelText })}
    </g>
  );
}

function renderPreviewPolygon({ pointsPx, cursorPt, color, labelText, boxWidth, boxHeight }) {
  const pts = Array.isArray(pointsPx) ? pointsPx : [];
  if (pts.length === 0) return null;

  const startPt = pts[0];
  const isNearStart = cursorPt && pts.length >= 3 && Math.hypot(cursorPt.x - startPt[0], cursorPt.y - startPt[1]) < 18;
  const badge = {
    x: clamp(startPt[0], 20, Math.max(20, boxWidth - 20)),
    y: clamp(startPt[1] - 16, 16, Math.max(16, boxHeight - 16)),
    width: 28,
    height: 22,
  };

  return (
    <g pointerEvents="none">
      {pts.length >= 2 ? (
        <path
          d={`M ${pts.map(([x, y]) => `${x},${y}`).join(' L ')}`}
          fill="none"
          stroke="#ffffff"
          strokeWidth={5}
          strokeOpacity={0.85}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {pts.length >= 2 ? (
        <path
          d={`M ${pts.map(([x, y]) => `${x},${y}`).join(' L ')}`}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}

      {cursorPt && pts.length >= 1 ? (
        <line
          x1={pts[pts.length - 1][0]}
          y1={pts[pts.length - 1][1]}
          x2={cursorPt.x}
          y2={cursorPt.y}
          stroke={color}
          strokeWidth={1.75}
          strokeDasharray="4 3"
          strokeOpacity={0.7}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}

      {pts.map(([vx, vy], idx) => (
        <circle
          key={idx}
          cx={vx}
          cy={vy}
          r={idx === 0 && isNearStart ? 7 : 4}
          fill={idx === 0 && isNearStart ? '#22c55e' : color}
          stroke="#ffffff"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {isNearStart ? (
        <text
          x={startPt[0]}
          y={startPt[1] - 12}
          fill="#22c55e"
          fontSize="11"
          fontWeight="700"
          textAnchor="middle"
        >
          Click to close
        </text>
      ) : null}

      {renderBadge({ ...badge, color, labelText })}
    </g>
  );
}

function renderPreviewTextbox({ xPx, yPx, widthPx, heightPx, color, labelText, boxWidth, boxHeight }) {
  const badge = getRectBadgeCoordinates({
    xPx,
    yPx,
    width: boxWidth,
    height: boxHeight,
    labelText,
  });

  return (
    <g pointerEvents="none">
      <rect
        x={xPx}
        y={yPx}
        width={widthPx}
        height={heightPx}
        rx={4}
        fill="#ffffff"
        fillOpacity={0.88}
        stroke="#ffffff"
        strokeWidth={5}
        strokeOpacity={0.85}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x={xPx}
        y={yPx}
        width={widthPx}
        height={heightPx}
        rx={4}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={xPx + 10}
        y={yPx + 18}
        fill={color}
        fontSize="11"
        fontWeight="500"
      >
        Text Box…
      </text>
      {renderBadge({ ...badge, color, labelText })}
    </g>
  );
}

function renderPreviewBlur({ xPx, yPx, widthPx, heightPx, color, labelText, boxWidth, boxHeight }) {
  const badge = getRectBadgeCoordinates({
    xPx,
    yPx,
    width: boxWidth,
    height: boxHeight,
    labelText,
  });
  const clipId = `fc-blur-preview-clip-${Math.round(xPx)}-${Math.round(yPx)}-${Math.round(widthPx)}-${Math.round(heightPx)}`;

  return (
    <g pointerEvents="none">
      <defs>
        <clipPath id={clipId}>
          <rect x={xPx} y={yPx} width={widthPx} height={heightPx} rx={2} />
        </clipPath>
      </defs>
      <foreignObject
        x={xPx}
        y={yPx}
        width={widthPx}
        height={heightPx}
        style={{ overflow: 'hidden' }}
        clipPath={`url(#${clipId})`}
      >
        <div
          className="fc-ann-blur-box"
          style={{
            width: '100%',
            height: '100%',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            borderRadius: '2px',
            overflow: 'hidden',
            contain: 'strict',
          }}
        />
      </foreignObject>
      <rect
        x={xPx}
        y={yPx}
        width={widthPx}
        height={heightPx}
        rx={2}
        fill="none"
        stroke="#ffffff"
        strokeWidth={4}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x={xPx}
        y={yPx}
        width={widthPx}
        height={heightPx}
        rx={2}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      {renderBadge({ ...badge, color, labelText })}
    </g>
  );
}

function renderPreviewRectangle({ xPx, yPx, widthPx, heightPx, color, labelText, boxWidth, boxHeight }) {
  const badge = getRectBadgeCoordinates({
    xPx,
    yPx,
    width: boxWidth,
    height: boxHeight,
    labelText,
  });

  return (
    <g pointerEvents="none">
      <rect
        x={xPx}
        y={yPx}
        width={widthPx}
        height={heightPx}
        rx={1.5}
        fill={color}
        fillOpacity={0.08}
        stroke="#ffffff"
        strokeWidth={5}
        strokeOpacity={0.85}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x={xPx}
        y={yPx}
        width={widthPx}
        height={heightPx}
        rx={1.5}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      {renderBadge({ ...badge, color, labelText })}
    </g>
  );
}

function renderPreviewPencil({ pointsPx, color, labelText, boxWidth, boxHeight }) {
  const pathD = pointsToSmoothSvgPath(pointsPx);
  const badge = getPencilBadgeCoordinates({
    pointsPx,
    width: boxWidth,
    height: boxHeight,
    labelText,
  });

  return (
    <g pointerEvents="none">
      <path
        d={pathD}
        fill="none"
        stroke="#ffffff"
        strokeWidth={6}
        strokeOpacity={0.85}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      {renderBadge({ ...badge, color, labelText })}
    </g>
  );
}

function renderPreviewCallout({
  pointerXPx,
  pointerYPx,
  boxXPx,
  boxYPx,
  boxWidthPx,
  boxHeightPx,
  color,
  labelText = 'Draft',
}) {
  const connector = calculateCalloutConnector({
    pointerXPx,
    pointerYPx,
    boxXPx,
    boxYPx,
    boxWidthPx,
    boxHeightPx,
  });

  return (
    <g pointerEvents="none">
      {/* Halo for connector and arrowhead */}
      <line
        x1={connector.attachXPx}
        y1={connector.attachYPx}
        x2={connector.pointerXPx}
        y2={connector.pointerYPx}
        stroke="#ffffff"
        strokeWidth={6}
        strokeOpacity={0.85}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={connector.arrowhead.polygonString}
        fill="#ffffff"
        fillOpacity={0.85}
        stroke="#ffffff"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />

      {/* Main dashed connector */}
      <line
        x1={connector.attachXPx}
        y1={connector.attachYPx}
        x2={connector.pointerXPx}
        y2={connector.pointerYPx}
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={connector.arrowhead.polygonString}
        fill={color}
        stroke={color}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />

      {/* Dashed preview text box */}
      <rect
        x={boxXPx}
        y={boxYPx}
        width={boxWidthPx}
        height={boxHeightPx}
        rx={5}
        fill="#ffffff"
        fillOpacity={0.85}
        stroke="#ffffff"
        strokeWidth={5}
        strokeOpacity={0.85}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x={boxXPx}
        y={boxYPx}
        width={boxWidthPx}
        height={boxHeightPx}
        rx={5}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function DraftCalloutItem({
  draft,
  width,
  height,
  onUpdateDraftGeometry,
  isNavigating,
}) {
  const px = normalizedCalloutToPixel({
    pointerX: draft.geometry?.pointerX ?? 0.5,
    pointerY: draft.geometry?.pointerY ?? 0.5,
    boxX: draft.geometry?.boxX ?? 0.6,
    boxY: draft.geometry?.boxY ?? 0.4,
    boxWidth: draft.geometry?.boxWidth ?? 0.2,
    boxHeight: draft.geometry?.boxHeight ?? 0.1,
    width,
    height,
  });

  const connector = calculateCalloutConnector({
    pointerXPx: px.pointerXPx,
    pointerYPx: px.pointerYPx,
    boxXPx: px.boxXPx,
    boxYPx: px.boxYPx,
    boxWidthPx: px.boxWidthPx,
    boxHeightPx: px.boxHeightPx,
  });

  const currentText = draft.geometry?.calloutText ?? '';

  return (
    <g className="fc-ann-group">
      {/* Dashed connector line */}
      <line
        x1={connector.attachXPx}
        y1={connector.attachYPx}
        x2={connector.pointerXPx}
        y2={connector.pointerYPx}
        stroke="#ffffff"
        strokeWidth={6}
        strokeOpacity={0.85}
        strokeDasharray="6 4"
        pointerEvents="none"
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={connector.arrowhead.polygonString}
        fill="#ffffff"
        fillOpacity={0.85}
        stroke="#ffffff"
        strokeWidth={3}
        pointerEvents="none"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={connector.attachXPx}
        y1={connector.attachYPx}
        x2={connector.pointerXPx}
        y2={connector.pointerYPx}
        stroke={draft.color}
        strokeWidth={2.5}
        strokeDasharray="6 4"
        pointerEvents="none"
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={connector.arrowhead.polygonString}
        fill={draft.color}
        stroke={draft.color}
        strokeWidth={1}
        pointerEvents="none"
        vectorEffect="non-scaling-stroke"
      />

      {/* Pointer Tip Dot */}
      <circle
        cx={px.pointerXPx}
        cy={px.pointerYPx}
        r={4}
        fill={draft.color}
        stroke="#ffffff"
        strokeWidth={1.5}
        pointerEvents="none"
        vectorEffect="non-scaling-stroke"
      />

      {/* Text Box embedded in foreignObject */}
      <foreignObject
        x={px.boxXPx}
        y={px.boxYPx}
        width={px.boxWidthPx}
        height={px.boxHeightPx}
        className="fc-callout-foreign"
        pointerEvents={isNavigating ? 'none' : 'all'}
      >
        <div
          className="fc-callout-box"
          style={{
            '--callout-border-color': draft.color,
            '--callout-header-bg': `${draft.color}18`,
            '--callout-chip-color': draft.color,
            borderStyle: 'dashed',
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="fc-callout-header fc-callout-header-readonly">
            <span className="fc-callout-badge-chip">Draft Callout</span>
          </div>
          <div className="fc-callout-body">
            <textarea
              className="fc-callout-textarea"
              placeholder="Type note on image…"
              value={currentText}
              autoFocus
              maxLength={2000}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                if (onUpdateDraftGeometry) {
                  onUpdateDraftGeometry({
                    ...(draft.geometry || {}),
                    calloutText: e.target.value,
                  });
                }
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
              }}
            />
          </div>
        </div>
      </foreignObject>
    </g>
  );
}

function CalloutAnnotationItem({
  annotation,
  isSelected,
  isEditable,
  isNavigating,
  effectiveBaseWidth,
  effectiveBaseHeight,
  isGestureTarget,
  gesture,
  onSelect,
  onMoveStart,
  onPointerResizeStart,
  onBoxResizeStart,
  onCommitGeometry,
  selectors = [],
}) {
  const [localText, setLocalText] = useState(annotation.geometry?.calloutText ?? '');

  useEffect(() => {
    setLocalText(annotation.geometry?.calloutText ?? '');
  }, [annotation.geometry?.calloutText]);

  let px;
  if (isGestureTarget) {
    if (gesture.tool === 'callout') {
      px = {
        pointerXPx: gesture.currentPointerXPx,
        pointerYPx: gesture.currentPointerYPx,
        boxXPx: gesture.currentBoxXPx,
        boxYPx: gesture.currentBoxYPx,
        boxWidthPx: gesture.boxWidthPx,
        boxHeightPx: gesture.boxHeightPx,
      };
    } else if (gesture.tool === 'callout-pointer') {
      px = {
        pointerXPx: gesture.currentPointerXPx,
        pointerYPx: gesture.currentPointerYPx,
        boxXPx: gesture.boxXPx,
        boxYPx: gesture.boxYPx,
        boxWidthPx: gesture.boxWidthPx,
        boxHeightPx: gesture.boxHeightPx,
      };
    } else if (gesture.tool === 'callout-box') {
      px = {
        pointerXPx: gesture.pointerXPx,
        pointerYPx: gesture.pointerYPx,
        boxXPx: gesture.currentBox.boxXPx,
        boxYPx: gesture.currentBox.boxYPx,
        boxWidthPx: gesture.currentBox.boxWidthPx,
        boxHeightPx: gesture.currentBox.boxHeightPx,
      };
    } else {
      px = normalizedCalloutToPixel({
        pointerX: annotation.geometry?.pointerX ?? 0.5,
        pointerY: annotation.geometry?.pointerY ?? 0.5,
        boxX: annotation.geometry?.boxX ?? 0.6,
        boxY: annotation.geometry?.boxY ?? 0.4,
        boxWidth: annotation.geometry?.boxWidth ?? 0.2,
        boxHeight: annotation.geometry?.boxHeight ?? 0.1,
        width: effectiveBaseWidth,
        height: effectiveBaseHeight,
      });
    }
  } else {
    px = normalizedCalloutToPixel({
      pointerX: annotation.geometry?.pointerX ?? 0.5,
      pointerY: annotation.geometry?.pointerY ?? 0.5,
      boxX: annotation.geometry?.boxX ?? 0.6,
      boxY: annotation.geometry?.boxY ?? 0.4,
      boxWidth: annotation.geometry?.boxWidth ?? 0.2,
      boxHeight: annotation.geometry?.boxHeight ?? 0.1,
      width: effectiveBaseWidth,
      height: effectiveBaseHeight,
    });
  }

  const connector = calculateCalloutConnector({
    pointerXPx: px.pointerXPx,
    pointerYPx: px.pointerYPx,
    boxXPx: px.boxXPx,
    boxYPx: px.boxYPx,
    boxWidthPx: px.boxWidthPx,
    boxHeightPx: px.boxHeightPx,
  });

  const labelText = String(annotation.displayNumber);

  const handleBlur = () => {
    const existing = annotation.geometry?.calloutText ?? '';
    const nonWhitespace = localText.replace(/\s+/g, '');
    if (!nonWhitespace || localText.length > 2000) {
      setLocalText(existing);
      return;
    }
    if (localText !== existing) {
      onCommitGeometry({
        annotationId: annotation.id,
        geometry: {
          ...(annotation.geometry || {}),
          calloutText: localText,
        },
      });
    }
  };

  return (
    <g className="fc-ann-group">
      {/* Selected Halo for connector line and arrowhead */}
      {isSelected ? (
        <>
          <line
            x1={connector.attachXPx}
            y1={connector.attachYPx}
            x2={connector.pointerXPx}
            y2={connector.pointerYPx}
            stroke="#ffffff"
            strokeWidth={6}
            strokeOpacity={0.85}
            strokeLinecap="round"
            pointerEvents="none"
            vectorEffect="non-scaling-stroke"
          />
          <polygon
            points={connector.arrowhead.polygonString}
            fill="#ffffff"
            fillOpacity={0.85}
            stroke="#ffffff"
            strokeWidth={5}
            pointerEvents="none"
            vectorEffect="non-scaling-stroke"
          />
          {/* Halo around the text box */}
          <rect
            x={px.boxXPx - 3}
            y={px.boxYPx - 3}
            width={px.boxWidthPx + 6}
            height={px.boxHeightPx + 6}
            rx={8}
            fill="none"
            stroke="#ffffff"
            strokeWidth={4}
            strokeOpacity={0.85}
            pointerEvents="none"
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : null}

      {/* Main connector line & arrowhead */}
      <line
        x1={connector.attachXPx}
        y1={connector.attachYPx}
        x2={connector.pointerXPx}
        y2={connector.pointerYPx}
        stroke={annotation.style?.strokeColor || annotation.color}
        strokeWidth={annotation.style?.strokeWidth || (isSelected ? 3 : 2.5)}
        strokeOpacity={annotation.style?.strokeOpacity ?? 1.0}
        strokeDasharray={
          annotation.style?.lineStyle === 'dashed'
            ? '8 6'
            : annotation.style?.lineStyle === 'dotted'
              ? '2 4'
              : undefined
        }
        strokeLinecap="round"
        pointerEvents="none"
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={connector.arrowhead.polygonString}
        fill={annotation.style?.strokeColor || annotation.color}
        stroke={annotation.style?.strokeColor || annotation.color}
        strokeWidth={1}
        fillOpacity={annotation.style?.strokeOpacity ?? 1.0}
        pointerEvents="none"
        vectorEffect="non-scaling-stroke"
      />

      {/* Pointer Tip Dot */}
      <circle
        cx={px.pointerXPx}
        cy={px.pointerYPx}
        r={3.5}
        fill={annotation.style?.strokeColor || annotation.color}
        stroke="#ffffff"
        strokeWidth={1.5}
        pointerEvents="none"
        vectorEffect="non-scaling-stroke"
      />

      {/* Hit target for connector line (clicking selects or drags callout) */}
      <line
        x1={connector.attachXPx}
        y1={connector.attachYPx}
        x2={connector.pointerXPx}
        y2={connector.pointerYPx}
        stroke="transparent"
        strokeWidth={14}
        strokeLinecap="round"
        className={isEditable ? 'fc-ann-hit' : 'fc-ann-hit fc-ann-hit-readonly'}
        pointerEvents={isNavigating ? 'none' : 'stroke'}
        onPointerDown={
          isNavigating
            ? undefined
            : (event) => onMoveStart(event, annotation, 'callout')
        }
      />

      {/* Text Box embedded in foreignObject */}
      <foreignObject
        x={px.boxXPx}
        y={px.boxYPx}
        width={px.boxWidthPx}
        height={px.boxHeightPx}
        className="fc-callout-foreign"
        pointerEvents={isNavigating ? 'none' : 'all'}
      >
        <div
          className={`fc-callout-box ${isSelected ? 'fc-callout-box-selected' : ''}`}
          style={{
            '--callout-border-color': annotation.style?.strokeColor || annotation.color,
            '--callout-header-bg': `${annotation.style?.strokeColor || annotation.color}15`,
            '--callout-chip-color': annotation.style?.strokeColor || annotation.color,
            ...(annotation.style?.fillEnabled ? { backgroundColor: annotation.style.fillColor || '#ffffff' } : {}),
            ...(selectors && selectors.length > 0
              ? { boxShadow: `0 0 0 2px ${selectors[0].color}` }
              : {}),
          }}
          onPointerDown={(e) => {
            if (!isNavigating) {
              onSelect(annotation.id);
            }
          }}
        >
          {/* Header Bar */}
          <div
            className={`fc-callout-header ${!isEditable ? 'fc-callout-header-readonly' : ''}`}
            title={isEditable ? 'Drag to move complete callout' : undefined}
            onPointerDown={
              isNavigating
                ? undefined
                : (event) => onMoveStart(event, annotation, 'callout')
            }
          >
            <span className="fc-callout-badge-chip">
              #{labelText}
            </span>
            {annotation.style?.marker ? (
              <span
                className="fc-callout-marker-chip"
                style={{ backgroundColor: annotation.style.markerColor || '#f59e0b', color: '#ffffff', borderRadius: '50%', width: '16px', height: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 'bold' }}
                title={`Marker: ${annotation.style.marker}`}
              >
                {{ star: '★', flag: '⚑', bug: '🪲', pin: '📌', warning: '⚠️' }[annotation.style.marker] || '★'}
              </span>
            ) : null}
            {selectors && selectors.length > 0 ? (
              selectors.map((sel) => (
                <span
                  key={sel.userId}
                  className="fc-callout-collab-chip"
                  style={{ backgroundColor: sel.color }}
                  title={`Selected by ${sel.displayName}`}
                >
                  {sel.displayName}
                </span>
              ))
            ) : null}
            {isEditable ? (
              <span className="fc-callout-drag-hint" title="Move callout">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z" />
                </svg>
              </span>
            ) : null}
          </div>

          {/* Body */}
          <div className="fc-callout-body">
            {isEditable ? (
              <textarea
                className="fc-callout-textarea"
                placeholder="Add note…"
                value={localText}
                maxLength={2000}
                style={{
                  fontSize: annotation.style?.fontSize ? `${annotation.style.fontSize}px` : undefined,
                  fontWeight: annotation.style?.fontWeight || undefined,
                  fontStyle: annotation.style?.fontStyle || undefined,
                  fontFamily:
                    annotation.style?.fontFamily === 'serif'
                      ? 'Georgia, serif'
                      : annotation.style?.fontFamily === 'monospace'
                        ? 'monospace'
                        : undefined,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(annotation.id);
                }}
                onChange={(e) => {
                  setLocalText(e.target.value);
                }}
                onBlur={handleBlur}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') {
                    setLocalText(annotation.geometry?.calloutText ?? '');
                    e.target.blur();
                  }
                }}
              />
            ) : (
              <div
                className={`fc-callout-display ${!localText ? 'fc-callout-display-placeholder' : ''}`}
                style={{
                  fontSize: annotation.style?.fontSize ? `${annotation.style.fontSize}px` : undefined,
                  fontWeight: annotation.style?.fontWeight || undefined,
                  fontStyle: annotation.style?.fontStyle || undefined,
                  fontFamily:
                    annotation.style?.fontFamily === 'serif'
                      ? 'Georgia, serif'
                      : annotation.style?.fontFamily === 'monospace'
                        ? 'monospace'
                        : undefined,
                }}
                onPointerDown={(e) => {
                  if (!isNavigating) {
                    onSelect(annotation.id);
                  }
                }}
              >
                {localText || '(No text)'}
              </div>
            )}
          </div>
        </div>
      </foreignObject>

      {/* Resize Handles and Independent Pointer Handle */}
      {isSelected && !isNavigating && isEditable ? (
        <>
          {/* Independent Pointer Handle */}
          <g
            style={{ cursor: 'crosshair' }}
            pointerEvents="all"
            onPointerDown={(event) =>
              onPointerResizeStart(event, annotation)
            }
          >
            <circle cx={px.pointerXPx} cy={px.pointerYPx} r={11} fill="transparent" />
            <circle
              cx={px.pointerXPx}
              cy={px.pointerYPx}
              r={5}
              fill="#ffffff"
              stroke={annotation.color}
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
            />
          </g>

          {/* 8 Text Box Resize Handles */}
          {RECT_HANDLE_POSITIONS.map((handle) => {
            let hx = px.boxXPx;
            let hy = px.boxYPx;
            if (handle.key === 'ne' || handle.key === 'e' || handle.key === 'se') {
              hx = px.boxXPx + px.boxWidthPx;
            } else if (handle.key === 'n' || handle.key === 's') {
              hx = px.boxXPx + px.boxWidthPx / 2;
            }
            if (handle.key === 'sw' || handle.key === 's' || handle.key === 'se') {
              hy = px.boxYPx + px.boxHeightPx;
            } else if (handle.key === 'w' || handle.key === 'e') {
              hy = px.boxYPx + px.boxHeightPx / 2;
            }

            return (
              <g
                key={handle.key}
                style={{ cursor: handle.cursor }}
                pointerEvents="all"
                onPointerDown={(event) =>
                  onBoxResizeStart(event, annotation, handle.key)
                }
              >
                <circle cx={hx} cy={hy} r={9} fill="transparent" />
                <circle
                  cx={hx}
                  cy={hy}
                  r={4.5}
                  fill="#ffffff"
                  stroke={annotation.color}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </>
      ) : null}
    </g>
  );
}

/**
 * Interactive SVG annotation overlay supporting Circle, Arrow, Rectangle, and Pencil annotations.
 * Aligned 1:1 with the rendered image box, with creator-only editing, zoom-independent scaling,
 * and normalized coordinate persistence.
 */
export function AnnotationLayer({
  imageId,
  annotations,
  currentUserId,
  draftAnnotation = null,
  toolMode,
  activeDrawColor,
  selectedAnnotationId,
  selectedAnnotationIds = [],
  onSelectAnnotation,
  onCreateDraft,
  onUpdateDraftGeometry = null,
  onCommitGeometry,
  onCommitBulkMove = null,
  readOnly = false,
  disabled = false,
  zoom = 1,
  scale = 1,
  baseWidth = 0,
  baseHeight = 0,
  isSpacePressed = false,
  liveCursors = [],
  liveSelections = [],
  onCursorMove = null,
  onCursorLeave = null,
  hiddenLayerIds = new Set(),
  lockedLayerIds = new Set(),
  activeDrawStyle = null,
  rotation = 0,
  isMagnifierActive = false,
}) {
  const svgRef = useRef(null);
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });
  const [gesture, setGesture] = useState(null);
  const [polygonPointsPx, setPolygonPointsPx] = useState([]);
  const [polygonCursorPt, setPolygonCursorPt] = useState(null);

  const effectiveBaseWidth = baseWidth > 0 ? baseWidth : boxSize.width;
  const effectiveBaseHeight = baseHeight > 0 ? baseHeight : boxSize.height;
  const isNavigating = readOnly || toolMode === 'pan' || isSpacePressed || isMagnifierActive;

  useEffect(() => {
    setGesture(null);
    setPolygonPointsPx([]);
    setPolygonCursorPt(null);
  }, [imageId, readOnly, toolMode, isSpacePressed, isMagnifierActive]);

  useEffect(() => {
    if (readOnly || toolMode !== 'polygon') return undefined;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setPolygonPointsPx([]);
        setPolygonCursorPt(null);
      } else if (e.key === 'Enter') {
        if (polygonPointsPx.length >= 3) {
          const normGeom = pixelPolygonToNormalized({
            pointsPx: polygonPointsPx,
            width: effectiveBaseWidth,
            height: effectiveBaseHeight,
          });
          setPolygonPointsPx([]);
          setPolygonCursorPt(null);
          onSelectAnnotation(null);
          onCreateDraft({
            type: 'polygon',
            geometry: normGeom,
            color: activeDrawColor,
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readOnly, toolMode, polygonPointsPx, effectiveBaseWidth, effectiveBaseHeight, activeDrawColor, onCreateDraft, onSelectAnnotation]);

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
    const svg = svgRef.current;
    if (!svg) return null;

    const currentBaseW = effectiveBaseWidth > 0 ? effectiveBaseWidth : 800;
    const currentBaseH = effectiveBaseHeight > 0 ? effectiveBaseHeight : 600;

    // Standard W3C SVG CTM method: directly transforms screen coordinates into SVG coordinate space,
    // accurately accounting for any combination of zoom, pan, rotation, and scaling.
    try {
      if (typeof svg.getScreenCTM === 'function') {
        const ctm = svg.getScreenCTM();
        if (ctm) {
          const inv = ctm.inverse();
          const pt = svg.createSVGPoint();
          pt.x = event.clientX;
          pt.y = event.clientY;
          const local = pt.matrixTransform(inv);
          return {
            x: clamp(local.x, 0, currentBaseW),
            y: clamp(local.y, 0, currentBaseH),
            width: currentBaseW,
            height: currentBaseH,
          };
        }
      }
    } catch {}

    // Fallback: Trigonometric rotation math if getScreenCTM is unavailable
    const rect = svg.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    if (rotation && rotation % 360 !== 0) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const rad = -((rotation % 360) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = event.clientX - centerX;
      const dy = event.clientY - centerY;
      const unrotX = (dx * cos - dy * sin) / (scale || 1) + currentBaseW / 2;
      const unrotY = (dx * sin + dy * cos) / (scale || 1) + currentBaseH / 2;
      return {
        x: clamp(unrotX, 0, currentBaseW),
        y: clamp(unrotY, 0, currentBaseH),
        width: currentBaseW,
        height: currentBaseH,
      };
    }

    const scaleX = rect.width / currentBaseW;
    const scaleY = rect.height / currentBaseH;

    return {
      x: clamp((event.clientX - rect.left) / scaleX, 0, currentBaseW),
      y: clamp((event.clientY - rect.top) / scaleY, 0, currentBaseH),
      width: currentBaseW,
      height: currentBaseH,
    };
  };

  const releaseCapture = (pointerId) => {
    const node = svgRef.current;
    if (node?.hasPointerCapture?.(pointerId)) {
      node.releasePointerCapture(pointerId);
    }
  };

  const isEditableAnnotation = (annotation) =>
    Boolean(
      !readOnly &&
      !disabled &&
      currentUserId &&
      annotation?.createdBy === currentUserId &&
      annotation?.status !== 'resolved' &&
      !lockedLayerIds.has(annotation?.layerId || 'default')
    );

  const handleStagePointerDown = (event) => {
    if (readOnly || isMagnifierActive) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;

    const pt = getLocalPointer(event);
    if (!pt) return;

    const isDrawingTool =
      toolMode === 'draw' ||
      toolMode === 'circle' ||
      toolMode === 'arrow' ||
      toolMode === 'line' ||
      toolMode === 'rectangle' ||
      toolMode === 'cloud' ||
      toolMode === 'pencil' ||
      toolMode === 'highlighter' ||
      toolMode === 'polygon' ||
      toolMode === 'callout' ||
      toolMode === 'textbox' ||
      toolMode === 'blur' ||
      toolMode === 'marker';

    if (!isDrawingTool || disabled) {
      if (!isDrawingTool) {
        onSelectAnnotation(null);
      }
      return;
    }

    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);
    onSelectAnnotation(null);

    if (toolMode === 'marker') {
      const cx = Math.max(0, Math.min(1, pt.x / pt.width));
      const cy = Math.max(0, Math.min(1, pt.y / pt.height));
      const minDim = Math.min(pt.width, pt.height);
      const r = Math.max(0.01, 14 / (minDim || 1000));
      onCreateDraft({
        type: 'marker',
        geometry: { type: 'circle', tool: 'marker', cx, cy, r },
        color: activeDrawColor,
      });
      return;
    }

    if (toolMode === 'polygon') {
      if (polygonPointsPx.length >= 3) {
        const startPt = polygonPointsPx[0];
        const distToStart = Math.hypot(pt.x - startPt[0], pt.y - startPt[1]);
        if (distToStart < 18) {
          const normGeom = pixelPolygonToNormalized({
            pointsPx: polygonPointsPx,
            width: pt.width,
            height: pt.height,
          });
          setPolygonPointsPx([]);
          setPolygonCursorPt(null);
          onSelectAnnotation(null);
          onCreateDraft({
            type: 'polygon',
            geometry: normGeom,
            color: activeDrawColor,
          });
          return;
        }
      }
      setPolygonPointsPx((prev) => [...prev, [pt.x, pt.y]]);
      setPolygonCursorPt(pt);
      return;
    }

    if (toolMode === 'pencil') {
      setGesture({
        type: 'draw',
        tool: 'pencil',
        pointerId: event.pointerId,
        pointsPx: [[pt.x, pt.y]],
      });
    } else if (toolMode === 'highlighter') {
      setGesture({
        type: 'draw',
        tool: 'highlighter',
        pointerId: event.pointerId,
        pointsPx: [[pt.x, pt.y]],
      });
    } else if (toolMode === 'arrow') {
      setGesture({
        type: 'draw',
        tool: 'arrow',
        pointerId: event.pointerId,
        startX: pt.x,
        startY: pt.y,
        currentX: pt.x,
        currentY: pt.y,
      });
    } else if (toolMode === 'line') {
      setGesture({
        type: 'draw',
        tool: 'line',
        pointerId: event.pointerId,
        startX: pt.x,
        startY: pt.y,
        currentX: pt.x,
        currentY: pt.y,
      });
    } else if (toolMode === 'rectangle' || toolMode === 'cloud' || toolMode === 'textbox' || toolMode === 'blur') {
      setGesture({
        type: 'draw',
        tool: toolMode,
        pointerId: event.pointerId,
        startX: pt.x,
        startY: pt.y,
        currentX: pt.x,
        currentY: pt.y,
      });
    } else if (toolMode === 'callout') {
      const defaultW = Math.min(140, Math.max(90, pt.width * 0.3));
      const defaultH = Math.min(52, Math.max(40, pt.height * 0.2));
      let initBoxX = pt.x + 30;
      let initBoxY = pt.y - defaultH - 20;
      if (initBoxX + defaultW > pt.width) {
        initBoxX = Math.max(0, pt.x - defaultW - 30);
      }
      if (initBoxY < 0) {
        initBoxY = Math.min(pt.height - defaultH, pt.y + 30);
      }
      setGesture({
        type: 'draw',
        tool: 'callout',
        pointerId: event.pointerId,
        pointerXPx: pt.x,
        pointerYPx: pt.y,
        boxWidthPx: defaultW,
        boxHeightPx: defaultH,
        currentBoxXPx: initBoxX,
        currentBoxYPx: initBoxY,
        hasDragged: false,
      });
    } else {
      setGesture({
        type: 'draw',
        tool: 'circle',
        pointerId: event.pointerId,
        startX: pt.x,
        startY: pt.y,
        cxPx: pt.x,
        cyPx: pt.y,
        rPx: 0,
      });
    }
  };

  const handleAnnotationPointerDown = (event, annotation, type) => {
    if (isNavigating) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();

    if (event.shiftKey) {
      onSelectAnnotation(annotation.id, { shiftKey: true });
      return;
    }

    if (!selectedAnnotationIds.includes(annotation.id)) {
      onSelectAnnotation(annotation.id, { shiftKey: false });
    }

    if (!isEditableAnnotation(annotation)) {
      return;
    }

    const pt = getLocalPointer(event);
    if (!pt) return;

    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);

    const isMulti = selectedAnnotationIds.length > 1 && selectedAnnotationIds.includes(annotation.id);
    const multiTargets = isMulti
      ? annotations.filter(
          (a) =>
            selectedAnnotationIds.includes(a.id) &&
            a.id !== annotation.id &&
            isEditableAnnotation(a)
        )
      : [];

    const baseMoveGesture = {
      isMulti,
      multiTargets,
      initialPointerX: pt.x,
      initialPointerY: pt.y,
      initialPointerNormX: pt.x / pt.width,
      initialPointerNormY: pt.y / pt.height,
      currentDeltaPx: { dx: 0, dy: 0 },
      currentDeltaNorm: { dx: 0, dy: 0 },
    };

    if (type === 'pencil') {
      const pxPoints = normalizedPencilToPixel({
        points: annotation.geometry?.points ?? [],
        width: pt.width,
        height: pt.height,
      }).pointsPx;

      setGesture({
        type: 'move',
        tool: 'pencil',
        pointerId: event.pointerId,
        annotationId: annotation.id,
        initialPointsPx: pxPoints,
        currentPointsPx: pxPoints,
        ...baseMoveGesture,
      });
    } else if (type === 'highlighter') {
      const pxPoints = normalizedHighlighterToPixel({
        points: annotation.geometry?.points ?? [],
        width: pt.width,
        height: pt.height,
      }).pointsPx;

      setGesture({
        type: 'move',
        tool: 'highlighter',
        pointerId: event.pointerId,
        annotationId: annotation.id,
        initialPointsPx: pxPoints,
        currentPointsPx: pxPoints,
        ...baseMoveGesture,
      });
    } else if (type === 'arrow') {
      const px = normalizedArrowToPixel({
        startX: annotation.geometry?.startX ?? 0.1,
        startY: annotation.geometry?.startY ?? 0.1,
        endX: annotation.geometry?.endX ?? 0.2,
        endY: annotation.geometry?.endY ?? 0.2,
        width: pt.width,
        height: pt.height,
      });

      setGesture({
        type: 'move',
        tool: 'arrow',
        pointerId: event.pointerId,
        annotationId: annotation.id,
        startXPx: px.startXPx,
        startYPx: px.startYPx,
        endXPx: px.endXPx,
        endYPx: px.endYPx,
        currentStartX: px.startXPx,
        currentStartY: px.startYPx,
        currentEndX: px.endXPx,
        currentEndY: px.endYPx,
        ...baseMoveGesture,
      });
    } else if (type === 'line') {
      const px = normalizedLineToPixel({
        startX: annotation.geometry?.startX ?? 0.1,
        startY: annotation.geometry?.startY ?? 0.1,
        endX: annotation.geometry?.endX ?? 0.2,
        endY: annotation.geometry?.endY ?? 0.2,
        width: pt.width,
        height: pt.height,
      });

      setGesture({
        type: 'move',
        tool: 'line',
        pointerId: event.pointerId,
        annotationId: annotation.id,
        startXPx: px.startXPx,
        startYPx: px.startYPx,
        endXPx: px.endXPx,
        endYPx: px.endYPx,
        currentStartX: px.startXPx,
        currentStartY: px.startYPx,
        currentEndX: px.endXPx,
        currentEndY: px.endYPx,
        ...baseMoveGesture,
      });
    } else if (type === 'polygon') {
      const pxPoints = normalizedPolygonToPixel({
        points: annotation.geometry?.points ?? [],
        width: pt.width,
        height: pt.height,
      }).pointsPx;

      setGesture({
        type: 'move',
        tool: 'polygon',
        pointerId: event.pointerId,
        annotationId: annotation.id,
        initialPointsPx: pxPoints,
        currentPointsPx: pxPoints,
        ...baseMoveGesture,
      });
    } else if (type === 'rectangle' || type === 'cloud' || type === 'textbox' || type === 'blur') {
      const px = normalizedRectToPixel({
        x: annotation.geometry?.x ?? 0.1,
        y: annotation.geometry?.y ?? 0.1,
        width: annotation.geometry?.width ?? 0.2,
        height: annotation.geometry?.height ?? 0.2,
        baseWidth: pt.width,
        baseHeight: pt.height,
      });

      setGesture({
        type: 'move',
        tool: type,
        pointerId: event.pointerId,
        annotationId: annotation.id,
        xPx: px.xPx,
        yPx: px.yPx,
        widthPx: px.widthPx,
        heightPx: px.heightPx,
        currentX: px.xPx,
        currentY: px.yPx,
        ...baseMoveGesture,
      });
    } else if (type === 'callout') {
      const px = normalizedCalloutToPixel({
        pointerX: annotation.geometry?.pointerX ?? 0.5,
        pointerY: annotation.geometry?.pointerY ?? 0.5,
        boxX: annotation.geometry?.boxX ?? 0.6,
        boxY: annotation.geometry?.boxY ?? 0.4,
        boxWidth: annotation.geometry?.boxWidth ?? 0.2,
        boxHeight: annotation.geometry?.boxHeight ?? 0.1,
        width: pt.width,
        height: pt.height,
      });

      setGesture({
        type: 'move',
        tool: 'callout',
        pointerId: event.pointerId,
        annotationId: annotation.id,
        initialPointerXPx: px.pointerXPx,
        initialPointerYPx: px.pointerYPx,
        initialBoxXPx: px.boxXPx,
        initialBoxYPx: px.boxYPx,
        boxWidthPx: px.boxWidthPx,
        boxHeightPx: px.boxHeightPx,
        currentPointerXPx: px.pointerXPx,
        currentPointerYPx: px.pointerYPx,
        currentBoxXPx: px.boxXPx,
        currentBoxYPx: px.boxYPx,
        ...baseMoveGesture,
      });
    } else {
      const px = normalizedCircleToPixel({
        cx: annotation.geometry?.cx ?? annotation.cx,
        cy: annotation.geometry?.cy ?? annotation.cy,
        r: annotation.geometry?.r ?? annotation.r,
        width: pt.width,
        height: pt.height,
      });

      setGesture({
        type: 'move',
        tool: 'circle',
        pointerId: event.pointerId,
        annotationId: annotation.id,
        offsetX: pt.x - px.cxPx,
        offsetY: pt.y - px.cyPx,
        cxPx: px.cxPx,
        cyPx: px.cyPx,
        rPx: px.rPx,
        ...baseMoveGesture,
      });
    }
  };

  const handleCircleResizePointerDown = (event, annotation) => {
    if (isNavigating) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();

    if (!isEditableAnnotation(annotation)) return;

    const pt = getLocalPointer(event);
    if (!pt) return;

    const px = normalizedCircleToPixel({
      cx: annotation.geometry?.cx ?? annotation.cx,
      cy: annotation.geometry?.cy ?? annotation.cy,
      r: annotation.geometry?.r ?? annotation.r,
      width: pt.width,
      height: pt.height,
    });

    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);

    setGesture({
      type: 'resize',
      tool: 'circle',
      pointerId: event.pointerId,
      annotationId: annotation.id,
      cxPx: px.cxPx,
      cyPx: px.cyPx,
      rPx: px.rPx,
    });
  };

  const handleArrowResizePointerDown = (event, annotation, handleKey) => {
    if (isNavigating) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();

    if (!isEditableAnnotation(annotation)) return;

    const pt = getLocalPointer(event);
    if (!pt) return;

    const px = normalizedArrowToPixel({
      startX: annotation.geometry?.startX ?? 0.1,
      startY: annotation.geometry?.startY ?? 0.1,
      endX: annotation.geometry?.endX ?? 0.2,
      endY: annotation.geometry?.endY ?? 0.2,
      width: pt.width,
      height: pt.height,
    });

    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);

    setGesture({
      type: 'resize',
      tool: 'arrow',
      handleKey,
      pointerId: event.pointerId,
      annotationId: annotation.id,
      startXPx: px.startXPx,
      startYPx: px.startYPx,
      endXPx: px.endXPx,
      endYPx: px.endYPx,
      currentStartX: px.startXPx,
      currentStartY: px.startYPx,
      currentEndX: px.endXPx,
      currentEndY: px.endYPx,
    });
  };

  const handleLineResizePointerDown = (event, annotation, handleKey) => {
    if (isNavigating) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();

    if (!isEditableAnnotation(annotation)) return;

    const pt = getLocalPointer(event);
    if (!pt) return;

    const px = normalizedLineToPixel({
      startX: annotation.geometry?.startX ?? 0.1,
      startY: annotation.geometry?.startY ?? 0.1,
      endX: annotation.geometry?.endX ?? 0.2,
      endY: annotation.geometry?.endY ?? 0.2,
      width: pt.width,
      height: pt.height,
    });

    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);

    setGesture({
      type: 'resize',
      tool: 'line',
      handleKey,
      pointerId: event.pointerId,
      annotationId: annotation.id,
      startXPx: px.startXPx,
      startYPx: px.startYPx,
      endXPx: px.endXPx,
      endYPx: px.endYPx,
      currentStartX: px.startXPx,
      currentStartY: px.startYPx,
      currentEndX: px.endXPx,
      currentEndY: px.endYPx,
    });
  };

  const handleRectResizePointerDown = (event, annotation, handleKey, toolName = 'rectangle') => {
    if (isNavigating) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();

    if (!isEditableAnnotation(annotation)) return;

    const pt = getLocalPointer(event);
    if (!pt) return;

    const px = normalizedRectToPixel({
      x: annotation.geometry?.x ?? 0.1,
      y: annotation.geometry?.y ?? 0.1,
      width: annotation.geometry?.width ?? 0.2,
      height: annotation.geometry?.height ?? 0.2,
      baseWidth: pt.width,
      baseHeight: pt.height,
    });

    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);

    setGesture({
      type: 'resize',
      tool: toolName,
      handleKey,
      pointerId: event.pointerId,
      annotationId: annotation.id,
      initialRect: {
        xPx: px.xPx,
        yPx: px.yPx,
        widthPx: px.widthPx,
        heightPx: px.heightPx,
      },
      currentRect: {
        xPx: px.xPx,
        yPx: px.yPx,
        widthPx: px.widthPx,
        heightPx: px.heightPx,
      },
    });
  };

  const handleCalloutPointerResizePointerDown = (event, annotation) => {
    if (isNavigating) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();

    if (!isEditableAnnotation(annotation)) return;

    const pt = getLocalPointer(event);
    if (!pt) return;

    const px = normalizedCalloutToPixel({
      pointerX: annotation.geometry?.pointerX ?? 0.5,
      pointerY: annotation.geometry?.pointerY ?? 0.5,
      boxX: annotation.geometry?.boxX ?? 0.6,
      boxY: annotation.geometry?.boxY ?? 0.4,
      boxWidth: annotation.geometry?.boxWidth ?? 0.2,
      boxHeight: annotation.geometry?.boxHeight ?? 0.1,
      width: pt.width,
      height: pt.height,
    });

    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);

    setGesture({
      type: 'resize',
      tool: 'callout-pointer',
      pointerId: event.pointerId,
      annotationId: annotation.id,
      boxXPx: px.boxXPx,
      boxYPx: px.boxYPx,
      boxWidthPx: px.boxWidthPx,
      boxHeightPx: px.boxHeightPx,
      currentPointerXPx: px.pointerXPx,
      currentPointerYPx: px.pointerYPx,
    });
  };

  const handleCalloutBoxResizePointerDown = (event, annotation, handleKey) => {
    if (isNavigating) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();

    if (!isEditableAnnotation(annotation)) return;

    const pt = getLocalPointer(event);
    if (!pt) return;

    const px = normalizedCalloutToPixel({
      pointerX: annotation.geometry?.pointerX ?? 0.5,
      pointerY: annotation.geometry?.pointerY ?? 0.5,
      boxX: annotation.geometry?.boxX ?? 0.6,
      boxY: annotation.geometry?.boxY ?? 0.4,
      boxWidth: annotation.geometry?.boxWidth ?? 0.2,
      boxHeight: annotation.geometry?.boxHeight ?? 0.1,
      width: pt.width,
      height: pt.height,
    });

    event.preventDefault();
    svgRef.current?.setPointerCapture?.(event.pointerId);

    setGesture({
      type: 'resize',
      tool: 'callout-box',
      handleKey,
      pointerId: event.pointerId,
      annotationId: annotation.id,
      pointerXPx: px.pointerXPx,
      pointerYPx: px.pointerYPx,
      initialBox: {
        boxXPx: px.boxXPx,
        boxYPx: px.boxYPx,
        boxWidthPx: px.boxWidthPx,
        boxHeightPx: px.boxHeightPx,
      },
      currentBox: {
        boxXPx: px.boxXPx,
        boxYPx: px.boxYPx,
        boxWidthPx: px.boxWidthPx,
        boxHeightPx: px.boxHeightPx,
      },
    });
  };

  const handlePointerMove = (event) => {
    const pt = getLocalPointer(event);
    if (pt && !readOnly && onCursorMove && effectiveBaseWidth > 0 && effectiveBaseHeight > 0) {
      const normX = clamp(pt.x / effectiveBaseWidth, 0, 1);
      const normY = clamp(pt.y / effectiveBaseHeight, 0, 1);
      onCursorMove({ x: normX, y: normY });
    }

    if (toolMode === 'polygon' && polygonPointsPx.length > 0 && pt) {
      setPolygonCursorPt({ x: clamp(pt.x, 0, pt.width), y: clamp(pt.y, 0, pt.height) });
    }

    if (readOnly || !gesture || gesture.pointerId !== event.pointerId) return;
    if (!pt) return;

    if (gesture.type === 'draw') {
      if (gesture.tool === 'pencil' || gesture.tool === 'highlighter') {
        const curX = clamp(pt.x, 0, pt.width);
        const curY = clamp(pt.y, 0, pt.height);
        const pts = gesture.pointsPx;
        const lastPt = pts[pts.length - 1];
        if (Math.hypot(curX - lastPt[0], curY - lastPt[1]) >= 1.5) {
          setGesture((prev) =>
            prev ? { ...prev, pointsPx: [...prev.pointsPx, [curX, curY]] } : null
          );
        }
        return;
      }

      if (
        gesture.tool === 'arrow' ||
        gesture.tool === 'line' ||
        gesture.tool === 'rectangle' ||
        gesture.tool === 'cloud' ||
        gesture.tool === 'textbox' ||
        gesture.tool === 'blur'
      ) {
        const curX = clamp(pt.x, 0, pt.width);
        const curY = clamp(pt.y, 0, pt.height);
        setGesture((prev) => (prev ? { ...prev, currentX: curX, currentY: curY } : null));
        return;
      }

      if (gesture.tool === 'callout') {
        const curX = clamp(pt.x, 0, pt.width);
        const curY = clamp(pt.y, 0, pt.height);
        const dist = Math.hypot(curX - gesture.pointerXPx, curY - gesture.pointerYPx);
        if (dist > 8) {
          const curBoxX = clamp(
            curX - gesture.boxWidthPx / 2,
            0,
            Math.max(0, pt.width - gesture.boxWidthPx)
          );
          const curBoxY = clamp(
            curY - gesture.boxHeightPx / 2,
            0,
            Math.max(0, pt.height - gesture.boxHeightPx)
          );
          setGesture((prev) =>
            prev
              ? {
                ...prev,
                currentBoxXPx: curBoxX,
                currentBoxYPx: curBoxY,
                hasDragged: true,
              }
              : null
          );
        }
        return;
      }

      // Default: circle draw
      const rawRadius = Math.hypot(pt.x - gesture.startX, pt.y - gesture.startY);
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
      const dxPx = pt.x - gesture.initialPointerX;
      const dyPx = pt.y - gesture.initialPointerY;
      const deltaNormX = (pt.x / pt.width) - (gesture.initialPointerNormX ?? 0);
      const deltaNormY = (pt.y / pt.height) - (gesture.initialPointerNormY ?? 0);
      const moveDeltas = {
        currentDeltaPx: { dx: dxPx, dy: dyPx },
        currentDeltaNorm: { dx: deltaNormX, dy: deltaNormY },
      };

      if (gesture.tool === 'pencil') {
        const nextPoints = clampMovedPencilPx({
          pointsPx: gesture.initialPointsPx,
          dx: dxPx,
          dy: dyPx,
          width: pt.width,
          height: pt.height,
        });
        setGesture((prev) => (prev ? { ...prev, ...moveDeltas, currentPointsPx: nextPoints } : null));
        return;
      }

      if (gesture.tool === 'highlighter') {
        const nextPoints = clampMovedHighlighterPx({
          pointsPx: gesture.initialPointsPx,
          dx: dxPx,
          dy: dyPx,
          width: pt.width,
          height: pt.height,
        });
        setGesture((prev) => (prev ? { ...prev, ...moveDeltas, currentPointsPx: nextPoints } : null));
        return;
      }

      if (gesture.tool === 'arrow') {
        const nextArrow = clampMovedArrowPx({
          startXPx: gesture.startXPx,
          startYPx: gesture.startYPx,
          endXPx: gesture.endXPx,
          endYPx: gesture.endYPx,
          dx: dxPx,
          dy: dyPx,
          width: pt.width,
          height: pt.height,
        });
        setGesture((prev) =>
          prev
            ? {
              ...prev,
              ...moveDeltas,
              currentStartX: nextArrow.startXPx,
              currentStartY: nextArrow.startYPx,
              currentEndX: nextArrow.endXPx,
              currentEndY: nextArrow.endYPx,
            }
            : null
        );
        return;
      }

      if (gesture.tool === 'line') {
        const nextLine = clampMovedLinePx({
          startXPx: gesture.startXPx,
          startYPx: gesture.startYPx,
          endXPx: gesture.endXPx,
          endYPx: gesture.endYPx,
          dx: dxPx,
          dy: dyPx,
          width: pt.width,
          height: pt.height,
        });
        setGesture((prev) =>
          prev
            ? {
              ...prev,
              ...moveDeltas,
              currentStartX: nextLine.startXPx,
              currentStartY: nextLine.startYPx,
              currentEndX: nextLine.endXPx,
              currentEndY: nextLine.endYPx,
            }
            : null
        );
        return;
      }

      if (gesture.tool === 'polygon') {
        const nextPoints = clampMovedPolygonPx({
          pointsPx: gesture.initialPointsPx,
          dx: dxPx,
          dy: dyPx,
          width: pt.width,
          height: pt.height,
        });
        setGesture((prev) => (prev ? { ...prev, ...moveDeltas, currentPointsPx: nextPoints } : null));
        return;
      }

      if (
        gesture.tool === 'rectangle' ||
        gesture.tool === 'cloud' ||
        gesture.tool === 'textbox' ||
        gesture.tool === 'blur'
      ) {
        const nextRect = clampMovedRectPx({
          xPx: gesture.xPx,
          yPx: gesture.yPx,
          widthPx: gesture.widthPx,
          heightPx: gesture.heightPx,
          dx: dxPx,
          dy: dyPx,
          width: pt.width,
          height: pt.height,
        });
        setGesture((prev) => (prev ? { ...prev, ...moveDeltas, currentX: nextRect.xPx, currentY: nextRect.yPx, currentRect: nextRect } : null));
        return;
      }

      if (gesture.tool === 'callout') {
        const nextCallout = clampMovedCalloutPx({
          pointerXPx: gesture.initialPointerXPx,
          pointerYPx: gesture.initialPointerYPx,
          boxXPx: gesture.initialBoxXPx,
          boxYPx: gesture.initialBoxYPx,
          boxWidthPx: gesture.boxWidthPx,
          boxHeightPx: gesture.boxHeightPx,
          dx: dxPx,
          dy: dyPx,
          width: pt.width,
          height: pt.height,
        });
        setGesture((prev) =>
          prev
            ? {
              ...prev,
              ...moveDeltas,
              currentPointerXPx: nextCallout.pointerXPx,
              currentPointerYPx: nextCallout.pointerYPx,
              currentBoxXPx: nextCallout.boxXPx,
              currentBoxYPx: nextCallout.boxYPx,
            }
            : null
        );
        return;
      }

      // Default: circle move
      const nextPos = clampMovedCirclePx({
        cxPx: pt.x - gesture.offsetX,
        cyPx: pt.y - gesture.offsetY,
        rPx: gesture.rPx,
        width: pt.width,
        height: pt.height,
      });
      setGesture((prev) => (prev ? { ...prev, ...moveDeltas, cxPx: nextPos.cxPx, cyPx: nextPos.cyPx } : null));
      return;
    }

    if (gesture.type === 'resize') {
      if (gesture.tool === 'arrow' || gesture.tool === 'line') {
        const curX = clamp(pt.x, 0, pt.width);
        const curY = clamp(pt.y, 0, pt.height);
        if (gesture.handleKey === 'start') {
          setGesture((prev) => (prev ? { ...prev, currentStartX: curX, currentStartY: curY } : null));
        } else {
          setGesture((prev) => (prev ? { ...prev, currentEndX: curX, currentEndY: curY } : null));
        }
        return;
      }

      if (
        gesture.tool === 'rectangle' ||
        gesture.tool === 'cloud' ||
        gesture.tool === 'textbox' ||
        gesture.tool === 'blur'
      ) {
        const nextRect = clampResizedRectPx({
          handleKey: gesture.handleKey,
          initialRect: gesture.initialRect,
          currentPt: pt,
          width: pt.width,
          height: pt.height,
        });
        setGesture((prev) => (prev ? { ...prev, currentRect: nextRect } : null));
        return;
      }

      if (gesture.tool === 'callout-pointer') {
        const nextPointer = clampMovedCalloutPointerPx({
          pointerXPx: pt.x,
          pointerYPx: pt.y,
          dx: 0,
          dy: 0,
          width: pt.width,
          height: pt.height,
        });
        setGesture((prev) =>
          prev
            ? {
              ...prev,
              currentPointerXPx: nextPointer.pointerXPx,
              currentPointerYPx: nextPointer.pointerYPx,
            }
            : null
        );
        return;
      }

      if (gesture.tool === 'callout-box') {
        const nextBox = clampResizedCalloutBoxPx({
          handleKey: gesture.handleKey,
          initialBox: gesture.initialBox,
          currentPt: pt,
          width: pt.width,
          height: pt.height,
          minWidth: 80,
          minHeight: 40,
        });
        setGesture((prev) => (prev ? { ...prev, currentBox: nextBox } : null));
        return;
      }

      // Default: circle resize
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
      if (activeGesture.tool === 'pencil') {
        const rawPoints = activeGesture.pointsPx;
        if (!Array.isArray(rawPoints) || rawPoints.length < 2) return;

        // Simplify using Ramer-Douglas-Peucker
        const simplifiedPx = simplifyPencilStroke(rawPoints, 1.2, 500);
        if (simplifiedPx.length < 2) return;

        // Check total path length threshold
        let totalLength = 0;
        for (let i = 1; i < simplifiedPx.length; i++) {
          totalLength += Math.hypot(
            simplifiedPx[i][0] - simplifiedPx[i - 1][0],
            simplifiedPx[i][1] - simplifiedPx[i - 1][1]
          );
        }
        if (totalLength < 6) return;

        const geometry = pixelPencilToNormalized({
          pointsPx: simplifiedPx,
          width: pt.width,
          height: pt.height,
        });

        onSelectAnnotation(null);
        onCreateDraft({
          type: 'pencil',
          geometry,
          color: activeDrawColor,
        });
        return;
      }

      if (activeGesture.tool === 'highlighter') {
        const rawPoints = activeGesture.pointsPx;
        if (!Array.isArray(rawPoints) || rawPoints.length < 2) return;

        const simplifiedPx = simplifyPencilStroke(rawPoints, 1.5, 400);
        if (simplifiedPx.length < 2) return;

        let totalLength = 0;
        for (let i = 1; i < simplifiedPx.length; i++) {
          totalLength += Math.hypot(
            simplifiedPx[i][0] - simplifiedPx[i - 1][0],
            simplifiedPx[i][1] - simplifiedPx[i - 1][1]
          );
        }
        if (totalLength < 6) return;

        const geometry = pixelHighlighterToNormalized({
          pointsPx: simplifiedPx,
          width: pt.width,
          height: pt.height,
        });

        onSelectAnnotation(null);
        onCreateDraft({
          type: 'highlighter',
          geometry,
          color: activeDrawColor,
        });
        return;
      }

      if (activeGesture.tool === 'arrow') {
        const len = Math.hypot(
          activeGesture.currentX - activeGesture.startX,
          activeGesture.currentY - activeGesture.startY
        );
        if (len < 10) return;

        const geometry = pixelArrowToNormalized({
          startXPx: activeGesture.startX,
          startYPx: activeGesture.startY,
          endXPx: activeGesture.currentX,
          endYPx: activeGesture.currentY,
          width: pt.width,
          height: pt.height,
        });
        onSelectAnnotation(null);
        onCreateDraft({
          type: 'arrow',
          geometry,
          color: activeDrawColor,
        });
        return;
      }

      if (activeGesture.tool === 'line') {
        const len = Math.hypot(
          activeGesture.currentX - activeGesture.startX,
          activeGesture.currentY - activeGesture.startY
        );
        if (len < 10) return;

        const geometry = pixelLineToNormalized({
          startXPx: activeGesture.startX,
          startYPx: activeGesture.startY,
          endXPx: activeGesture.currentX,
          endYPx: activeGesture.currentY,
          width: pt.width,
          height: pt.height,
        });
        onSelectAnnotation(null);
        onCreateDraft({
          type: 'line',
          geometry,
          color: activeDrawColor,
        });
        return;
      }

      if (activeGesture.tool === 'rectangle') {
        const widthPx = Math.abs(activeGesture.currentX - activeGesture.startX);
        const heightPx = Math.abs(activeGesture.currentY - activeGesture.startY);
        if (widthPx < 10 || heightPx < 10) return;

        const xPx = Math.min(activeGesture.startX, activeGesture.currentX);
        const yPx = Math.min(activeGesture.startY, activeGesture.currentY);

        const geometry = pixelRectToNormalized({
          xPx,
          yPx,
          widthPx,
          heightPx,
          width: pt.width,
          height: pt.height,
        });
        onSelectAnnotation(null);
        onCreateDraft({
          type: 'rectangle',
          geometry,
          color: activeDrawColor,
        });
        return;
      }

      if (activeGesture.tool === 'cloud') {
        const widthPx = Math.abs(activeGesture.currentX - activeGesture.startX);
        const heightPx = Math.abs(activeGesture.currentY - activeGesture.startY);
        if (widthPx < 10 || heightPx < 10) return;

        const xPx = Math.min(activeGesture.startX, activeGesture.currentX);
        const yPx = Math.min(activeGesture.startY, activeGesture.currentY);

        const geometry = pixelCloudToNormalized({
          xPx,
          yPx,
          widthPx,
          heightPx,
          width: pt.width,
          height: pt.height,
        });
        onSelectAnnotation(null);
        onCreateDraft({
          type: 'cloud',
          geometry,
          color: activeDrawColor,
        });
        return;
      }

      if (activeGesture.tool === 'textbox') {
        const widthPx = Math.abs(activeGesture.currentX - activeGesture.startX);
        const heightPx = Math.abs(activeGesture.currentY - activeGesture.startY);
        if (widthPx < 10 || heightPx < 10) return;

        const xPx = Math.min(activeGesture.startX, activeGesture.currentX);
        const yPx = Math.min(activeGesture.startY, activeGesture.currentY);

        const geometry = pixelTextboxToNormalized({
          xPx,
          yPx,
          widthPx,
          heightPx,
          width: pt.width,
          height: pt.height,
          text: '',
        });
        onSelectAnnotation(null);
        onCreateDraft({
          type: 'textbox',
          geometry,
          color: activeDrawColor,
        });
        return;
      }

      if (activeGesture.tool === 'blur') {
        const widthPx = Math.abs(activeGesture.currentX - activeGesture.startX);
        const heightPx = Math.abs(activeGesture.currentY - activeGesture.startY);
        if (widthPx < 10 || heightPx < 10) return;

        const xPx = Math.min(activeGesture.startX, activeGesture.currentX);
        const yPx = Math.min(activeGesture.startY, activeGesture.currentY);

        const geometry = pixelBlurToNormalized({
          xPx,
          yPx,
          widthPx,
          heightPx,
          width: pt.width,
          height: pt.height,
        });
        onSelectAnnotation(null);
        onCreateDraft({
          type: 'blur',
          geometry,
          color: activeDrawColor,
        });
        return;
      }

      if (activeGesture.tool === 'callout') {
        const geometry = pixelCalloutToNormalized({
          pointerXPx: activeGesture.pointerXPx,
          pointerYPx: activeGesture.pointerYPx,
          boxXPx: activeGesture.currentBoxXPx,
          boxYPx: activeGesture.currentBoxYPx,
          boxWidthPx: activeGesture.boxWidthPx,
          boxHeightPx: activeGesture.boxHeightPx,
          calloutText: '',
          width: pt.width,
          height: pt.height,
        });
        onSelectAnnotation(null);
        onCreateDraft({
          type: 'callout',
          geometry,
          color: activeDrawColor,
        });
        return;
      }

      // Default: circle draw
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
        type: 'circle',
        geometry,
        color: activeDrawColor,
      });
      return;
    }

    if (activeGesture.type === 'move') {
      const commitMovedGeometry = (primaryGeom) => {
        if (
          activeGesture.isMulti &&
          Array.isArray(activeGesture.multiTargets) &&
          activeGesture.multiTargets.length > 0
        ) {
          const dNormX = activeGesture.currentDeltaNorm?.dx || 0;
          const dNormY = activeGesture.currentDeltaNorm?.dy || 0;
          const targetUpdates = activeGesture.multiTargets.map((target) => ({
            annotationId: target.id,
            geometry: translateAnnotationGeometry(target.geometry || target, dNormX, dNormY),
          }));

          if (onCommitBulkMove) {
            onCommitBulkMove([
              { annotationId: activeGesture.annotationId, geometry: primaryGeom },
              ...targetUpdates,
            ]);
          } else {
            onCommitGeometry({
              annotationId: activeGesture.annotationId,
              geometry: primaryGeom,
            });
            targetUpdates.forEach((u) => onCommitGeometry(u));
          }
        } else {
          onCommitGeometry({
            annotationId: activeGesture.annotationId,
            geometry: primaryGeom,
          });
        }
      };

      if (activeGesture.tool === 'pencil') {
        const geometry = pixelPencilToNormalized({
          pointsPx: activeGesture.currentPointsPx,
          width: pt.width,
          height: pt.height,
        });
        commitMovedGeometry(geometry);
        return;
      }

      if (activeGesture.tool === 'highlighter') {
        const geometry = pixelHighlighterToNormalized({
          pointsPx: activeGesture.currentPointsPx,
          width: pt.width,
          height: pt.height,
        });
        commitMovedGeometry(geometry);
        return;
      }

      if (activeGesture.tool === 'arrow') {
        const geometry = pixelArrowToNormalized({
          startXPx: activeGesture.currentStartX,
          startYPx: activeGesture.currentStartY,
          endXPx: activeGesture.currentEndX,
          endYPx: activeGesture.currentEndY,
          width: pt.width,
          height: pt.height,
        });
        commitMovedGeometry(geometry);
        return;
      }

      if (activeGesture.tool === 'line') {
        const geometry = pixelLineToNormalized({
          startXPx: activeGesture.currentStartX,
          startYPx: activeGesture.currentStartY,
          endXPx: activeGesture.currentEndX,
          endYPx: activeGesture.currentEndY,
          width: pt.width,
          height: pt.height,
        });
        commitMovedGeometry(geometry);
        return;
      }

      if (activeGesture.tool === 'polygon') {
        const geometry = pixelPolygonToNormalized({
          pointsPx: activeGesture.currentPointsPx,
          width: pt.width,
          height: pt.height,
        });
        commitMovedGeometry(geometry);
        return;
      }

      if (activeGesture.tool === 'rectangle') {
        const geometry = pixelRectToNormalized({
          xPx: activeGesture.currentX,
          yPx: activeGesture.currentY,
          widthPx: activeGesture.widthPx,
          heightPx: activeGesture.heightPx,
          width: pt.width,
          height: pt.height,
        });
        commitMovedGeometry(geometry);
        return;
      }

      if (activeGesture.tool === 'cloud') {
        const geometry = pixelCloudToNormalized({
          xPx: activeGesture.currentX,
          yPx: activeGesture.currentY,
          widthPx: activeGesture.widthPx,
          heightPx: activeGesture.heightPx,
          width: pt.width,
          height: pt.height,
        });
        commitMovedGeometry(geometry);
        return;
      }

      if (activeGesture.tool === 'textbox') {
        const targetAnn = annotations.find((a) => a.id === activeGesture.annotationId);
        const geometry = pixelTextboxToNormalized({
          xPx: activeGesture.currentX,
          yPx: activeGesture.currentY,
          widthPx: activeGesture.widthPx,
          heightPx: activeGesture.heightPx,
          width: pt.width,
          height: pt.height,
          text: targetAnn?.geometry?.text || targetAnn?.comment || '',
        });
        commitMovedGeometry(geometry);
        return;
      }

      if (activeGesture.tool === 'blur') {
        const targetAnn = annotations.find((a) => a.id === activeGesture.annotationId);
        const geometry = pixelBlurToNormalized({
          xPx: activeGesture.currentX,
          yPx: activeGesture.currentY,
          widthPx: activeGesture.widthPx,
          heightPx: activeGesture.heightPx,
          width: pt.width,
          height: pt.height,
          blurAmount: targetAnn?.geometry?.blurAmount ?? 12,
          blurType: targetAnn?.geometry?.blurType ?? 'blur',
        });
        commitMovedGeometry(geometry);
        return;
      }

      if (activeGesture.tool === 'callout') {
        const targetAnn = annotations.find((a) => a.id === activeGesture.annotationId);
        const geometry = pixelCalloutToNormalized({
          pointerXPx: activeGesture.currentPointerXPx,
          pointerYPx: activeGesture.currentPointerYPx,
          boxXPx: activeGesture.currentBoxXPx,
          boxYPx: activeGesture.currentBoxYPx,
          boxWidthPx: activeGesture.boxWidthPx,
          boxHeightPx: activeGesture.boxHeightPx,
          calloutText: targetAnn?.geometry?.calloutText ?? '',
          width: pt.width,
          height: pt.height,
        });
        commitMovedGeometry(geometry);
        return;
      }

      // Default: circle move
      const geometry = pixelCircleToNormalized({
        cxPx: activeGesture.cxPx,
        cyPx: activeGesture.cyPx,
        rPx: activeGesture.rPx,
        width: pt.width,
        height: pt.height,
      });
      commitMovedGeometry(geometry);
      return;
    }

    if (activeGesture.type === 'resize') {
      if (activeGesture.tool === 'arrow') {
        const len = Math.hypot(
          activeGesture.currentEndX - activeGesture.currentStartX,
          activeGesture.currentEndY - activeGesture.currentStartY
        );
        if (len < 8) return;

        const geometry = pixelArrowToNormalized({
          startXPx: activeGesture.currentStartX,
          startYPx: activeGesture.currentStartY,
          endXPx: activeGesture.currentEndX,
          endYPx: activeGesture.currentEndY,
          width: pt.width,
          height: pt.height,
        });
        onCommitGeometry({
          annotationId: activeGesture.annotationId,
          geometry,
        });
        return;
      }

      if (activeGesture.tool === 'line') {
        const len = Math.hypot(
          activeGesture.currentEndX - activeGesture.currentStartX,
          activeGesture.currentEndY - activeGesture.currentStartY
        );
        if (len < 8) return;

        const geometry = pixelLineToNormalized({
          startXPx: activeGesture.currentStartX,
          startYPx: activeGesture.currentStartY,
          endXPx: activeGesture.currentEndX,
          endYPx: activeGesture.currentEndY,
          width: pt.width,
          height: pt.height,
        });
        onCommitGeometry({
          annotationId: activeGesture.annotationId,
          geometry,
        });
        return;
      }

      if (activeGesture.tool === 'rectangle') {
        const rect = activeGesture.currentRect;
        const geometry = pixelRectToNormalized({
          xPx: rect.xPx,
          yPx: rect.yPx,
          widthPx: rect.widthPx,
          heightPx: rect.heightPx,
          width: pt.width,
          height: pt.height,
        });
        onCommitGeometry({
          annotationId: activeGesture.annotationId,
          geometry,
        });
        return;
      }

      if (activeGesture.tool === 'cloud') {
        const rect = activeGesture.currentRect;
        const geometry = pixelCloudToNormalized({
          xPx: rect.xPx,
          yPx: rect.yPx,
          widthPx: rect.widthPx,
          heightPx: rect.heightPx,
          width: pt.width,
          height: pt.height,
        });
        onCommitGeometry({
          annotationId: activeGesture.annotationId,
          geometry,
        });
        return;
      }

      if (activeGesture.tool === 'textbox') {
        const targetAnn = annotations.find((a) => a.id === activeGesture.annotationId);
        const rect = activeGesture.currentRect;
        const geometry = pixelTextboxToNormalized({
          xPx: rect.xPx,
          yPx: rect.yPx,
          widthPx: rect.widthPx,
          heightPx: rect.heightPx,
          width: pt.width,
          height: pt.height,
          text: targetAnn?.geometry?.text || targetAnn?.comment || '',
        });
        onCommitGeometry({
          annotationId: activeGesture.annotationId,
          geometry,
        });
        return;
      }

      if (activeGesture.tool === 'blur') {
        const targetAnn = annotations.find((a) => a.id === activeGesture.annotationId);
        const rect = activeGesture.currentRect;
        const geometry = pixelBlurToNormalized({
          xPx: rect.xPx,
          yPx: rect.yPx,
          widthPx: rect.widthPx,
          heightPx: rect.heightPx,
          width: pt.width,
          height: pt.height,
          blurAmount: targetAnn?.geometry?.blurAmount ?? 12,
          blurType: targetAnn?.geometry?.blurType ?? 'blur',
        });
        onCommitGeometry({
          annotationId: activeGesture.annotationId,
          geometry,
        });
        return;
      }

      if (activeGesture.tool === 'callout-pointer') {
        const targetAnn = annotations.find((a) => a.id === activeGesture.annotationId);
        const geometry = pixelCalloutToNormalized({
          pointerXPx: activeGesture.currentPointerXPx,
          pointerYPx: activeGesture.currentPointerYPx,
          boxXPx: activeGesture.boxXPx,
          boxYPx: activeGesture.boxYPx,
          boxWidthPx: activeGesture.boxWidthPx,
          boxHeightPx: activeGesture.boxHeightPx,
          calloutText: targetAnn?.geometry?.calloutText ?? '',
          width: pt.width,
          height: pt.height,
        });
        onCommitGeometry({
          annotationId: activeGesture.annotationId,
          geometry,
        });
        return;
      }

      if (activeGesture.tool === 'callout-box') {
        const targetAnn = annotations.find((a) => a.id === activeGesture.annotationId);
        const box = activeGesture.currentBox;
        const geometry = pixelCalloutToNormalized({
          pointerXPx: activeGesture.pointerXPx,
          pointerYPx: activeGesture.pointerYPx,
          boxXPx: box.boxXPx,
          boxYPx: box.boxYPx,
          boxWidthPx: box.boxWidthPx,
          boxHeightPx: box.boxHeightPx,
          calloutText: targetAnn?.geometry?.calloutText ?? '',
          width: pt.width,
          height: pt.height,
        });
        onCommitGeometry({
          annotationId: activeGesture.annotationId,
          geometry,
        });
        return;
      }

      // Default: circle resize
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

  const hasValidBox = effectiveBaseWidth > 0 && effectiveBaseHeight > 0;
  const isDrawing = !isNavigating && gesture?.type === 'draw';
  const effectiveSelectedId = isNavigating ? null : selectedAnnotationId;
  const effectiveSelectedIds = isNavigating
    ? []
    : selectedAnnotationIds && selectedAnnotationIds.length > 0
      ? selectedAnnotationIds
      : effectiveSelectedId
        ? [effectiveSelectedId]
        : [];
  const openAnnotations = annotations.filter((ann) => {
    const isStatusOk = ann.status !== 'resolved' || effectiveSelectedIds.includes(ann.id);
    const isLayerVisible = !hiddenLayerIds.has(ann.layerId || 'default') || effectiveSelectedIds.includes(ann.id);
    return isStatusOk && isLayerVisible;
  });
  const activeDraftForImage =
    !isNavigating && draftAnnotation && draftAnnotation.imageId === imageId
      ? draftAnnotation
      : null;

  const handleStagePointerLeave = () => {
    if (!readOnly && onCursorLeave) {
      onCursorLeave();
    }
  };

  const handleStageDoubleClick = (event) => {
    if (readOnly || toolMode !== 'polygon' || polygonPointsPx.length < 3) return;
    const pt = getLocalPointer(event);
    if (!pt) return;
    event.preventDefault();
    const normGeom = pixelPolygonToNormalized({
      pointsPx: polygonPointsPx,
      width: effectiveBaseWidth,
      height: effectiveBaseHeight,
    });
    setPolygonPointsPx([]);
    setPolygonCursorPt(null);
    onSelectAnnotation(null);
    onCreateDraft({
      type: 'polygon',
      geometry: normGeom,
      color: activeDrawColor,
    });
  };

  const isDrawingCursor =
    toolMode === 'draw' ||
    toolMode === 'circle' ||
    toolMode === 'arrow' ||
    toolMode === 'line' ||
    toolMode === 'rectangle' ||
    toolMode === 'cloud' ||
    toolMode === 'pencil' ||
    toolMode === 'highlighter' ||
    toolMode === 'polygon' ||
    toolMode === 'callout' ||
    toolMode === 'textbox' ||
    toolMode === 'blur';

  return (
    <svg
      ref={svgRef}
      className={`fc-annotation-svg${isNavigating
          ? ' fc-annotation-svg-readonly'
          : isDrawingCursor
            ? ' fc-annotation-svg-draw'
            : ''
        }`}
      viewBox={hasValidBox ? `0 0 ${effectiveBaseWidth} ${effectiveBaseHeight}` : undefined}
      pointerEvents={isNavigating ? 'none' : undefined}
      onPointerDown={isNavigating ? undefined : handleStagePointerDown}
      onPointerMove={isNavigating ? undefined : handlePointerMove}
      onPointerUp={isNavigating ? undefined : handlePointerUp}
      onPointerCancel={isNavigating ? undefined : handlePointerCancel}
      onPointerLeave={isNavigating ? undefined : handleStagePointerLeave}
      onDoubleClick={isNavigating ? undefined : handleStageDoubleClick}
      role="img"
      aria-label="Image annotations overlay"
    >
      {hasValidBox
        ? openAnnotations.map((ann) => {
          const isSelected = effectiveSelectedIds.includes(ann.id);
          const isPrimarySelected = ann.id === effectiveSelectedId || (effectiveSelectedIds.length > 0 && effectiveSelectedIds[0] === ann.id);
          const isEditable = isEditableAnnotation(ann);
          const annType = ann.geometry?.tool || ann.type || (ann.geometry?.type ? ann.geometry.type : 'circle');
          const selectors = liveSelections?.filter((s) => s.annotationId === ann.id) || [];
          const isGestureTarget =
            gesture &&
            (gesture.type === 'move' || gesture.type === 'resize') &&
            gesture.annotationId === ann.id;
          const labelText = String(ann.displayNumber);
          const isCoSelectedMoveTarget = Boolean(
            gesture?.isMulti &&
            gesture.multiTargets?.some((t) => t.id === ann.id)
          );
          const coSelectedTransform = isCoSelectedMoveTarget
            ? `translate(${gesture.currentDeltaPx?.dx || 0}, ${gesture.currentDeltaPx?.dy || 0})`
            : undefined;

          const renderItem = () => {
          // 0. CALLOUT ANNOTATION
          if (annType === 'callout') {
            return (
              <CalloutAnnotationItem
                key={ann.id}
                annotation={ann}
                isSelected={isSelected}
                isEditable={isEditable}
                isNavigating={isNavigating}
                effectiveBaseWidth={effectiveBaseWidth}
                effectiveBaseHeight={effectiveBaseHeight}
                isGestureTarget={isGestureTarget}
                gesture={gesture}
                onSelect={onSelectAnnotation}
                onMoveStart={handleAnnotationPointerDown}
                onPointerResizeStart={handleCalloutPointerResizePointerDown}
                onBoxResizeStart={handleCalloutBoxResizePointerDown}
                onCommitGeometry={onCommitGeometry}
                selectors={selectors}
              />
            );
          }

          // 1. PENCIL / FREEHAND ANNOTATION
          if (annType === 'pencil') {
            const pointsPx = isGestureTarget
              ? gesture.currentPointsPx
              : normalizedPencilToPixel({
                points: ann.geometry?.points ?? [],
                width: effectiveBaseWidth,
                height: effectiveBaseHeight,
              }).pointsPx;

            const pathD = pointsToSmoothSvgPath(pointsPx);
            const badge = getPencilBadgeCoordinates({
              pointsPx,
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
              labelText,
            });

            return (
              <g key={ann.id} className="fc-ann-group">
                {/* Selected White Halo */}
                {isSelected ? (
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={7}
                    strokeOpacity={0.85}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Colored Stroke */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={ann.style?.strokeColor || ann.color}
                  strokeWidth={ann.style?.strokeWidth || (isSelected ? 3.5 : 2.5)}
                  strokeOpacity={ann.style?.strokeOpacity ?? 1.0}
                  strokeDasharray={
                    ann.style?.lineStyle === 'dashed'
                      ? '8 6'
                      : ann.style?.lineStyle === 'dotted'
                        ? '2 4'
                        : 'none'
                  }
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="none"
                  vectorEffect="non-scaling-stroke"
                />

                {/* Hit Target for Selecting & Dragging */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={18}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={isEditable ? 'fc-ann-hit' : 'fc-ann-hit fc-ann-hit-readonly'}
                  pointerEvents={isNavigating ? 'none' : 'stroke'}
                  onPointerDown={
                    isNavigating
                      ? undefined
                      : (event) => handleAnnotationPointerDown(event, ann, 'pencil')
                  }
                />

                {/* Live Collaborator Selection Highlight */}
                {selectors.length > 0 ? (
                  <path
                    d={pathD}
                    fill="none"
                    stroke={selectors[0].color}
                    strokeWidth={10}
                    strokeOpacity={0.35}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Badge */}
                {renderBadge({
                  ...badge,
                  color: ann.color,
                  labelText,
                  marker: ann.style?.marker,
                  markerColor: ann.style?.markerColor,
                  stamp: ann.style?.stamp,
                  stampColor: ann.style?.stampColor,
                  labels: ann.labels,
                  isEditable,
                  isNavigating,
                  selectors,
                  onPointerDown: (event) =>
                    handleAnnotationPointerDown(event, ann, 'pencil'),
                })}
              </g>
            );
          }

          // HIGHLIGHTER ANNOTATION
          if (annType === 'highlighter') {
            const pointsPx = isGestureTarget
              ? gesture.currentPointsPx
              : normalizedHighlighterToPixel({
                points: ann.geometry?.points ?? [],
                width: effectiveBaseWidth,
                height: effectiveBaseHeight,
              }).pointsPx;

            const pathD = pointsToSmoothSvgPath(pointsPx);
            const badge = getPencilBadgeCoordinates({
              pointsPx,
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
              labelText,
            });

            const hlWidth = ann.style?.strokeWidth ? ann.style.strokeWidth * 3.5 : 14;
            const hlOpacity = ann.style?.strokeOpacity ? ann.style.strokeOpacity * 0.45 : 0.45;

            return (
              <g key={ann.id} className="fc-ann-group">
                {/* Selected White Halo */}
                {isSelected ? (
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={hlWidth + 4}
                    strokeOpacity={0.85}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Highlighter Stroke */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={ann.style?.strokeColor || ann.color}
                  strokeWidth={hlWidth}
                  strokeOpacity={hlOpacity}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ mixBlendMode: 'multiply' }}
                  pointerEvents="none"
                  vectorEffect="non-scaling-stroke"
                />

                {/* Hit Target for Selecting & Dragging */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(18, hlWidth + 4)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={isEditable ? 'fc-ann-hit' : 'fc-ann-hit fc-ann-hit-readonly'}
                  pointerEvents={isNavigating ? 'none' : 'stroke'}
                  onPointerDown={
                    isNavigating
                      ? undefined
                      : (event) => handleAnnotationPointerDown(event, ann, 'highlighter')
                  }
                />

                {/* Live Collaborator Selection Highlight */}
                {selectors.length > 0 ? (
                  <path
                    d={pathD}
                    fill="none"
                    stroke={selectors[0].color}
                    strokeWidth={hlWidth + 6}
                    strokeOpacity={0.35}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Badge */}
                {renderBadge({
                  ...badge,
                  color: ann.color,
                  labelText,
                  marker: ann.style?.marker,
                  markerColor: ann.style?.markerColor,
                  stamp: ann.style?.stamp,
                  stampColor: ann.style?.stampColor,
                  labels: ann.labels,
                  isEditable,
                  isNavigating,
                  selectors,
                  onPointerDown: (event) =>
                    handleAnnotationPointerDown(event, ann, 'highlighter'),
                })}
              </g>
            );
          }

          // 2. ARROW ANNOTATION
          if (annType === 'arrow') {
            const px = isGestureTarget
              ? {
                startXPx: gesture.currentStartX,
                startYPx: gesture.currentStartY,
                endXPx: gesture.currentEndX,
                endYPx: gesture.currentEndY,
              }
              : normalizedArrowToPixel({
                startX: ann.geometry?.startX ?? 0.1,
                startY: ann.geometry?.startY ?? 0.1,
                endX: ann.geometry?.endX ?? 0.2,
                endY: ann.geometry?.endY ?? 0.2,
                width: effectiveBaseWidth,
                height: effectiveBaseHeight,
              });

            const badge = getArrowBadgeCoordinates({
              startXPx: px.startXPx,
              startYPx: px.startYPx,
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
              labelText,
            });

            const arrowhead = calculateArrowheadPoints({
              startXPx: px.startXPx,
              startYPx: px.startYPx,
              endXPx: px.endXPx,
              endYPx: px.endYPx,
              arrowHead: ann.style?.arrowHead || 'standard',
            });

            return (
              <g key={ann.id} className="fc-ann-group">
                {/* Selected White Halo */}
                {isSelected ? (
                  <>
                    <line
                      x1={px.startXPx}
                      y1={px.startYPx}
                      x2={px.endXPx}
                      y2={px.endYPx}
                      stroke="#ffffff"
                      strokeWidth={6}
                      strokeOpacity={0.85}
                      strokeLinecap="round"
                      pointerEvents="none"
                      vectorEffect="non-scaling-stroke"
                    />
                    <polygon
                      points={arrowhead.polygonString}
                      fill="#ffffff"
                      fillOpacity={0.85}
                      stroke="#ffffff"
                      strokeWidth={5}
                      pointerEvents="none"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                ) : null}

                {/* Arrow Line & Head */}
                <line
                  x1={px.startXPx}
                  y1={px.startYPx}
                  x2={px.endXPx}
                  y2={px.endYPx}
                  stroke={ann.style?.strokeColor || ann.color}
                  strokeWidth={ann.style?.strokeWidth || (isSelected ? 3 : 2.5)}
                  strokeOpacity={ann.style?.strokeOpacity ?? 1.0}
                  strokeDasharray={
                    ann.style?.lineStyle === 'dashed'
                      ? '8 6'
                      : ann.style?.lineStyle === 'dotted'
                        ? '2 4'
                        : 'none'
                  }
                  strokeLinecap="round"
                  pointerEvents="none"
                  vectorEffect="non-scaling-stroke"
                />
                {ann.style?.arrowHead === 'stealth' ? (
                  <polygon
                    points={arrowhead.stealthPolygonString}
                    fill={ann.style?.strokeColor || ann.color}
                    stroke={ann.style?.strokeColor || ann.color}
                    strokeWidth={1}
                    fillOpacity={ann.style?.strokeOpacity ?? 1.0}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : ann.style?.arrowHead === 'double' ? (
                  <>
                    <polygon
                      points={arrowhead.polygonString}
                      fill={ann.style?.strokeColor || ann.color}
                      stroke={ann.style?.strokeColor || ann.color}
                      strokeWidth={1}
                      fillOpacity={ann.style?.strokeOpacity ?? 1.0}
                      pointerEvents="none"
                      vectorEffect="non-scaling-stroke"
                    />
                    <polygon
                      points={arrowhead.startPolygonString}
                      fill={ann.style?.strokeColor || ann.color}
                      stroke={ann.style?.strokeColor || ann.color}
                      strokeWidth={1}
                      fillOpacity={ann.style?.strokeOpacity ?? 1.0}
                      pointerEvents="none"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                ) : ann.style?.arrowHead === 'standard' ? (
                  <polyline
                    points={`${arrowhead.left[0]},${arrowhead.left[1]} ${arrowhead.tip[0]},${arrowhead.tip[1]} ${arrowhead.right[0]},${arrowhead.right[1]}`}
                    fill="none"
                    stroke={ann.style?.strokeColor || ann.color}
                    strokeWidth={ann.style?.strokeWidth || (isSelected ? 3 : 2.5)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeOpacity={ann.style?.strokeOpacity ?? 1.0}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <polygon
                    points={arrowhead.polygonString}
                    fill={ann.style?.strokeColor || ann.color}
                    stroke={ann.style?.strokeColor || ann.color}
                    strokeWidth={1}
                    fillOpacity={ann.style?.strokeOpacity ?? 1.0}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                )}

                {/* Hit Target for Selecting & Dragging */}
                <line
                  x1={px.startXPx}
                  y1={px.startYPx}
                  x2={px.endXPx}
                  y2={px.endYPx}
                  stroke="transparent"
                  strokeWidth={14}
                  strokeLinecap="round"
                  className={isEditable ? 'fc-ann-hit' : 'fc-ann-hit fc-ann-hit-readonly'}
                  pointerEvents={isNavigating ? 'none' : 'stroke'}
                  onPointerDown={
                    isNavigating
                      ? undefined
                      : (event) => handleAnnotationPointerDown(event, ann, 'arrow')
                  }
                />

                {/* Live Collaborator Selection Highlight */}
                {selectors.length > 0 ? (
                  <line
                    x1={px.startXPx}
                    y1={px.startYPx}
                    x2={px.endXPx}
                    y2={px.endYPx}
                    stroke={selectors[0].color}
                    strokeWidth={10}
                    strokeOpacity={0.35}
                    strokeLinecap="round"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Badge */}
                {renderBadge({
                  ...badge,
                  color: ann.color,
                  labelText,
                  marker: ann.style?.marker,
                  markerColor: ann.style?.markerColor,
                  stamp: ann.style?.stamp,
                  stampColor: ann.style?.stampColor,
                  labels: ann.labels,
                  isEditable,
                  isNavigating,
                  selectors,
                  onPointerDown: (event) =>
                    handleAnnotationPointerDown(event, ann, 'arrow'),
                })}

                {/* Endpoint Resize Handles */}
                {isSelected && !isDrawing && isEditable ? (
                  <>
                    <g
                      style={{ cursor: 'crosshair' }}
                      pointerEvents="all"
                      onPointerDown={(event) =>
                        handleArrowResizePointerDown(event, ann, 'start')
                      }
                    >
                      <circle cx={px.startXPx} cy={px.startYPx} r={10} fill="transparent" />
                      <circle
                        cx={px.startXPx}
                        cy={px.startYPx}
                        r={4.5}
                        fill="#ffffff"
                        stroke={ann.color}
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                    <g
                      style={{ cursor: 'crosshair' }}
                      pointerEvents="all"
                      onPointerDown={(event) =>
                        handleArrowResizePointerDown(event, ann, 'end')
                      }
                    >
                      <circle cx={px.endXPx} cy={px.endYPx} r={10} fill="transparent" />
                      <circle
                        cx={px.endXPx}
                        cy={px.endYPx}
                        r={4.5}
                        fill="#ffffff"
                        stroke={ann.color}
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  </>
                ) : null}
              </g>
            );
          }

          // LINE ANNOTATION
          if (annType === 'line') {
            const px = isGestureTarget
              ? {
                startXPx: gesture.currentStartX,
                startYPx: gesture.currentStartY,
                endXPx: gesture.currentEndX,
                endYPx: gesture.currentEndY,
              }
              : normalizedLineToPixel({
                startX: ann.geometry?.startX ?? 0.1,
                startY: ann.geometry?.startY ?? 0.1,
                endX: ann.geometry?.endX ?? 0.2,
                endY: ann.geometry?.endY ?? 0.2,
                width: effectiveBaseWidth,
                height: effectiveBaseHeight,
              });

            const badge = getArrowBadgeCoordinates({
              startXPx: px.startXPx,
              startYPx: px.startYPx,
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
              labelText,
            });

            return (
              <g key={ann.id} className="fc-ann-group">
                {/* Selected White Halo */}
                {isSelected ? (
                  <line
                    x1={px.startXPx}
                    y1={px.startYPx}
                    x2={px.endXPx}
                    y2={px.endYPx}
                    stroke="#ffffff"
                    strokeWidth={6}
                    strokeOpacity={0.85}
                    strokeLinecap="round"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Line Shaft */}
                <line
                  x1={px.startXPx}
                  y1={px.startYPx}
                  x2={px.endXPx}
                  y2={px.endYPx}
                  stroke={ann.style?.strokeColor || ann.color}
                  strokeWidth={ann.style?.strokeWidth || (isSelected ? 3 : 2.5)}
                  strokeOpacity={ann.style?.strokeOpacity ?? 1.0}
                  strokeDasharray={
                    ann.style?.lineStyle === 'dashed'
                      ? '8 6'
                      : ann.style?.lineStyle === 'dotted'
                        ? '2 4'
                        : 'none'
                  }
                  strokeLinecap="round"
                  pointerEvents="none"
                  vectorEffect="non-scaling-stroke"
                />

                {/* Hit Target for Selecting & Dragging */}
                <line
                  x1={px.startXPx}
                  y1={px.startYPx}
                  x2={px.endXPx}
                  y2={px.endYPx}
                  stroke="transparent"
                  strokeWidth={14}
                  strokeLinecap="round"
                  className={isEditable ? 'fc-ann-hit' : 'fc-ann-hit fc-ann-hit-readonly'}
                  pointerEvents={isNavigating ? 'none' : 'stroke'}
                  onPointerDown={
                    isNavigating
                      ? undefined
                      : (event) => handleAnnotationPointerDown(event, ann, 'line')
                  }
                />

                {/* Live Collaborator Selection Highlight */}
                {selectors.length > 0 ? (
                  <line
                    x1={px.startXPx}
                    y1={px.startYPx}
                    x2={px.endXPx}
                    y2={px.endYPx}
                    stroke={selectors[0].color}
                    strokeWidth={8}
                    strokeOpacity={0.35}
                    strokeLinecap="round"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Badge */}
                {renderBadge({
                  ...badge,
                  color: ann.color,
                  labelText,
                  marker: ann.style?.marker,
                  markerColor: ann.style?.markerColor,
                  stamp: ann.style?.stamp,
                  stampColor: ann.style?.stampColor,
                  labels: ann.labels,
                  isEditable,
                  isNavigating,
                  selectors,
                  onPointerDown: (event) =>
                    handleAnnotationPointerDown(event, ann, 'line'),
                })}

                {/* Resize Endpoint Handles */}
                {isSelected && !isDrawing && isEditable ? (
                  <>
                    <g
                      style={{ cursor: 'crosshair' }}
                      pointerEvents="all"
                      onPointerDown={(event) =>
                        handleLineResizePointerDown(event, ann, 'start')
                      }
                    >
                      <circle cx={px.startXPx} cy={px.startYPx} r={10} fill="transparent" />
                      <circle
                        cx={px.startXPx}
                        cy={px.startYPx}
                        r={4.5}
                        fill="#ffffff"
                        stroke={ann.color}
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                    <g
                      style={{ cursor: 'crosshair' }}
                      pointerEvents="all"
                      onPointerDown={(event) =>
                        handleLineResizePointerDown(event, ann, 'end')
                      }
                    >
                      <circle cx={px.endXPx} cy={px.endYPx} r={10} fill="transparent" />
                      <circle
                        cx={px.endXPx}
                        cy={px.endYPx}
                        r={4.5}
                        fill="#ffffff"
                        stroke={ann.color}
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  </>
                ) : null}
              </g>
            );
          }

          // POLYGON ANNOTATION
          if (annType === 'polygon') {
            const pointsPx = isGestureTarget
              ? gesture.currentPointsPx
              : normalizedPolygonToPixel({
                points: ann.geometry?.points ?? [],
                width: effectiveBaseWidth,
                height: effectiveBaseHeight,
              }).pointsPx;

            const polygonSvgStr = pointsToPolygonSvgString(pointsPx);
            const startPt = pointsPx[0] || [0, 0];
            const badge = {
              x: clamp(startPt[0], 20, Math.max(20, effectiveBaseWidth - 20)),
              y: clamp(startPt[1] - 16, 16, Math.max(16, effectiveBaseHeight - 16)),
              width: 28,
              height: 22,
            };

            return (
              <g key={ann.id} className="fc-ann-group">
                {/* Selected White Halo */}
                {isSelected ? (
                  <polygon
                    points={polygonSvgStr}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={6}
                    strokeOpacity={0.85}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Polygon Shape */}
                <polygon
                  points={polygonSvgStr}
                  fill={
                    ann.style?.fillEnabled
                      ? (ann.style.fillColor || ann.color)
                      : isSelected
                        ? ann.color
                        : 'transparent'
                  }
                  fillOpacity={
                    ann.style?.fillEnabled
                      ? (ann.style.fillOpacity ?? 0.2)
                      : isSelected
                        ? 0.08
                        : 0
                  }
                  stroke={ann.style?.strokeColor || ann.color}
                  strokeWidth={ann.style?.strokeWidth || (isSelected ? 3 : 2.5)}
                  strokeOpacity={ann.style?.strokeOpacity ?? 1.0}
                  strokeDasharray={
                    ann.style?.lineStyle === 'dashed'
                      ? '8 6'
                      : ann.style?.lineStyle === 'dotted'
                        ? '2 4'
                        : 'none'
                  }
                  strokeLinejoin="round"
                  pointerEvents="none"
                  vectorEffect="non-scaling-stroke"
                />

                {/* Hit Target for Selecting & Dragging */}
                <polygon
                  points={polygonSvgStr}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={14}
                  strokeLinejoin="round"
                  className={isEditable ? 'fc-ann-hit' : 'fc-ann-hit fc-ann-hit-readonly'}
                  pointerEvents={
                    isNavigating
                      ? 'none'
                      : toolMode === 'select' || isSelected
                        ? 'all'
                        : 'stroke'
                  }
                  onPointerDown={
                    isNavigating
                      ? undefined
                      : (event) => handleAnnotationPointerDown(event, ann, 'polygon')
                  }
                />

                {/* Live Collaborator Selection Highlight */}
                {selectors.length > 0 ? (
                  <polygon
                    points={polygonSvgStr}
                    fill="none"
                    stroke={selectors[0].color}
                    strokeWidth={8}
                    strokeOpacity={0.35}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Vertex Dots when Selected */}
                {isSelected && !isDrawing
                  ? pointsPx.map(([vx, vy], idx) => (
                    <circle
                      key={idx}
                      cx={vx}
                      cy={vy}
                      r={4}
                      fill="#ffffff"
                      stroke={ann.color}
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  ))
                  : null}

                {/* Badge */}
                {renderBadge({
                  ...badge,
                  color: ann.color,
                  labelText,
                  marker: ann.style?.marker,
                  markerColor: ann.style?.markerColor,
                  stamp: ann.style?.stamp,
                  stampColor: ann.style?.stampColor,
                  labels: ann.labels,
                  isEditable,
                  isNavigating,
                  selectors,
                  onPointerDown: (event) =>
                    handleAnnotationPointerDown(event, ann, 'polygon'),
                })}
              </g>
            );
          }

          // 3. RECTANGLE ANNOTATION
          if (annType === 'rectangle') {
            const px = isGestureTarget
              ? gesture.currentRect
                ? gesture.currentRect
                : {
                  xPx: gesture.currentX,
                  yPx: gesture.currentY,
                  widthPx: gesture.widthPx,
                  heightPx: gesture.heightPx,
                }
              : normalizedRectToPixel({
                x: ann.geometry?.x ?? 0.1,
                y: ann.geometry?.y ?? 0.1,
                width: ann.geometry?.width ?? 0.2,
                height: ann.geometry?.height ?? 0.2,
                baseWidth: effectiveBaseWidth,
                baseHeight: effectiveBaseHeight,
              });

            const badge = getRectBadgeCoordinates({
              xPx: px.xPx,
              yPx: px.yPx,
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
              labelText,
            });

            return (
              <g key={ann.id} className="fc-ann-group">
                {/* Selected White Halo */}
                {isSelected ? (
                  <rect
                    x={px.xPx}
                    y={px.yPx}
                    width={px.widthPx}
                    height={px.heightPx}
                    rx={1.5}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={6}
                    strokeOpacity={0.85}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Rectangle Outline & Fill */}
                <rect
                  x={px.xPx}
                  y={px.yPx}
                  width={px.widthPx}
                  height={px.heightPx}
                  rx={1.5}
                  fill={
                    ann.style?.fillEnabled
                      ? (ann.style.fillColor || ann.color)
                      : isSelected
                        ? ann.color
                        : 'transparent'
                  }
                  fillOpacity={
                    ann.style?.fillEnabled
                      ? (ann.style.fillOpacity ?? 0.2)
                      : isSelected
                        ? 0.08
                        : 0
                  }
                  stroke={ann.style?.strokeColor || ann.color}
                  strokeWidth={ann.style?.strokeWidth || (isSelected ? 3 : 2.5)}
                  strokeOpacity={ann.style?.strokeOpacity ?? 1.0}
                  strokeDasharray={
                    ann.style?.lineStyle === 'dashed'
                      ? '8 6'
                      : ann.style?.lineStyle === 'dotted'
                        ? '2 4'
                        : 'none'
                  }
                  pointerEvents="none"
                  vectorEffect="non-scaling-stroke"
                />

                {/* Hit Target for Selecting & Dragging */}
                <rect
                  x={px.xPx}
                  y={px.yPx}
                  width={px.widthPx}
                  height={px.heightPx}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={14}
                  className={isEditable ? 'fc-ann-hit' : 'fc-ann-hit fc-ann-hit-readonly'}
                  pointerEvents={
                    isNavigating
                      ? 'none'
                      : toolMode === 'select' || isSelected
                        ? 'all'
                        : 'stroke'
                  }
                  onPointerDown={
                    isNavigating
                      ? undefined
                      : (event) => handleAnnotationPointerDown(event, ann, 'rectangle')
                  }
                />

                {/* Live Collaborator Selection Highlight */}
                {selectors.length > 0 ? (
                  <rect
                    x={px.xPx - 4}
                    y={px.yPx - 4}
                    width={px.widthPx + 8}
                    height={px.heightPx + 8}
                    fill="none"
                    stroke={selectors[0].color}
                    strokeWidth={2.5}
                    strokeDasharray="6 3"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Badge */}
                {renderBadge({
                  ...badge,
                  color: ann.color,
                  labelText,
                  marker: ann.style?.marker,
                  markerColor: ann.style?.markerColor,
                  stamp: ann.style?.stamp,
                  stampColor: ann.style?.stampColor,
                  labels: ann.labels,
                  isEditable,
                  isNavigating,
                  selectors,
                  onPointerDown: (event) =>
                    handleAnnotationPointerDown(event, ann, 'rectangle'),
                })}

                {/* 8 Resize Handles */}
                {isSelected && !isDrawing && isEditable
                  ? RECT_HANDLE_POSITIONS.map((handle) => {
                    let hx = px.xPx;
                    let hy = px.yPx;
                    if (handle.key === 'ne' || handle.key === 'e' || handle.key === 'se') {
                      hx = px.xPx + px.widthPx;
                    } else if (handle.key === 'n' || handle.key === 's') {
                      hx = px.xPx + px.widthPx / 2;
                    }
                    if (handle.key === 'sw' || handle.key === 's' || handle.key === 'se') {
                      hy = px.yPx + px.heightPx;
                    } else if (handle.key === 'w' || handle.key === 'e') {
                      hy = px.yPx + px.heightPx / 2;
                    }

                    return (
                      <g
                        key={handle.key}
                        style={{ cursor: handle.cursor }}
                        pointerEvents="all"
                        onPointerDown={(event) =>
                          handleRectResizePointerDown(event, ann, handle.key)
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
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    );
                  })
                  : null}
              </g>
            );
          }

          // CLOUD / REVISION CLOUD ANNOTATION
          if (annType === 'cloud') {
            const px = isGestureTarget
              ? gesture.currentRect
                ? gesture.currentRect
                : {
                  xPx: gesture.currentX,
                  yPx: gesture.currentY,
                  widthPx: gesture.widthPx,
                  heightPx: gesture.heightPx,
                }
              : normalizedCloudToPixel({
                x: ann.geometry?.x ?? 0.1,
                y: ann.geometry?.y ?? 0.1,
                width: ann.geometry?.width ?? 0.2,
                height: ann.geometry?.height ?? 0.2,
                baseWidth: effectiveBaseWidth,
                baseHeight: effectiveBaseHeight,
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
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
              labelText,
            });

            return (
              <g key={ann.id} className="fc-ann-group">
                {/* Selected White Halo */}
                {isSelected ? (
                  <path
                    d={cloudPath}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={6}
                    strokeOpacity={0.85}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Cloud Path & Fill */}
                <path
                  d={cloudPath}
                  fill={
                    ann.style?.fillEnabled
                      ? (ann.style.fillColor || ann.color)
                      : isSelected
                        ? ann.color
                        : 'transparent'
                  }
                  fillOpacity={
                    ann.style?.fillEnabled
                      ? (ann.style.fillOpacity ?? 0.2)
                      : isSelected
                        ? 0.08
                        : 0
                  }
                  stroke={ann.style?.strokeColor || ann.color}
                  strokeWidth={ann.style?.strokeWidth || (isSelected ? 3 : 2.5)}
                  strokeOpacity={ann.style?.strokeOpacity ?? 1.0}
                  strokeDasharray={
                    ann.style?.lineStyle === 'dashed'
                      ? '8 6'
                      : ann.style?.lineStyle === 'dotted'
                        ? '2 4'
                        : 'none'
                  }
                  pointerEvents="none"
                  vectorEffect="non-scaling-stroke"
                />

                {/* Hit Target for Selecting & Dragging */}
                <path
                  d={cloudPath}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={14}
                  className={isEditable ? 'fc-ann-hit' : 'fc-ann-hit fc-ann-hit-readonly'}
                  pointerEvents={
                    isNavigating
                      ? 'none'
                      : toolMode === 'select' || isSelected
                        ? 'all'
                        : 'stroke'
                  }
                  onPointerDown={
                    isNavigating
                      ? undefined
                      : (event) => handleAnnotationPointerDown(event, ann, 'cloud')
                  }
                />

                {/* Live Collaborator Selection Highlight */}
                {selectors.length > 0 ? (
                  <path
                    d={cloudPath}
                    fill="none"
                    stroke={selectors[0].color}
                    strokeWidth={6}
                    strokeOpacity={0.35}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Badge */}
                {renderBadge({
                  ...badge,
                  color: ann.color,
                  labelText,
                  marker: ann.style?.marker,
                  markerColor: ann.style?.markerColor,
                  stamp: ann.style?.stamp,
                  stampColor: ann.style?.stampColor,
                  labels: ann.labels,
                  isEditable,
                  isNavigating,
                  selectors,
                  onPointerDown: (event) =>
                    handleAnnotationPointerDown(event, ann, 'cloud'),
                })}

                {/* 8 Resize Handles */}
                {isSelected && !isDrawing && isEditable
                  ? RECT_HANDLE_POSITIONS.map((handle) => {
                    let hx = px.xPx;
                    let hy = px.yPx;
                    if (handle.key === 'ne' || handle.key === 'e' || handle.key === 'se') {
                      hx = px.xPx + px.widthPx;
                    } else if (handle.key === 'n' || handle.key === 's') {
                      hx = px.xPx + px.widthPx / 2;
                    }
                    if (handle.key === 'sw' || handle.key === 's' || handle.key === 'se') {
                      hy = px.yPx + px.heightPx;
                    } else if (handle.key === 'w' || handle.key === 'e') {
                      hy = px.yPx + px.heightPx / 2;
                    }

                    return (
                      <g
                        key={handle.key}
                        style={{ cursor: handle.cursor }}
                        pointerEvents="all"
                        onPointerDown={(event) =>
                          handleRectResizePointerDown(event, ann, handle.key, 'cloud')
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
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    );
                  })
                  : null}
              </g>
            );
          }

          // TEXTBOX ANNOTATION
          if (annType === 'textbox') {
            const px = isGestureTarget
              ? gesture.currentRect
                ? gesture.currentRect
                : {
                  xPx: gesture.currentX,
                  yPx: gesture.currentY,
                  widthPx: gesture.widthPx,
                  heightPx: gesture.heightPx,
                }
              : normalizedTextboxToPixel({
                x: ann.geometry?.x ?? 0.1,
                y: ann.geometry?.y ?? 0.1,
                width: ann.geometry?.width ?? 0.2,
                height: ann.geometry?.height ?? 0.2,
                baseWidth: effectiveBaseWidth,
                baseHeight: effectiveBaseHeight,
              });

            const badge = getRectBadgeCoordinates({
              xPx: px.xPx,
              yPx: px.yPx,
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
              labelText,
            });

            const contentText = ann.geometry?.text || ann.comment || 'Text box';

            return (
              <g key={ann.id} className="fc-ann-group">
                {/* Selected White Halo */}
                {isSelected ? (
                  <rect
                    x={px.xPx}
                    y={px.yPx}
                    width={px.widthPx}
                    height={px.heightPx}
                    rx={4}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={6}
                    strokeOpacity={0.85}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Box card */}
                <rect
                  x={px.xPx}
                  y={px.yPx}
                  width={px.widthPx}
                  height={px.heightPx}
                  rx={4}
                  fill={ann.style?.fillEnabled === false ? 'transparent' : (ann.style?.fillColor || '#ffffff')}
                  fillOpacity={ann.style?.fillEnabled === false ? 0 : (ann.style?.fillOpacity ?? 0.92)}
                  stroke={ann.style?.strokeColor || ann.color}
                  strokeWidth={ann.style?.strokeWidth || (isSelected ? 2.5 : 1.75)}
                  strokeOpacity={ann.style?.strokeOpacity ?? 1.0}
                  strokeDasharray={
                    ann.style?.lineStyle === 'dashed'
                      ? '8 6'
                      : ann.style?.lineStyle === 'dotted'
                        ? '2 4'
                        : undefined
                  }
                  pointerEvents="none"
                  vectorEffect="non-scaling-stroke"
                />

                {/* Text Content inside Box */}
                <foreignObject
                  x={px.xPx + 4}
                  y={px.yPx + 4}
                  width={Math.max(10, px.widthPx - 8)}
                  height={Math.max(10, px.heightPx - 8)}
                  pointerEvents="none"
                >
                  <div
                    className="fc-ann-textbox-content"
                    style={{
                      width: '100%',
                      height: '100%',
                      color: ann.style?.strokeColor || ann.color,
                      fontSize: ann.style?.fontSize
                        ? `${ann.style.fontSize}px`
                        : `${Math.max(10, Math.min(18, Math.round(px.heightPx * 0.28)))}px`,
                      fontWeight: ann.style?.fontWeight || 600,
                      fontStyle: ann.style?.fontStyle || 'normal',
                      fontFamily:
                        ann.style?.fontFamily === 'serif'
                          ? 'Georgia, serif'
                          : ann.style?.fontFamily === 'monospace'
                            ? 'monospace'
                            : 'inherit',
                      lineHeight: '1.3',
                      overflow: 'hidden',
                      wordBreak: 'break-word',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                    }}
                  >
                    {contentText}
                  </div>
                </foreignObject>

                {/* Hit Target for Selecting & Dragging */}
                <rect
                  x={px.xPx}
                  y={px.yPx}
                  width={px.widthPx}
                  height={px.heightPx}
                  rx={4}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={14}
                  className={isEditable ? 'fc-ann-hit' : 'fc-ann-hit fc-ann-hit-readonly'}
                  pointerEvents={
                    isNavigating
                      ? 'none'
                      : toolMode === 'select' || isSelected
                        ? 'all'
                        : 'stroke'
                  }
                  onPointerDown={
                    isNavigating
                      ? undefined
                      : (event) => handleAnnotationPointerDown(event, ann, 'textbox')
                  }
                />

                {/* Live Collaborator Selection Highlight */}
                {selectors.length > 0 ? (
                  <rect
                    x={px.xPx - 3}
                    y={px.yPx - 3}
                    width={px.widthPx + 6}
                    height={px.heightPx + 6}
                    rx={5}
                    fill="none"
                    stroke={selectors[0].color}
                    strokeWidth={2.5}
                    strokeDasharray="6 3"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Badge */}
                {renderBadge({
                  ...badge,
                  color: ann.color,
                  labelText,
                  marker: ann.style?.marker,
                  markerColor: ann.style?.markerColor,
                  stamp: ann.style?.stamp,
                  stampColor: ann.style?.stampColor,
                  labels: ann.labels,
                  isEditable,
                  isNavigating,
                  selectors,
                  onPointerDown: (event) =>
                    handleAnnotationPointerDown(event, ann, 'textbox'),
                })}

                {/* 8 Resize Handles */}
                {isSelected && !isDrawing && isEditable
                  ? RECT_HANDLE_POSITIONS.map((handle) => {
                    let hx = px.xPx;
                    let hy = px.yPx;
                    if (handle.key === 'ne' || handle.key === 'e' || handle.key === 'se') {
                      hx = px.xPx + px.widthPx;
                    } else if (handle.key === 'n' || handle.key === 's') {
                      hx = px.xPx + px.widthPx / 2;
                    }
                    if (handle.key === 'sw' || handle.key === 's' || handle.key === 'se') {
                      hy = px.yPx + px.heightPx;
                    } else if (handle.key === 'w' || handle.key === 'e') {
                      hy = px.yPx + px.heightPx / 2;
                    }

                    return (
                      <g
                        key={handle.key}
                        style={{ cursor: handle.cursor }}
                        pointerEvents="all"
                        onPointerDown={(event) =>
                          handleRectResizePointerDown(event, ann, handle.key, 'textbox')
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
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    );
                  })
                  : null}
              </g>
            );
          }

          // BLUR / PIXELATE ANNOTATION
          if (annType === 'blur') {
            const px = isGestureTarget
              ? gesture.currentRect
                ? gesture.currentRect
                : {
                  xPx: gesture.currentX,
                  yPx: gesture.currentY,
                  widthPx: gesture.widthPx,
                  heightPx: gesture.heightPx,
                }
              : normalizedBlurToPixel({
                x: ann.geometry?.x ?? 0.1,
                y: ann.geometry?.y ?? 0.1,
                width: ann.geometry?.width ?? 0.2,
                height: ann.geometry?.height ?? 0.2,
                baseWidth: effectiveBaseWidth,
                baseHeight: effectiveBaseHeight,
              });

            const badge = getRectBadgeCoordinates({
              xPx: px.xPx,
              yPx: px.yPx,
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
              labelText,
            });

            const clipId = `fc-blur-clip-${ann.id}`;

            return (
              <g key={ann.id} className="fc-ann-group">
                <defs>
                  <clipPath id={clipId}>
                    <rect x={px.xPx} y={px.yPx} width={px.widthPx} height={px.heightPx} rx={2} />
                  </clipPath>
                </defs>

                {/* Backdrop Blur Overlay */}
                <foreignObject
                  x={px.xPx}
                  y={px.yPx}
                  width={px.widthPx}
                  height={px.heightPx}
                  style={{ overflow: 'hidden' }}
                  clipPath={`url(#${clipId})`}
                  pointerEvents="none"
                >
                  <div
                    className="fc-ann-blur-box"
                    style={{
                      width: '100%',
                      height: '100%',
                      backdropFilter: 'blur(12px)',
                      WebkitBackdropFilter: 'blur(12px)',
                      backgroundColor: 'rgba(255, 255, 255, 0.2)',
                      borderRadius: '2px',
                      overflow: 'hidden',
                      contain: 'strict',
                    }}
                  />
                </foreignObject>

                {/* Selected White Halo */}
                {isSelected ? (
                  <rect
                    x={px.xPx}
                    y={px.yPx}
                    width={px.widthPx}
                    height={px.heightPx}
                    rx={2}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={5}
                    strokeOpacity={0.85}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Frame border */}
                <rect
                  x={px.xPx}
                  y={px.yPx}
                  width={px.widthPx}
                  height={px.heightPx}
                  rx={2}
                  fill="none"
                  stroke={ann.style?.strokeColor || ann.color}
                  strokeWidth={ann.style?.strokeWidth || (isSelected ? 2.5 : 1.75)}
                  strokeOpacity={ann.style?.strokeOpacity ?? 1.0}
                  strokeDasharray={
                    ann.style?.lineStyle === 'solid'
                      ? undefined
                      : ann.style?.lineStyle === 'dotted'
                        ? '2 4'
                        : '5 3'
                  }
                  pointerEvents="none"
                  vectorEffect="non-scaling-stroke"
                />

                {/* Hit Target for Selecting & Dragging */}
                <rect
                  x={px.xPx}
                  y={px.yPx}
                  width={px.widthPx}
                  height={px.heightPx}
                  rx={2}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={14}
                  className={isEditable ? 'fc-ann-hit' : 'fc-ann-hit fc-ann-hit-readonly'}
                  pointerEvents={
                    isNavigating
                      ? 'none'
                      : toolMode === 'select' || isSelected
                        ? 'all'
                        : 'stroke'
                  }
                  onPointerDown={
                    isNavigating
                      ? undefined
                      : (event) => handleAnnotationPointerDown(event, ann, 'blur')
                  }
                />

                {/* Live Collaborator Selection Highlight */}
                {selectors.length > 0 ? (
                  <rect
                    x={px.xPx - 3}
                    y={px.yPx - 3}
                    width={px.widthPx + 6}
                    height={px.heightPx + 6}
                    rx={3}
                    fill="none"
                    stroke={selectors[0].color}
                    strokeWidth={2.5}
                    strokeDasharray="6 3"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Badge */}
                {renderBadge({
                  ...badge,
                  color: ann.color,
                  labelText,
                  marker: ann.style?.marker,
                  markerColor: ann.style?.markerColor,
                  stamp: ann.style?.stamp,
                  stampColor: ann.style?.stampColor,
                  labels: ann.labels,
                  isEditable,
                  isNavigating,
                  selectors,
                  onPointerDown: (event) =>
                    handleAnnotationPointerDown(event, ann, 'blur'),
                })}

                {/* 8 Resize Handles */}
                {isSelected && !isDrawing && isEditable
                  ? RECT_HANDLE_POSITIONS.map((handle) => {
                    let hx = px.xPx;
                    let hy = px.yPx;
                    if (handle.key === 'ne' || handle.key === 'e' || handle.key === 'se') {
                      hx = px.xPx + px.widthPx;
                    } else if (handle.key === 'n' || handle.key === 's') {
                      hx = px.xPx + px.widthPx / 2;
                    }
                    if (handle.key === 'sw' || handle.key === 's' || handle.key === 'se') {
                      hy = px.yPx + px.heightPx;
                    } else if (handle.key === 'w' || handle.key === 'e') {
                      hy = px.yPx + px.heightPx / 2;
                    }

                    return (
                      <g
                        key={handle.key}
                        style={{ cursor: handle.cursor }}
                        pointerEvents="all"
                        onPointerDown={(event) =>
                          handleRectResizePointerDown(event, ann, handle.key, 'blur')
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
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    );
                  })
                  : null}
              </g>
            );
          }

          // 4. NUMBERED MARKER PIN ANNOTATION
          if (annType === 'marker' || ann.geometry?.tool === 'marker') {
            const px = isGestureTarget
              ? {
                cxPx: gesture.cxPx,
                cyPx: gesture.cyPx,
                rPx: gesture.rPx,
              }
              : normalizedCircleToPixel({
                cx: ann.geometry?.cx ?? ann.cx,
                cy: ann.geometry?.cy ?? ann.cy,
                r: ann.geometry?.r ?? ann.r ?? 0.015,
                width: effectiveBaseWidth,
                height: effectiveBaseHeight,
              });

            const pinPathD = `M ${px.cxPx} ${px.cyPx} C ${px.cxPx - 5} ${px.cyPx - 9}, ${px.cxPx - 14} ${px.cyPx - 16}, ${px.cxPx - 14} ${px.cyPx - 26} A 14 14 0 1 1 ${px.cxPx + 14} ${px.cyPx - 26} C ${px.cxPx + 14} ${px.cyPx - 16}, ${px.cxPx + 5} ${px.cyPx - 9}, ${px.cxPx} ${px.cyPx} Z`;

            const stampConfig = {
              priority: { icon: '⚡', label: 'Priority', color: '#ef4444' },
              warning: { icon: '⚠️', label: 'Warning', color: '#f59e0b' },
              suggestion: { icon: '💡', label: 'Suggestion', color: '#06b6d4' },
              issue: { icon: '🪲', label: 'Issue', color: '#8b5cf6' },
            };
            const stampInfo = ann.style?.stamp ? stampConfig[ann.style.stamp] : null;

            return (
              <g key={ann.id} className="fc-ann-group fc-ann-marker-group">
                {/* Selected Halo */}
                {isSelected ? (
                  <path
                    d={pinPathD}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={6}
                    strokeOpacity={0.85}
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Marker Drop Pin Body */}
                <path
                  d={pinPathD}
                  fill={ann.color}
                  stroke="#ffffff"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />

                {/* Pinpoint Anchor Dot */}
                <circle
                  cx={px.cxPx}
                  cy={px.cyPx}
                  r={2.5}
                  fill="#ffffff"
                  stroke={ann.color}
                  strokeWidth={1.5}
                  pointerEvents="none"
                />

                {/* Marker Number Text */}
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

                {/* Hit Target for Selecting & Dragging */}
                <path
                  d={pinPathD}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={16}
                  className={isEditable ? 'fc-ann-hit' : 'fc-ann-hit fc-ann-hit-readonly'}
                  pointerEvents={
                    isNavigating
                      ? 'none'
                      : toolMode === 'select' || isSelected
                        ? 'all'
                        : 'fill'
                  }
                  onPointerDown={
                    isNavigating
                      ? undefined
                      : (event) => handleAnnotationPointerDown(event, ann, 'circle')
                  }
                />

                {/* Live Collaborator Selection Highlight */}
                {selectors.length > 0 ? (
                  <path
                    d={pinPathD}
                    fill="none"
                    stroke={selectors[0].color}
                    strokeWidth={2.5}
                    strokeDasharray="6 3"
                    pointerEvents="none"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}

                {/* Attached Visual Stamp */}
                {stampInfo ? (
                  <g transform={`translate(${px.cxPx + 11}, ${px.cyPx - 38})`} pointerEvents="none">
                    <circle
                      cx="8"
                      cy="8"
                      r="8"
                      fill={ann.style?.stampColor || stampInfo.color}
                      stroke="#ffffff"
                      strokeWidth="1.2"
                    />
                    <text
                      x="8"
                      y="8.5"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="9"
                    >
                      {stampInfo.icon}
                    </text>
                  </g>
                ) : null}

                {/* Attached Custom Labels */}
                {Array.isArray(ann.labels) && ann.labels.length > 0 ? (
                  <g className="fc-ann-canvas-labels" transform={`translate(${px.cxPx - 14}, ${px.cyPx + 5})`} pointerEvents="none">
                    {ann.labels.slice(0, 2).map((lbl, lIdx) => {
                      const lblName = typeof lbl === 'string' ? lbl : (lbl?.name || '');
                      const lblColor = (typeof lbl === 'object' && lbl?.color) ? lbl.color : '#334155';
                      const pillWidth = Math.min(65, Math.max(16, (lblName.length || 4) * 5.2 + 8));
                      return (
                        <g key={lIdx} transform={`translate(${lIdx * (pillWidth + 3)}, 0)`}>
                          <rect
                            x="0"
                            y="0"
                            width={pillWidth}
                            height="12"
                            rx="3"
                            fill={lblColor}
                            fillOpacity={0.92}
                            stroke="#ffffff"
                            strokeWidth="0.8"
                          />
                          <text
                            x={pillWidth / 2}
                            y={6.5}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="#ffffff"
                            fontSize="7.5"
                            fontWeight="600"
                          >
                            {lblName.length > 8 ? `${lblName.slice(0, 7)}…` : lblName}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                ) : null}
              </g>
            );
          }

          // 5. CIRCLE ANNOTATION (Default / Backward Compatible)
          const px = isGestureTarget
            ? {
              cxPx: gesture.cxPx,
              cyPx: gesture.cyPx,
              rPx: gesture.rPx,
            }
            : normalizedCircleToPixel({
              cx: ann.geometry?.cx ?? ann.cx,
              cy: ann.geometry?.cy ?? ann.cy,
              r: ann.geometry?.r ?? ann.r,
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
            });

          const badge = getCircleBadgeCoordinates({
            cxPx: px.cxPx,
            cyPx: px.cyPx,
            rPx: px.rPx,
            width: effectiveBaseWidth,
            height: effectiveBaseHeight,
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
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}

              <circle
                cx={px.cxPx}
                cy={px.cyPx}
                r={px.rPx}
                fill={
                  ann.style?.fillEnabled
                    ? (ann.style.fillColor || ann.color)
                    : isSelected
                      ? ann.color
                      : 'transparent'
                }
                fillOpacity={
                  ann.style?.fillEnabled
                    ? (ann.style.fillOpacity ?? 0.2)
                    : isSelected
                      ? 0.08
                      : 0
                }
                stroke={ann.style?.strokeColor || ann.color}
                strokeWidth={ann.style?.strokeWidth || (isSelected ? 3 : 2.5)}
                strokeOpacity={ann.style?.strokeOpacity ?? 1.0}
                strokeDasharray={
                  ann.style?.lineStyle === 'dashed'
                    ? '8 6'
                    : ann.style?.lineStyle === 'dotted'
                      ? '2 4'
                      : 'none'
                }
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
              />

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
                  isNavigating
                    ? 'none'
                    : toolMode === 'select' || isSelected
                      ? 'all'
                      : 'stroke'
                }
                onPointerDown={
                  isNavigating
                    ? undefined
                    : (event) => handleAnnotationPointerDown(event, ann, 'circle')
                }
              />

              {/* Live Collaborator Selection Highlight */}
              {selectors.length > 0 ? (
                <circle
                  cx={px.cxPx}
                  cy={px.cyPx}
                  r={px.rPx + 5}
                  fill="none"
                  stroke={selectors[0].color}
                  strokeWidth={2.5}
                  strokeDasharray="6 3"
                  pointerEvents="none"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}

              {renderBadge({
                ...badge,
                color: ann.color,
                labelText,
                marker: ann.style?.marker,
                markerColor: ann.style?.markerColor,
                stamp: ann.style?.stamp,
                stampColor: ann.style?.stampColor,
                labels: ann.labels,
                isEditable,
                isNavigating,
                selectors,
                onPointerDown: (event) =>
                  handleAnnotationPointerDown(event, ann, 'circle'),
              })}

              {isSelected && !isDrawing && isEditable
                ? CIRCLE_HANDLE_POSITIONS.map((handle) => {
                  const hx = clamp(
                    px.cxPx + handle.dx * px.rPx,
                    4,
                    Math.max(4, effectiveBaseWidth - 4)
                  );
                  const hy = clamp(
                    px.cyPx + handle.dy * px.rPx,
                    4,
                    Math.max(4, effectiveBaseHeight - 4)
                  );

                  return (
                    <g
                      key={handle.key}
                      style={{ cursor: handle.cursor }}
                      pointerEvents="all"
                      onPointerDown={(event) =>
                        handleCircleResizePointerDown(event, ann)
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
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  );
                })
                : null}
            </g>
          );
          };

          const rendered = renderItem();
          return coSelectedTransform ? (
            <g key={ann.id} transform={coSelectedTransform}>
              {rendered}
            </g>
          ) : (
            rendered
          );
        })
        : null}

      {/* DRAWING GESTURE PREVIEWS */}
      {hasValidBox && isDrawing
        ? gesture.tool === 'highlighter' && Array.isArray(gesture.pointsPx) && gesture.pointsPx.length >= 2
          ? renderPreviewHighlighter({
            pointsPx: gesture.pointsPx,
            color: activeDrawColor,
            labelText: 'Draft',
            boxWidth: effectiveBaseWidth,
            boxHeight: effectiveBaseHeight,
          })
          : gesture.tool === 'pencil' && Array.isArray(gesture.pointsPx) && gesture.pointsPx.length >= 2
            ? renderPreviewPencil({
              pointsPx: gesture.pointsPx,
              color: activeDrawColor,
              labelText: 'Draft',
              boxWidth: effectiveBaseWidth,
              boxHeight: effectiveBaseHeight,
            })
            : gesture.tool === 'arrow' &&
              Math.hypot(gesture.currentX - gesture.startX, gesture.currentY - gesture.startY) > 3
              ? renderPreviewArrow({
                startXPx: gesture.startX,
                startYPx: gesture.startY,
                endXPx: gesture.currentX,
                endYPx: gesture.currentY,
                color: activeDrawColor,
                labelText: 'Draft',
                boxWidth: effectiveBaseWidth,
                boxHeight: effectiveBaseHeight,
              })
              : gesture.tool === 'line' &&
                Math.hypot(gesture.currentX - gesture.startX, gesture.currentY - gesture.startY) > 3
                ? renderPreviewLine({
                  startXPx: gesture.startX,
                  startYPx: gesture.startY,
                  endXPx: gesture.currentX,
                  endYPx: gesture.currentY,
                  color: activeDrawColor,
                  labelText: 'Draft',
                  boxWidth: effectiveBaseWidth,
                  boxHeight: effectiveBaseHeight,
                })
                : gesture.tool === 'rectangle' &&
                  Math.abs(gesture.currentX - gesture.startX) > 3 &&
                  Math.abs(gesture.currentY - gesture.startY) > 3
                  ? renderPreviewRectangle({
                    xPx: Math.min(gesture.startX, gesture.currentX),
                    yPx: Math.min(gesture.startY, gesture.currentY),
                    widthPx: Math.abs(gesture.currentX - gesture.startX),
                    heightPx: Math.abs(gesture.currentY - gesture.startY),
                    color: activeDrawColor,
                    labelText: 'Draft',
                    boxWidth: effectiveBaseWidth,
                    boxHeight: effectiveBaseHeight,
                  })
                  : gesture.tool === 'cloud' &&
                    Math.abs(gesture.currentX - gesture.startX) > 3 &&
                    Math.abs(gesture.currentY - gesture.startY) > 3
                    ? renderPreviewCloud({
                      xPx: Math.min(gesture.startX, gesture.currentX),
                      yPx: Math.min(gesture.startY, gesture.currentY),
                      widthPx: Math.abs(gesture.currentX - gesture.startX),
                      heightPx: Math.abs(gesture.currentY - gesture.startY),
                      color: activeDrawColor,
                      labelText: 'Draft',
                      boxWidth: effectiveBaseWidth,
                      boxHeight: effectiveBaseHeight,
                    })
                    : gesture.tool === 'textbox' &&
                      Math.abs(gesture.currentX - gesture.startX) > 3 &&
                      Math.abs(gesture.currentY - gesture.startY) > 3
                      ? renderPreviewTextbox({
                        xPx: Math.min(gesture.startX, gesture.currentX),
                        yPx: Math.min(gesture.startY, gesture.currentY),
                        widthPx: Math.abs(gesture.currentX - gesture.startX),
                        heightPx: Math.abs(gesture.currentY - gesture.startY),
                        color: activeDrawColor,
                        labelText: 'Draft',
                        boxWidth: effectiveBaseWidth,
                        boxHeight: effectiveBaseHeight,
                      })
                      : gesture.tool === 'blur' &&
                        Math.abs(gesture.currentX - gesture.startX) > 3 &&
                        Math.abs(gesture.currentY - gesture.startY) > 3
                        ? renderPreviewBlur({
                          xPx: Math.min(gesture.startX, gesture.currentX),
                          yPx: Math.min(gesture.startY, gesture.currentY),
                          widthPx: Math.abs(gesture.currentX - gesture.startX),
                          heightPx: Math.abs(gesture.currentY - gesture.startY),
                          color: activeDrawColor,
                          labelText: 'Draft',
                          boxWidth: effectiveBaseWidth,
                          boxHeight: effectiveBaseHeight,
                        })
                        : gesture.tool === 'callout'
                          ? renderPreviewCallout({
                            pointerXPx: gesture.pointerXPx,
                            pointerYPx: gesture.pointerYPx,
                            boxXPx: gesture.currentBoxXPx,
                            boxYPx: gesture.currentBoxYPx,
                            boxWidthPx: gesture.boxWidthPx,
                            boxHeightPx: gesture.boxHeightPx,
                            color: activeDrawColor,
                            labelText: 'Draft',
                          })
                          : gesture.tool === 'circle' && gesture.rPx > 2
                            ? renderPreviewCircle({
                              cxPx: gesture.cxPx,
                              cyPx: gesture.cyPx,
                              rPx: gesture.rPx,
                              color: activeDrawColor,
                              labelText: 'Draft',
                              boxWidth: effectiveBaseWidth,
                              boxHeight: effectiveBaseHeight,
                            })
                            : null
        : null}

      {/* POLYGON DRAWING IN-PROGRESS PREVIEW */}
      {hasValidBox && !readOnly && toolMode === 'polygon' && polygonPointsPx.length > 0
        ? renderPreviewPolygon({
          pointsPx: polygonPointsPx,
          cursorPt: polygonCursorPt,
          color: activeDrawColor,
          labelText: 'Draft',
          boxWidth: effectiveBaseWidth,
          boxHeight: effectiveBaseHeight,
        })
        : null}

      {/* ACTIVE UNCOMMITTED DRAFT FOR CURRENT IMAGE */}
      {hasValidBox && !isDrawing && activeDraftForImage
        ? (() => {
          const draftType =
            activeDraftForImage.type ||
            (activeDraftForImage.geometry?.type ? activeDraftForImage.geometry.type : 'circle');

          if (draftType === 'callout') {
            return (
              <DraftCalloutItem
                key="draft-callout"
                draft={activeDraftForImage}
                width={effectiveBaseWidth}
                height={effectiveBaseHeight}
                onUpdateDraftGeometry={onUpdateDraftGeometry}
                isNavigating={isNavigating}
              />
            );
          }

          if (draftType === 'pencil') {
            const draftPx = normalizedPencilToPixel({
              points: activeDraftForImage.geometry?.points ?? [],
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
            }).pointsPx;
            return renderPreviewPencil({
              pointsPx: draftPx,
              color: activeDraftForImage.color,
              labelText: 'Draft',
              boxWidth: effectiveBaseWidth,
              boxHeight: effectiveBaseHeight,
            });
          }

          if (draftType === 'highlighter') {
            const draftPx = normalizedHighlighterToPixel({
              points: activeDraftForImage.geometry?.points ?? [],
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
            }).pointsPx;
            return renderPreviewHighlighter({
              pointsPx: draftPx,
              color: activeDraftForImage.color,
              labelText: 'Draft',
              boxWidth: effectiveBaseWidth,
              boxHeight: effectiveBaseHeight,
            });
          }

          if (draftType === 'arrow') {
            const draftPx = normalizedArrowToPixel({
              startX: activeDraftForImage.geometry?.startX ?? 0.1,
              startY: activeDraftForImage.geometry?.startY ?? 0.1,
              endX: activeDraftForImage.geometry?.endX ?? 0.2,
              endY: activeDraftForImage.geometry?.endY ?? 0.2,
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
            });
            return renderPreviewArrow({
              startXPx: draftPx.startXPx,
              startYPx: draftPx.startYPx,
              endXPx: draftPx.endXPx,
              endYPx: draftPx.endYPx,
              color: activeDraftForImage.color,
              labelText: 'Draft',
              boxWidth: effectiveBaseWidth,
              boxHeight: effectiveBaseHeight,
            });
          }

          if (draftType === 'line') {
            const draftPx = normalizedLineToPixel({
              startX: activeDraftForImage.geometry?.startX ?? 0.1,
              startY: activeDraftForImage.geometry?.startY ?? 0.1,
              endX: activeDraftForImage.geometry?.endX ?? 0.2,
              endY: activeDraftForImage.geometry?.endY ?? 0.2,
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
            });
            return renderPreviewLine({
              startXPx: draftPx.startXPx,
              startYPx: draftPx.startYPx,
              endXPx: draftPx.endXPx,
              endYPx: draftPx.endYPx,
              color: activeDraftForImage.color,
              labelText: 'Draft',
              boxWidth: effectiveBaseWidth,
              boxHeight: effectiveBaseHeight,
            });
          }

          if (draftType === 'polygon') {
            const draftPx = normalizedPolygonToPixel({
              points: activeDraftForImage.geometry?.points ?? [],
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
            }).pointsPx;
            return renderPreviewPolygon({
              pointsPx: draftPx,
              cursorPt: null,
              color: activeDraftForImage.color,
              labelText: 'Draft',
              boxWidth: effectiveBaseWidth,
              boxHeight: effectiveBaseHeight,
            });
          }

          if (draftType === 'rectangle') {
            const draftPx = normalizedRectToPixel({
              x: activeDraftForImage.geometry?.x ?? 0.1,
              y: activeDraftForImage.geometry?.y ?? 0.1,
              width: activeDraftForImage.geometry?.width ?? 0.2,
              height: activeDraftForImage.geometry?.height ?? 0.2,
              baseWidth: effectiveBaseWidth,
              baseHeight: effectiveBaseHeight,
            });
            return renderPreviewRectangle({
              xPx: draftPx.xPx,
              yPx: draftPx.yPx,
              widthPx: draftPx.widthPx,
              heightPx: draftPx.heightPx,
              color: activeDraftForImage.color,
              labelText: 'Draft',
              boxWidth: effectiveBaseWidth,
              boxHeight: effectiveBaseHeight,
            });
          }

          if (draftType === 'cloud') {
            const draftPx = normalizedCloudToPixel({
              x: activeDraftForImage.geometry?.x ?? 0.1,
              y: activeDraftForImage.geometry?.y ?? 0.1,
              width: activeDraftForImage.geometry?.width ?? 0.2,
              height: activeDraftForImage.geometry?.height ?? 0.2,
              baseWidth: effectiveBaseWidth,
              baseHeight: effectiveBaseHeight,
            });
            return renderPreviewCloud({
              xPx: draftPx.xPx,
              yPx: draftPx.yPx,
              widthPx: draftPx.widthPx,
              heightPx: draftPx.heightPx,
              color: activeDraftForImage.color,
              labelText: 'Draft',
              boxWidth: effectiveBaseWidth,
              boxHeight: effectiveBaseHeight,
            });
          }

          if (draftType === 'textbox') {
            const draftPx = normalizedTextboxToPixel({
              x: activeDraftForImage.geometry?.x ?? 0.1,
              y: activeDraftForImage.geometry?.y ?? 0.1,
              width: activeDraftForImage.geometry?.width ?? 0.2,
              height: activeDraftForImage.geometry?.height ?? 0.2,
              baseWidth: effectiveBaseWidth,
              baseHeight: effectiveBaseHeight,
            });
            return renderPreviewTextbox({
              xPx: draftPx.xPx,
              yPx: draftPx.yPx,
              widthPx: draftPx.widthPx,
              heightPx: draftPx.heightPx,
              color: activeDraftForImage.color,
              labelText: 'Draft',
              boxWidth: effectiveBaseWidth,
              boxHeight: effectiveBaseHeight,
            });
          }

          if (draftType === 'blur') {
            const draftPx = normalizedBlurToPixel({
              x: activeDraftForImage.geometry?.x ?? 0.1,
              y: activeDraftForImage.geometry?.y ?? 0.1,
              width: activeDraftForImage.geometry?.width ?? 0.2,
              height: activeDraftForImage.geometry?.height ?? 0.2,
              baseWidth: effectiveBaseWidth,
              baseHeight: effectiveBaseHeight,
            });
            return renderPreviewBlur({
              xPx: draftPx.xPx,
              yPx: draftPx.yPx,
              widthPx: draftPx.widthPx,
              heightPx: draftPx.heightPx,
              color: activeDraftForImage.color,
              labelText: 'Draft',
              boxWidth: effectiveBaseWidth,
              boxHeight: effectiveBaseHeight,
            });
          }

          if (draftType === 'marker') {
            const draftPx = normalizedCircleToPixel({
              cx: activeDraftForImage.geometry?.cx ?? activeDraftForImage.cx ?? 0.5,
              cy: activeDraftForImage.geometry?.cy ?? activeDraftForImage.cy ?? 0.5,
              r: 0.015,
              width: effectiveBaseWidth,
              height: effectiveBaseHeight,
            });
            const pinPathD = `M ${draftPx.cxPx} ${draftPx.cyPx} C ${draftPx.cxPx - 5} ${draftPx.cyPx - 9}, ${draftPx.cxPx - 14} ${draftPx.cyPx - 16}, ${draftPx.cxPx - 14} ${draftPx.cyPx - 26} A 14 14 0 1 1 ${draftPx.cxPx + 14} ${draftPx.cyPx - 26} C ${draftPx.cxPx + 14} ${draftPx.cyPx - 16}, ${draftPx.cxPx + 5} ${draftPx.cyPx - 9}, ${draftPx.cxPx} ${draftPx.cyPx} Z`;
            return (
              <g key="draft-marker" pointerEvents="none">
                <path
                  d={pinPathD}
                  fill={activeDraftForImage.color}
                  fillOpacity={0.85}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
                <circle cx={draftPx.cxPx} cy={draftPx.cyPx} r={2.5} fill="#ffffff" stroke={activeDraftForImage.color} strokeWidth={1.5} />
                <text
                  x={draftPx.cxPx}
                  y={draftPx.cyPx - 26}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#ffffff"
                  fontSize="10"
                  fontWeight="bold"
                >
                  Pin
                </text>
              </g>
            );
          }

          // Default: circle draft
          const draftPx = normalizedCircleToPixel({
            cx: activeDraftForImage.geometry?.cx ?? activeDraftForImage.cx,
            cy: activeDraftForImage.geometry?.cy ?? activeDraftForImage.cy,
            r: activeDraftForImage.geometry?.r ?? activeDraftForImage.r,
            width: effectiveBaseWidth,
            height: effectiveBaseHeight,
          });
          return renderPreviewCircle({
            cxPx: draftPx.cxPx,
            cyPx: draftPx.cyPx,
            rPx: draftPx.rPx,
            color: activeDraftForImage.color,
            labelText: 'Draft',
            boxWidth: effectiveBaseWidth,
            boxHeight: effectiveBaseHeight,
          });
        })()
        : null}

      {/* Live Reviewer Cursors */}
      {hasValidBox && liveCursors && liveCursors.length > 0 ? (
        <g className="fc-live-cursors" pointerEvents="none" aria-hidden="true">
          {liveCursors.map((cursor) => {
            const cx = cursor.x * effectiveBaseWidth;
            const cy = cursor.y * effectiveBaseHeight;
            const cursorColor =
              cursor.color ||
              getReviewerColor(cursor.userId || cursor.displayName);
            const invScale = 1 / Math.max(0.1, scale || 1);

            return (
              <g
                key={cursor.sessionId || cursor.userId}
                className="fc-live-cursor-group"
                transform={`translate(${cx}, ${cy})`}
              >
                <g transform={`scale(${invScale})`}>
                  {/* Outer white halo for contrast */}
                  <path
                    d="M5.653 3.123l13.064 12.06a.75.75 0 01-.482 1.282l-4.708.318 2.82 5.64a.75.75 0 01-.336.985l-2.02.996a.75.75 0 01-.99-.34l-2.813-5.626-3.37 3.37a.75.75 0 01-1.283-.53V3.873a.75.75 0 011.125-.65z"
                    fill="#ffffff"
                    stroke="#ffffff"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                  />
                  {/* Colored pointer fill */}
                  <path
                    d="M5.653 3.123l13.064 12.06a.75.75 0 01-.482 1.282l-4.708.318 2.82 5.64a.75.75 0 01-.336.985l-2.02.996a.75.75 0 01-.99-.34l-2.813-5.626-3.37 3.37a.75.75 0 01-1.283-.53V3.873a.75.75 0 011.125-.65z"
                    fill={cursorColor}
                  />

                  {/* Reviewer Name Pill */}
                  <g transform="translate(13, 17)">
                    <rect
                      x="0"
                      y="0"
                      rx="4"
                      ry="4"
                      width={Math.max(
                        36,
                        (cursor.displayName?.length || 6) * 7.2 + 12
                      )}
                      height="20"
                      fill={cursorColor}
                      stroke="#ffffff"
                      strokeWidth="1.2"
                    />
                    <text
                      x="6"
                      y="14"
                      fill="#ffffff"
                      fontSize="11"
                      fontWeight="600"
                      fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                    >
                      {cursor.displayName || 'Reviewer'}
                    </text>
                  </g>
                </g>
              </g>
            );
          })}
        </g>
      ) : null}
    </svg>
  );
}
