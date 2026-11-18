/**
 * State definitions, color palettes, and geometry helpers for the collaborative batch whiteboard.
 */

export const WHITEBOARD_TOOL_MODES = {
  SELECT: 'select',
  PAN: 'pan',
  STICKY: 'sticky',
  TEXT: 'text',
  RECTANGLE: 'rectangle',
  CIRCLE: 'circle',
  ARROW: 'arrow',
  PENCIL: 'pencil',
};

export const WHITEBOARD_STICKY_COLORS = [
  { label: 'Yellow', value: '#fef08a', textDark: true },
  { label: 'Green', value: '#bbf7d0', textDark: true },
  { label: 'Blue', value: '#bae6fd', textDark: true },
  { label: 'Pink', value: '#fbcfe8', textDark: true },
  { label: 'Orange', value: '#fed7aa', textDark: true },
  { label: 'Purple', value: '#e9d5ff', textDark: true },
  { label: 'White', value: '#ffffff', textDark: true },
];

export const WHITEBOARD_SHAPE_COLORS = [
  { label: 'Slate', value: '#1e293b' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Teal', value: '#0d9488' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Purple', value: '#7c3aed' },
  { label: 'Pink', value: '#db2777' },
];

export const DEFAULT_STICKY_COLOR = '#fef08a';
export const DEFAULT_SHAPE_COLOR = '#2563eb';
export const DEFAULT_PENCIL_COLOR = '#1e293b';
export const DEFAULT_TEXT_COLOR = '#0f172a';

export const MIN_STICKY_WIDTH = 120;
export const MIN_STICKY_HEIGHT = 100;
export const DEFAULT_STICKY_WIDTH = 200;
export const DEFAULT_STICKY_HEIGHT = 180;

export const MIN_SHAPE_SIZE = 20;

/**
 * Transforms screen coordinates (relative to whiteboard container) into world coordinates.
 */
export function screenToWorld({ x, y }, { zoom = 1, pan = { x: 0, y: 0 } }) {
  const safeZoom = Math.max(zoom, 0.05);
  return {
    x: (x - pan.x) / safeZoom,
    y: (y - pan.y) / safeZoom,
  };
}

/**
 * Transforms world coordinates into screen coordinates.
 */
export function worldToScreen({ x, y }, { zoom = 1, pan = { x: 0, y: 0 } }) {
  return {
    x: x * zoom + pan.x,
    y: y * zoom + pan.y,
  };
}

/**
 * Calculates bounding box for an individual whiteboard element.
 */
export function getWhiteboardElementBounds(element) {
  if (!element) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  const { type, x, y, width, height, geometry } = element;

  switch (type) {
    case 'sticky':
    case 'text':
    case 'rectangle': {
      const w = Math.max(width || DEFAULT_STICKY_WIDTH, 10);
      const h = Math.max(height || DEFAULT_STICKY_HEIGHT, 10);
      return {
        minX: x,
        minY: y,
        maxX: x + w,
        maxY: y + h,
        width: w,
        height: h,
      };
    }
    case 'circle': {
      const r = geometry?.r || Math.max(width || 100, height || 100) / 2;
      return {
        minX: x - r,
        minY: y - r,
        maxX: x + r,
        maxY: y + r,
        width: r * 2,
        height: r * 2,
      };
    }
    case 'arrow': {
      const x1 = geometry?.x1 ?? x;
      const y1 = geometry?.y1 ?? y;
      const x2 = geometry?.x2 ?? x + (width || 100);
      const y2 = geometry?.y2 ?? y + (height || 0);
      const minX = Math.min(x1, x2);
      const minY = Math.min(y1, y2);
      const maxX = Math.max(x1, x2);
      const maxY = Math.max(y1, y2);
      return {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(maxX - minX, 10),
        height: Math.max(maxY - minY, 10),
      };
    }
    case 'pencil': {
      const points = Array.isArray(geometry?.points) ? geometry.points : [];
      if (points.length === 0) {
        return { minX: x, minY: y, maxX: x + 10, maxY: y + 10, width: 10, height: 10 };
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const pt of points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      return {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(maxX - minX, 10),
        height: Math.max(maxY - minY, 10),
      };
    }
    default:
      return { minX: x, minY: y, maxX: x + 50, maxY: y + 50, width: 50, height: 50 };
  }
}

/**
 * Calculates collective bounding box for an array of whiteboard elements.
 */
export function getWhiteboardElementsBoundingBox(elements) {
  if (!Array.isArray(elements) || elements.length === 0) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    const b = getWhiteboardElementBounds(el);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }

  if (minX === Infinity) return null;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

/**
 * Calculates arrowhead points for whiteboard arrow element.
 */
export function calculateWhiteboardArrowhead(x1, y1, x2, y2, headLength = 14, headAngleDeg = 28) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headAngleRad = (headAngleDeg * Math.PI) / 180;

  const leftX = x2 - headLength * Math.cos(angle - headAngleRad);
  const leftY = y2 - headLength * Math.sin(angle - headAngleRad);
  const rightX = x2 - headLength * Math.cos(angle + headAngleRad);
  const rightY = y2 - headLength * Math.sin(angle + headAngleRad);

  return {
    tip: { x: x2, y: y2 },
    left: { x: leftX, y: leftY },
    right: { x: rightX, y: rightY },
    pathData: `M ${x2} ${y2} L ${leftX} ${leftY} M ${x2} ${y2} L ${rightX} ${rightY}`,
  };
}

/**
 * Converts array of world points into a smooth SVG path.
 */
export function pointsToSmoothSvgPath(points) {
  if (!Array.isArray(points) || points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y} L ${points[0].x + 0.1} ${points[0].y + 0.1}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y}, ${xc} ${yc}`;
  }
  const last = points[points.length - 1];
  const secondLast = points[points.length - 2];
  d += ` Q ${secondLast.x} ${secondLast.y}, ${last.x} ${last.y}`;
  return d;
}

