import { supabase } from './supabaseClient.js';
import { validateImageFile, formatFileSize, getFormatLabel } from './imageUploadService.js';

export const REFERENCE_STORAGE_BUCKET = 'framecheck-reference-images';
export const MAX_REFERENCE_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_REFERENCE_COMMENT_LENGTH = 2000;
export const ALLOWED_REFERENCE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
export const ALLOWED_REFERENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour
const SIGNED_URL_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

const signedUrlCache = new Map();
const inFlightUrlRequests = new Map();

function getClientOrThrow() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.'
    );
  }
  return supabase;
}

function formatErrorMessage(error, defaultMsg = 'Operation failed.') {
  if (!error) return defaultMsg;
  const msg = String(error.message || '');
  if (error.code === '42501' || /row-level security|permission denied|not authorized/i.test(msg)) {
    return 'You do not have permission to perform this reference image action.';
  }
  if (error.code === '23514' || /cross-image/i.test(msg)) {
    return 'Cross-image association forbidden: reference image must belong to the exact same image as the annotation.';
  }
  if (error.code === '23503' || /does not exist|soft-deleted/i.test(msg)) {
    return 'Cannot attach reference to a nonexistent or soft-deleted annotation.';
  }
  if (/payload too large|entity too large|exceeded/i.test(msg)) {
    return 'File exceeds the 50 MB maximum size limit.';
  }
  return msg || defaultMsg;
}

/**
 * Validates a reference image file for allowed types and size.
 * Reuses core byte-inspection from imageUploadService.
 */
export async function validateReferenceFile(file) {
  if (!file) {
    return { valid: false, reason: 'No file provided.' };
  }
  return validateImageFile(file);
}

/**
 * Fetches all reference images for a target batch image,
 * along with resolved creator display names.
 */
export async function listImageReferences(imageId) {
  if (!imageId) return [];
  const client = getClientOrThrow();

  // 1. Fetch metadata rows
  const { data: rows, error: selectError } = await client
    .from('reference_images')
    .select(
      'id, image_id, annotation_id, created_by, original_filename, storage_path, mime_type, file_size, comment, created_at, updated_at'
    )
    .eq('image_id', imageId)
    .order('created_at', { ascending: true });

  if (selectError) {
    throw new Error(formatErrorMessage(selectError, 'Failed to load reference images.'));
  }

  if (!rows || rows.length === 0) {
    return [];
  }

  // 2. Fetch creator display names using the narrowly-scoped RPC helper
  let creatorMap = new Map();
  try {
    const { data: names, error: namesError } = await client.rpc(
      'get_reference_image_creator_names',
      { target_image_id: imageId }
    );
    if (!namesError && Array.isArray(names)) {
      names.forEach((item) => {
        if (item.id && item.display_name) {
          creatorMap.set(item.id, item.display_name);
        }
      });
    }
  } catch (rpcErr) {
    console.warn('[ReferenceImageService] Could not resolve creator display names via RPC:', rpcErr);
  }

  // 3. Map to consistent shape
  return rows.map((row) => ({
    id: row.id,
    imageId: row.image_id,
    annotationId: row.annotation_id,
    createdBy: row.created_by,
    creatorName: creatorMap.get(row.created_by) || 'Reviewer',
    originalFilename: row.original_filename,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    formattedSize: formatFileSize(Number(row.file_size)),
    formatLabel: getFormatLabel(row.mime_type),
    comment: row.comment || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isAnnotationLevel: Boolean(row.annotation_id),
  }));
}

/**
 * Returns a cached private signed URL for a stored reference image.
 */
export async function getReferenceSignedUrl(storagePath, { forceRefresh = false } = {}) {
  if (!storagePath) {
    throw new Error('Reference image storage path is missing.');
  }

  const now = Date.now();
  if (!forceRefresh) {
    const cached = signedUrlCache.get(storagePath);
    if (cached && cached.expiresAt - now > SIGNED_URL_REFRESH_BUFFER_MS) {
      return cached.url;
    }

    const pending = inFlightUrlRequests.get(storagePath);
    if (pending) {
      return pending;
    }
  }

  const client = getClientOrThrow();
  const request = client.storage
    .from(REFERENCE_STORAGE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
    .then(({ data, error }) => {
      if (error || !data?.signedUrl) {
        throw error || new Error('Unable to generate signed reference image URL.');
      }
      signedUrlCache.set(storagePath, {
        url: data.signedUrl,
        expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
      });
      return data.signedUrl;
    })
    .finally(() => {
      inFlightUrlRequests.delete(storagePath);
    });

  inFlightUrlRequests.set(storagePath, request);
  return request;
}

/**
 * Clears the in-memory signed URL cache for reference images.
 */
export function clearReferenceSignedUrlCache() {
  signedUrlCache.clear();
  inFlightUrlRequests.clear();
}

/**
 * Safe upload lifecycle:
 * 1. Validates the file.
 * 2. Uploads binary to private Storage bucket.
 * 3. Inserts metadata row in public.reference_images.
 * 4. Cleans up Storage object if metadata insert fails.
 */
export async function uploadReferenceImage({
  batchId,
  imageId,
  annotationId = null,
  file,
  comment = '',
}) {
  if (!batchId || !imageId) {
    throw new Error('Batch ID and Image ID are required to upload a reference image.');
  }

  // Step 1: Validate file
  const check = await validateReferenceFile(file);
  if (!check.valid) {
    throw new Error(check.reason);
  }

  const trimmedComment = typeof comment === 'string' ? comment.trim() : '';
  if (trimmedComment.length > MAX_REFERENCE_COMMENT_LENGTH) {
    throw new Error(`Comment must be ${MAX_REFERENCE_COMMENT_LENGTH} characters or fewer.`);
  }

  const client = getClientOrThrow();
  const ext = check.extension || 'png';
  const referenceUuid = crypto.randomUUID();
  const storagePath = `${batchId}/${imageId}/${referenceUuid}.${ext}`;

  // Step 2: Upload object to private Storage
  const { error: uploadError } = await client.storage
    .from(REFERENCE_STORAGE_BUCKET)
    .upload(storagePath, file, {
      contentType: check.mimeType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(formatErrorMessage(uploadError, 'Storage upload failed.'));
  }

  // Step 3: Insert metadata row into public.reference_images
  const { data: insertedRow, error: insertError } = await client
    .from('reference_images')
    .insert({
      image_id: imageId,
      annotation_id: annotationId || null,
      original_filename: file.name,
      storage_path: storagePath,
      mime_type: check.mimeType,
      file_size: file.size,
      comment: trimmedComment,
    })
    .select(
      'id, image_id, annotation_id, created_by, original_filename, storage_path, mime_type, file_size, comment, created_at, updated_at'
    )
    .single();

  if (insertError) {
    // Step 4: Rollback Storage upload on metadata failure
    let cleanupFailed = false;
    try {
      const { error: removeError } = await client.storage
        .from(REFERENCE_STORAGE_BUCKET)
        .remove([storagePath]);
      if (removeError) {
        cleanupFailed = true;
        console.error('[ReferenceImageService] Storage cleanup error:', removeError);
      }
    } catch (cleanupErr) {
      cleanupFailed = true;
      console.error('[ReferenceImageService] Storage cleanup threw:', cleanupErr);
    }

    const msg = formatErrorMessage(insertError, 'Failed to save reference image record.');
    if (cleanupFailed) {
      throw new Error(`${msg} (Warning: storage cleanup failed; an orphaned storage file may remain)`);
    }
    throw new Error(msg);
  }

  return {
    id: insertedRow.id,
    imageId: insertedRow.image_id,
    annotationId: insertedRow.annotation_id,
    createdBy: insertedRow.created_by,
    creatorName: 'You',
    originalFilename: insertedRow.original_filename,
    storagePath: insertedRow.storage_path,
    mimeType: insertedRow.mime_type,
    fileSize: Number(insertedRow.file_size),
    formattedSize: formatFileSize(Number(insertedRow.file_size)),
    formatLabel: getFormatLabel(insertedRow.mime_type),
    comment: insertedRow.comment || '',
    createdAt: insertedRow.created_at,
    updatedAt: insertedRow.updated_at,
    isAnnotationLevel: Boolean(insertedRow.annotation_id),
  };
}

/**
 * Updates the comment on an existing reference image.
 * Respects table immutability (only comment may be updated).
 */
export async function updateReferenceComment(referenceId, comment) {
  if (!referenceId) {
    throw new Error('Reference image ID is required to update comment.');
  }

  const trimmed = typeof comment === 'string' ? comment.trim() : '';
  if (trimmed.length > MAX_REFERENCE_COMMENT_LENGTH) {
    throw new Error(`Comment must be ${MAX_REFERENCE_COMMENT_LENGTH} characters or fewer.`);
  }

  const client = getClientOrThrow();
  const { data, error } = await client
    .from('reference_images')
    .update({ comment: trimmed })
    .eq('id', referenceId)
    .select(
      'id, image_id, annotation_id, created_by, original_filename, storage_path, mime_type, file_size, comment, created_at, updated_at'
    )
    .single();

  if (error) {
    throw new Error(formatErrorMessage(error, 'Failed to update reference comment.'));
  }

  return {
    id: data.id,
    imageId: data.image_id,
    annotationId: data.annotation_id,
    createdBy: data.created_by,
    originalFilename: data.original_filename,
    storagePath: data.storage_path,
    mimeType: data.mime_type,
    fileSize: Number(data.file_size),
    formattedSize: formatFileSize(Number(data.file_size)),
    formatLabel: getFormatLabel(data.mime_type),
    comment: data.comment || '',
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    isAnnotationLevel: Boolean(data.annotation_id),
  };
}

/**
 * Safe deletion lifecycle:
 * 1. Deletes the Storage object first while metadata exists.
 * 2. Deletes the database record only after Storage deletion succeeds.
 */
export async function deleteReferenceImage({ id, storagePath }) {
  if (!id || !storagePath) {
    throw new Error('Reference image ID and storage path are required for deletion.');
  }

  const client = getClientOrThrow();

  // Step 1: Delete Storage object first
  const { error: storageError } = await client.storage
    .from(REFERENCE_STORAGE_BUCKET)
    .remove([storagePath]);

  if (storageError) {
    throw new Error(
      `Failed to remove storage binary: ${storageError.message || 'Storage error'}. Database record preserved.`
    );
  }

  // Step 2: Delete database record only after Storage deletion succeeds
  const { error: dbError } = await client
    .from('reference_images')
    .delete()
    .eq('id', id);

  if (dbError) {
    throw new Error(
      `Storage binary was removed, but metadata deletion failed: ${dbError.message}. Database record may need manual cleanup.`
    );
  }

  // Evict cached signed URL
  signedUrlCache.delete(storagePath);

  return { success: true };
}

/**
 * Safe replacement lifecycle:
 * Respects database immutability by creating a new reference record first,
 * and deleting the old one only when the new one is successfully persisted.
 */
export async function replaceReferenceImage({
  batchId,
  imageId,
  oldReference,
  newFile,
  comment = null,
}) {
  if (!oldReference?.id || !oldReference?.storagePath) {
    throw new Error('Existing reference information is required for replacement.');
  }

  // Step 1: Upload new reference first (preserves existing comment if not provided)
  const effectiveComment = comment !== null ? comment : oldReference.comment;
  const newRecord = await uploadReferenceImage({
    batchId,
    imageId,
    annotationId: oldReference.annotationId || null,
    file: newFile,
    comment: effectiveComment,
  });

  // Step 2: Delete the old reference
  let warning = null;
  try {
    await deleteReferenceImage({
      id: oldReference.id,
      storagePath: oldReference.storagePath,
    });
  } catch (deleteOldErr) {
    console.warn('[ReferenceImageService] Old reference deletion failed during replace:', deleteOldErr);
    warning = `New reference was created successfully, but failed to remove old reference: ${deleteOldErr.message}`;
  }

  return { newReference: newRecord, warning };
}

/**
 * Checks whether the current user can manage (edit comment, replace, or delete)
 * a specific reference image.
 */
export function canManageReference({
  reference,
  currentUserId,
  userRole,
  parentAnnotation = null,
}) {
  if (!currentUserId || !reference) return false;
  // Admins can manage all references
  if (userRole === 'admin') return true;
  // Uploaders are view-only
  if (userRole === 'uploader') return false;

  // Image-level reference: created_by owns it
  if (!reference.annotationId) {
    return reference.createdBy === currentUserId;
  }

  // Annotation-level reference: parent annotation creator owns it
  if (parentAnnotation) {
    const parentCreatorId = parentAnnotation.createdBy || parentAnnotation.created_by;
    return parentCreatorId === currentUserId;
  }

  // Fallback if parentAnnotation object is not readily available
  return reference.createdBy === currentUserId;
}

/**
 * Checks whether the current user can attach a reference to a specific annotation.
 */
export function canAddAnnotationReference({
  annotation,
  currentUserId,
  userRole,
}) {
  if (!currentUserId || !annotation) return false;
  if (userRole === 'admin') return true;
  if (userRole === 'uploader') return false;
  const creatorId = annotation.createdBy || annotation.created_by;
  return creatorId === currentUserId;
}

