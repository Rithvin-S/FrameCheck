import { isSupabaseConfigured, supabase } from './supabaseClient.js';

export const MAX_ANNOTATION_COMMENT_LENGTH = 2000;

const ANNOTATION_FIELDS = `
  id,
  image_id,
  annotation_number,
  created_by,
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

function ensureSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured. Check your environment variables.');
  }
}

function validateGeometry(geometry) {
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

  return { cx, cy, r };
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
 * Normalizes a database row from public.annotations into the workspace shape.
 */
export function mapAnnotationRow(row, creatorNameFallback = '') {
  if (!row) return null;
  const joinedName =
    typeof row.creator?.display_name === 'string'
      ? row.creator.display_name.trim()
      : '';
  const fallbackName = String(creatorNameFallback || '').trim();

  return {
    id: row.id,
    imageId: row.image_id,
    annotationNumber: Number(row.annotation_number),
    displayNumber: Number(row.annotation_number),
    createdBy: row.created_by,
    creatorName: joinedName || fallbackName || 'Reviewer',
    cx: Number(row.cx),
    cy: Number(row.cy),
    r: Number(row.r),
    color: String(row.color || '#dc2626').toLowerCase(),
    comment: row.comment ?? '',
    status: row.status === 'resolved' ? 'resolved' : 'open',
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

  const { data, error } = await supabase
    .from('annotations')
    .select(
      `
        id,
        image_id,
        annotation_number,
        created_by,
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
      `
    )
    .eq('image.batch_id', batchId)
    .is('deleted_at', null)
    .order('annotation_number', { ascending: true });

  if (error) {
    throw formatAnnotationServiceError(
      error,
      'Unable to load annotations for this batch.'
    );
  }

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

/**
 * Creates a persisted circle annotation with a required comment.
 */
export async function createAnnotation({
  imageId,
  createdBy,
  geometry,
  color,
  comment,
  creatorNameFallback = '',
}) {
  ensureSupabase();
  if (!imageId) {
    throw new Error('Image ID is required to save an annotation.');
  }
  if (!createdBy) {
    throw new Error('You must be signed in to create an annotation.');
  }

  const validGeometry = validateGeometry(geometry);
  const validColor = validateColor(color);
  const validComment = normalizeAnnotationComment(comment);

  const { data, error } = await supabase
    .from('annotations')
    .insert({
      image_id: imageId,
      created_by: createdBy,
      cx: validGeometry.cx,
      cy: validGeometry.cy,
      r: validGeometry.r,
      color: validColor,
      comment: validComment,
    })
    .select(ANNOTATION_FIELDS)
    .single();

  if (error) {
    throw formatAnnotationServiceError(error, 'Unable to save annotation.');
  }

  return mapAnnotationRow(data, creatorNameFallback);
}

/**
 * Persists updated circle coordinates and radius after a completed move or resize gesture.
 */
export async function updateAnnotationGeometry(
  annotationId,
  geometry,
  creatorNameFallback = ''
) {
  ensureSupabase();
  const validGeometry = validateGeometry(geometry);

  const { data, error } = await supabase
    .from('annotations')
    .update({
      cx: validGeometry.cx,
      cy: validGeometry.cy,
      r: validGeometry.r,
    })
    .eq('id', annotationId)
    .select(ANNOTATION_FIELDS)
    .single();

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

  const { data, error } = await supabase
    .from('annotations')
    .update({ color: validColor })
    .eq('id', annotationId)
    .select(ANNOTATION_FIELDS)
    .single();

  if (error) {
    throw formatAnnotationServiceError(error, 'Unable to update annotation color.');
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

  const { data, error } = await supabase
    .from('annotations')
    .update({ comment: validComment })
    .eq('id', annotationId)
    .select(ANNOTATION_FIELDS)
    .single();

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

  const { data, error } = await supabase
    .from('annotations')
    .update({ status })
    .eq('id', annotationId)
    .select(ANNOTATION_FIELDS)
    .single();

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
 * Subscribes to live annotation, soft-delete tombstone, and image completion events
 * for a single batch on one Supabase Realtime channel.
 */
export function subscribeToBatchReviewRealtime({
  batchId,
  onAnnotationUpsert,
  onAnnotationDelete,
  onBatchImageChange,
  onStatusChange,
}) {
  if (!isSupabaseConfigured || !supabase || !batchId) {
    return () => {};
  }

  const channel = supabase
    .channel(`batch-review-${batchId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'annotations',
      },
      (payload) => {
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
        if (payload?.new) {
          onBatchImageChange?.('UPDATE', payload.new);
        }
      }
    )
    .subscribe((status, error) => {
      onStatusChange?.(status, error);
    });

  return () => {
    supabase.removeChannel(channel);
  };
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
