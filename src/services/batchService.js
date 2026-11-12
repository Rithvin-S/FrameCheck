import { supabase } from './supabaseClient.js';

export const REVIEW_STATUSES = {
  NOT_STARTED: 'not_started',
  IN_REVIEW: 'in_review',
  REVIEW_COMPLETED: 'review_completed',
};

export const REVIEW_STATUS_LABELS = {
  [REVIEW_STATUSES.NOT_STARTED]: 'Not Started',
  [REVIEW_STATUSES.IN_REVIEW]: 'In Review',
  [REVIEW_STATUSES.REVIEW_COMPLETED]: 'Review Completed',
};

const BATCH_IMAGE_FIELDS =
  'id, batch_id, original_filename, relative_path, storage_path, mime_type, file_size, display_order, is_completed, completed_at, completed_by, created_at';

function getClientOrThrow() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.'
    );
  }
  return supabase;
}

/**
 * Derives overall batch review status from image completion and active open annotations.
 */
export function deriveBatchReviewStatus({
  imageCount = 0,
  completedImageCount = 0,
  totalAnnotationCount = 0,
  openAnnotationCount = 0,
}) {
  if (
    imageCount > 0 &&
    completedImageCount === imageCount &&
    openAnnotationCount === 0
  ) {
    return REVIEW_STATUSES.REVIEW_COMPLETED;
  }

  if (completedImageCount > 0 || totalAnnotationCount > 0) {
    return REVIEW_STATUSES.IN_REVIEW;
  }

  return REVIEW_STATUSES.NOT_STARTED;
}

function normalizeBatchRow(row) {
  return {
    id: row.id,
    owner_id: row.owner_id,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ownerName: row.owner?.display_name ?? 'Unknown',
    imageCount: row.batch_images?.[0]?.count ?? 0,
  };
}

function normalizeDashboardBatchRow(row) {
  const imageCount = Number(row.image_count ?? 0);
  const completedImageCount = Number(row.completed_image_count ?? 0);
  const totalAnnotationCount = Number(row.total_annotation_count ?? 0);
  const openAnnotationCount = Number(row.open_annotation_count ?? 0);
  const reviewStatus =
    row.review_status && REVIEW_STATUS_LABELS[row.review_status]
      ? row.review_status
      : deriveBatchReviewStatus({
          imageCount,
          completedImageCount,
          totalAnnotationCount,
          openAnnotationCount,
        });

  return {
    id: row.id,
    owner_id: row.owner_id,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ownerName: row.owner_name ?? 'Unknown',
    imageCount,
    completedImageCount,
    totalAnnotationCount,
    openAnnotationCount,
    reviewStatus,
  };
}

/**
 * Fetches batches visible to the signed-in user via RLS with server-aggregated review status:
 * Uploaders see their own batches; Reviewers and Admins see all batches.
 */
export async function listBatches() {
  const client = getClientOrThrow();
  const { data, error } = await client.rpc('list_dashboard_batches');

  if (error) {
    throw error;
  }

  return (data ?? []).map(normalizeDashboardBatchRow);
}

/**
 * Fetches a single batch by ID if authorized by RLS. Returns null if not found or inaccessible.
 * @param {string} batchId
 */
export async function getBatchById(batchId) {
  const client = getClientOrThrow();
  const { data, error } = await client
    .from('batches')
    .select(
      `
      id,
      owner_id,
      name,
      created_at,
      updated_at,
      owner:profiles!batches_owner_id_fkey (
        display_name
      ),
      batch_images (
        count
      )
    `
    )
    .eq('id', batchId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? normalizeBatchRow(data) : null;
}

/**
 * Creates a new batch owned by the authenticated user.
 */
export async function createBatch({ name, ownerId }) {
  const client = getClientOrThrow();
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error('Batch name is required.');
  }
  if (trimmedName.length > 120) {
    throw new Error('Batch name must be 120 characters or fewer.');
  }

  const { data, error } = await client
    .from('batches')
    .insert({
      name: trimmedName,
      owner_id: ownerId,
    })
    .select('id, owner_id, name, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Fetches ordered image metadata records for a batch.
 * @param {string} batchId
 */
export async function listBatchImages(batchId) {
  const client = getClientOrThrow();
  const { data, error } = await client
    .from('batch_images')
    .select(BATCH_IMAGE_FIELDS)
    .eq('batch_id', batchId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

/**
 * Marks a batch image as completed or reopens it for review.
 */
export async function updateBatchImageCompletion(imageId, isCompleted) {
  const client = getClientOrThrow();
  const { data, error } = await client
    .from('batch_images')
    .update({ is_completed: Boolean(isCompleted) })
    .eq('id', imageId)
    .select(BATCH_IMAGE_FIELDS)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Inserts a metadata record for an image already uploaded to private Supabase Storage.
 * display_order is assigned atomically by a PostgreSQL BEFORE INSERT trigger.
 */
export async function insertBatchImage({
  batchId,
  originalFilename,
  relativePath,
  storagePath,
  mimeType,
  fileSize,
}) {
  const client = getClientOrThrow();
  const { data, error } = await client
    .from('batch_images')
    .insert({
      batch_id: batchId,
      original_filename: originalFilename,
      relative_path: relativePath || null,
      storage_path: storagePath,
      mime_type: mimeType,
      file_size: fileSize,
    })
    .select(BATCH_IMAGE_FIELDS)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

