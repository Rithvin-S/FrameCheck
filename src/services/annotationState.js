/**
 * Pure annotation geometry helpers and per-image undo/redo state management.
 * Geometry is stored in normalized coordinates relative to the rendered image box:
 *   - cx, cy in [0, 1] relative to rendered image width and height
 *   - r relative to min(renderedWidth, renderedHeight) so circles remain true circles
 *     regardless of image aspect ratio or container resizing.
 */

export const ANNOTATION_COLORS = [
  { name: 'Red', value: '#dc2626' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Amber', value: '#d97706' },
  { name: 'Green', value: '#16a34a' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Purple', value: '#9333ea' },
  { name: 'Pink', value: '#db2777' },
];

export const DEFAULT_ANNOTATION_COLOR = ANNOTATION_COLORS[0].value;
export const MIN_ANNOTATION_RADIUS_PX = 12;

export const DEFAULT_ANNOTATION_STYLE = Object.freeze({
  strokeWidth: 3,
  strokeOpacity: 1.0,
  strokeColor: null, // null defaults to annotation.color
  lineStyle: 'solid', // 'solid' | 'dashed' | 'dotted'
  fillEnabled: false,
  fillColor: '#dc2626',
  fillOpacity: 0.2,
  arrowHead: 'standard', // 'standard' | 'filled' | 'stealth' | 'double'
  fontSize: 14,
  fontStyle: 'normal', // 'normal' | 'italic'
  fontWeight: 'normal', // 'normal' | 'bold'
  fontFamily: 'sans-serif', // 'sans-serif' | 'serif' | 'monospace'
  marker: null, // null | 'star' | 'flag' | 'bug' | 'pin' | 'warning'
  markerColor: '#f59e0b',
  stamp: null, // null | 'priority' | 'warning' | 'suggestion' | 'issue'
  stampColor: null,
});

export const ANNOTATION_STAMPS = Object.freeze([
  { id: 'priority', label: 'Priority', icon: '⚡', color: '#ef4444', marker: 'flag' },
  { id: 'warning', label: 'Warning', icon: '⚠️', color: '#f59e0b', marker: 'warning' },
  { id: 'suggestion', label: 'Suggestion', icon: '💡', color: '#06b6d4', marker: 'star' },
  { id: 'issue', label: 'Issue', icon: '🪲', color: '#8b5cf6', marker: 'bug' },
]);

export const FONT_SIZE_OPTIONS = Object.freeze([11, 12, 14, 16, 18, 24]);

export const FONT_FAMILY_OPTIONS = Object.freeze([
  { id: 'sans-serif', label: 'Sans', font: 'system-ui, -apple-system, sans-serif' },
  { id: 'serif', label: 'Serif', font: 'Georgia, serif' },
  { id: 'monospace', label: 'Mono', font: 'monospace' },
]);

export const LINE_STYLES = Object.freeze([
  { id: 'solid', label: 'Solid', dasharray: 'none' },
  { id: 'dashed', label: 'Dashed', dasharray: '8 6' },
  { id: 'dotted', label: 'Dotted', dasharray: '2 4' },
]);

export const ARROW_HEAD_STYLES = Object.freeze([
  { id: 'standard', label: 'Standard' },
  { id: 'filled', label: 'Filled' },
  { id: 'stealth', label: 'Stealth' },
  { id: 'double', label: 'Double End' },
]);

export const ANNOTATION_MARKERS = Object.freeze([
  { id: 'star', label: 'Star', icon: '★' },
  { id: 'flag', label: 'Flag', icon: '⚑' },
  { id: 'bug', label: 'Bug', icon: '🪲' },
  { id: 'pin', label: 'Pin', icon: '📌' },
  { id: 'warning', label: 'Warning', icon: '⚠️' },
]);

export const STROKE_WIDTH_OPTIONS = Object.freeze([1, 2, 3, 5, 8, 12]);

export const PROPERTY_TYPES = Object.freeze({
  TEXT: 'text',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  DATE: 'date',
  SELECT: 'select',
});

export const PRESET_LABELS = Object.freeze([
  { name: 'Critical', color: '#ef4444' },
  { name: 'UI Issue', color: '#8b5cf6' },
  { name: 'Alignment', color: '#06b6d4' },
  { name: 'Typography', color: '#f59e0b' },
  { name: 'Layout', color: '#10b981' },
  { name: 'Functional Issue', color: '#ec4899' },
]);

export const DEFAULT_LAYERS = Object.freeze([
  { id: 'default', name: 'Default Layer', color: '#6366f1', displayOrder: 0 },
]);

export const ANNOTATION_PRIORITIES = Object.freeze(['critical', 'high', 'medium', 'low']);
export const DEFAULT_ANNOTATION_PRIORITY = 'medium';

export const PRIORITY_CONFIG = Object.freeze({
  critical: Object.freeze({
    id: 'critical',
    label: 'Critical',
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#ef4444',
    icon: '🔴',
    weight: 4,
  }),
  high: Object.freeze({
    id: 'high',
    label: 'High',
    color: '#f97316',
    bgColor: 'rgba(249, 115, 22, 0.15)',
    borderColor: '#f97316',
    icon: '🟠',
    weight: 3,
  }),
  medium: Object.freeze({
    id: 'medium',
    label: 'Medium',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.15)',
    borderColor: '#3b82f6',
    icon: '🔵',
    weight: 2,
  }),
  low: Object.freeze({
    id: 'low',
    label: 'Low',
    color: '#64748b',
    bgColor: 'rgba(100, 116, 139, 0.15)',
    borderColor: '#64748b',
    icon: '⚪',
    weight: 1,
  }),
});

/**
 * Normalizes an arbitrary priority string to a supported level ('critical', 'high', 'medium', 'low').
 */
export function normalizeAnnotationPriority(priority) {
  if (typeof priority === 'string') {
    const lower = priority.trim().toLowerCase();
    if (ANNOTATION_PRIORITIES.includes(lower)) {
      return lower;
    }
  }
  return DEFAULT_ANNOTATION_PRIORITY;
}

/**
 * Validates whether the given priority string is one of the 4 supported levels.
 */
export function validateAnnotationPriority(priority) {
  if (typeof priority !== 'string') return false;
  return ANNOTATION_PRIORITIES.includes(priority.trim().toLowerCase());
}

export const REVIEWER_COLLAB_COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#06b6d4', // Cyan
  '#2563eb', // Blue
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#14b8a6', // Teal
];

/**
 * Generates a stable, vibrant distinct color for a reviewer based on their user ID or name.
 */
export function getReviewerColor(userIdOrName) {
  if (!userIdOrName) return REVIEWER_COLLAB_COLORS[0];
  let hash = 0;
  for (let i = 0; i < userIdOrName.length; i++) {
    hash = (hash << 5) - hash + userIdOrName.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % REVIEWER_COLLAB_COLORS.length;
  return REVIEWER_COLLAB_COLORS[index];
}

export const ANNOTATION_TYPES = Object.freeze({
  CIRCLE: 'circle',
  ARROW: 'arrow',
  RECTANGLE: 'rectangle',
  PENCIL: 'pencil',
  CALLOUT: 'callout',
  HIGHLIGHTER: 'highlighter',
  LINE: 'line',
  POLYGON: 'polygon',
  CLOUD: 'cloud',
  TEXTBOX: 'textbox',
  BLUR: 'blur',
  MARKER: 'marker',
});

export const SUPPORTED_ANNOTATION_TYPES = Object.freeze([
  ANNOTATION_TYPES.CIRCLE,
  ANNOTATION_TYPES.ARROW,
  ANNOTATION_TYPES.RECTANGLE,
  ANNOTATION_TYPES.PENCIL,
  ANNOTATION_TYPES.CALLOUT,
  ANNOTATION_TYPES.HIGHLIGHTER,
  ANNOTATION_TYPES.LINE,
  ANNOTATION_TYPES.POLYGON,
  ANNOTATION_TYPES.CLOUD,
  ANNOTATION_TYPES.TEXTBOX,
  ANNOTATION_TYPES.BLUR,
  ANNOTATION_TYPES.MARKER,
]);

export function createEmptyImageAnnotationState() {
  return {
    annotations: [],
    history: {
      past: [],
      future: [],
    },
  };
}

export function getImageAnnotationState(stateByImageId, imageId) {
  if (!imageId || !stateByImageId[imageId]) {
    return createEmptyImageAnnotationState();
  }
  return stateByImageId[imageId];
}

export function clamp(value, min, max) {
  if (min > max) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Validates normalized circle geometry:
 * cx, cy in [0, 1], r in (0, 1].
 */
export function validateCircleGeometry(geometry) {
  const cx = Number(geometry?.cx);
  const cy = Number(geometry?.cy);
  const r = Number(geometry?.r);

  if (
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    !Number.isFinite(r) ||
    cx < 0 ||
    cx > 1 ||
    cy < 0 ||
    cy > 1 ||
    r <= 0 ||
    r > 1
  ) {
    throw new Error('Annotation circle geometry is out of valid bounds.');
  }

  return { type: ANNOTATION_TYPES.CIRCLE, cx, cy, r };
}

/**
 * Validates normalized arrow geometry:
 * startX, startY, endX, endY in [0, 1] with length > 0.
 */
export function validateArrowGeometry(geometry) {
  const startX = Number(geometry?.startX);
  const startY = Number(geometry?.startY);
  const endX = Number(geometry?.endX);
  const endY = Number(geometry?.endY);

  if (
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(endX) ||
    !Number.isFinite(endY) ||
    startX < 0 ||
    startX > 1 ||
    startY < 0 ||
    startY > 1 ||
    endX < 0 ||
    endX > 1 ||
    endY < 0 ||
    endY > 1
  ) {
    throw new Error('Annotation arrow coordinates are out of valid bounds.');
  }

  if (Math.hypot(endX - startX, endY - startY) < 1e-4) {
    throw new Error('Arrow length must be greater than zero.');
  }

  return { type: ANNOTATION_TYPES.ARROW, startX, startY, endX, endY };
}

/**
 * Validates normalized rectangle geometry:
 * x, y in [0, 1], width > 0, height > 0, x + width <= 1, y + height <= 1.
 */
export function validateRectangleGeometry(geometry) {
  const x = Number(geometry?.x);
  const y = Number(geometry?.y);
  const width = Number(geometry?.width);
  const height = Number(geometry?.height);

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    x < 0 ||
    x > 1 ||
    y < 0 ||
    y > 1 ||
    width <= 0 ||
    width > 1 ||
    height <= 0 ||
    height > 1 ||
    x + width > 1 ||
    y + height > 1
  ) {
    throw new Error('Annotation rectangle geometry is out of valid bounds.');
  }

  return { type: ANNOTATION_TYPES.RECTANGLE, x, y, width, height };
}

/**
 * Validates normalized pencil/freehand geometry:
 * Array of at least 2 points [x, y] with coordinates in [0, 1].
 */
export function validatePencilGeometry(geometry) {
  const points = geometry?.points;
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('Annotation pencil stroke must contain at least 2 points.');
  }
  if (points.length > 1000) {
    throw new Error('Pencil stroke exceeds maximum point limit of 1000.');
  }

  const normalizedPoints = points.map((pt, idx) => {
    let px, py;
    if (Array.isArray(pt)) {
      px = Number(pt[0]);
      py = Number(pt[1]);
    } else if (pt && typeof pt === 'object') {
      px = Number(pt.x);
      py = Number(pt.y);
    } else {
      throw new Error(`Invalid point at index ${idx} in pencil stroke.`);
    }

    if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || px > 1 || py < 0 || py > 1) {
      throw new Error(`Pencil point at index ${idx} is out of valid bounds.`);
    }
    return [px, py];
  });

  return { type: ANNOTATION_TYPES.PENCIL, points: normalizedPoints };
}

/**
 * Validates normalized callout geometry:
 * pointerX, pointerY in [0, 1], boxX, boxY in [0, 1], boxWidth > 0, boxHeight > 0,
 * boxX + boxWidth <= 1, boxY + boxHeight <= 1.
 * calloutText must be a non-empty string (1–2000 characters, at least one non-whitespace character).
 */
export function validateCalloutGeometry(geometry) {
  const pointerX = Number(geometry?.pointerX);
  const pointerY = Number(geometry?.pointerY);
  const boxX = Number(geometry?.boxX);
  const boxY = Number(geometry?.boxY);
  const boxWidth = Number(geometry?.boxWidth);
  const boxHeight = Number(geometry?.boxHeight);
  const rawText = geometry?.calloutText;

  if (
    !Number.isFinite(pointerX) ||
    !Number.isFinite(pointerY) ||
    !Number.isFinite(boxX) ||
    !Number.isFinite(boxY) ||
    !Number.isFinite(boxWidth) ||
    !Number.isFinite(boxHeight) ||
    pointerX < 0 ||
    pointerX > 1 ||
    pointerY < 0 ||
    pointerY > 1 ||
    boxX < 0 ||
    boxX > 1 ||
    boxY < 0 ||
    boxY > 1 ||
    boxWidth <= 0 ||
    boxWidth > 1 ||
    boxHeight <= 0 ||
    boxHeight > 1 ||
    boxX + boxWidth > 1 ||
    boxY + boxHeight > 1
  ) {
    throw new Error('Annotation callout geometry is out of valid bounds.');
  }

  if (typeof rawText !== 'string') {
    throw new Error('Callout note text must be a string.');
  }

  const nonWhitespace = rawText.replace(/\s+/g, '');
  if (nonWhitespace.length === 0) {
    throw new Error('Callout note text cannot be empty or only whitespace.');
  }

  if (rawText.length > 2000) {
    throw new Error('Callout note text cannot exceed 2000 characters.');
  }

  return {
    type: ANNOTATION_TYPES.CALLOUT,
    pointerX,
    pointerY,
    boxX,
    boxY,
    boxWidth,
    boxHeight,
    calloutText: rawText,
  };
}

/**
 * Validates normalized line geometry:
 * startX, startY, endX, endY in [0, 1] with length > 0.
 */
export function validateLineGeometry(geometry) {
  const startX = Number(geometry?.startX);
  const startY = Number(geometry?.startY);
  const endX = Number(geometry?.endX);
  const endY = Number(geometry?.endY);

  if (
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(endX) ||
    !Number.isFinite(endY) ||
    startX < 0 ||
    startX > 1 ||
    startY < 0 ||
    startY > 1 ||
    endX < 0 ||
    endX > 1 ||
    endY < 0 ||
    endY > 1
  ) {
    throw new Error('Annotation line coordinates are out of valid bounds.');
  }

  if (Math.hypot(endX - startX, endY - startY) < 1e-4) {
    throw new Error('Line length must be greater than zero.');
  }

  return { type: ANNOTATION_TYPES.LINE, tool: 'line', startX, startY, endX, endY };
}

/**
 * Validates normalized highlighter geometry:
 * Array of at least 2 points [x, y] with coordinates in [0, 1].
 */
export function validateHighlighterGeometry(geometry) {
  const points = geometry?.points;
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('Highlighter stroke must contain at least 2 points.');
  }
  if (points.length > 1000) {
    throw new Error('Highlighter stroke exceeds maximum point limit of 1000.');
  }

  const normalizedPoints = points.map((pt, idx) => {
    let px, py;
    if (Array.isArray(pt)) {
      px = Number(pt[0]);
      py = Number(pt[1]);
    } else if (pt && typeof pt === 'object') {
      px = Number(pt.x);
      py = Number(pt.y);
    } else {
      throw new Error(`Invalid point at index ${idx} in highlighter stroke.`);
    }

    if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || px > 1 || py < 0 || py > 1) {
      throw new Error(`Highlighter point at index ${idx} is out of valid bounds.`);
    }
    return [px, py];
  });

  return { type: ANNOTATION_TYPES.HIGHLIGHTER, tool: 'highlighter', points: normalizedPoints };
}

/**
 * Validates normalized polygon geometry:
 * Array of at least 3 vertices [x, y] with coordinates in [0, 1].
 */
export function validatePolygonGeometry(geometry) {
  const points = geometry?.points;
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error('Annotation polygon must contain at least 3 vertices.');
  }
  if (points.length > 500) {
    throw new Error('Polygon exceeds maximum vertex limit of 500.');
  }

  const normalizedPoints = points.map((pt, idx) => {
    let px, py;
    if (Array.isArray(pt)) {
      px = Number(pt[0]);
      py = Number(pt[1]);
    } else if (pt && typeof pt === 'object') {
      px = Number(pt.x);
      py = Number(pt.y);
    } else {
      throw new Error(`Invalid vertex at index ${idx} in polygon.`);
    }

    if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || px > 1 || py < 0 || py > 1) {
      throw new Error(`Polygon vertex at index ${idx} is out of valid bounds.`);
    }
    return [px, py];
  });

  return { type: ANNOTATION_TYPES.POLYGON, tool: 'polygon', isClosed: true, points: normalizedPoints };
}

/**
 * Validates normalized cloud annotation geometry:
 * x, y, width, height in [0, 1].
 */
export function validateCloudGeometry(geometry) {
  const x = Number(geometry?.x);
  const y = Number(geometry?.y);
  const width = Number(geometry?.width);
  const height = Number(geometry?.height);

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    x < 0 ||
    x > 1 ||
    y < 0 ||
    y > 1 ||
    width <= 0 ||
    width > 1 ||
    height <= 0 ||
    height > 1 ||
    x + width > 1 ||
    y + height > 1
  ) {
    throw new Error('Cloud annotation geometry is out of valid bounds.');
  }

  return { type: ANNOTATION_TYPES.CLOUD, tool: 'cloud', x, y, width, height };
}

/**
 * Validates normalized text box geometry:
 * x, y, width, height in [0, 1], with optional text string.
 */
export function validateTextboxGeometry(geometry) {
  const x = Number(geometry?.x ?? geometry?.boxX);
  const y = Number(geometry?.y ?? geometry?.boxY);
  const width = Number(geometry?.width ?? geometry?.boxWidth);
  const height = Number(geometry?.height ?? geometry?.boxHeight);
  const rawText = String(geometry?.text ?? geometry?.calloutText ?? '');

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    x < 0 ||
    x > 1 ||
    y < 0 ||
    y > 1 ||
    width <= 0 ||
    width > 1 ||
    height <= 0 ||
    height > 1 ||
    x + width > 1 ||
    y + height > 1
  ) {
    throw new Error('Text box geometry is out of valid bounds.');
  }

  if (rawText.length > 2000) {
    throw new Error('Text box content cannot exceed 2000 characters.');
  }

  return {
    type: ANNOTATION_TYPES.TEXTBOX,
    tool: 'textbox',
    x,
    y,
    width,
    height,
    text: rawText,
    boxX: x,
    boxY: y,
    boxWidth: width,
    boxHeight: height,
    calloutText: rawText,
  };
}

/**
 * Validates normalized blur/pixelate annotation geometry:
 * x, y, width, height in [0, 1], with effect 'blur' | 'pixelate'.
 */
export function validateBlurGeometry(geometry) {
  const x = Number(geometry?.x);
  const y = Number(geometry?.y);
  const width = Number(geometry?.width);
  const height = Number(geometry?.height);
  const effect = geometry?.effect === 'pixelate' ? 'pixelate' : 'blur';

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    x < 0 ||
    x > 1 ||
    y < 0 ||
    y > 1 ||
    width <= 0 ||
    width > 1 ||
    height <= 0 ||
    height > 1 ||
    x + width > 1 ||
    y + height > 1
  ) {
    throw new Error('Blur annotation geometry is out of valid bounds.');
  }

  return { type: ANNOTATION_TYPES.BLUR, tool: 'blur', x, y, width, height, effect };
}

/**
 * Unified geometry validator dispatching by tool type.
 */
export function validateAnnotationGeometry(geometry, type = ANNOTATION_TYPES.CIRCLE) {
  const normType = String(geometry?.tool || type || geometry?.type || ANNOTATION_TYPES.CIRCLE).trim().toLowerCase();
  switch (normType) {
    case ANNOTATION_TYPES.MARKER:
    case ANNOTATION_TYPES.CIRCLE:
      return validateCircleGeometry(geometry);
    case ANNOTATION_TYPES.ARROW:
      return validateArrowGeometry(geometry);
    case ANNOTATION_TYPES.LINE:
      return validateLineGeometry(geometry);
    case ANNOTATION_TYPES.RECTANGLE:
      return validateRectangleGeometry(geometry);
    case ANNOTATION_TYPES.PENCIL:
      return validatePencilGeometry(geometry);
    case ANNOTATION_TYPES.HIGHLIGHTER:
      return validateHighlighterGeometry(geometry);
    case ANNOTATION_TYPES.POLYGON:
      return validatePolygonGeometry(geometry);
    case ANNOTATION_TYPES.CLOUD:
      return validateCloudGeometry(geometry);
    case ANNOTATION_TYPES.TEXTBOX:
      return validateTextboxGeometry(geometry);
    case ANNOTATION_TYPES.BLUR:
      return validateBlurGeometry(geometry);
    case ANNOTATION_TYPES.CALLOUT:
      return validateCalloutGeometry(geometry);
    default:
      throw new Error(`Unsupported annotation type: "${normType}".`);
  }
}

/**
 * Determines whether two geometries (or annotation objects) differ meaningfully.
 * Works seamlessly across all 5 annotation types as well as legacy top-level cx/cy/r.
 */
export function hasGeometryChanged(a, b) {
  if (!a || !b) return true;
  const geomA = a.geometry || a;
  const geomB = b.geometry || b;

  const typeA = geomA.type || (geomA.cx !== undefined ? ANNOTATION_TYPES.CIRCLE : null);
  const typeB = geomB.type || (geomB.cx !== undefined ? ANNOTATION_TYPES.CIRCLE : null);

  if (typeA && typeB && typeA !== typeB) return true;

  const type = typeA || typeB || ANNOTATION_TYPES.CIRCLE;

  switch (type) {
    case ANNOTATION_TYPES.CIRCLE: {
      const cxA = Number(geomA.cx);
      const cyA = Number(geomA.cy);
      const rA = Number(geomA.r);
      const cxB = Number(geomB.cx);
      const cyB = Number(geomB.cy);
      const rB = Number(geomB.r);
      return (
        Math.abs(cxA - cxB) > 1e-5 ||
        Math.abs(cyA - cyB) > 1e-5 ||
        Math.abs(rA - rB) > 1e-5
      );
    }
    case ANNOTATION_TYPES.ARROW:
    case ANNOTATION_TYPES.LINE: {
      return (
        Math.abs(Number(geomA.startX) - Number(geomB.startX)) > 1e-5 ||
        Math.abs(Number(geomA.startY) - Number(geomB.startY)) > 1e-5 ||
        Math.abs(Number(geomA.endX) - Number(geomB.endX)) > 1e-5 ||
        Math.abs(Number(geomA.endY) - Number(geomB.endY)) > 1e-5
      );
    }
    case ANNOTATION_TYPES.RECTANGLE:
    case ANNOTATION_TYPES.CLOUD:
    case ANNOTATION_TYPES.BLUR: {
      return (
        Math.abs(Number(geomA.x) - Number(geomB.x)) > 1e-5 ||
        Math.abs(Number(geomA.y) - Number(geomB.y)) > 1e-5 ||
        Math.abs(Number(geomA.width) - Number(geomB.width)) > 1e-5 ||
        Math.abs(Number(geomA.height) - Number(geomB.height)) > 1e-5 ||
        String(geomA.effect ?? '') !== String(geomB.effect ?? '')
      );
    }
    case ANNOTATION_TYPES.TEXTBOX: {
      return (
        Math.abs(Number(geomA.x ?? geomA.boxX) - Number(geomB.x ?? geomB.boxX)) > 1e-5 ||
        Math.abs(Number(geomA.y ?? geomA.boxY) - Number(geomB.y ?? geomB.boxY)) > 1e-5 ||
        Math.abs(Number(geomA.width ?? geomA.boxWidth) - Number(geomB.width ?? geomB.boxWidth)) > 1e-5 ||
        Math.abs(Number(geomA.height ?? geomA.boxHeight) - Number(geomB.height ?? geomB.boxHeight)) > 1e-5 ||
        String(geomA.text ?? geomA.calloutText ?? '') !== String(geomB.text ?? geomB.calloutText ?? '')
      );
    }
    case ANNOTATION_TYPES.PENCIL:
    case ANNOTATION_TYPES.HIGHLIGHTER:
    case ANNOTATION_TYPES.POLYGON: {
      const ptsA = Array.isArray(geomA.points) ? geomA.points : [];
      const ptsB = Array.isArray(geomB.points) ? geomB.points : [];
      if (ptsA.length !== ptsB.length) return true;
      for (let i = 0; i < ptsA.length; i++) {
        const pA = ptsA[i];
        const pB = ptsB[i];
        if (!pA || !pB) return true;
        if (
          Math.abs(Number(pA[0]) - Number(pB[0])) > 1e-5 ||
          Math.abs(Number(pA[1]) - Number(pB[1])) > 1e-5
        ) {
          return true;
        }
      }
      return false;
    }
    case ANNOTATION_TYPES.CALLOUT: {
      return (
        Math.abs(Number(geomA.pointerX) - Number(geomB.pointerX)) > 1e-5 ||
        Math.abs(Number(geomA.pointerY) - Number(geomB.pointerY)) > 1e-5 ||
        Math.abs(Number(geomA.boxX) - Number(geomB.boxX)) > 1e-5 ||
        Math.abs(Number(geomA.boxY) - Number(geomB.boxY)) > 1e-5 ||
        Math.abs(Number(geomA.boxWidth) - Number(geomB.boxWidth)) > 1e-5 ||
        Math.abs(Number(geomA.boxHeight) - Number(geomB.boxHeight)) > 1e-5 ||
        String(geomA.calloutText ?? '') !== String(geomB.calloutText ?? '')
      );
    }
    default:
      return JSON.stringify(geomA) !== JSON.stringify(geomB);
  }
}

/**
 * Translates an annotation geometry by normalized deltas (deltaNormX, deltaNormY in [0, 1]).
 * Ensures the shape stays clamped within the image bounds without distorting proportions.
 */
export function translateAnnotationGeometry(geometry, deltaNormX, deltaNormY) {
  if (!geometry || typeof geometry !== 'object') return geometry;
  const dx = Number(deltaNormX) || 0;
  const dy = Number(deltaNormY) || 0;
  if (dx === 0 && dy === 0) return geometry;

  const type = String(
    geometry.type || geometry.tool || (geometry.cx !== undefined ? ANNOTATION_TYPES.CIRCLE : '')
  ).toLowerCase();

  switch (type) {
    case ANNOTATION_TYPES.MARKER:
    case ANNOTATION_TYPES.CIRCLE: {
      const cx = clamp(Number(geometry.cx ?? 0.5) + dx, 0, 1);
      const cy = clamp(Number(geometry.cy ?? 0.5) + dy, 0, 1);
      return {
        ...geometry,
        cx,
        cy,
      };
    }
    case ANNOTATION_TYPES.ARROW:
    case ANNOTATION_TYPES.LINE: {
      const startX = Number(geometry.startX ?? 0);
      const startY = Number(geometry.startY ?? 0);
      const endX = Number(geometry.endX ?? 0);
      const endY = Number(geometry.endY ?? 0);
      const minX = Math.min(startX, endX);
      const maxX = Math.max(startX, endX);
      const minY = Math.min(startY, endY);
      const maxY = Math.max(startY, endY);
      const clampedDx = clamp(dx, -minX, Math.max(0, 1 - maxX));
      const clampedDy = clamp(dy, -minY, Math.max(0, 1 - maxY));
      return {
        ...geometry,
        startX: clamp(startX + clampedDx, 0, 1),
        startY: clamp(startY + clampedDy, 0, 1),
        endX: clamp(endX + clampedDx, 0, 1),
        endY: clamp(endY + clampedDy, 0, 1),
      };
    }
    case ANNOTATION_TYPES.RECTANGLE:
    case ANNOTATION_TYPES.CLOUD:
    case ANNOTATION_TYPES.BLUR: {
      const w = Number(geometry.width ?? 0.1);
      const h = Number(geometry.height ?? 0.1);
      const maxX = Math.max(0, 1 - w);
      const maxY = Math.max(0, 1 - h);
      const origX = Number(geometry.x ?? 0);
      const origY = Number(geometry.y ?? 0);
      const nextX = clamp(origX + dx, 0, maxX);
      const nextY = clamp(origY + dy, 0, maxY);
      return {
        ...geometry,
        x: nextX,
        y: nextY,
      };
    }
    case ANNOTATION_TYPES.TEXTBOX: {
      const w = Number(geometry.width ?? geometry.boxWidth ?? 0.15);
      const h = Number(geometry.height ?? geometry.boxHeight ?? 0.08);
      const maxX = Math.max(0, 1 - w);
      const maxY = Math.max(0, 1 - h);
      const origX = Number(geometry.x ?? geometry.boxX ?? 0);
      const origY = Number(geometry.y ?? geometry.boxY ?? 0);
      const nextX = clamp(origX + dx, 0, maxX);
      const nextY = clamp(origY + dy, 0, maxY);
      const result = { ...geometry };
      if (geometry.x !== undefined) result.x = nextX;
      if (geometry.y !== undefined) result.y = nextY;
      if (geometry.boxX !== undefined) result.boxX = nextX;
      if (geometry.boxY !== undefined) result.boxY = nextY;
      return result;
    }
    case ANNOTATION_TYPES.PENCIL:
    case ANNOTATION_TYPES.HIGHLIGHTER:
    case ANNOTATION_TYPES.POLYGON: {
      const pts = Array.isArray(geometry.points) ? geometry.points : [];
      if (pts.length === 0) return geometry;
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (const pt of pts) {
        if (Array.isArray(pt) && pt.length >= 2) {
          const px = Number(pt[0]);
          const py = Number(pt[1]);
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
      const clampedDx = clamp(dx, -minX, Math.max(0, 1 - maxX));
      const clampedDy = clamp(dy, -minY, Math.max(0, 1 - maxY));
      const translatedPoints = pts.map((pt) => {
        if (!Array.isArray(pt) || pt.length < 2) return pt;
        return [
          clamp(Number(pt[0]) + clampedDx, 0, 1),
          clamp(Number(pt[1]) + clampedDy, 0, 1),
        ];
      });
      return {
        ...geometry,
        points: translatedPoints,
      };
    }
    case ANNOTATION_TYPES.CALLOUT: {
      const pX = Number(geometry.pointerX ?? 0.5);
      const pY = Number(geometry.pointerY ?? 0.5);
      const bX = Number(geometry.boxX ?? 0.6);
      const bY = Number(geometry.boxY ?? 0.4);
      const bW = Number(geometry.boxWidth ?? 0.2);
      const bH = Number(geometry.boxHeight ?? 0.1);
      const minX = Math.min(pX, bX);
      const maxX = Math.max(pX, bX + bW);
      const minY = Math.min(pY, bY);
      const maxY = Math.max(pY, bY + bH);
      const clampedDx = clamp(dx, -minX, Math.max(0, 1 - maxX));
      const clampedDy = clamp(dy, -minY, Math.max(0, 1 - maxY));
      return {
        ...geometry,
        pointerX: clamp(pX + clampedDx, 0, 1),
        pointerY: clamp(pY + clampedDy, 0, 1),
        boxX: clamp(bX + clampedDx, 0, 1),
        boxY: clamp(bY + clampedDy, 0, 1),
      };
    }
    default:
      return geometry;
  }
}

/**
 * Converts a circle in rendered image pixels into normalized image coordinates.
 */
export function pixelCircleToNormalized({ cxPx, cyPx, rPx, width, height }) {
  const minDim = Math.min(width, height);
  if (width <= 0 || height <= 0 || minDim <= 0) {
    return { cx: 0.5, cy: 0.5, r: 0.1 };
  }

  return {
    cx: clamp(cxPx / width, 0, 1),
    cy: clamp(cyPx / height, 0, 1),
    r: Math.max(0, rPx / minDim),
  };
}

/**
 * Converts normalized image coordinates into rendered image pixel coordinates.
 */
export function normalizedCircleToPixel({ cx, cy, r, width, height }) {
  const minDim = Math.min(width, height);
  return {
    cxPx: cx * width,
    cyPx: cy * height,
    rPx: r * minDim,
  };
}

/**
 * Clamps a moved circle in pixel coordinates so it stays completely inside [0, width] x [0, height].
 */
export function clampMovedCirclePx({ cxPx, cyPx, rPx, width, height }) {
  const safeRadius = Math.min(rPx, Math.min(width, height) / 2);
  return {
    cxPx: clamp(cxPx, safeRadius, width - safeRadius),
    cyPx: clamp(cyPx, safeRadius, height - safeRadius),
    rPx: safeRadius,
  };
}

/**
 * Clamps a circle radius in pixel coordinates so it respects minimum size and image boundaries.
 */
export function clampResizedRadiusPx({ cxPx, cyPx, rawRadiusPx, width, height }) {
  const minDim = Math.min(width, height);
  const maxAllowed = Math.max(
    0,
    Math.min(cxPx, width - cxPx, cyPx, height - cyPx)
  );
  const effectiveMin = Math.min(MIN_ANNOTATION_RADIUS_PX, maxAllowed, minDim / 2);
  return clamp(rawRadiusPx, effectiveMin, maxAllowed);
}

/**
 * Converts pixel coordinates for an arrow into normalized coordinates.
 */
export function pixelArrowToNormalized({ startXPx, startYPx, endXPx, endYPx, width, height }) {
  if (width <= 0 || height <= 0) {
    return { type: ANNOTATION_TYPES.ARROW, startX: 0.1, startY: 0.1, endX: 0.2, endY: 0.2 };
  }
  return {
    type: ANNOTATION_TYPES.ARROW,
    startX: clamp(startXPx / width, 0, 1),
    startY: clamp(startYPx / height, 0, 1),
    endX: clamp(endXPx / width, 0, 1),
    endY: clamp(endYPx / height, 0, 1),
  };
}

/**
 * Converts normalized arrow coordinates into pixel coordinates.
 */
export function normalizedArrowToPixel({ startX, startY, endX, endY, width, height }) {
  return {
    startXPx: startX * width,
    startYPx: startY * height,
    endXPx: endX * width,
    endYPx: endY * height,
  };
}

/**
 * Clamps moved arrow endpoints in pixel coordinates so both endpoints stay completely inside [0, width] x [0, height].
 */
export function clampMovedArrowPx({ startXPx, startYPx, endXPx, endYPx, dx, dy, width, height }) {
  const minX = Math.min(startXPx, endXPx);
  const maxX = Math.max(startXPx, endXPx);
  const minY = Math.min(startYPx, endYPx);
  const maxY = Math.max(startYPx, endYPx);

  const clampedDx = clamp(dx, -minX, Math.max(0, width - maxX));
  const clampedDy = clamp(dy, -minY, Math.max(0, height - maxY));

  return {
    startXPx: startXPx + clampedDx,
    startYPx: startYPx + clampedDy,
    endXPx: endXPx + clampedDx,
    endYPx: endYPx + clampedDy,
  };
}

/**
 * Converts pixel coordinates for a straight line into normalized coordinates.
 */
export function pixelLineToNormalized({ startXPx, startYPx, endXPx, endYPx, width, height }) {
  if (width <= 0 || height <= 0) {
    return { type: ANNOTATION_TYPES.LINE, tool: 'line', startX: 0.1, startY: 0.1, endX: 0.2, endY: 0.2 };
  }
  return {
    type: ANNOTATION_TYPES.LINE,
    tool: 'line',
    startX: clamp(startXPx / width, 0, 1),
    startY: clamp(startYPx / height, 0, 1),
    endX: clamp(endXPx / width, 0, 1),
    endY: clamp(endYPx / height, 0, 1),
  };
}

/**
 * Converts normalized line coordinates into pixel coordinates.
 */
export function normalizedLineToPixel({ startX, startY, endX, endY, width, height }) {
  return normalizedArrowToPixel({ startX, startY, endX, endY, width, height });
}

/**
 * Clamps moved line endpoints in pixel coordinates so both endpoints stay inside [0, width] x [0, height].
 */
export function clampMovedLinePx(args) {
  return clampMovedArrowPx(args);
}

/**
 * Calculates arrowhead polygon points given start and end pixel coordinates.
 * Supports standard, filled, stealth, and double-ended arrows.
 */
export function calculateArrowheadPoints({
  startXPx,
  startYPx,
  endXPx,
  endYPx,
  headLength = 16,
  headAngle = Math.PI / 7,
  arrowHead = 'standard',
}) {
  const angle = Math.atan2(endYPx - startYPx, endXPx - startXPx);
  const len = Math.hypot(endXPx - startXPx, endYPx - startYPx);
  const effectiveHeadLen = Math.min(headLength, Math.max(8, len * 0.4));

  const p1x = endXPx - effectiveHeadLen * Math.cos(angle - headAngle);
  const p1y = endYPx - effectiveHeadLen * Math.sin(angle - headAngle);
  const p2x = endXPx - effectiveHeadLen * Math.cos(angle + headAngle);
  const p2y = endYPx - effectiveHeadLen * Math.sin(angle + headAngle);

  // Stealth arrowhead has an indented notch base
  const recessX = endXPx - (effectiveHeadLen * 0.65) * Math.cos(angle);
  const recessY = endYPx - (effectiveHeadLen * 0.65) * Math.sin(angle);
  const stealthPolygonString = `${endXPx},${endYPx} ${p1x},${p1y} ${recessX},${recessY} ${p2x},${p2y}`;

  // Start arrowhead for 'double'
  const startAngle = angle + Math.PI;
  const sp1x = startXPx - effectiveHeadLen * Math.cos(startAngle - headAngle);
  const sp1y = startYPx - effectiveHeadLen * Math.sin(startAngle - headAngle);
  const sp2x = startXPx - effectiveHeadLen * Math.cos(startAngle + headAngle);
  const sp2y = startYPx - effectiveHeadLen * Math.sin(startAngle + headAngle);
  const startPolygonString = `${startXPx},${startYPx} ${sp1x},${sp1y} ${sp2x},${sp2y}`;

  return {
    tip: [endXPx, endYPx],
    left: [p1x, p1y],
    right: [p2x, p2y],
    polygonString: `${endXPx},${endYPx} ${p1x},${p1y} ${p2x},${p2y}`,
    stealthPolygonString,
    startPolygonString,
    arrowHead: arrowHead || 'standard',
  };
}

/**
 * Converts pixel coordinates for a rectangle into normalized coordinates.
 */
export function pixelRectToNormalized({ xPx, yPx, widthPx, heightPx, width, height }) {
  if (width <= 0 || height <= 0) {
    return { type: ANNOTATION_TYPES.RECTANGLE, x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
  }
  const normX = clamp(xPx / width, 0, 1);
  const normY = clamp(yPx / height, 0, 1);
  return {
    type: ANNOTATION_TYPES.RECTANGLE,
    x: normX,
    y: normY,
    width: clamp(widthPx / width, 0, 1 - normX),
    height: clamp(heightPx / height, 0, 1 - normY),
  };
}

/**
 * Converts normalized rectangle coordinates into pixel coordinates.
 * Supports:
 * - { x, y, width, height, baseWidth, baseHeight }
 * - { x, y, rectWidth, rectHeight, width, height }
 * - { x, y, width, height, boxWidth, boxHeight }
 * - Positional args (geom, baseWidth, baseHeight)
 */
export function normalizedRectToPixel(arg1, maybeBaseW, maybeBaseH) {
  if (!arg1 || typeof arg1 !== 'object') {
    return { xPx: 0, yPx: 0, widthPx: 0, heightPx: 0 };
  }

  const x = Number(arg1.x ?? 0);
  const y = Number(arg1.y ?? 0);

  let baseW = maybeBaseW ?? arg1.baseWidth ?? arg1.boxWidth ?? arg1.imageWidth;
  let baseH = maybeBaseH ?? arg1.baseHeight ?? arg1.boxHeight ?? arg1.imageHeight;

  let normW = arg1.rectWidth;
  let normH = arg1.rectHeight;

  if (baseW === undefined) {
    if (arg1.rectWidth !== undefined) {
      baseW = arg1.width;
    } else {
      baseW = arg1.width > 1 ? arg1.width : 800;
    }
  }

  if (baseH === undefined) {
    if (arg1.rectHeight !== undefined) {
      baseH = arg1.height;
    } else {
      baseH = arg1.height > 1 ? arg1.height : 600;
    }
  }

  if (normW === undefined) {
    if (arg1.baseWidth !== undefined || arg1.boxWidth !== undefined || arg1.imageWidth !== undefined || maybeBaseW !== undefined) {
      normW = arg1.width ?? 0.2;
    } else if (arg1.width !== undefined && arg1.width <= 1) {
      normW = arg1.width;
    } else {
      normW = 0.2;
    }
  }

  if (normH === undefined) {
    if (arg1.baseHeight !== undefined || arg1.boxHeight !== undefined || arg1.imageHeight !== undefined || maybeBaseH !== undefined) {
      normH = arg1.height ?? 0.2;
    } else if (arg1.height !== undefined && arg1.height <= 1) {
      normH = arg1.height;
    } else {
      normH = 0.2;
    }
  }

  const validBaseW = Number(baseW) > 0 ? Number(baseW) : 800;
  const validBaseH = Number(baseH) > 0 ? Number(baseH) : 600;

  return {
    xPx: x * validBaseW,
    yPx: y * validBaseH,
    widthPx: Number(normW) * validBaseW,
    heightPx: Number(normH) * validBaseH,
  };
}

/**
 * Clamps moved rectangle in pixel coordinates so it stays completely inside [0, width] x [0, height].
 */
export function clampMovedRectPx({ xPx, yPx, widthPx, heightPx, dx, dy, width, height }) {
  const nextX = clamp(xPx + dx, 0, Math.max(0, width - widthPx));
  const nextY = clamp(yPx + dy, 0, Math.max(0, height - heightPx));
  return {
    xPx: nextX,
    yPx: nextY,
    widthPx,
    heightPx,
  };
}

/**
 * Clamps resized rectangle from 8 handle keys ('nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w').
 */
export function clampResizedRectPx({ handleKey, initialRect, currentPt, width, height, minSize = 10 }) {
  let { xPx, yPx, widthPx, heightPx } = initialRect;
  let right = xPx + widthPx;
  let bottom = yPx + heightPx;

  const curX = clamp(currentPt.x, 0, width);
  const curY = clamp(currentPt.y, 0, height);

  switch (handleKey) {
    case 'nw':
      xPx = Math.min(curX, right - minSize);
      yPx = Math.min(curY, bottom - minSize);
      widthPx = right - xPx;
      heightPx = bottom - yPx;
      break;
    case 'ne':
      right = Math.max(curX, xPx + minSize);
      yPx = Math.min(curY, bottom - minSize);
      widthPx = right - xPx;
      heightPx = bottom - yPx;
      break;
    case 'se':
      right = Math.max(curX, xPx + minSize);
      bottom = Math.max(curY, yPx + minSize);
      widthPx = right - xPx;
      heightPx = bottom - yPx;
      break;
    case 'sw':
      xPx = Math.min(curX, right - minSize);
      bottom = Math.max(curY, yPx + minSize);
      widthPx = right - xPx;
      heightPx = bottom - yPx;
      break;
    case 'n':
      yPx = Math.min(curY, bottom - minSize);
      heightPx = bottom - yPx;
      break;
    case 's':
      bottom = Math.max(curY, yPx + minSize);
      heightPx = bottom - yPx;
      break;
    case 'w':
      xPx = Math.min(curX, right - minSize);
      widthPx = right - xPx;
      break;
    case 'e':
      right = Math.max(curX, xPx + minSize);
      widthPx = right - xPx;
      break;
    default:
      break;
  }

  return {
    xPx,
    yPx,
    widthPx,
    heightPx,
  };
}

/**
 * Converts pixel coordinates for a revision cloud into normalized coordinates.
 */
export function pixelCloudToNormalized({ xPx, yPx, widthPx, heightPx, width, height }) {
  const rect = pixelRectToNormalized({ xPx, yPx, widthPx, heightPx, width, height });
  return { ...rect, type: ANNOTATION_TYPES.CLOUD, tool: 'cloud' };
}

/**
 * Converts normalized cloud coordinates into pixel coordinates.
 */
export function normalizedCloudToPixel(arg1, maybeBaseW, maybeBaseH) {
  return normalizedRectToPixel(arg1, maybeBaseW, maybeBaseH);
}

export function clampMovedCloudPx(args) {
  return clampMovedRectPx(args);
}

export function clampResizedCloudPx(args) {
  return clampResizedRectPx(args);
}

/**
 * Generates an SVG path data string for a revision cloud shaped as convex scalloped arcs
 * along the perimeter of the rectangle [xPx, yPx, widthPx, heightPx].
 */
export function generateCloudSvgPath({ xPx, yPx, widthPx, heightPx, arcRadius = 14 }) {
  if (widthPx <= 0 || heightPx <= 0) return '';
  const safeRadius = Math.max(6, Math.min(arcRadius, Math.min(widthPx, heightPx) / 2));

  const numX = Math.max(2, Math.round(widthPx / (safeRadius * 1.8)));
  const stepX = widthPx / numX;
  const numY = Math.max(2, Math.round(heightPx / (safeRadius * 1.8)));
  const stepY = heightPx / numY;

  const rx = stepX * 0.65;
  const ryX = safeRadius * 0.9;
  const rxY = safeRadius * 0.9;
  const ry = stepY * 0.65;

  let d = `M ${xPx.toFixed(1)} ${yPx.toFixed(1)}`;

  for (let i = 0; i < numX; i++) {
    const nextX = xPx + (i + 1) * stepX;
    d += ` A ${rx.toFixed(1)} ${ryX.toFixed(1)} 0 0 0 ${nextX.toFixed(1)} ${yPx.toFixed(1)}`;
  }

  for (let j = 0; j < numY; j++) {
    const nextY = yPx + (j + 1) * stepY;
    d += ` A ${rxY.toFixed(1)} ${ry.toFixed(1)} 0 0 0 ${(xPx + widthPx).toFixed(1)} ${nextY.toFixed(1)}`;
  }

  for (let i = numX - 1; i >= 0; i--) {
    const prevX = xPx + i * stepX;
    d += ` A ${rx.toFixed(1)} ${ryX.toFixed(1)} 0 0 0 ${prevX.toFixed(1)} ${(yPx + heightPx).toFixed(1)}`;
  }

  for (let j = numY - 1; j >= 0; j--) {
    const prevY = yPx + j * stepY;
    d += ` A ${rxY.toFixed(1)} ${ry.toFixed(1)} 0 0 0 ${xPx.toFixed(1)} ${prevY.toFixed(1)}`;
  }

  d += ' Z';
  return d;
}

/**
 * Converts pixel coordinates for a text box into normalized coordinates.
 */
export function pixelTextboxToNormalized({ xPx, yPx, widthPx, heightPx, text = '', width, height }) {
  const rect = pixelRectToNormalized({ xPx, yPx, widthPx, heightPx, width, height });
  const rawText = String(text ?? '');
  return {
    ...rect,
    type: ANNOTATION_TYPES.TEXTBOX,
    tool: 'textbox',
    text: rawText,
    boxX: rect.x,
    boxY: rect.y,
    boxWidth: rect.width,
    boxHeight: rect.height,
    calloutText: rawText,
  };
}

/**
 * Converts normalized text box coordinates into pixel coordinates.
 */
export function normalizedTextboxToPixel(arg1, maybeBaseW, maybeBaseH) {
  if (!arg1 || typeof arg1 !== 'object') {
    return { xPx: 0, yPx: 0, widthPx: 0, heightPx: 0 };
  }
  const normX = arg1.x ?? arg1.boxX ?? 0.1;
  const normY = arg1.y ?? arg1.boxY ?? 0.1;
  const normW = arg1.rectWidth ?? arg1.width ?? (arg1.boxWidth !== undefined && arg1.boxWidth <= 1 ? arg1.boxWidth : 0.2);
  const normH = arg1.rectHeight ?? arg1.height ?? (arg1.boxHeight !== undefined && arg1.boxHeight <= 1 ? arg1.boxHeight : 0.1);

  return normalizedRectToPixel({
    x: normX,
    y: normY,
    width: normW,
    height: normH,
    baseWidth: maybeBaseW ?? arg1.baseWidth ?? (arg1.boxWidth !== undefined && arg1.boxWidth > 1 ? arg1.boxWidth : arg1.width),
    baseHeight: maybeBaseH ?? arg1.baseHeight ?? (arg1.boxHeight !== undefined && arg1.boxHeight > 1 ? arg1.boxHeight : arg1.height),
  });
}

export function clampMovedTextboxPx(args) {
  return clampMovedRectPx(args);
}

export function clampResizedTextboxPx(args) {
  return clampResizedRectPx(args);
}

/**
 * Converts pixel coordinates for a blur/pixelate annotation into normalized coordinates.
 */
export function pixelBlurToNormalized({ xPx, yPx, widthPx, heightPx, effect = 'blur', width, height, baseWidth, baseHeight }) {
  const baseW = baseWidth ?? width;
  const baseH = baseHeight ?? height;
  const rect = pixelRectToNormalized({ xPx, yPx, widthPx, heightPx, width: baseW, height: baseH });
  return {
    ...rect,
    type: ANNOTATION_TYPES.BLUR,
    tool: 'blur',
    effect: effect === 'pixelate' ? 'pixelate' : 'blur',
  };
}

/**
 * Converts normalized blur coordinates into pixel coordinates.
 */
export function normalizedBlurToPixel(arg1, maybeBaseW, maybeBaseH) {
  if (!arg1 || typeof arg1 !== 'object') {
    return { xPx: 0, yPx: 0, widthPx: 0, heightPx: 0 };
  }
  const normX = arg1.x ?? arg1.boxX ?? 0.1;
  const normY = arg1.y ?? arg1.boxY ?? 0.1;
  const normW = arg1.rectWidth ?? arg1.width ?? (arg1.boxWidth !== undefined && arg1.boxWidth <= 1 ? arg1.boxWidth : 0.2);
  const normH = arg1.rectHeight ?? arg1.height ?? (arg1.boxHeight !== undefined && arg1.boxHeight <= 1 ? arg1.boxHeight : 0.2);

  const baseW = maybeBaseW ?? arg1.baseWidth ?? (arg1.boxWidth !== undefined && arg1.boxWidth > 1 ? arg1.boxWidth : arg1.width);
  const baseH = maybeBaseH ?? arg1.baseHeight ?? (arg1.boxHeight !== undefined && arg1.boxHeight > 1 ? arg1.boxHeight : arg1.height);

  return normalizedRectToPixel({
    x: normX,
    y: normY,
    width: normW,
    height: normH,
    baseWidth: baseW,
    baseHeight: baseH,
  });
}

export function clampMovedBlurPx(args) {
  return clampMovedRectPx(args);
}

export function clampResizedBlurPx(args) {
  return clampResizedRectPx(args);
}

/**
 * Converts pixel points for a polygon into normalized coordinates.
 */
export function pixelPolygonToNormalized({ pointsPx, width, height }) {
  if (width <= 0 || height <= 0 || !Array.isArray(pointsPx)) {
    return { type: ANNOTATION_TYPES.POLYGON, tool: 'polygon', isClosed: true, points: [] };
  }
  return {
    type: ANNOTATION_TYPES.POLYGON,
    tool: 'polygon',
    isClosed: true,
    points: pointsPx.map(([px, py]) => [
      clamp(px / width, 0, 1),
      clamp(py / height, 0, 1),
    ]),
  };
}

/**
 * Converts normalized polygon vertices into pixel coordinates.
 */
export function normalizedPolygonToPixel({ points, width, height }) {
  if (!Array.isArray(points)) return { pointsPx: [] };
  return {
    pointsPx: points.map(([nx, ny]) => [
      nx * width,
      ny * height,
    ]),
  };
}

export function clampMovedPolygonPx({ pointsPx, dx, dy, width, height }) {
  return clampMovedPencilPx({ pointsPx, dx, dy, width, height });
}

export function pointsToPolygonSvgString(pointsPx) {
  if (!Array.isArray(pointsPx) || pointsPx.length === 0) return '';
  return pointsPx.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

/**
 * Converts pixel points for a freehand highlighter stroke into normalized coordinates.
 */
export function pixelHighlighterToNormalized({ pointsPx, width, height }) {
  if (width <= 0 || height <= 0 || !Array.isArray(pointsPx)) {
    return { type: ANNOTATION_TYPES.HIGHLIGHTER, tool: 'highlighter', points: [] };
  }
  return {
    type: ANNOTATION_TYPES.HIGHLIGHTER,
    tool: 'highlighter',
    points: pointsPx.map(([px, py]) => [
      clamp(px / width, 0, 1),
      clamp(py / height, 0, 1),
    ]),
  };
}

/**
 * Converts normalized highlighter points into pixel coordinates.
 */
export function normalizedHighlighterToPixel({ points, width, height }) {
  return normalizedPencilToPixel({ points, width, height });
}

export function clampMovedHighlighterPx(args) {
  return clampMovedPencilPx(args);
}

/**
 * Converts pixel points for a freehand pencil stroke into normalized coordinates.
 */
export function pixelPencilToNormalized({ pointsPx, width, height }) {
  if (width <= 0 || height <= 0 || !Array.isArray(pointsPx)) {
    return { type: ANNOTATION_TYPES.PENCIL, points: [] };
  }
  return {
    type: ANNOTATION_TYPES.PENCIL,
    points: pointsPx.map(([px, py]) => [
      clamp(px / width, 0, 1),
      clamp(py / height, 0, 1),
    ]),
  };
}

/**
 * Converts normalized freehand pencil points into pixel coordinates.
 */
export function normalizedPencilToPixel({ points, width, height }) {
  if (!Array.isArray(points)) return { pointsPx: [] };
  return {
    pointsPx: points.map(([nx, ny]) => [
      nx * width,
      ny * height,
    ]),
  };
}

/**
 * Calculates perpendicular distance from point p to line segment [p1, p2].
 */
function getPerpendicularDistance(p, p1, p2) {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];

  if (dx === 0 && dy === 0) {
    return Math.hypot(p[0] - p1[0], p[1] - p1[1]);
  }

  const numerator = Math.abs(dy * p[0] - dx * p[1] + p2[0] * p1[1] - p2[1] * p1[0]);
  const denominator = Math.hypot(dx, dy);
  return numerator / denominator;
}

/**
 * Simplifies a 2D polyline using the Ramer-Douglas-Peucker (RDP) algorithm.
 * @param {Array<[number, number]>} points Array of [x, y] coordinates.
 * @param {number} epsilon Maximum allowed perpendicular distance threshold.
 * @returns {Array<[number, number]>} Simplified array of points.
 */
export function simplifyPointsRDP(points, epsilon = 1.2) {
  if (!Array.isArray(points) || points.length <= 2) {
    return points ? points.slice() : [];
  }

  let maxDist = 0;
  let index = 0;
  const last = points.length - 1;

  for (let i = 1; i < last; i++) {
    const dist = getPerpendicularDistance(points[i], points[0], points[last]);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const recResults1 = simplifyPointsRDP(points.slice(0, index + 1), epsilon);
    const recResults2 = simplifyPointsRDP(points.slice(index), epsilon);
    return recResults1.slice(0, -1).concat(recResults2);
  }

  return [points[0], points[last]];
}

/**
 * Pre-processes, deduplicates, and applies RDP simplification to a raw drawn stroke,
 * ensuring sensible point limits without visibly altering stroke shape.
 */
export function simplifyPencilStroke(pointsPx, initialEpsilon = 1.2, maxPoints = 500) {
  if (!Array.isArray(pointsPx) || pointsPx.length < 2) return [];

  // Step 1: Remove duplicate or micro-jitter points (< 1.5px apart)
  const deduped = [pointsPx[0]];
  for (let i = 1; i < pointsPx.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = pointsPx[i];
    if (Math.hypot(curr[0] - prev[0], curr[1] - prev[1]) >= 1.5 || i === pointsPx.length - 1) {
      deduped.push(curr);
    }
  }

  if (deduped.length <= 2) return deduped;

  // Step 2: RDP simplification
  let epsilon = initialEpsilon;
  let simplified = simplifyPointsRDP(deduped, epsilon);

  // If still above maxPoints, adaptively increase epsilon
  let passes = 0;
  while (simplified.length > maxPoints && passes < 4) {
    epsilon *= 1.8;
    simplified = simplifyPointsRDP(simplified, epsilon);
    passes++;
  }

  // Safety downsample fallback
  if (simplified.length > maxPoints) {
    const step = Math.ceil(simplified.length / maxPoints);
    simplified = simplified.filter((_, idx) => idx === 0 || idx === simplified.length - 1 || idx % step === 0);
  }

  return simplified;
}

/**
 * Converts an array of [x, y] points into a smooth SVG path definition (d attribute)
 * using quadratic bezier curves through segment midpoints.
 */
export function pointsToSmoothSvgPath(points) {
  if (!Array.isArray(points) || points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[0][0]} ${points[0][1]}`;
  }
  if (points.length === 2) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  }

  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const xc = (points[i][0] + points[i + 1][0]) / 2;
    const yc = (points[i][1] + points[i + 1][1]) / 2;
    d += ` Q ${points[i][0]} ${points[i][1]}, ${xc} ${yc}`;
  }
  const last = points.length - 1;
  d += ` L ${points[last][0]} ${points[last][1]}`;
  return d;
}

/**
 * Computes bounding box for an array of 2D points.
 */
export function getPointsBoundingBox(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const x = pt[0];
    const y = pt[1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

/**
 * Clamps moved freehand points so the entire stroke remains inside [0, width] x [0, height].
 */
export function clampMovedPencilPx({ pointsPx, dx, dy, width, height }) {
  if (!Array.isArray(pointsPx) || pointsPx.length === 0) return [];
  const bbox = getPointsBoundingBox(pointsPx);
  const clampedDx = clamp(dx, -bbox.minX, Math.max(0, width - bbox.maxX));
  const clampedDy = clamp(dy, -bbox.minY, Math.max(0, height - bbox.maxY));

  return pointsPx.map(([px, py]) => [
    px + clampedDx,
    py + clampedDy,
  ]);
}

/**
 * Calculates badge coordinates for a freehand pencil stroke.
 */
export function getPencilBadgeCoordinates({ pointsPx, width, height, labelText }) {
  const halfBadgeW =
    labelText.length >= 4
      ? Math.max(18, labelText.length * 4 + 4)
      : labelText.length >= 3
        ? 14
        : 11;
  const halfBadgeH = 11;

  const startPt = Array.isArray(pointsPx) && pointsPx.length > 0 ? pointsPx[0] : [0, 0];

  return {
    x: clamp(startPt[0], halfBadgeW + 2, Math.max(halfBadgeW + 2, width - halfBadgeW - 2)),
    y: clamp(startPt[1] - 14, halfBadgeH + 2, Math.max(halfBadgeH + 2, height - halfBadgeH - 2)),
    width: halfBadgeW * 2,
    height: halfBadgeH * 2,
  };
}

/**
 * Converts pixel coordinates for a callout into normalized coordinates.
 */
export function pixelCalloutToNormalized({
  pointerXPx,
  pointerYPx,
  boxXPx,
  boxYPx,
  boxWidthPx,
  boxHeightPx,
  calloutText = '',
  width,
  height,
}) {
  if (width <= 0 || height <= 0) {
    return {
      type: ANNOTATION_TYPES.CALLOUT,
      pointerX: 0.5,
      pointerY: 0.5,
      boxX: 0.6,
      boxY: 0.4,
      boxWidth: 0.2,
      boxHeight: 0.1,
      calloutText: '',
    };
  }
  const normBoxX = clamp(boxXPx / width, 0, 1);
  const normBoxY = clamp(boxYPx / height, 0, 1);
  return {
    type: ANNOTATION_TYPES.CALLOUT,
    pointerX: clamp(pointerXPx / width, 0, 1),
    pointerY: clamp(pointerYPx / height, 0, 1),
    boxX: normBoxX,
    boxY: normBoxY,
    boxWidth: clamp(boxWidthPx / width, 0, 1 - normBoxX),
    boxHeight: clamp(boxHeightPx / height, 0, 1 - normBoxY),
    calloutText: String(calloutText ?? ''),
  };
}

/**
 * Converts normalized callout coordinates into pixel coordinates.
 */
export function normalizedCalloutToPixel({
  pointerX,
  pointerY,
  boxX,
  boxY,
  boxWidth,
  boxHeight,
  width,
  height,
}) {
  return {
    pointerXPx: pointerX * width,
    pointerYPx: pointerY * height,
    boxXPx: boxX * width,
    boxYPx: boxY * height,
    boxWidthPx: boxWidth * width,
    boxHeightPx: boxHeight * height,
  };
}

/**
 * Calculates connection coordinates between the callout pointer and text box boundary.
 * Returns the attachment point on the text box edge, the arrowhead polygon, and connector line.
 */
export function calculateCalloutConnector({
  pointerXPx,
  pointerYPx,
  boxXPx,
  boxYPx,
  boxWidthPx,
  boxHeightPx,
  headLength = 12,
  headAngle = Math.PI / 7,
}) {
  const boxCenterX = boxXPx + boxWidthPx / 2;
  const boxCenterY = boxYPx + boxHeightPx / 2;
  const halfW = boxWidthPx / 2;
  const halfH = boxHeightPx / 2;

  const dx = pointerXPx - boxCenterX;
  const dy = pointerYPx - boxCenterY;

  let attachX = boxCenterX;
  let attachY = boxCenterY;

  if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
    const tx = Math.abs(dx) > 1e-4 ? halfW / Math.abs(dx) : Infinity;
    const ty = Math.abs(dy) > 1e-4 ? halfH / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);

    if (t < 1) {
      attachX = clamp(boxCenterX + t * dx, boxXPx, boxXPx + boxWidthPx);
      attachY = clamp(boxCenterY + t * dy, boxYPx, boxYPx + boxHeightPx);
    } else {
      attachX = pointerXPx;
      attachY = pointerYPx;
    }
  }

  const arrowhead = calculateArrowheadPoints({
    startXPx: attachX,
    startYPx: attachY,
    endXPx: pointerXPx,
    endYPx: pointerYPx,
    headLength,
    headAngle,
  });

  return {
    attachXPx: attachX,
    attachYPx: attachY,
    pointerXPx,
    pointerYPx,
    arrowhead,
  };
}

/**
 * Clamps moving the entire callout (both pointer tip and text box) so neither exceeds image boundaries.
 */
export function clampMovedCalloutPx({
  pointerXPx,
  pointerYPx,
  boxXPx,
  boxYPx,
  boxWidthPx,
  boxHeightPx,
  dx,
  dy,
  width,
  height,
}) {
  const minXDisplacement = Math.max(-pointerXPx, -boxXPx);
  const maxXDisplacement = Math.min(width - pointerXPx, width - (boxXPx + boxWidthPx));
  const minYDisplacement = Math.max(-pointerYPx, -boxYPx);
  const maxYDisplacement = Math.min(height - pointerYPx, height - (boxYPx + boxHeightPx));

  const clampedDx = clamp(dx, minXDisplacement, Math.max(minXDisplacement, maxXDisplacement));
  const clampedDy = clamp(dy, minYDisplacement, Math.max(minYDisplacement, maxYDisplacement));

  return {
    pointerXPx: pointerXPx + clampedDx,
    pointerYPx: pointerYPx + clampedDy,
    boxXPx: boxXPx + clampedDx,
    boxYPx: boxYPx + clampedDy,
    boxWidthPx,
    boxHeightPx,
  };
}

/**
 * Clamps moving only the pointer tip independently within image bounds [0, width] x [0, height].
 */
export function clampMovedCalloutPointerPx({
  pointerXPx,
  pointerYPx,
  dx,
  dy,
  width,
  height,
}) {
  return {
    pointerXPx: clamp(pointerXPx + dx, 0, width),
    pointerYPx: clamp(pointerYPx + dy, 0, height),
  };
}

/**
 * Clamps resizing the callout text box from corner and edge handles.
 */
export function clampResizedCalloutBoxPx({
  handleKey,
  initialBox,
  currentPt,
  width,
  height,
  minWidth = 70,
  minHeight = 36,
}) {
  let { boxXPx, boxYPx, boxWidthPx, boxHeightPx } = initialBox;
  let right = boxXPx + boxWidthPx;
  let bottom = boxYPx + boxHeightPx;

  const curX = clamp(currentPt.x, 0, width);
  const curY = clamp(currentPt.y, 0, height);

  switch (handleKey) {
    case 'nw':
      boxXPx = Math.min(curX, right - minWidth);
      boxYPx = Math.min(curY, bottom - minHeight);
      boxWidthPx = right - boxXPx;
      boxHeightPx = bottom - boxYPx;
      break;
    case 'ne':
      right = Math.max(curX, boxXPx + minWidth);
      boxYPx = Math.min(curY, bottom - minHeight);
      boxWidthPx = right - boxXPx;
      boxHeightPx = bottom - boxYPx;
      break;
    case 'se':
      right = Math.max(curX, boxXPx + minWidth);
      bottom = Math.max(curY, boxYPx + minHeight);
      boxWidthPx = right - boxXPx;
      boxHeightPx = bottom - boxYPx;
      break;
    case 'sw':
      boxXPx = Math.min(curX, right - minWidth);
      bottom = Math.max(curY, boxYPx + minHeight);
      boxWidthPx = right - boxXPx;
      boxHeightPx = bottom - boxYPx;
      break;
    case 'n':
      boxYPx = Math.min(curY, bottom - minHeight);
      boxHeightPx = bottom - boxYPx;
      break;
    case 's':
      bottom = Math.max(curY, boxYPx + minHeight);
      boxHeightPx = bottom - boxYPx;
      break;
    case 'w':
      boxXPx = Math.min(curX, right - minWidth);
      boxWidthPx = right - boxXPx;
      break;
    case 'e':
      right = Math.max(curX, boxXPx + minWidth);
      boxWidthPx = right - boxXPx;
      break;
    default:
      break;
  }

  return {
    boxXPx,
    boxYPx,
    boxWidthPx,
    boxHeightPx,
  };
}

/**
 * Calculates badge coordinates for a callout (anchored above the text box).
 */
export function getCalloutBadgeCoordinates({
  boxXPx,
  boxYPx,
  width,
  height,
  labelText,
}) {
  const halfBadgeW =
    labelText.length >= 4
      ? Math.max(18, labelText.length * 4 + 4)
      : labelText.length >= 3
        ? 14
        : 11;
  const halfBadgeH = 11;
  return {
    x: clamp(boxXPx, halfBadgeW + 2, Math.max(halfBadgeW + 2, width - halfBadgeW - 2)),
    y: clamp(boxYPx - 14, halfBadgeH + 2, Math.max(halfBadgeH + 2, height - halfBadgeH - 2)),
    width: halfBadgeW * 2,
    height: halfBadgeH * 2,
  };
}

/**
 * Validates a single structured custom property object.
 */
export function validateCustomProperty(prop) {
  if (!prop || typeof prop !== 'object') {
    throw new Error('Custom property must be an object.');
  }
  const name = String(prop.name || '').trim();
  if (!name) {
    throw new Error('Property name is required.');
  }
  if (name.length > 100) {
    throw new Error('Property name must be 100 characters or fewer.');
  }
  const validTypes = Object.values(PROPERTY_TYPES);
  const type = String(prop.type || PROPERTY_TYPES.TEXT).toLowerCase();
  if (!validTypes.includes(type)) {
    throw new Error(`Unsupported property type: "${type}".`);
  }

  let value = prop.value;
  if (type === PROPERTY_TYPES.NUMBER) {
    if (value !== '' && value !== null && value !== undefined) {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        throw new Error(`Property "${name}" requires a valid number.`);
      }
      value = num;
    } else {
      value = null;
    }
  } else if (type === PROPERTY_TYPES.BOOLEAN) {
    value = Boolean(value);
  } else if (type === PROPERTY_TYPES.SELECT) {
    const rawOptions = Array.isArray(prop.options) ? prop.options : [];
    const seenOpts = new Set();
    const options = [];
    for (const opt of rawOptions) {
      const trimmed = String(opt ?? '').trim();
      if (!trimmed) continue;
      if (trimmed.length > 100) {
        throw new Error(`Option in select property "${name}" exceeds 100 characters.`);
      }
      const lower = trimmed.toLowerCase();
      if (!seenOpts.has(lower)) {
        seenOpts.add(lower);
        options.push(trimmed);
      }
    }
    if (options.length === 0) {
      throw new Error(`Select property "${name}" must contain at least one option.`);
    }
    const valStr = String(value ?? '').trim();
    if (valStr) {
      const match = options.find((o) => o.toLowerCase() === valStr.toLowerCase());
      if (!match) {
        throw new Error(`Selected value "${valStr}" is not a valid option for "${name}".`);
      }
      value = match;
    } else {
      value = '';
    }
    return {
      id: String(prop.id || `prop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
      name,
      type,
      value,
      options,
    };
  } else if (type === PROPERTY_TYPES.DATE) {
    const valStr = String(value ?? '').trim();
    if (valStr) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(valStr)) {
        throw new Error(`Property "${name}" requires a date in YYYY-MM-DD format.`);
      }
      const [year, month, day] = valStr.split('-').map(Number);
      const d = new Date(Date.UTC(year, month - 1, day));
      if (
        d.getUTCFullYear() !== year ||
        d.getUTCMonth() !== month - 1 ||
        d.getUTCDate() !== day
      ) {
        throw new Error(`Property "${name}" contains an invalid calendar date "${valStr}".`);
      }
      value = valStr;
    } else {
      value = '';
    }
    return {
      id: String(prop.id || `prop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
      name,
      type,
      value,
      options: Array.isArray(prop.options) ? prop.options : [],
    };
  } else {
    value = String(value ?? '').trim();
  }

  return {
    id: String(prop.id || `prop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    name,
    type,
    value,
    options: Array.isArray(prop.options) ? prop.options : [],
  };
}

/**
 * Validates a list of custom properties, ensuring uniqueness of property names (case-insensitive).
 */
export function validateCustomPropertiesList(properties) {
  if (!Array.isArray(properties)) return [];
  const seenNames = new Set();
  const result = [];
  for (const item of properties) {
    const validated = validateCustomProperty(item);
    const lowerName = validated.name.toLowerCase();
    if (seenNames.has(lowerName)) {
      throw new Error(`Duplicate property name "${validated.name}". Property names must be unique within an annotation.`);
    }
    seenNames.add(lowerName);
    result.push(validated);
  }
  return result;
}

/**
 * Validates and normalizes annotation labels.
 */
export function validateAnnotationLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .slice(0, 50)
    .map((lbl) => {
      if (!lbl) return null;
      if (typeof lbl === 'string') {
        const text = lbl.trim().slice(0, 50);
        return text ? { id: text, name: text, color: '#6366f1' } : null;
      }
      const name = String(lbl.name || lbl.text || '').trim().slice(0, 50);
      if (!name) return null;
      const color = String(lbl.color || '#6366f1').toLowerCase();
      return {
        id: String(lbl.id || name).slice(0, 100),
        name,
        color: /^#[0-9a-f]{6}$/.test(color) ? color : '#6366f1',
      };
    })
    .filter(Boolean);
}

/**
 * Normalizes an annotation style object with default fallbacks.
 * Preserves all incoming properties for forward compatibility while validating
 * known style constraints matching PostgreSQL validate_annotation_style.
 */
export function normalizeAnnotationStyle(style, fallbackColor = '#dc2626') {
  if (!style || typeof style !== 'object') {
    return { ...DEFAULT_ANNOTATION_STYLE, fillColor: fallbackColor };
  }

  // Preserve all incoming properties for forward compatibility
  const normalized = { ...style };

  // 1. strokeWidth: number > 0 and <= 50
  if ('strokeWidth' in style && style.strokeWidth !== null) {
    const sw = Number(style.strokeWidth);
    normalized.strokeWidth =
      Number.isFinite(sw) && sw > 0 && sw <= 50
        ? sw
        : DEFAULT_ANNOTATION_STYLE.strokeWidth;
  } else if (!('strokeWidth' in normalized)) {
    normalized.strokeWidth = DEFAULT_ANNOTATION_STYLE.strokeWidth;
  }

  // 2. strokeOpacity: number between 0 and 1
  if ('strokeOpacity' in style && style.strokeOpacity !== null) {
    const so = Number(style.strokeOpacity);
    normalized.strokeOpacity =
      Number.isFinite(so) && so >= 0 && so <= 1
        ? so
        : DEFAULT_ANNOTATION_STYLE.strokeOpacity;
  } else if (!('strokeOpacity' in normalized)) {
    normalized.strokeOpacity = DEFAULT_ANNOTATION_STYLE.strokeOpacity;
  }

  // 3. strokeColor: valid 6-char hex string (#RRGGBB) or null
  if ('strokeColor' in style && style.strokeColor !== null) {
    normalized.strokeColor =
      typeof style.strokeColor === 'string' &&
      /^#[0-9a-f]{6}$/i.test(style.strokeColor)
        ? style.strokeColor.toLowerCase()
        : null;
  } else {
    normalized.strokeColor = null;
  }

  // 4. lineStyle: 'solid' | 'dashed' | 'dotted'
  if ('lineStyle' in style && style.lineStyle !== null) {
    normalized.lineStyle = ['solid', 'dashed', 'dotted'].includes(
      style.lineStyle
    )
      ? style.lineStyle
      : 'solid';
  } else if (!('lineStyle' in normalized)) {
    normalized.lineStyle = 'solid';
  }

  // 5. fillEnabled: boolean
  normalized.fillEnabled = Boolean(style.fillEnabled);

  // 6. fillColor: valid 6-char hex string (#RRGGBB)
  if ('fillColor' in style && style.fillColor !== null) {
    normalized.fillColor =
      typeof style.fillColor === 'string' &&
      /^#[0-9a-f]{6}$/i.test(style.fillColor)
        ? style.fillColor.toLowerCase()
        : fallbackColor;
  } else if (!('fillColor' in normalized)) {
    normalized.fillColor = fallbackColor;
  }

  // 7. fillOpacity: number between 0 and 1
  if ('fillOpacity' in style && style.fillOpacity !== null) {
    const fo = Number(style.fillOpacity);
    normalized.fillOpacity =
      Number.isFinite(fo) && fo >= 0 && fo <= 1
        ? fo
        : DEFAULT_ANNOTATION_STYLE.fillOpacity;
  } else if (!('fillOpacity' in normalized)) {
    normalized.fillOpacity = DEFAULT_ANNOTATION_STYLE.fillOpacity;
  }

  // 8. arrowHead: 'standard' | 'filled' | 'stealth' | 'double'
  if ('arrowHead' in style && style.arrowHead !== null) {
    normalized.arrowHead = [
      'standard',
      'filled',
      'stealth',
      'double',
    ].includes(style.arrowHead)
      ? style.arrowHead
      : 'standard';
  } else if (!('arrowHead' in normalized)) {
    normalized.arrowHead = 'standard';
  }

  // 9. marker: 'star' | 'flag' | 'bug' | 'pin' | 'warning' or null
  if ('marker' in style && style.marker !== null) {
    normalized.marker = ['star', 'flag', 'bug', 'pin', 'warning'].includes(
      style.marker
    )
      ? style.marker
      : null;
  } else {
    normalized.marker = null;
  }

  // 10. markerColor: valid 6-char hex string (#RRGGBB)
  if ('markerColor' in style && style.markerColor !== null) {
    normalized.markerColor =
      typeof style.markerColor === 'string' &&
      /^#[0-9a-f]{6}$/i.test(style.markerColor)
        ? style.markerColor.toLowerCase()
        : '#f59e0b';
  } else if (!('markerColor' in normalized)) {
    normalized.markerColor = '#f59e0b';
  }

  // 11. Typography (fontSize: 8..72, fontStyle, fontWeight, fontFamily)
  if ('fontSize' in style && style.fontSize !== null) {
    const fs = Number(style.fontSize);
    normalized.fontSize =
      Number.isFinite(fs) && fs >= 8 && fs <= 72
        ? fs
        : DEFAULT_ANNOTATION_STYLE.fontSize;
  } else if (!('fontSize' in normalized)) {
    normalized.fontSize = DEFAULT_ANNOTATION_STYLE.fontSize;
  }

  if ('fontStyle' in style && style.fontStyle !== null) {
    normalized.fontStyle = ['normal', 'italic'].includes(style.fontStyle)
      ? style.fontStyle
      : 'normal';
  } else if (!('fontStyle' in normalized)) {
    normalized.fontStyle = 'normal';
  }

  if ('fontWeight' in style && style.fontWeight !== null) {
    normalized.fontWeight = ['normal', 'bold', '600', '700'].includes(
      String(style.fontWeight)
    )
      ? style.fontWeight
      : 'normal';
  } else if (!('fontWeight' in normalized)) {
    normalized.fontWeight = 'normal';
  }

  if ('fontFamily' in style && style.fontFamily !== null) {
    normalized.fontFamily = ['sans-serif', 'serif', 'monospace'].includes(
      style.fontFamily
    )
      ? style.fontFamily
      : 'sans-serif';
  } else if (!('fontFamily' in normalized)) {
    normalized.fontFamily = 'sans-serif';
  }

  // 12. Visual Stamps (priority, warning, suggestion, issue)
  if ('stamp' in style && style.stamp !== null) {
    normalized.stamp = ['priority', 'warning', 'suggestion', 'issue'].includes(
      style.stamp
    )
      ? style.stamp
      : null;
  } else if (!('stamp' in normalized)) {
    normalized.stamp = null;
  }

  if ('stampColor' in style && style.stampColor !== null) {
    normalized.stampColor =
      typeof style.stampColor === 'string' &&
      /^#[0-9a-f]{6}$/i.test(style.stampColor)
        ? style.stampColor.toLowerCase()
        : null;
  } else if (!('stampColor' in normalized)) {
    normalized.stampColor = null;
  }

  return normalized;
}

function sortByAnnotationNumber(annotations) {
  return annotations
    .slice()
    .sort((a, b) => a.annotationNumber - b.annotationNumber);
}

function upsertSortedAnnotation(annotations, nextAnnotation) {
  const exists = annotations.some((item) => item.id === nextAnnotation.id);
  const nextList = exists
    ? annotations.map((item) =>
        item.id === nextAnnotation.id ? nextAnnotation : item
      )
    : [...annotations, nextAnnotation];
  return sortByAnnotationNumber(nextList);
}

function updateImageEntry(stateByImageId, imageId, updater) {
  const current = getImageAnnotationState(stateByImageId, imageId);
  return {
    ...stateByImageId,
    [imageId]: updater(current),
  };
}

/**
 * Reducer managing persisted per-image annotation arrays synchronized with Supabase
 * and command-based undo/redo history stacks.
 */
export function annotationsReducer(stateByImageId, action) {
  if (
    action.type === 'HYDRATE_BATCH_ANNOTATIONS' ||
    action.type === 'RESYNC_BATCH_ANNOTATIONS'
  ) {
    const { imageIds = [], annotations = [] } = action;
    const preserveHistory = action.type === 'RESYNC_BATCH_ANNOTATIONS';
    const grouped = new Map();

    for (const imgId of imageIds) {
      grouped.set(imgId, []);
    }
    for (const ann of annotations) {
      if (!ann?.imageId) continue;
      if (!grouped.has(ann.imageId)) {
        grouped.set(ann.imageId, []);
      }
      grouped.get(ann.imageId).push(ann);
    }

    const nextState = {};
    for (const [imgId, list] of grouped.entries()) {
      const existingHistory = preserveHistory
        ? stateByImageId[imgId]?.history
        : null;
      nextState[imgId] = {
        annotations: sortByAnnotationNumber(list),
        history: existingHistory ?? {
          past: [],
          future: [],
        },
      };
    }
    return nextState;
  }

  const { imageId } = action;
  if (!imageId) return stateByImageId;

  switch (action.type) {
    case 'APPLY_GEOMETRY_OPTIMISTIC': {
      const { annotationId, geometry } = action;
      return updateImageEntry(stateByImageId, imageId, (current) => ({
        ...current,
        annotations: current.annotations.map((item) => {
          if (item.id !== annotationId) return item;
          const mergedGeometry = { ...(item.geometry || {}), ...geometry };
          const isCircle =
            item.type === ANNOTATION_TYPES.CIRCLE ||
            mergedGeometry.type === ANNOTATION_TYPES.CIRCLE ||
            (!item.type && mergedGeometry.cx !== undefined);

          return {
            ...item,
            geometry: mergedGeometry,
            cx: isCircle ? (mergedGeometry.cx ?? item.cx) : item.cx,
            cy: isCircle ? (mergedGeometry.cy ?? item.cy) : item.cy,
            r: isCircle ? (mergedGeometry.r ?? item.r) : item.r,
          };
        }),
      }));
    }

    case 'APPLY_COLOR_OPTIMISTIC': {
      const { annotationId, color } = action;
      return updateImageEntry(stateByImageId, imageId, (current) => ({
        ...current,
        annotations: current.annotations.map((item) =>
          item.id === annotationId ? { ...item, color } : item
        ),
      }));
    }

    case 'APPLY_STYLE_OPTIMISTIC': {
      const { annotationId, style } = action;
      return updateImageEntry(stateByImageId, imageId, (current) => ({
        ...current,
        annotations: current.annotations.map((item) =>
          item.id === annotationId
            ? { ...item, style: { ...(item.style || {}), ...style } }
            : item
        ),
      }));
    }

    case 'APPLY_PROPERTIES_OPTIMISTIC': {
      const { annotationId, customProperties } = action;
      return updateImageEntry(stateByImageId, imageId, (current) => ({
        ...current,
        annotations: current.annotations.map((item) =>
          item.id === annotationId ? { ...item, customProperties } : item
        ),
      }));
    }

    case 'APPLY_LABELS_OPTIMISTIC': {
      const { annotationId, labels } = action;
      return updateImageEntry(stateByImageId, imageId, (current) => ({
        ...current,
        annotations: current.annotations.map((item) =>
          item.id === annotationId ? { ...item, labels } : item
        ),
      }));
    }

    case 'APPLY_LAYER_OPTIMISTIC': {
      const { annotationId, layerId } = action;
      return updateImageEntry(stateByImageId, imageId, (current) => ({
        ...current,
        annotations: current.annotations.map((item) =>
          item.id === annotationId ? { ...item, layerId } : item
        ),
      }));
    }

    case 'APPLY_ASSIGNMENT_OPTIMISTIC': {
      const { annotationId, assignedTo, assigneeName } = action;
      return updateImageEntry(stateByImageId, imageId, (current) => ({
        ...current,
        annotations: current.annotations.map((item) =>
          item.id === annotationId
            ? { ...item, assignedTo, assigneeName }
            : item
        ),
      }));
    }

    case 'APPLY_PRIORITY_OPTIMISTIC': {
      const { annotationId, priority } = action;
      return updateImageEntry(stateByImageId, imageId, (current) => ({
        ...current,
        annotations: current.annotations.map((item) =>
          item.id === annotationId ? { ...item, priority } : item
        ),
      }));
    }

    case 'UPSERT_ANNOTATION': {
      const { annotation, historyCommand = null } = action;
      if (!annotation) return stateByImageId;
      return updateImageEntry(stateByImageId, imageId, (current) => ({
        annotations: upsertSortedAnnotation(current.annotations, annotation),
        history: historyCommand
          ? {
              past: [...current.history.past, historyCommand],
              future: [],
            }
          : current.history,
      }));
    }

    case 'REMOVE_ANNOTATION': {
      const { annotationId, historyCommand = null } = action;
      const existingEntry = getImageAnnotationState(stateByImageId, imageId);
      const exists = existingEntry.annotations.some(
        (item) => item.id === annotationId
      );
      if (!exists && !historyCommand) {
        return stateByImageId;
      }
      return updateImageEntry(stateByImageId, imageId, (current) => ({
        annotations: current.annotations.filter((item) => item.id !== annotationId),
        history: historyCommand
          ? {
              past: [...current.history.past, historyCommand],
              future: [],
            }
          : current.history,
      }));
    }

    case 'STEP_UNDO_SUCCESS': {
      const { annotation = null, removedAnnotationId = null } = action;
      return updateImageEntry(stateByImageId, imageId, (current) => {
        if (current.history.past.length === 0) return current;
        const lastCommand = current.history.past[current.history.past.length - 1];
        const nextPast = current.history.past.slice(0, -1);

        let nextAnnotations = current.annotations;
        if (removedAnnotationId) {
          nextAnnotations = nextAnnotations.filter(
            (item) => item.id !== removedAnnotationId
          );
        } else if (annotation) {
          nextAnnotations = upsertSortedAnnotation(nextAnnotations, annotation);
        }

        return {
          annotations: nextAnnotations,
          history: {
            past: nextPast,
            future: [lastCommand, ...current.history.future],
          },
        };
      });
    }

    case 'STEP_REDO_SUCCESS': {
      const { annotation = null, removedAnnotationId = null } = action;
      return updateImageEntry(stateByImageId, imageId, (current) => {
        if (current.history.future.length === 0) return current;
        const [nextCommand, ...restFuture] = current.history.future;

        let nextAnnotations = current.annotations;
        if (removedAnnotationId) {
          nextAnnotations = nextAnnotations.filter(
            (item) => item.id !== removedAnnotationId
          );
        } else if (annotation) {
          nextAnnotations = upsertSortedAnnotation(nextAnnotations, annotation);
        }

        return {
          annotations: nextAnnotations,
          history: {
            past: [...current.history.past, nextCommand],
            future: restFuture,
          },
        };
      });
    }

    default:
      return stateByImageId;
  }
}

