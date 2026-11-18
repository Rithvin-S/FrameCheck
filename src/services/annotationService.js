import { isSupabaseConfigured, supabase } from './supabaseClient.js';
import {
  ANNOTATION_TYPES,
  DEFAULT_ANNOTATION_PRIORITY,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_LAYERS,
  getReviewerColor,
  normalizeAnnotationPriority,
  normalizeAnnotationStyle,
  validateAnnotationGeometry,
  validateAnnotationLabels,
  validateAnnotationPriority,
  validateCircleGeometry,
  validateCustomPropertiesList,
} from './annotationState.js';

export const MAX_ANNOTATION_COMMENT_LENGTH = 2000;

export const ANNOTATION_FIELDS_LEGACY = `
  id,
  image_id,
  annotation_number,
  created_by,
  type,
  geometry,
  cx,
  cy,
  r,
  color,
  comment,
  status,
  created_at,
  updated_at,
  resolved_at,
  creator:profiles!annotations_created_by_fkey (
    display_name
  )
`;

export const ANNOTATION_FIELDS_V2 = `
  id,
  image_id,
  annotation_number,
  created_by,
  type,
  geometry,
  cx,
  cy,
  r,
  color,
  comment,
  status,
  style,
  custom_properties,
  labels,
  layer_id,
  created_at,
  updated_at,
  resolved_at,
  creator:profiles!annotations_created_by_fkey (
    display_name
  )
`;

export const ANNOTATION_FIELDS_V3 = `
  id,
  image_id,
  annotation_number,
  created_by,
  type,
  geometry,
  cx,
  cy,
  r,
  color,
  comment,
  status,
  style,
  custom_properties,
  labels,
  layer_id,
  assigned_to,
  priority,
  version_number,
  version_id,
  created_at,
  updated_at,
  resolved_at,
  creator:profiles!annotations_created_by_fkey (
    display_name
  ),
  assignee:profiles!annotations_assigned_to_fkey (
    id,
    display_name
  )
`;

let hasPhase20AColumns = true;
let hasPhase19Columns = true;

function isMissingColumnError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '').toLowerCase();
  const details = String(error.details || '').toLowerCase();
  const hint = String(error.hint || '').toLowerCase();
  return (
    code === '42703' ||
    code === '42P01' ||
    code === 'PGRST200' ||
    code === 'PGRST201' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('could not find') ||
    msg.includes('relationship') ||
    details.includes('does not exist') ||
    details.includes('schema cache') ||
    details.includes('relationship') ||
    hint.includes('does not exist')
  );
}

function ensureSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured. Check your environment variables.');
  }
}

function validateGeometry(geometry) {
  return validateCircleGeometry(geometry);
}

function validateColor(color) {
  const normalized = String(color ?? '').trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) {
    throw new Error('Annotation color must be a valid 6-digit hex color.');
  }
  return normalized;
}

export function normalizeAnnotationComment(comment) {
  const trimmed = String(comment ?? '').trim();
  if (!trimmed) {
    throw new Error('Please enter a comment explaining the issue.');
  }
  if (trimmed.length > MAX_ANNOTATION_COMMENT_LENGTH) {
    throw new Error(
      `Annotation comment must be ${MAX_ANNOTATION_COMMENT_LENGTH} characters or fewer.`
    );
  }
  return trimmed;
}

function formatAnnotationServiceError(error, fallbackMessage) {
  if (!error) return new Error(fallbackMessage);
  const msg = String(error.message || '');
  if (error.code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return new Error(
      error.message || 'You only have permission to modify your own annotations.'
    );
  }
  if (error.code === 'P0002' || error.code === 'PGRST116') {
    return new Error(
      'This annotation is no longer available or has already been removed.'
    );
  }
  return new Error(msg || fallbackMessage);
}

/**
 * Extracts and normalizes the geometry object for an annotation row,
 * guaranteeing consistent shape whether reading legacy columns or new JSONB geometry.
 */
export function extractAnnotationGeometry(row) {
  if (!row) return { type: ANNOTATION_TYPES.CIRCLE, cx: 0.5, cy: 0.5, r: 0.1 };
  const rawType = String(row.type || ANNOTATION_TYPES.CIRCLE).trim().toLowerCase();
  const geom = row.geometry && typeof row.geometry === 'object' ? row.geometry : {};
  const tool = geom.tool ? String(geom.tool).trim().toLowerCase() : null;
  const effectiveType = tool || rawType;

  if (effectiveType === ANNOTATION_TYPES.CIRCLE || (!row.type && row.cx !== null && row.cx !== undefined)) {
    const cx = Number(geom.cx !== undefined ? geom.cx : row.cx);
    const cy = Number(geom.cy !== undefined ? geom.cy : row.cy);
    const r = Number(geom.r !== undefined ? geom.r : row.r);
    return {
      type: ANNOTATION_TYPES.CIRCLE,
      cx: Number.isFinite(cx) ? cx : 0.5,
      cy: Number.isFinite(cy) ? cy : 0.5,
      r: Number.isFinite(r) ? r : 0.1,
    };
  }

  return {
    type: effectiveType,
    tool: tool || effectiveType,
    ...geom,
  };
}

/**
 * Normalizes a database row from public.annotations into the workspace shape.
 * Maintains top-level cx, cy, r for circles for full backward compatibility.
 */
export function mapAnnotationRow(row, creatorNameFallback = '') {
  if (!row) return null;
  const joinedName =
    typeof row.creator?.display_name === 'string'
      ? row.creator.display_name.trim()
      : '';
  const fallbackName = String(creatorNameFallback || '').trim();

  const tool = row.geometry?.tool ? String(row.geometry.tool).trim().toLowerCase() : null;
  const type = tool || String(row.type || ANNOTATION_TYPES.CIRCLE).trim().toLowerCase();
  const geometry = extractAnnotationGeometry(row);

  const assignedTo = row.assigned_to || null;
  const assigneeName =
    typeof row.assignee?.display_name === 'string'
      ? row.assignee.display_name.trim()
      : null;
  const priority = normalizeAnnotationPriority(row.priority);

  return {
    id: row.id,
    imageId: row.image_id,
    versionNumber: row.version_number ?? 1,
    versionId: row.version_id ?? null,
    annotationNumber: Number(row.annotation_number),
    displayNumber: Number(row.annotation_number),
    createdBy: row.created_by,
    creatorName: joinedName || fallbackName || 'Reviewer',
    type,
    geometry,
    cx: type === ANNOTATION_TYPES.CIRCLE ? Number(geometry.cx ?? row.cx) : null,
    cy: type === ANNOTATION_TYPES.CIRCLE ? Number(geometry.cy ?? row.cy) : null,
    r: type === ANNOTATION_TYPES.CIRCLE ? Number(geometry.r ?? row.r) : null,
    color: String(row.color || '#dc2626').toLowerCase(),
    comment: row.comment ?? '',
    status: row.status === 'resolved' ? 'resolved' : 'open',
    style: row.style && typeof row.style === 'object' ? row.style : {},
    customProperties: Array.isArray(row.custom_properties) ? row.custom_properties : [],
    labels: Array.isArray(row.labels) ? row.labels : [],
    layerId: String(row.layer_id || 'default'),
    assignedTo,
    assigneeName,
    priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? null,
  };
}

/**
 * Fetches all non-deleted annotations belonging to images in the specified batch.
 */
export async function listBatchAnnotations(batchId) {
  ensureSupabase();
  if (!batchId) return [];

  const fieldsV3 = `
    id,
    image_id,
    annotation_number,
    created_by,
    type,
    geometry,
    cx,
    cy,
    r,
    color,
    comment,
    status,
    style,
    custom_properties,
    labels,
    layer_id,
    assigned_to,
    priority,
    version_number,
    version_id,
    created_at,
    updated_at,
    resolved_at,
    creator:profiles!annotations_created_by_fkey (
      display_name
    ),
    assignee:profiles!annotations_assigned_to_fkey (
      id,
      display_name
    ),
    image:batch_images!annotations_image_id_fkey!inner (
      batch_id,
      display_order
    )
  `;

  const fieldsV2 = `
    id,
    image_id,
    annotation_number,
    created_by,
    type,
    geometry,
    cx,
    cy,
    r,
    color,
    comment,
    status,
    style,
    custom_properties,
    labels,
    layer_id,
    created_at,
    updated_at,
    resolved_at,
    creator:profiles!annotations_created_by_fkey (
      display_name
    ),
    image:batch_images!annotations_image_id_fkey!inner (
      batch_id,
      display_order
    )
  `;

  const fieldsLegacy = `
    id,
    image_id,
    annotation_number,
    created_by,
    type,
    geometry,
    cx,
    cy,
    r,
    color,
    comment,
    status,
    created_at,
    updated_at,
    resolved_at,
    creator:profiles!annotations_created_by_fkey (
      display_name
    ),
    image:batch_images!annotations_image_id_fkey!inner (
      batch_id,
      display_order
    )
  `;

  let queryFields = hasPhase20AColumns
    ? fieldsV3
    : hasPhase19Columns
      ? fieldsV2
      : fieldsLegacy;

  let response = await supabase
    .from('annotations')
    .select(queryFields)
    .eq('image.batch_id', batchId)
    .is('deleted_at', null)
    .order('annotation_number', { ascending: true });

  if (response.error && hasPhase20AColumns && isMissingColumnError(response.error)) {
    hasPhase20AColumns = false;
    queryFields = hasPhase19Columns ? fieldsV2 : fieldsLegacy;
    response = await supabase
      .from('annotations')
      .select(queryFields)
      .eq('image.batch_id', batchId)
      .is('deleted_at', null)
      .order('annotation_number', { ascending: true });
  }

  if (response.error && hasPhase19Columns && isMissingColumnError(response.error)) {
    hasPhase19Columns = false;
    response = await supabase
      .from('annotations')
      .select(fieldsLegacy)
      .eq('image.batch_id', batchId)
      .is('deleted_at', null)
      .order('annotation_number', { ascending: true });
  }

  if (response.error) {
    throw formatAnnotationServiceError(
      response.error,
      'Unable to load annotations for this batch.'
    );
  }

  const data = response.data;

  return (data ?? [])
    .slice()
    .sort((a, b) => {
      const orderDiff =
        Number(a.image?.display_order ?? 0) - Number(b.image?.display_order ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return Number(a.annotation_number) - Number(b.annotation_number);
    })
    .map((row) => mapAnnotationRow(row));
}

function getAnnotationSelectFields() {
  if (hasPhase20AColumns) return ANNOTATION_FIELDS_V3;
  if (hasPhase19Columns) return ANNOTATION_FIELDS_V2;
  return ANNOTATION_FIELDS_LEGACY;
}

async function executeAnnotationUpdate(annotationId, updatePayload, creatorNameFallback) {
  let fields = getAnnotationSelectFields();
  let res = await supabase
    .from('annotations')
    .update(updatePayload)
    .eq('id', annotationId)
    .select(fields)
    .single();

  if (res.error && hasPhase20AColumns && isMissingColumnError(res.error)) {
    hasPhase20AColumns = false;
    fields = getAnnotationSelectFields();
    res = await supabase
      .from('annotations')
      .update(updatePayload)
      .eq('id', annotationId)
      .select(fields)
      .single();
  }

  if (res.error && hasPhase19Columns && isMissingColumnError(res.error)) {
    hasPhase19Columns = false;
    res = await supabase
      .from('annotations')
      .update(updatePayload)
      .eq('id', annotationId)
      .select(ANNOTATION_FIELDS_LEGACY)
      .single();
  }

  return res;
}

/**
 * Creates a persisted annotation of any supported type (circle, arrow, rectangle, pencil, callout)
 * with a required comment, optional custom styles, properties, labels, and layer assignment.
 */
export async function createAnnotation({
  imageId,
  createdBy,
  versionNumber = null,
  versionId = null,
  type = ANNOTATION_TYPES.CIRCLE,
  geometry,
  color,
  comment,
  style = {},
  customProperties = [],
  labels = [],
  layerId = 'default',
  assignedTo = null,
  priority = DEFAULT_ANNOTATION_PRIORITY,
  creatorNameFallback = '',
}) {
  ensureSupabase();
  if (!imageId) {
    throw new Error('Image ID is required to save an annotation.');
  }
  if (!createdBy) {
    throw new Error('You must be signed in to create an annotation.');
  }

  const normalizedType = String(type || geometry?.tool || geometry?.type || ANNOTATION_TYPES.CIRCLE)
    .trim()
    .toLowerCase();
  const validGeometry = validateAnnotationGeometry(geometry, normalizedType);
  const validColor = validateColor(color);
  const validComment = normalizeAnnotationComment(comment);
  const validStyle = normalizeAnnotationStyle(style, validColor);
  const validProps = validateCustomPropertiesList(customProperties);
  const validLabels = validateAnnotationLabels(labels);
  const validPriority = normalizeAnnotationPriority(priority);
  const validAssignee = assignedTo ? String(assignedTo).trim() : null;

  // Map advanced tool types to the underlying PostgreSQL supported check-constraint types:
  // ('circle', 'arrow', 'rectangle', 'pencil', 'callout') while embedding tool in geometry.
  let dbType = normalizedType;
  const dbGeometry = { ...validGeometry };

  switch (normalizedType) {
    case ANNOTATION_TYPES.HIGHLIGHTER:
      dbType = 'pencil';
      dbGeometry.type = 'pencil';
      dbGeometry.tool = 'highlighter';
      break;
    case ANNOTATION_TYPES.LINE:
      dbType = 'arrow';
      dbGeometry.type = 'arrow';
      dbGeometry.tool = 'line';
      break;
    case ANNOTATION_TYPES.POLYGON:
      dbType = 'pencil';
      dbGeometry.type = 'pencil';
      dbGeometry.tool = 'polygon';
      dbGeometry.isClosed = true;
      break;
    case ANNOTATION_TYPES.CLOUD:
      dbType = 'rectangle';
      dbGeometry.type = 'rectangle';
      dbGeometry.tool = 'cloud';
      break;
    case ANNOTATION_TYPES.TEXTBOX:
      dbType = 'rectangle';
      dbGeometry.type = 'rectangle';
      dbGeometry.tool = 'textbox';
      break;
    case ANNOTATION_TYPES.BLUR:
      dbType = 'rectangle';
      dbGeometry.type = 'rectangle';
      dbGeometry.tool = 'blur';
      break;
    case ANNOTATION_TYPES.MARKER:
      dbType = 'circle';
      dbGeometry.type = 'circle';
      dbGeometry.tool = 'marker';
      break;
    default:
      break;
  }

  const insertPayload = {
    image_id: imageId,
    created_by: createdBy,
    type: dbType,
    geometry: dbGeometry,
    color: validColor,
    comment: validComment,
  };

  if (normalizedType === ANNOTATION_TYPES.CIRCLE || normalizedType === ANNOTATION_TYPES.MARKER) {
    insertPayload.cx = validGeometry.cx;
    insertPayload.cy = validGeometry.cy;
    insertPayload.r = validGeometry.r;
  }

  if (hasPhase19Columns) {
    insertPayload.style = validStyle;
    insertPayload.custom_properties = validProps;
    insertPayload.labels = validLabels;
    insertPayload.layer_id = layerId || 'default';
  }

  if (hasPhase20AColumns) {
    insertPayload.assigned_to = validAssignee;
    insertPayload.priority = validPriority;
  }

  if (versionNumber) {
    insertPayload.version_number = versionNumber;
  }
  if (versionId) {
    insertPayload.version_id = versionId;
  }

  const selectFields = getAnnotationSelectFields();
  let res = await supabase
    .from('annotations')
    .insert(insertPayload)
    .select(selectFields)
    .single();

  if (res.error && isMissingColumnError(res.error) && (insertPayload.version_number || insertPayload.version_id)) {
    delete insertPayload.version_number;
    delete insertPayload.version_id;
    res = await supabase
      .from('annotations')
      .insert(insertPayload)
      .select(selectFields)
      .single();
  }

  if (res.error && hasPhase20AColumns && isMissingColumnError(res.error)) {
    hasPhase20AColumns = false;
    delete insertPayload.assigned_to;
    delete insertPayload.priority;

    res = await supabase
      .from('annotations')
      .insert(insertPayload)
      .select(getAnnotationSelectFields())
      .single();
  }

  if (res.error && hasPhase19Columns && isMissingColumnError(res.error)) {
    hasPhase19Columns = false;
    delete insertPayload.style;
    delete insertPayload.custom_properties;
    delete insertPayload.labels;
    delete insertPayload.layer_id;

    res = await supabase
      .from('annotations')
      .insert(insertPayload)
      .select(ANNOTATION_FIELDS_LEGACY)
      .single();
  }

  if (res.error) {
    throw formatAnnotationServiceError(res.error, 'Unable to save annotation.');
  }

  const mapped = mapAnnotationRow(res.data, creatorNameFallback);
  if (!hasPhase19Columns) {
    mapped.style = validStyle;
    mapped.customProperties = validProps;
    mapped.labels = validLabels;
    mapped.layerId = layerId || 'default';
  }
  if (!hasPhase20AColumns) {
    mapped.assignedTo = validAssignee;
    mapped.priority = validPriority;
  }
  return mapped;
}

/**
 * Persists updated geometry after a completed move, resize, or edit gesture.
 * Supports circles (maintaining cx, cy, r columns) and all new vector types.
 */
export async function updateAnnotationGeometry(
  annotationId,
  geometry,
  arg3 = '',
  arg4 = ''
) {
  ensureSupabase();
  const knownTypes = [
    ANNOTATION_TYPES.CIRCLE,
    ANNOTATION_TYPES.ARROW,
    ANNOTATION_TYPES.LINE,
    ANNOTATION_TYPES.RECTANGLE,
    ANNOTATION_TYPES.CLOUD,
    ANNOTATION_TYPES.TEXTBOX,
    ANNOTATION_TYPES.BLUR,
    ANNOTATION_TYPES.PENCIL,
    ANNOTATION_TYPES.HIGHLIGHTER,
    ANNOTATION_TYPES.POLYGON,
    ANNOTATION_TYPES.CALLOUT,
  ];
  let inferredType = null;
  let creatorNameFallback = '';

  if (typeof arg3 === 'string' && knownTypes.includes(arg3.toLowerCase())) {
    inferredType = arg3.toLowerCase();
    creatorNameFallback = String(arg4 || '');
  } else {
    creatorNameFallback = String(arg3 || '');
    const candidateType = geometry?.tool || geometry?.type;
    if (candidateType && knownTypes.includes(String(candidateType).toLowerCase())) {
      inferredType = String(candidateType).toLowerCase();
    } else if (geometry?.cx !== undefined) {
      inferredType = ANNOTATION_TYPES.CIRCLE;
    } else if (geometry?.startX !== undefined) {
      inferredType = ANNOTATION_TYPES.ARROW;
    } else if (geometry?.points !== undefined) {
      inferredType = ANNOTATION_TYPES.PENCIL;
    } else if (geometry?.pointerX !== undefined) {
      inferredType = ANNOTATION_TYPES.CALLOUT;
    } else if (geometry?.x !== undefined && geometry?.width !== undefined) {
      inferredType = ANNOTATION_TYPES.RECTANGLE;
    } else {
      inferredType = ANNOTATION_TYPES.CIRCLE;
    }
  }

  const validGeometry = validateAnnotationGeometry(geometry, inferredType);

  const dbGeometry = { ...validGeometry };
  switch (inferredType) {
    case ANNOTATION_TYPES.HIGHLIGHTER:
      dbGeometry.type = 'pencil';
      dbGeometry.tool = 'highlighter';
      break;
    case ANNOTATION_TYPES.LINE:
      dbGeometry.type = 'arrow';
      dbGeometry.tool = 'line';
      break;
    case ANNOTATION_TYPES.POLYGON:
      dbGeometry.type = 'pencil';
      dbGeometry.tool = 'polygon';
      dbGeometry.isClosed = true;
      break;
    case ANNOTATION_TYPES.CLOUD:
      dbGeometry.type = 'rectangle';
      dbGeometry.tool = 'cloud';
      break;
    case ANNOTATION_TYPES.TEXTBOX:
      dbGeometry.type = 'rectangle';
      dbGeometry.tool = 'textbox';
      break;
    case ANNOTATION_TYPES.BLUR:
      dbGeometry.type = 'rectangle';
      dbGeometry.tool = 'blur';
      break;
    case ANNOTATION_TYPES.MARKER:
      dbGeometry.type = 'circle';
      dbGeometry.tool = 'marker';
      break;
    default:
      break;
  }

  const updatePayload = {
    geometry: dbGeometry,
  };

  if (inferredType === ANNOTATION_TYPES.CIRCLE || inferredType === ANNOTATION_TYPES.MARKER) {
    updatePayload.cx = validGeometry.cx;
    updatePayload.cy = validGeometry.cy;
    updatePayload.r = validGeometry.r;
  }

  const { data, error } = await executeAnnotationUpdate(
    annotationId,
    updatePayload,
    creatorNameFallback
  );

  if (error) {
    throw formatAnnotationServiceError(
      error,
      'Unable to update annotation position or size.'
    );
  }

  return mapAnnotationRow(data, creatorNameFallback);
}

/**
 * Persists an updated circle stroke color.
 */
export async function updateAnnotationColor(
  annotationId,
  color,
  creatorNameFallback = ''
) {
  ensureSupabase();
  const validColor = validateColor(color);

  const { data, error } = await executeAnnotationUpdate(
    annotationId,
    { color: validColor },
    creatorNameFallback
  );

  if (error) {
    throw formatAnnotationServiceError(error, 'Unable to update annotation color.');
  }

  return mapAnnotationRow(data, creatorNameFallback);
}

/**
 * Persists an updated drawing style for an existing annotation.
 * Supports both positional args: (annotationId, style, creatorNameFallback)
 * and object payload: ({ annotationId, style, creatorNameFallback }).
 */
export async function updateAnnotationStyle(
  annotationIdOrPayload,
  styleArg,
  creatorNameFallbackArg = ''
) {
  ensureSupabase();

  let annotationId;
  let style;
  let creatorNameFallback;

  if (
    annotationIdOrPayload &&
    typeof annotationIdOrPayload === 'object' &&
    ('annotationId' in annotationIdOrPayload || 'id' in annotationIdOrPayload)
  ) {
    annotationId =
      annotationIdOrPayload.annotationId || annotationIdOrPayload.id;
    style =
      annotationIdOrPayload.style !== undefined
        ? annotationIdOrPayload.style
        : styleArg;
    creatorNameFallback =
      annotationIdOrPayload.creatorNameFallback || creatorNameFallbackArg || '';
  } else {
    annotationId = annotationIdOrPayload;
    style = styleArg;
    creatorNameFallback = creatorNameFallbackArg || '';
  }

  const validStyle = normalizeAnnotationStyle(style);

  if (!hasPhase19Columns) {
    return {
      id: annotationId,
      style: validStyle,
    };
  }

  const { data, error } = await executeAnnotationUpdate(
    annotationId,
    { style: validStyle },
    creatorNameFallback
  );

  if (error) {
    if (isMissingColumnError(error)) {
      hasPhase19Columns = false;
      return { id: annotationId, style: validStyle };
    }
    throw formatAnnotationServiceError(error, 'Unable to update annotation style.');
  }

  return mapAnnotationRow(data, creatorNameFallback);
}

/**
 * Persists updated custom structured properties for an annotation.
 * Supports both positional args: (annotationId, properties, creatorNameFallback)
 * and object payload: ({ annotationId, properties, creatorNameFallback }).
 */
export async function updateAnnotationCustomProperties(
  annotationIdOrPayload,
  propertiesArg,
  creatorNameFallbackArg = ''
) {
  ensureSupabase();

  let annotationId;
  let properties;
  let creatorNameFallback;

  if (
    annotationIdOrPayload &&
    typeof annotationIdOrPayload === 'object' &&
    ('annotationId' in annotationIdOrPayload || 'id' in annotationIdOrPayload)
  ) {
    annotationId =
      annotationIdOrPayload.annotationId || annotationIdOrPayload.id;
    properties =
      annotationIdOrPayload.properties !== undefined
        ? annotationIdOrPayload.properties
        : annotationIdOrPayload.customProperties !== undefined
          ? annotationIdOrPayload.customProperties
          : propertiesArg;
    creatorNameFallback =
      annotationIdOrPayload.creatorNameFallback || creatorNameFallbackArg || '';
  } else {
    annotationId = annotationIdOrPayload;
    properties = propertiesArg;
    creatorNameFallback = creatorNameFallbackArg || '';
  }

  const validProps = validateCustomPropertiesList(properties);

  if (!hasPhase19Columns) {
    return {
      id: annotationId,
      customProperties: validProps,
    };
  }

  const { data, error } = await executeAnnotationUpdate(
    annotationId,
    { custom_properties: validProps },
    creatorNameFallback
  );

  if (error) {
    if (isMissingColumnError(error)) {
      hasPhase19Columns = false;
      return { id: annotationId, customProperties: validProps };
    }
    throw formatAnnotationServiceError(error, 'Unable to update custom properties.');
  }

  return mapAnnotationRow(data, creatorNameFallback);
}

/**
 * Persists updated labels for an annotation.
 * Supports both positional args: (annotationId, labels, creatorNameFallback)
 * and object payload: ({ annotationId, labels, creatorNameFallback }).
 */
export async function updateAnnotationLabels(
  annotationIdOrPayload,
  labelsArg,
  creatorNameFallbackArg = ''
) {
  ensureSupabase();

  let annotationId;
  let labels;
  let creatorNameFallback;

  if (
    annotationIdOrPayload &&
    typeof annotationIdOrPayload === 'object' &&
    ('annotationId' in annotationIdOrPayload || 'id' in annotationIdOrPayload)
  ) {
    annotationId =
      annotationIdOrPayload.annotationId || annotationIdOrPayload.id;
    labels =
      annotationIdOrPayload.labels !== undefined
        ? annotationIdOrPayload.labels
        : labelsArg;
    creatorNameFallback =
      annotationIdOrPayload.creatorNameFallback || creatorNameFallbackArg || '';
  } else {
    annotationId = annotationIdOrPayload;
    labels = labelsArg;
    creatorNameFallback = creatorNameFallbackArg || '';
  }

  const validLabels = validateAnnotationLabels(labels);

  if (!hasPhase19Columns) {
    return {
      id: annotationId,
      labels: validLabels,
    };
  }

  const { data, error } = await executeAnnotationUpdate(
    annotationId,
    { labels: validLabels },
    creatorNameFallback
  );

  if (error) {
    if (isMissingColumnError(error)) {
      hasPhase19Columns = false;
      return { id: annotationId, labels: validLabels };
    }
    throw formatAnnotationServiceError(error, 'Unable to update annotation labels.');
  }

  return mapAnnotationRow(data, creatorNameFallback);
}

/**
 * Persists an updated layer assignment for an annotation.
 * Supports both positional args: (annotationId, layerId, creatorNameFallback)
 * and object payload: ({ annotationId, layerId, creatorNameFallback }).
 */
export async function updateAnnotationLayer(
  annotationIdOrPayload,
  layerIdArg,
  creatorNameFallbackArg = ''
) {
  ensureSupabase();

  let annotationId;
  let layerId;
  let creatorNameFallback;

  if (
    annotationIdOrPayload &&
    typeof annotationIdOrPayload === 'object' &&
    ('annotationId' in annotationIdOrPayload || 'id' in annotationIdOrPayload)
  ) {
    annotationId =
      annotationIdOrPayload.annotationId || annotationIdOrPayload.id;
    layerId =
      annotationIdOrPayload.layerId !== undefined
        ? annotationIdOrPayload.layerId
        : layerIdArg;
    creatorNameFallback =
      annotationIdOrPayload.creatorNameFallback || creatorNameFallbackArg || '';
  } else {
    annotationId = annotationIdOrPayload;
    layerId = layerIdArg;
    creatorNameFallback = creatorNameFallbackArg || '';
  }
  const targetLayer = String(layerId || 'default').trim() || 'default';

  if (!hasPhase19Columns) {
    return {
      id: annotationId,
      layerId: targetLayer,
    };
  }

  const { data, error } = await executeAnnotationUpdate(
    annotationId,
    { layer_id: targetLayer },
    creatorNameFallback
  );

  if (error) {
    if (isMissingColumnError(error)) {
      hasPhase19Columns = false;
      return { id: annotationId, layerId: targetLayer };
    }
    throw formatAnnotationServiceError(error, 'Unable to move annotation to layer.');
  }

  return mapAnnotationRow(data, creatorNameFallback);
}

/**
 * Persists an updated assignee for an annotation.
 * Supports both positional args: (annotationId, assignedTo, creatorNameFallback)
 * and object payload: ({ annotationId, assignedTo, creatorNameFallback }).
 */
export async function updateAnnotationAssignment(
  annotationIdOrPayload,
  assignedToArg,
  creatorNameFallbackArg = ''
) {
  ensureSupabase();

  let annotationId;
  let assignedTo;
  let creatorNameFallback;

  if (
    annotationIdOrPayload &&
    typeof annotationIdOrPayload === 'object' &&
    ('annotationId' in annotationIdOrPayload || 'id' in annotationIdOrPayload)
  ) {
    annotationId =
      annotationIdOrPayload.annotationId || annotationIdOrPayload.id;
    assignedTo =
      annotationIdOrPayload.assignedTo !== undefined
        ? annotationIdOrPayload.assignedTo
        : assignedToArg;
    creatorNameFallback =
      annotationIdOrPayload.creatorNameFallback || creatorNameFallbackArg || '';
  } else {
    annotationId = annotationIdOrPayload;
    assignedTo = assignedToArg;
    creatorNameFallback = creatorNameFallbackArg || '';
  }

  const targetAssignee = assignedTo ? String(assignedTo).trim() : null;

  if (!hasPhase20AColumns) {
    return {
      id: annotationId,
      assignedTo: targetAssignee,
      assigneeName: null,
    };
  }

  const { data, error } = await executeAnnotationUpdate(
    annotationId,
    { assigned_to: targetAssignee },
    creatorNameFallback
  );

  if (error) {
    if (isMissingColumnError(error)) {
      hasPhase20AColumns = false;
      return { id: annotationId, assignedTo: targetAssignee, assigneeName: null };
    }
    throw formatAnnotationServiceError(error, 'Unable to update annotation assignment.');
  }

  return mapAnnotationRow(data, creatorNameFallback);
}

/**
 * Persists an updated priority for an annotation ('critical' | 'high' | 'medium' | 'low').
 * Supports both positional args: (annotationId, priority, creatorNameFallback)
 * and object payload: ({ annotationId, priority, creatorNameFallback }).
 */
export async function updateAnnotationPriority(
  annotationIdOrPayload,
  priorityArg,
  creatorNameFallbackArg = ''
) {
  ensureSupabase();

  let annotationId;
  let priority;
  let creatorNameFallback;

  if (
    annotationIdOrPayload &&
    typeof annotationIdOrPayload === 'object' &&
    ('annotationId' in annotationIdOrPayload || 'id' in annotationIdOrPayload)
  ) {
    annotationId =
      annotationIdOrPayload.annotationId || annotationIdOrPayload.id;
    priority =
      annotationIdOrPayload.priority !== undefined
        ? annotationIdOrPayload.priority
        : priorityArg;
    creatorNameFallback =
      annotationIdOrPayload.creatorNameFallback || creatorNameFallbackArg || '';
  } else {
    annotationId = annotationIdOrPayload;
    priority = priorityArg;
    creatorNameFallback = creatorNameFallbackArg || '';
  }

  const validPriority = normalizeAnnotationPriority(priority);

  if (!hasPhase20AColumns) {
    return {
      id: annotationId,
      priority: validPriority,
    };
  }

  const { data, error } = await executeAnnotationUpdate(
    annotationId,
    { priority: validPriority },
    creatorNameFallback
  );

  if (error) {
    if (isMissingColumnError(error)) {
      hasPhase20AColumns = false;
      return { id: annotationId, priority: validPriority };
    }
    throw formatAnnotationServiceError(error, 'Unable to update annotation priority.');
  }

  return mapAnnotationRow(data, creatorNameFallback);
}

/**
 * Persists an edited explanation comment for an existing annotation.
 */
export async function updateAnnotationComment(
  annotationId,
  comment,
  creatorNameFallback = ''
) {
  ensureSupabase();
  const validComment = normalizeAnnotationComment(comment);

  const { data, error } = await executeAnnotationUpdate(
    annotationId,
    { comment: validComment },
    creatorNameFallback
  );

  if (error) {
    throw formatAnnotationServiceError(error, 'Unable to update annotation comment.');
  }

  return mapAnnotationRow(data, creatorNameFallback);
}

/**
 * Updates annotation resolution status ('open' or 'resolved').
 */
export async function setAnnotationStatus(
  annotationId,
  status,
  creatorNameFallback = ''
) {
  ensureSupabase();
  if (status !== 'open' && status !== 'resolved') {
    throw new Error('Invalid annotation status.');
  }

  const { data, error } = await executeAnnotationUpdate(
    annotationId,
    { status },
    creatorNameFallback
  );

  if (error) {
    throw formatAnnotationServiceError(error, 'Unable to update annotation status.');
  }

  return mapAnnotationRow(data, creatorNameFallback);
}

/**
 * Soft-deletes the creator's own annotation via RPC so its annotation number is never reused.
 */
export async function softDeleteAnnotation(annotationId, creatorNameFallback = '') {
  ensureSupabase();

  const { data, error } = await supabase.rpc('soft_delete_annotation', {
    target_annotation_id: annotationId,
  });

  if (error) {
    throw formatAnnotationServiceError(error, 'Unable to delete annotation.');
  }

  const row = Array.isArray(data) ? data[0] : data;
  return mapAnnotationRow(row, creatorNameFallback);
}

/**
 * Restores a soft-deleted annotation owned by the current user (used for Undo/Redo).
 */
export async function restoreAnnotation(annotationId, creatorNameFallback = '') {
  ensureSupabase();

  const { data, error } = await supabase.rpc('restore_annotation', {
    target_annotation_id: annotationId,
  });

  if (error) {
    throw formatAnnotationServiceError(error, 'Unable to restore annotation.');
  }

  const row = Array.isArray(data) ? data[0] : data;
  return mapAnnotationRow(row, creatorNameFallback);
}

let hasLayersTable = true;
const localLayerStore = new Map(); // batchId -> array of layers

/**
 * Fetches all annotation layers for a batch, ensuring the default layer is always present.
 */
export async function listBatchLayers(batchId) {
  ensureSupabase();
  if (!batchId) return DEFAULT_LAYERS;

  if (!hasLayersTable) {
    const local = localLayerStore.get(batchId) || [];
    return [
      DEFAULT_LAYERS[0],
      ...local.filter((l) => l.id !== 'default'),
    ];
  }

  const { data, error } = await supabase
    .from('batch_annotation_layers')
    .select('id, batch_id, name, color, display_order, created_by, created_at, updated_at')
    .eq('batch_id', batchId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    if (error.code === '42P01' || isMissingColumnError(error)) {
      hasLayersTable = false;
      const local = localLayerStore.get(batchId) || [];
      return [DEFAULT_LAYERS[0], ...local.filter((l) => l.id !== 'default')];
    }
    throw formatAnnotationServiceError(error, 'Unable to load annotation layers.');
  }

  const remoteLayers = (data || []).map((row) => ({
    id: row.id,
    batchId: row.batch_id,
    name: row.name,
    color: row.color,
    displayOrder: row.display_order,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  const hasDefault = remoteLayers.some(
    (l) => l.id === 'default' || l.name.toLowerCase() === 'default layer'
  );
  if (!hasDefault) {
    return [DEFAULT_LAYERS[0], ...remoteLayers];
  }
  return remoteLayers;
}

/**
 * Creates a new custom annotation layer for a batch.
 */
export async function createBatchLayer({
  batchId,
  name,
  color = '#6366f1',
  displayOrder = 0,
  createdBy = null,
}) {
  ensureSupabase();
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    throw new Error('Layer name is required.');
  }
  if (!hasLayersTable) {
    const newLayer = {
      id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      batchId,
      name: trimmedName,
      color: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#6366f1',
      displayOrder,
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const list = localLayerStore.get(batchId) || [];
    localLayerStore.set(batchId, [...list, newLayer]);
    return newLayer;
  }

  const { data, error } = await supabase
    .from('batch_annotation_layers')
    .insert({
      batch_id: batchId,
      name: trimmedName,
      color: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#6366f1',
      display_order: displayOrder,
      created_by: createdBy,
    })
    .select('id, batch_id, name, color, display_order, created_by, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '42P01' || isMissingColumnError(error)) {
      hasLayersTable = false;
      return createBatchLayer({ batchId, name, color, displayOrder, createdBy });
    }
    throw formatAnnotationServiceError(error, 'Unable to create annotation layer.');
  }

  return {
    id: data.id,
    batchId: data.batch_id,
    name: data.name,
    color: data.color,
    displayOrder: data.display_order,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Renames or updates properties of an annotation layer.
 */
export async function updateBatchLayer(layerId, { name, color, displayOrder }) {
  ensureSupabase();
  if (layerId === 'default') {
    throw new Error('Default layer cannot be modified.');
  }
  const payload = {};
  if (name !== undefined) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('Layer name cannot be empty.');
    payload.name = trimmed;
  }
  if (color !== undefined) {
    payload.color = /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#6366f1';
  }
  if (displayOrder !== undefined) {
    payload.display_order = Number(displayOrder) || 0;
  }

  if (!hasLayersTable) {
    for (const [, list] of localLayerStore.entries()) {
      const idx = list.findIndex((l) => l.id === layerId);
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...payload, updatedAt: new Date().toISOString() };
        return list[idx];
      }
    }
    return { id: layerId, ...payload };
  }

  const { data, error } = await supabase
    .from('batch_annotation_layers')
    .update(payload)
    .eq('id', layerId)
    .select('id, batch_id, name, color, display_order, created_by, created_at, updated_at')
    .single();

  if (error) {
    throw formatAnnotationServiceError(error, 'Unable to update annotation layer.');
  }

  return {
    id: data.id,
    batchId: data.batch_id,
    name: data.name,
    color: data.color,
    displayOrder: data.display_order,
    createdBy: data.created_by,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Deletes a custom annotation layer.
 */
export async function deleteBatchLayer(layerId) {
  ensureSupabase();
  const targetId = typeof layerId === 'object' && layerId !== null ? layerId.layerId : layerId;
  if (!targetId || targetId === 'default') {
    throw new Error('Default layer cannot be deleted.');
  }
  if (!hasLayersTable) {
    for (const [bId, list] of localLayerStore.entries()) {
      localLayerStore.set(bId, list.filter((l) => l.id !== targetId));
    }
    return true;
  }

  const { error } = await supabase
    .from('batch_annotation_layers')
    .delete()
    .eq('id', targetId);

  if (error) {
    throw formatAnnotationServiceError(error, 'Unable to delete annotation layer.');
  }

  return true;
}

/**
 * Fetches a collaborator's display name (authorized by profiles_select_annotation_creators).
 */
export async function fetchCreatorDisplayName(userId) {
  if (!isSupabaseConfigured || !supabase || !userId) return '';

  const { data, error } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data?.display_name) {
    return '';
  }
  return String(data.display_name).trim();
}

/**
 * Module-level coordination for batch review Realtime channels.
 * Tracks in-flight teardown promises and active subscription tokens per batch to prevent
 * overlapping subscriptions and ensure channels transitioning through 'leaving' are never
 * reused before teardown completes.
 */
const batchTeardownPromises = new Map();
const activeBatchSubscriptionTokens = new Map();

/**
 * Helper to determine whether two presence property values are deeply equal.
 */
function isPresenceValueEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!isPresenceValueEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Subscribes to live annotation, soft-delete tombstone, image completion, and presence events
 * for a single batch on one Supabase Realtime channel.
 */
export function subscribeToBatchReviewRealtime({
  batchId,
  onAnnotationUpsert,
  onAnnotationDelete,
  onBatchImageChange,
  onStatusChange,
  presenceUser = null,
  onPresenceSync = null,
  onCursorBroadcast = null,
  onCursorLeave = null,
  onViewportBroadcast = null,
  onReactionChange = null,
  onBatchActivityEvent = null,
  onReferenceImageChange = null,
  onLayerChange = null,
  onDiscussionChange = null,
  onChecklistChange = null,
}) {
  if (!isSupabaseConfigured || !supabase || !batchId) {
    const noopUnsubscribe = () => {};
    noopUnsubscribe.updatePresenceState = () => {};
    noopUnsubscribe.sendCursor = () => {};
    noopUnsubscribe.sendCursorLeave = () => {};
    noopUnsubscribe.sendViewport = () => {};
    noopUnsubscribe.sendReactionChange = () => {};
    noopUnsubscribe.sendDiscussionChange = () => {};
    noopUnsubscribe.sendChecklistChange = () => {};
    return noopUnsubscribe;
  }

  const subToken = Symbol(`batch-review-${batchId}`);
  activeBatchSubscriptionTokens.set(batchId, subToken);

  let currentChannel = null;
  let isDisposed = false;
  let isSubscribed = false;

  const channelConfig =
    presenceUser && presenceUser.user_id
      ? {
          config: {
            presence: {
              key: presenceUser.user_id,
            },
          },
        }
      : {};

  const canTrack = Boolean(
    presenceUser &&
      presenceUser.user_id &&
      (presenceUser.role === 'reviewer' || presenceUser.role === 'admin')
  );

  let currentTrackedState = {
    user_id: presenceUser?.user_id,
    session_id: presenceUser?.sessionId || null,
    display_name: presenceUser?.display_name || 'Reviewer',
    role: presenceUser?.role,
    color: presenceUser?.color || getReviewerColor(presenceUser?.user_id || presenceUser?.display_name),
    selected_image_id: presenceUser?.selectedImageId || null,
    selected_annotation_id: presenceUser?.selectedAnnotationId || null,
    viewport: presenceUser?.viewport || null,
    following_user_id: presenceUser?.followingUserId || null,
  };

  const extractUniqueReviewers = (presenceState) => {
    if (!presenceState || typeof presenceState !== 'object') {
      return [];
    }
    const userMap = new Map();

    Object.values(presenceState).forEach((presences) => {
      if (!Array.isArray(presences)) return;
      presences.forEach((p) => {
        if (!p || !p.user_id) return;
        // Only Reviewer and Admin roles appear in presence list
        if (p.role === 'reviewer' || p.role === 'admin') {
          userMap.set(p.user_id, {
            userId: p.user_id,
            sessionId: p.session_id || null,
            displayName: p.display_name || 'Reviewer',
            role: p.role,
            color: p.color || getReviewerColor(p.user_id || p.display_name),
            selectedImageId: p.selected_image_id || null,
            selectedAnnotationId: p.selected_annotation_id || null,
            viewport: p.viewport || null,
            followingUserId: p.following_user_id || null,
          });
        }
      });
    });

    return Array.from(userMap.values());
  };

  const notifyPresence = () => {
    if (typeof onPresenceSync === 'function' && currentChannel) {
      const reviewers = extractUniqueReviewers(currentChannel.presenceState());
      onPresenceSync(reviewers);
    }
  };

  const trackPresence = async (partial = null) => {
    if (!canTrack) return;
    if (partial) {
      let hasChanges = false;
      for (const [key, val] of Object.entries(partial)) {
        if (!isPresenceValueEqual(currentTrackedState[key], val)) {
          hasChanges = true;
          break;
        }
      }
      if (!hasChanges) {
        return;
      }
      currentTrackedState = { ...currentTrackedState, ...partial };
    }
    if (!currentChannel || !isSubscribed) return;
    try {
      await currentChannel.track(currentTrackedState);
    } catch {
      // Gracefully ignore presence tracking errors so core review continues
    }
  };

  const sendCursor = (payload) => {
    if (!canTrack || !currentChannel || !isSubscribed) return;
    try {
      currentChannel.send({
        type: 'broadcast',
        event: 'cursor',
        payload,
      });
    } catch {
      // Ignore transient send failures
    }
  };

  const sendCursorLeave = (payload) => {
    if (!canTrack || !currentChannel || !isSubscribed) return;
    try {
      currentChannel.send({
        type: 'broadcast',
        event: 'cursor-leave',
        payload,
      });
    } catch {
      // Ignore
    }
  };

  const sendViewport = (payload) => {
    if (!canTrack || !currentChannel || !isSubscribed) return;
    try {
      currentChannel.send({
        type: 'broadcast',
        event: 'viewport',
        payload,
      });
    } catch {
      // Ignore
    }
  };

  const sendReactionChange = (payload) => {
    if (!currentChannel || !isSubscribed) return;
    try {
      currentChannel.send({
        type: 'broadcast',
        event: 'reaction-change',
        payload,
      });
    } catch {
      // Ignore
    }
  };

  const sendDiscussionChange = (payload) => {
    if (!currentChannel || !isSubscribed) return;
    try {
      currentChannel.send({
        type: 'broadcast',
        event: 'discussion-change',
        payload,
      });
    } catch {
      // Ignore
    }
  };

  const sendChecklistChange = (payload) => {
    if (!currentChannel || !isSubscribed) return;
    try {
      currentChannel.send({
        type: 'broadcast',
        event: 'checklist-change',
        payload,
      });
    } catch {
      // Ignore
    }
  };

  const initChannel = async () => {
    // 1. Wait for any in-flight teardown for this batch to complete
    while (batchTeardownPromises.has(batchId)) {
      try {
        await batchTeardownPromises.get(batchId);
      } catch {
        // Ignore previous teardown failures
      }
    }

    // 2. Check if this subscription was disposed or superseded while awaiting teardown
    if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) {
      return;
    }

    // 3. Ensure no existing channel with the topic batch-review-${batchId} lingers in Supabase client
    const topic = `batch-review-${batchId}`;
    const lingeringChannels = (supabase.getChannels() || []).filter(
      (c) => c.topic === topic || c.topic === `realtime:${topic}`
    );
    if (lingeringChannels.length > 0) {
      for (const chan of lingeringChannels) {
        try {
          await supabase.removeChannel(chan);
        } catch (err) {
          console.warn('[Realtime] Lingering channel removal error:', err);
        }
      }
    }

    // 4. Re-check disposal or superseding after lingering removal
    if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) {
      return;
    }

    // Verify that no lingering channel with the same batch topic remains registered.
    // If removal failed and an old channel remains registered, abort to avoid reusing a leaving channel.
    const remainingChannels = (supabase.getChannels() || []).filter(
      (c) => c.topic === topic || c.topic === `realtime:${topic}`
    );
    if (remainingChannels.length > 0) {
      console.warn(
        '[Realtime] Lingering channel remained after removal attempt; aborting subscription to avoid reusing leaving channel.'
      );
      onStatusChange?.(
        'CHANNEL_ERROR',
        new Error('Previous channel could not be cleared before resubscription.')
      );
      return;
    }

    // 5. Create fresh channel
    const channel = supabase.channel(`batch-review-${batchId}`, channelConfig);
    currentChannel = channel;

    // 6. Bind presence and broadcast listeners
    channel
      .on('presence', { event: 'sync' }, () => {
        if (!isDisposed && activeBatchSubscriptionTokens.get(batchId) === subToken) {
          notifyPresence();
        }
      })
      .on('presence', { event: 'join' }, () => {
        if (!isDisposed && activeBatchSubscriptionTokens.get(batchId) === subToken) {
          notifyPresence();
        }
      })
      .on('presence', { event: 'leave' }, () => {
        if (!isDisposed && activeBatchSubscriptionTokens.get(batchId) === subToken) {
          notifyPresence();
        }
      })
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        if (!isDisposed && activeBatchSubscriptionTokens.get(batchId) === subToken && payload && onCursorBroadcast) {
          onCursorBroadcast(payload);
        }
      })
      .on('broadcast', { event: 'cursor-leave' }, ({ payload }) => {
        if (!isDisposed && activeBatchSubscriptionTokens.get(batchId) === subToken && payload && onCursorLeave) {
          onCursorLeave(payload);
        }
      })
      .on('broadcast', { event: 'viewport' }, ({ payload }) => {
        if (!isDisposed && activeBatchSubscriptionTokens.get(batchId) === subToken && payload && onViewportBroadcast) {
          onViewportBroadcast(payload);
        }
      })
      .on('broadcast', { event: 'reaction-change' }, ({ payload }) => {
        if (!isDisposed && activeBatchSubscriptionTokens.get(batchId) === subToken && payload && onReactionChange) {
          onReactionChange(payload);
        }
      })
      .on('broadcast', { event: 'discussion-change' }, ({ payload }) => {
        if (!isDisposed && activeBatchSubscriptionTokens.get(batchId) === subToken && payload && onDiscussionChange) {
          onDiscussionChange(payload);
        }
      })
      .on('broadcast', { event: 'checklist-change' }, ({ payload }) => {
        if (!isDisposed && activeBatchSubscriptionTokens.get(batchId) === subToken && payload && onChecklistChange) {
          onChecklistChange(payload);
        }
      })
      .on('system', {}, (payload) => {
        console.warn('[Realtime System]', payload);
      })
      // 7. Bind all 6 Postgres change listeners
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'annotation_reactions',
        },
        (payload) => {
          if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) return;
          if (onReactionChange) {
            if (payload.eventType === 'INSERT' && payload.new) {
              onReactionChange({
                action: 'added',
                reaction: {
                  id: payload.new.id,
                  annotationId: payload.new.annotation_id,
                  userId: payload.new.user_id,
                  emoji: payload.new.emoji,
                  createdAt: payload.new.created_at,
                },
              });
            } else if (payload.eventType === 'DELETE' && payload.old) {
              onReactionChange({
                action: 'removed',
                reaction: {
                  id: payload.old.id,
                  annotationId: payload.old.annotation_id,
                  userId: payload.old.user_id,
                  emoji: payload.old.emoji,
                },
              });
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'annotations',
        },
        (payload) => {
          if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) return;
          if (payload?.new) {
            onAnnotationUpsert?.(payload.new);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'annotations',
        },
        (payload) => {
          if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) return;
          const row = payload?.new;
          if (!row) return;
          if (row.deleted_at) {
            onAnnotationDelete?.({
              annotationId: row.id,
              imageId: row.image_id,
            });
          } else {
            onAnnotationUpsert?.(row);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'annotation_deletion_events',
          filter: `batch_id=eq.${batchId}`,
        },
        (payload) => {
          if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) return;
          const evt = payload?.new;
          if (!evt) return;
          onAnnotationDelete?.({
            annotationId: evt.annotation_id,
            imageId: evt.image_id,
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'batch_images',
          filter: `batch_id=eq.${batchId}`,
        },
        (payload) => {
          if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) return;
          if (payload?.new) {
            onBatchImageChange?.('INSERT', payload.new);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'batch_images',
          filter: `batch_id=eq.${batchId}`,
        },
        (payload) => {
          if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) return;
          if (payload?.new) {
            onBatchImageChange?.('UPDATE', payload.new);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'batch_activity_events',
          filter: `batch_id=eq.${batchId}`,
        },
        (payload) => {
          if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) return;
          if (payload?.new) {
            onBatchActivityEvent?.(payload.new);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reference_images',
        },
        (payload) => {
          if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) return;
          if (payload) {
            onReferenceImageChange?.(payload);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'batch_annotation_layers',
        },
        (payload) => {
          if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) return;
          if (payload) {
            onLayerChange?.(payload);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'annotation_discussions',
        },
        (payload) => {
          if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) return;
          if (onDiscussionChange) {
            if (payload.eventType === 'INSERT' && payload.new) {
              onDiscussionChange({
                action: 'created',
                message: {
                  id: payload.new.id,
                  annotationId: payload.new.annotation_id,
                  userId: payload.new.user_id,
                  message: payload.new.message,
                  createdAt: payload.new.created_at,
                  updatedAt: payload.new.updated_at,
                },
              });
            } else if (payload.eventType === 'DELETE' && payload.old) {
              onDiscussionChange({
                action: 'deleted',
                annotationId: payload.old.annotation_id,
                messageId: payload.old.id,
              });
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'batch_review_checklists',
        },
        (payload) => {
          if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) return;
          if (onChecklistChange) {
            onChecklistChange({
              action: payload.eventType?.toLowerCase() || 'updated',
              item: payload.new || payload.old,
            });
          }
        }
      )
      .subscribe((status, error) => {
        if (isDisposed || activeBatchSubscriptionTokens.get(batchId) !== subToken) {
          return;
        }
        if (status === 'SUBSCRIBED') {
          isSubscribed = true;
          trackPresence();
        } else {
          isSubscribed = false;
        }
        onStatusChange?.(status, error);
      });
  };

  initChannel();

  const unsubscribe = () => {
    if (isDisposed) {
      return;
    }
    isDisposed = true;
    isSubscribed = false;

    if (activeBatchSubscriptionTokens.get(batchId) === subToken) {
      activeBatchSubscriptionTokens.delete(batchId);
    }

    onPresenceSync?.([]);

    if (currentChannel) {
      const channelToRemove = currentChannel;
      currentChannel = null;

      if (canTrack) {
        channelToRemove.untrack().catch(() => {});
      }

      // Coordinate asynchronous teardown using public Supabase API
      const teardownPromise = (async () => {
        try {
          await supabase.removeChannel(channelToRemove);
        } catch (err) {
          console.warn('[Realtime] removeChannel error:', err);
        } finally {
          if (batchTeardownPromises.get(batchId) === teardownPromise) {
            batchTeardownPromises.delete(batchId);
          }
        }
      })();

      batchTeardownPromises.set(batchId, teardownPromise);
    }
  };

  unsubscribe.updatePresenceState = (partial) => {
    trackPresence(partial);
  };
  unsubscribe.sendCursor = sendCursor;
  unsubscribe.sendCursorLeave = sendCursorLeave;
  unsubscribe.sendViewport = sendViewport;
  unsubscribe.sendReactionChange = sendReactionChange;
  unsubscribe.sendDiscussionChange = sendDiscussionChange;
  unsubscribe.sendChecklistChange = sendChecklistChange;

  return unsubscribe;
}

/**
 * Subscribes to live annotation and image completion events affecting visible dashboard batches.
 */
export function subscribeToDashboardReviewRealtime({
  onRelevantChange,
  onStatusChange,
}) {
  if (!isSupabaseConfigured || !supabase) {
    return () => {};
  }

  const channel = supabase
    .channel('dashboard-review-sync')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'annotations',
      },
      (payload) => {
        onRelevantChange?.(payload);
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'annotation_deletion_events',
      },
      (payload) => {
        onRelevantChange?.(payload);
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'batch_images',
      },
      (payload) => {
        onRelevantChange?.(payload);
      }
    )
    .subscribe((status, error) => {
      onStatusChange?.(status, error);
    });

  return () => {
    supabase.removeChannel(channel);
  };
}
