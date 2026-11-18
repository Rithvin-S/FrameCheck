import { getSignedImageUrl, STORAGE_BUCKET, validateImageFile } from './imageUploadService.js';
import { isSupabaseConfigured, supabase } from './supabaseClient.js';

function getClientOrThrow() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured. Check your environment variables.');
  }
  return supabase;
}

/**
 * Loads all historical and active versions for a logical image.
 * Ordered chronologically by version_number ascending.
 */
export async function listImageVersions(imageId) {
  if (!imageId) return [];
  const client = getClientOrThrow();

  try {
    const { data, error } = await client
      .from('image_versions')
      .select(`
        id,
        image_id,
        batch_id,
        version_number,
        storage_path,
        original_filename,
        file_size,
        mime_type,
        uploaded_by,
        uploaded_at,
        status,
        correction_message,
        reviewed_by,
        reviewed_at,
        rejection_reason,
        created_at,
        uploader:profiles!image_versions_uploaded_by_fkey (
          id,
          display_name,
          role
        ),
        reviewer:profiles!image_versions_reviewed_by_fkey (
          id,
          display_name,
          role
        )
      `)
      .eq('image_id', imageId)
      .order('version_number', { ascending: false });

    if (error) {
      // If table does not exist yet (pre-migration), return empty array gracefully
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return [];
      }
      throw error;
    }

    return (data || []).map((row) => ({
      id: row.id,
      imageId: row.image_id,
      batchId: row.batch_id,
      versionNumber: row.version_number,
      storagePath: row.storage_path,
      originalFilename: row.original_filename,
      fileSize: row.file_size,
      mimeType: row.mime_type,
      uploadedBy: row.uploaded_by,
      uploaderName: row.uploader?.display_name?.trim() || 'Uploader',
      uploadedAt: row.uploaded_at || row.created_at,
      status: row.status,
      correctionMessage: row.correction_message || '',
      reviewedBy: row.reviewed_by,
      reviewerName: row.reviewer?.display_name?.trim() || 'Reviewer',
      reviewedAt: row.reviewed_at,
      rejectionReason: row.rejection_reason || '',
      createdAt: row.created_at,
    }));
  } catch (err) {
    console.warn('Failed to list image versions:', err);
    return [];
  }
}

/**
 * Loads all pending replacement proposals for a batch.
 */
export async function listBatchPendingReplacements(batchId) {
  if (!batchId) return [];
  const client = getClientOrThrow();

  try {
    const { data, error } = await client
      .from('image_versions')
      .select(`
        id,
        image_id,
        batch_id,
        version_number,
        storage_path,
        original_filename,
        file_size,
        mime_type,
        uploaded_by,
        uploaded_at,
        status,
        correction_message,
        created_at,
        uploader:profiles!image_versions_uploaded_by_fkey (
          id,
          display_name,
          role
        ),
        image:batch_images!image_versions_image_id_fkey (
          id,
          original_filename,
          display_order,
          storage_path
        )
      `)
      .eq('batch_id', batchId)
      .eq('status', 'pending_approval')
      .order('version_number', { ascending: true });

    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return [];
      }
      throw error;
    }

    return (data || []).map((row) => ({
      id: row.id,
      imageId: row.image_id,
      batchId: row.batch_id,
      versionNumber: row.version_number,
      storagePath: row.storage_path,
      originalFilename: row.original_filename,
      fileSize: row.file_size,
      mimeType: row.mime_type,
      uploadedBy: row.uploaded_by,
      uploaderName: row.uploader?.display_name?.trim() || 'Uploader',
      uploadedAt: row.uploaded_at || row.created_at,
      status: row.status,
      correctionMessage: row.correction_message || '',
      imageOrder: row.image?.display_order || 1,
      imageFilename: row.image?.original_filename || row.original_filename,
      originalStoragePath: row.image?.storage_path,
    }));
  } catch (err) {
    console.warn('Failed to list batch pending replacements:', err);
    return [];
  }
}

/**
 * Submits a new replacement image version for reviewer approval.
 * 1. Validates file integrity, type, and size.
 * 2. Uploads to private storage at immutable owner/batch/uuid.ext path.
 * 3. Calls submit_image_replacement RPC to atomically insert version and update batch image.
 */
export async function submitImageReplacement({
  batchId,
  imageId,
  ownerId,
  file,
  correctionMessage = '',
}) {
  const client = getClientOrThrow();

  if (!batchId || !imageId || !ownerId) {
    throw new Error('Batch ID, Image ID, and Owner ID are required.');
  }

  // 1. Validate file
  const validation = await validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  // 2. Upload replacement image to immutable storage path
  const replacementUuid = crypto.randomUUID();
  const storagePath = `${ownerId}/${batchId}/${replacementUuid}.${validation.extension}`;

  const { error: uploadError } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, {
      contentType: validation.mimeType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Failed to upload replacement image to storage.');
  }

  // 3. Atomically register proposal via RPC
  try {
    const { data, error } = await client.rpc('submit_image_replacement', {
      target_image_id: imageId,
      new_storage_path: storagePath,
      new_original_filename: file.name,
      new_file_size: file.size,
      new_mime_type: validation.mimeType,
      correction_msg: correctionMessage.trim() || null,
    });

    if (error) {
      throw error;
    }

    return data;
  } catch (rpcErr) {
    // If RPC failed, remove the uploaded file to avoid orphaned storage object
    await client.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
    throw new Error(rpcErr?.message || 'Failed to submit replacement proposal.');
  }
}

/**
 * Approves a pending replacement image proposal.
 * Atomically marks proposed version approved, archives original version,
 * updates logical image to point to the new version, and resets completion status to In Review.
 */
export async function approveImageReplacement({ versionId }) {
  if (!versionId) throw new Error('Version ID is required.');
  const client = getClientOrThrow();

  const { data, error } = await client.rpc('approve_image_replacement', {
    target_version_id: versionId,
  });

  if (error) {
    throw new Error(error.message || 'Failed to approve image replacement.');
  }

  return data;
}

/**
 * Rejects a pending replacement proposal with a mandatory rejection reason.
 * Preserves the original active version and notifies the uploader.
 */
export async function rejectImageReplacement({ versionId, rejectionReason }) {
  if (!versionId) throw new Error('Version ID is required.');
  const trimmedReason = (rejectionReason || '').trim();
  if (!trimmedReason) {
    throw new Error('A rejection reason is required explaining why the replacement was rejected.');
  }

  const client = getClientOrThrow();
  const { data, error } = await client.rpc('reject_image_replacement', {
    target_version_id: versionId,
    rejection_reason_text: trimmedReason,
  });

  if (error) {
    throw new Error(error.message || 'Failed to reject image replacement.');
  }

  return data;
}

/**
 * Reserves cancellation of a pending replacement proposal.
 * Sets cancellation_in_progress = true in the database under row lock,
 * preventing concurrent reviewers from approving or rejecting the proposal.
 */
export async function reserveImageReplacementCancellation({ versionId }) {
  if (!versionId) throw new Error('Version ID is required.');
  const client = getClientOrThrow();

  const { data, error } = await client.rpc('reserve_image_replacement_cancellation', {
    target_version_id: versionId,
  });

  if (error) {
    throw new Error(error.message || 'Failed to reserve replacement proposal cancellation.');
  }

  return data;
}

/**
 * Releases a cancellation reservation if storage removal fails,
 * restoring cancellation_in_progress = false.
 */
export async function releaseImageReplacementCancellation({ versionId }) {
  if (!versionId) throw new Error('Version ID is required.');
  const client = getClientOrThrow();

  const { data, error } = await client.rpc('release_image_replacement_cancellation', {
    target_version_id: versionId,
  });

  if (error) {
    throw new Error(error.message || 'Failed to release replacement proposal cancellation.');
  }

  return data;
}

/**
 * Cancels / withdraws a pending replacement proposal submitted by the uploader or batch owner.
 *
 * Implements the 3-step concurrency-safe cancellation workflow:
 * 1. Reserve: Calls reserve_image_replacement_cancellation RPC to lock rows and set
 *    cancellation_in_progress = true. This blocks concurrent reviewers from approving or rejecting.
 * 2. Delete Storage Object: Removes file from Supabase Storage while proposal is reserved.
 *    Storage DELETE policy framecheck_images_delete_pending_replacement requires
 *    cancellation_in_progress = true. If deletion fails, releases reservation.
 * 3. Finalize: Calls cancel_image_replacement RPC to clear pending_version_id on batch_images
 *    and delete the image_versions record.
 */
export async function cancelImageReplacement({ versionId }) {
  if (!versionId) throw new Error('Version ID is required.');
  const client = getClientOrThrow();

  // 1. Reserve cancellation under DB row lock
  const { data: reservedVersion, error: reserveErr } = await client.rpc(
    'reserve_image_replacement_cancellation',
    { target_version_id: versionId }
  );

  if (reserveErr) {
    throw new Error(
      reserveErr.message || 'Failed to reserve replacement proposal cancellation.'
    );
  }

  const storagePath = reservedVersion?.storage_path;

  // 2. Remove file from storage via Storage API while cancellation is reserved
  // (strictly permitted by framecheck_images_delete_pending_replacement because cancellation_in_progress is true)
  if (storagePath) {
    const { error: storageErr } = await client.storage
      .from(STORAGE_BUCKET)
      .remove([storagePath]);

    if (storageErr) {
      // If the file is already absent (e.g. retry after earlier failure), proceed cleanly
      const isAlreadyGone =
        storageErr.status === 404 ||
        storageErr.statusCode === '404' ||
        storageErr.message?.toLowerCase().includes('not found');

      if (!isAlreadyGone) {
        // Attempt to release reservation so the proposal remains actionable
        try {
          await client.rpc('release_image_replacement_cancellation', {
            target_version_id: versionId,
          });
        } catch {
          // If release fails, reservation remains in place to prevent unsafe review
        }

        throw new Error(
          `Failed to remove replacement file from storage: ${storageErr.message}. The proposal remains pending and cancellation can be retried.`
        );
      }
    }
  }

  // 3. Finalize cancellation atomically in the database
  const { data, error: rpcErr } = await client.rpc('cancel_image_replacement', {
    target_version_id: versionId,
  });

  if (rpcErr) {
    throw new Error(
      `Replacement file was removed from storage, but failed to finalize cancellation in database: ${rpcErr.message}. The proposal remains reserved and finalization can be safely retried.`
    );
  }

  return data;
}

/**
 * Subscribes to Realtime changes on image_versions for a batch.
 */
export function subscribeToBatchVersionEvents(batchId, onEvent) {
  if (!isSupabaseConfigured || !supabase || !batchId) {
    return () => {};
  }

  const channel = supabase
    .channel(`fc-batch-versions-${batchId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'image_versions',
        filter: `batch_id=eq.${batchId}`,
      },
      (payload) => {
        onEvent?.(payload);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
