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

export function hasGeometryChanged(a, b) {
  if (!a || !b) return true;
  return (
    Math.abs(a.cx - b.cx) > 1e-5 ||
    Math.abs(a.cy - b.cy) > 1e-5 ||
    Math.abs(a.r - b.r) > 1e-5
  );
}

export function clamp(value, min, max) {
  if (min > max) return min;
  return Math.min(Math.max(value, min), max);
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
        annotations: current.annotations.map((item) =>
          item.id === annotationId
            ? { ...item, cx: geometry.cx, cy: geometry.cy, r: geometry.r }
            : item
        ),
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

