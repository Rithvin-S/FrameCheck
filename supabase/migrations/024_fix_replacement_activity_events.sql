-- Phase 23: Fix batch_activity_events schema alignment for image replacements
-- Migration 024: Forward-fix following Migration 022 and 023
-- Fixes: Corrects column 'user_id' -> 'actor_id', populates 'image_id',
-- stores structured JSON in 'metadata', places human-readable summary in 'details',
-- and extends batch_activity_events_event_type_check to support replacement event types.

BEGIN;

-- ============================================================================
-- 1. Extend batch_activity_events CHECK constraint for image replacements
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'batch_activity_events'
  ) THEN
    ALTER TABLE public.batch_activity_events
      DROP CONSTRAINT IF EXISTS batch_activity_events_event_type_check;

    ALTER TABLE public.batch_activity_events
      ADD CONSTRAINT batch_activity_events_event_type_check CHECK (
        event_type IN (
          'annotation_created',
          'annotation_geometry_edited',
          'annotation_resolved',
          'annotation_reopened',
          'annotation_deleted',
          'annotation_updated',
          'annotation_assigned',
          'reviewer_handoff',
          'checklist_item_completed',
          'checklist_item_reopened',
          'comment_added',
          'comment_mention',
          'whiteboard_created',
          'whiteboard_updated',
          'image_completed',
          'batch_review_completed',
          'replacement_submitted',
          'replacement_approved',
          'replacement_rejected',
          'replacement_cancelled'
        )
      );
  END IF;
END $$;

-- ============================================================================
-- 2. Update RPC: submit_image_replacement
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_image_replacement(
  target_image_id uuid,
  new_storage_path text,
  new_original_filename text,
  new_file_size bigint,
  new_mime_type text,
  correction_msg text DEFAULT NULL
)
RETURNS public.image_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_image public.batch_images%ROWTYPE;
  v_batch public.batches%ROWTYPE;
  v_caller_id uuid;
  v_next_version integer;
  v_new_version public.image_versions%ROWTYPE;
  v_reviewer record;
  v_storage_obj record;
  v_actual_size bigint;
  v_actual_mime text;
  v_path_ext text;
  v_filename_ext text;
  v_trimmed_filename text;
  v_trimmed_msg text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 3. Storage & Parameter Validation:
  -- Validate maximum 1,000-character correction message
  v_trimmed_msg := NULLIF(btrim(COALESCE(correction_msg, '')), '');
  IF v_trimmed_msg IS NOT NULL AND char_length(v_trimmed_msg) > 1000 THEN
    RAISE EXCEPTION 'Correction message cannot exceed 1,000 characters.' USING ERRCODE = '22023';
  END IF;

  -- Validate original filename
  v_trimmed_filename := btrim(COALESCE(new_original_filename, ''));
  IF char_length(v_trimmed_filename) < 1 OR char_length(v_trimmed_filename) > 255 THEN
    RAISE EXCEPTION 'Original filename must be between 1 and 255 characters.' USING ERRCODE = '22023';
  END IF;

  -- Validate filename extension
  v_filename_ext := lower(substring(v_trimmed_filename from '\.([a-zA-Z0-9]+)$'));
  IF v_filename_ext IS NULL OR v_filename_ext NOT IN ('jpg', 'jpeg', 'png', 'webp') THEN
    RAISE EXCEPTION 'Invalid filename extension: %. Supported extensions are .jpg, .jpeg, .png, and .webp.',
      COALESCE(v_filename_ext, 'none') USING ERRCODE = '22023';
  END IF;

  -- Validate supported image MIME types
  IF new_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
    RAISE EXCEPTION 'Unsupported image format: %. Supported formats are JPEG, PNG, and WebP.', new_mime_type
      USING ERRCODE = '22023';
  END IF;

  -- Validate existing 50 MB file size limit (52,428,800 bytes)
  IF new_file_size IS NULL OR new_file_size <= 0 OR new_file_size > 52428800 THEN
    RAISE EXCEPTION 'Image file size must be between 1 byte and 50 MB (52,428,800 bytes).' USING ERRCODE = '22023';
  END IF;

  -- Verify target image exists and lock it
  SELECT * INTO v_image
  FROM public.batch_images
  WHERE id = target_image_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target image not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Verify batch ownership or admin authority
  SELECT * INTO v_batch
  FROM public.batches
  WHERE id = v_image.batch_id;

  IF NOT (v_batch.owner_id = v_caller_id OR public.is_admin()) THEN
    RAISE EXCEPTION 'Only batch owners and admins can submit image replacements.' USING ERRCODE = '42501';
  END IF;

  -- Validate storage path structure: {owner_id}/{batch_id}/{image_uuid}.{ext}
  IF new_storage_path IS NULL
     OR new_storage_path !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpg|jpeg|png|webp)$'
  THEN
    RAISE EXCEPTION 'Invalid image storage path structure.' USING ERRCODE = '22023';
  END IF;

  -- Extract storage path extension
  v_path_ext := lower(substring(new_storage_path from '\.([a-zA-Z0-9]+)$'));
  IF v_path_ext NOT IN ('jpg', 'jpeg', 'png', 'webp') THEN
    RAISE EXCEPTION 'Invalid storage path extension: %. Supported extensions are .jpg, .jpeg, .png, and .webp.',
      COALESCE(v_path_ext, 'none') USING ERRCODE = '22023';
  END IF;

  -- Ensure storage path matches batch and owner ownership
  IF split_part(new_storage_path, '/', 1) <> v_batch.owner_id::text
     OR split_part(new_storage_path, '/', 2) <> v_batch.id::text
  THEN
    RAISE EXCEPTION 'Image storage path does not match batch ownership.' USING ERRCODE = '42501';
  END IF;

  -- Validate that this storage path is not already registered to an existing version or image
  IF EXISTS (
    SELECT 1 FROM public.image_versions WHERE storage_path = new_storage_path
  ) THEN
    RAISE EXCEPTION 'The specified storage path is already in use by another image version.'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.batch_images WHERE storage_path = new_storage_path
  ) THEN
    RAISE EXCEPTION 'The specified storage path is already in use by another image.'
      USING ERRCODE = '23505';
  END IF;

  -- Validate existence of the uploaded object and inspect actual storage metadata
  SELECT id, owner, metadata
  INTO v_storage_obj
  FROM storage.objects
  WHERE bucket_id = 'framecheck-images'
    AND name = new_storage_path;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Uploaded image object not found in storage bucket.' USING ERRCODE = '23503';
  END IF;

  -- Verify storage object owner matches caller or admin if recorded
  IF v_storage_obj.owner IS NOT NULL
     AND v_storage_obj.owner::text <> v_caller_id::text
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Storage object owner does not match authenticated user.' USING ERRCODE = '42501';
  END IF;

  -- 5. Validate actual Storage metadata:
  -- Require metadata jsonb to exist
  IF v_storage_obj.metadata IS NULL THEN
    RAISE EXCEPTION 'Storage object metadata is missing.' USING ERRCODE = '22023';
  END IF;

  -- Require size metadata key to exist
  IF NOT (v_storage_obj.metadata ? 'size') OR (v_storage_obj.metadata ->> 'size') IS NULL THEN
    RAISE EXCEPTION 'Storage object size metadata is missing.' USING ERRCODE = '22023';
  END IF;

  v_actual_size := (v_storage_obj.metadata ->> 'size')::bigint;
  IF v_actual_size IS NULL OR v_actual_size <= 0 THEN
    RAISE EXCEPTION 'Invalid storage object size metadata.' USING ERRCODE = '22023';
  END IF;

  IF v_actual_size > 52428800 THEN
    RAISE EXCEPTION 'Uploaded image file exceeds the 50 MB limit.' USING ERRCODE = '22023';
  END IF;

  IF v_actual_size IS DISTINCT FROM new_file_size THEN
    RAISE EXCEPTION 'Submitted file size (%) does not match actual storage object size (%).',
      new_file_size, v_actual_size USING ERRCODE = '22023';
  END IF;

  -- Require mimetype metadata key to exist
  IF NOT (v_storage_obj.metadata ? 'mimetype') OR (v_storage_obj.metadata ->> 'mimetype') IS NULL THEN
    RAISE EXCEPTION 'Storage object MIME type metadata is missing.' USING ERRCODE = '22023';
  END IF;

  v_actual_mime := lower(btrim(v_storage_obj.metadata ->> 'mimetype'));
  IF v_actual_mime NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
    RAISE EXCEPTION 'Unsupported image format in storage object: %. Supported formats are JPEG, PNG, and WebP.',
      v_actual_mime USING ERRCODE = '22023';
  END IF;

  IF v_actual_mime IS DISTINCT FROM lower(btrim(new_mime_type)) THEN
    RAISE EXCEPTION 'Submitted MIME type (%) does not match actual storage object MIME type (%).',
      new_mime_type, v_actual_mime USING ERRCODE = '22023';
  END IF;

  -- Enforce exact MIME type against storage path extension:
  -- .jpg / .jpeg -> image/jpeg, .png -> image/png, .webp -> image/webp
  IF (v_actual_mime = 'image/jpeg' AND v_path_ext NOT IN ('jpg', 'jpeg'))
     OR (v_actual_mime = 'image/png' AND v_path_ext <> 'png')
     OR (v_actual_mime = 'image/webp' AND v_path_ext <> 'webp') THEN
    RAISE EXCEPTION 'Storage path extension (.%) does not match image MIME type (%).',
      v_path_ext, v_actual_mime USING ERRCODE = '22023';
  END IF;

  -- Enforce exact MIME type against original filename extension
  IF (v_actual_mime = 'image/jpeg' AND v_filename_ext NOT IN ('jpg', 'jpeg'))
     OR (v_actual_mime = 'image/png' AND v_filename_ext <> 'png')
     OR (v_actual_mime = 'image/webp' AND v_filename_ext <> 'webp') THEN
    RAISE EXCEPTION 'Filename extension (.%) does not match image MIME type (%).',
      v_filename_ext, v_actual_mime USING ERRCODE = '22023';
  END IF;

  -- Prevent duplicate pending replacements
  IF v_image.replacement_status = 'pending_approval' THEN
    RAISE EXCEPTION 'A replacement proposal is already pending approval for this image. Please wait for reviewer decision or cancel it.' USING ERRCODE = '23505';
  END IF;

  -- Determine next version number
  SELECT COALESCE(MAX(version_number), 1) + 1
  INTO v_next_version
  FROM public.image_versions
  WHERE image_id = target_image_id;

  -- Insert proposed replacement version safely with concurrency protection
  BEGIN
    INSERT INTO public.image_versions (
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
      updated_at
    )
    VALUES (
      target_image_id,
      v_image.batch_id,
      v_next_version,
      new_storage_path,
      v_trimmed_filename,
      v_actual_size,
      v_actual_mime,
      v_caller_id,
      now(),
      'pending_approval',
      v_trimmed_msg,
      now(),
      now()
    )
    RETURNING * INTO v_new_version;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'The specified storage path is already in use by another image version.'
      USING ERRCODE = '23505';
  END;

  -- Update logical batch_image state
  UPDATE public.batch_images
  SET
    replacement_status = 'pending_approval',
    pending_version_id = v_new_version.id
  WHERE id = target_image_id;

  -- 4. Replacement Notifications:
  -- Per FrameCheck_SRS.docx Section 3.2:
  -- "All users with the Reviewer role can view all batches; batch assignment is not required."
  -- and FR-012: "Reviewers shall be able to view all batches."
  -- Therefore, all users with role 'reviewer' or 'admin' are authorized to review this batch.
  -- Notify all authorized reviewers and admins, excluding the submitting uploader.
  -- Duplicate notifications are prevented via DISTINCT.
  FOR v_reviewer IN
    SELECT DISTINCT p.id
    FROM public.profiles p
    WHERE p.id <> v_caller_id
      AND p.role IN ('reviewer', 'admin')
  LOOP
    INSERT INTO public.notifications (
      recipient_id,
      actor_id,
      type,
      title,
      message,
      batch_id,
      image_id,
      data
    )
    VALUES (
      v_reviewer.id,
      v_caller_id,
      'status_change',
      'Image Replacement Pending Approval',
      format('Replacement proposed for Image #%s in batch "%s"%s',
        v_image.display_order,
        v_batch.name,
        CASE WHEN v_trimmed_msg IS NOT NULL
          THEN format(': "%s"', left(v_trimmed_msg, 60))
          ELSE '.'
        END
      ),
      v_batch.id,
      v_image.id,
      jsonb_build_object(
        'event', 'replacement_submitted',
        'versionId', v_new_version.id,
        'versionNumber', v_next_version,
        'imageOrder', v_image.display_order,
        'batchName', v_batch.name
      )
    );
  END LOOP;

  -- Record batch activity event if table exists
  BEGIN
    INSERT INTO public.batch_activity_events (
      batch_id,
      actor_id,
      image_id,
      event_type,
      details,
      metadata
    )
    VALUES (
      v_batch.id,
      v_caller_id,
      v_image.id,
      'replacement_submitted',
      format('Replacement proposed for Image #%s (%s)', v_image.display_order, v_trimmed_filename),
      jsonb_build_object(
        'imageId', v_image.id,
        'versionNumber', v_next_version,
        'originalFilename', v_trimmed_filename,
        'correctionMessage', v_trimmed_msg
      )
    );
  EXCEPTION WHEN undefined_table THEN
    -- Table does not exist; proceed smoothly
  END;

  RETURN v_new_version;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_image_replacement(uuid, text, text, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_image_replacement(uuid, text, text, bigint, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_image_replacement(uuid, text, text, bigint, text, text) TO authenticated;

-- ============================================================================
-- 3. Update RPC: approve_image_replacement
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_image_replacement(
  target_version_id uuid
)
RETURNS public.image_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version public.image_versions%ROWTYPE;
  v_image public.batch_images%ROWTYPE;
  v_batch public.batches%ROWTYPE;
  v_caller_id uuid;
  v_approver_name text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- Lock version row FOR UPDATE to handle simultaneous decisions
  SELECT * INTO v_version
  FROM public.image_versions
  WHERE id = target_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Image version not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_version.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'This replacement proposal has already been decided (% status).', v_version.status
      USING ERRCODE = '23505';
  END IF;

  IF v_version.cancellation_in_progress THEN
    RAISE EXCEPTION 'This replacement proposal is currently being cancelled.'
      USING ERRCODE = '23505';
  END IF;

  -- Enforce reviewer authorization
  IF NOT (public.is_reviewer_or_admin() AND public.can_review_batch_image(v_version.image_id)) THEN
    RAISE EXCEPTION 'Only authorized reviewers or admins can approve image replacements.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_image
  FROM public.batch_images
  WHERE id = v_version.image_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated batch image not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 6. Approval & Rejection Consistency:
  -- Verify proposed version is still the pending version associated with the logical image
  IF v_image.pending_version_id IS DISTINCT FROM target_version_id
     OR v_image.replacement_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'This version proposal is no longer the active pending replacement for this image.'
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_batch
  FROM public.batches
  WHERE id = v_version.batch_id;

  SELECT COALESCE(NULLIF(trim(display_name), ''), 'A reviewer')
  INTO v_approver_name
  FROM public.profiles
  WHERE id = v_caller_id;

  -- 1. Archive previously active version(s)
  UPDATE public.image_versions
  SET
    status = 'archived',
    updated_at = now()
  WHERE image_id = v_version.image_id
    AND status IN ('active', 'approved')
    AND id <> target_version_id;

  -- 2. Mark target version as approved
  UPDATE public.image_versions
  SET
    status = 'approved',
    reviewed_by = v_caller_id,
    reviewed_at = now(),
    updated_at = now()
  WHERE id = target_version_id
  RETURNING * INTO v_version;

  -- 3. Update logical batch image to point to the newly approved version
  --    and set review status to In Review (is_completed = false)
  UPDATE public.batch_images
  SET
    storage_path = v_version.storage_path,
    original_filename = v_version.original_filename,
    file_size = v_version.file_size,
    mime_type = v_version.mime_type,
    current_version_number = v_version.version_number,
    current_version_id = v_version.id,
    replacement_status = 'approved',
    pending_version_id = NULL,
    is_completed = false,
    completed_at = NULL,
    completed_by = NULL
  WHERE id = v_version.image_id;

  -- 4. Notify uploader of approval
  IF v_version.uploaded_by <> v_caller_id THEN
    INSERT INTO public.notifications (
      recipient_id,
      actor_id,
      type,
      title,
      message,
      batch_id,
      image_id,
      data
    )
    VALUES (
      v_version.uploaded_by,
      v_caller_id,
      'status_change',
      'Replacement Approved',
      format('%s approved your replacement (Version %s) for Image #%s in batch "%s".',
        v_approver_name,
        v_version.version_number,
        v_image.display_order,
        v_batch.name
      ),
      v_batch.id,
      v_image.id,
      jsonb_build_object(
        'event', 'replacement_approved',
        'versionId', v_version.id,
        'versionNumber', v_version.version_number,
        'imageOrder', v_image.display_order
      )
    );
  END IF;

  -- 5. Record activity feed event
  BEGIN
    INSERT INTO public.batch_activity_events (
      batch_id,
      actor_id,
      image_id,
      event_type,
      details,
      metadata
    )
    VALUES (
      v_batch.id,
      v_caller_id,
      v_image.id,
      'replacement_approved',
      format('Approved replacement Version %s for Image #%s', v_version.version_number, v_image.display_order),
      jsonb_build_object(
        'imageId', v_image.id,
        'versionNumber', v_version.version_number,
        'originalFilename', v_version.original_filename
      )
    );
  EXCEPTION WHEN undefined_table THEN
    -- Fallback safely
  END;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_image_replacement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_image_replacement(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_image_replacement(uuid) TO authenticated;

-- ============================================================================
-- 4. Update RPC: reject_image_replacement
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reject_image_replacement(
  target_version_id uuid,
  rejection_reason_text text
)
RETURNS public.image_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version public.image_versions%ROWTYPE;
  v_image public.batch_images%ROWTYPE;
  v_batch public.batches%ROWTYPE;
  v_caller_id uuid;
  v_reviewer_name text;
  v_trimmed_reason text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  v_trimmed_reason := btrim(COALESCE(rejection_reason_text, ''));
  IF length(v_trimmed_reason) = 0 THEN
    RAISE EXCEPTION 'A rejection reason is required when rejecting a replacement.' USING ERRCODE = '22023';
  END IF;

  -- Lock version row FOR UPDATE
  SELECT * INTO v_version
  FROM public.image_versions
  WHERE id = target_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Image version not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_version.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'This replacement proposal has already been decided (% status).', v_version.status
      USING ERRCODE = '23505';
  END IF;

  IF v_version.cancellation_in_progress THEN
    RAISE EXCEPTION 'This replacement proposal is currently being cancelled.'
      USING ERRCODE = '23505';
  END IF;

  -- Enforce reviewer authorization
  IF NOT (public.is_reviewer_or_admin() AND public.can_review_batch_image(v_version.image_id)) THEN
    RAISE EXCEPTION 'Only authorized reviewers or admins can reject image replacements.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_image
  FROM public.batch_images
  WHERE id = v_version.image_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated batch image not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 6. Approval & Rejection Consistency:
  -- Verify proposed version is still the pending version associated with the logical image
  IF v_image.pending_version_id IS DISTINCT FROM target_version_id
     OR v_image.replacement_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'This version proposal is no longer the active pending replacement for this image.'
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_batch
  FROM public.batches
  WHERE id = v_version.batch_id;

  SELECT COALESCE(NULLIF(trim(display_name), ''), 'A reviewer')
  INTO v_reviewer_name
  FROM public.profiles
  WHERE id = v_caller_id;

  -- 1. Mark target version as rejected
  UPDATE public.image_versions
  SET
    status = 'rejected',
    reviewed_by = v_caller_id,
    reviewed_at = now(),
    rejection_reason = v_trimmed_reason,
    updated_at = now()
  WHERE id = target_version_id
  RETURNING * INTO v_version;

  -- 2. Update batch_images to reflect rejected status while keeping original image active
  UPDATE public.batch_images
  SET
    replacement_status = 'rejected',
    pending_version_id = NULL
  WHERE id = v_version.image_id;

  -- 3. Notify uploader with rejection reason
  IF v_version.uploaded_by <> v_caller_id THEN
    INSERT INTO public.notifications (
      recipient_id,
      actor_id,
      type,
      title,
      message,
      batch_id,
      image_id,
      data
    )
    VALUES (
      v_version.uploaded_by,
      v_caller_id,
      'status_change',
      'Replacement Rejected',
      format('%s rejected replacement (Version %s) for Image #%s: "%s"',
        v_reviewer_name,
        v_version.version_number,
        v_image.display_order,
        left(v_trimmed_reason, 120)
      ),
      v_batch.id,
      v_image.id,
      jsonb_build_object(
        'event', 'replacement_rejected',
        'versionId', v_version.id,
        'versionNumber', v_version.version_number,
        'imageOrder', v_image.display_order,
        'rejectionReason', v_trimmed_reason
      )
    );
  END IF;

  -- 4. Record activity feed event
  BEGIN
    INSERT INTO public.batch_activity_events (
      batch_id,
      actor_id,
      image_id,
      event_type,
      details,
      metadata
    )
    VALUES (
      v_batch.id,
      v_caller_id,
      v_image.id,
      'replacement_rejected',
      format('Rejected replacement for Image #%s: %s', v_image.display_order, v_trimmed_reason),
      jsonb_build_object(
        'imageId', v_image.id,
        'versionNumber', v_version.version_number,
        'originalFilename', v_version.original_filename,
        'rejectionReason', v_trimmed_reason
      )
    );
  EXCEPTION WHEN undefined_table THEN
    -- Fallback safely
  END;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_image_replacement(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_image_replacement(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_image_replacement(uuid, text) TO authenticated;

-- ============================================================================
-- 5. Update RPC: cancel_image_replacement
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_image_replacement(
  target_version_id uuid
)
RETURNS public.image_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_version public.image_versions%ROWTYPE;
  v_image public.batch_images%ROWTYPE;
  v_batch public.batches%ROWTYPE;
  v_caller_id uuid;
  v_prev_status text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- Lock version row FOR UPDATE
  SELECT * INTO v_version
  FROM public.image_versions
  WHERE id = target_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Image version not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_version.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Only pending proposals can be cancelled.' USING ERRCODE = '22023';
  END IF;

  -- Enforce cancellation reservation before finalization
  IF NOT v_version.cancellation_in_progress THEN
    RAISE EXCEPTION 'Replacement cancellation must be reserved before finalization.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_batch
  FROM public.batches
  WHERE id = v_version.batch_id;

  IF NOT (v_version.uploaded_by = v_caller_id OR v_batch.owner_id = v_caller_id OR public.is_admin()) THEN
    RAISE EXCEPTION 'Only the proposal author, batch owner, or an Admin can cancel this replacement proposal.'
      USING ERRCODE = '42501';
  END IF;

  -- Lock associated batch image FOR UPDATE
  SELECT * INTO v_image
  FROM public.batch_images
  WHERE id = v_version.image_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated batch image not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Verify proposal is still the pending version on the image
  IF v_image.pending_version_id IS DISTINCT FROM target_version_id
     OR v_image.replacement_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'This version proposal is no longer the active pending replacement for this image.'
      USING ERRCODE = '23505';
  END IF;

  -- Determine previous replacement status:
  -- If current_version_number > 1, the image has an existing approved version; otherwise 'none'
  v_prev_status := CASE
    WHEN v_image.current_version_number > 1 THEN 'approved'
    ELSE 'none'
  END;

  -- Set transaction-local workflow context for column protection trigger
  PERFORM set_config('framecheck.workflow_context', 'cancel_image_replacement', true);

  -- Update batch_images FIRST to clear pending_version_id and reset replacement_status,
  -- within the same transaction, before deleting the pending version record.
  UPDATE public.batch_images
  SET
    replacement_status = v_prev_status,
    pending_version_id = NULL
  WHERE id = v_version.image_id;

  -- Delete the pending image_versions record
  DELETE FROM public.image_versions
  WHERE id = target_version_id;

  -- Record batch activity event
  BEGIN
    INSERT INTO public.batch_activity_events (
      batch_id,
      actor_id,
      image_id,
      event_type,
      details,
      metadata
    )
    VALUES (
      v_batch.id,
      v_caller_id,
      v_image.id,
      'replacement_cancelled',
      format('Cancelled replacement proposal for Image #%s', v_image.display_order),
      jsonb_build_object(
        'imageId', v_image.id,
        'versionNumber', v_version.version_number,
        'originalFilename', v_version.original_filename
      )
    );
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_image_replacement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_image_replacement(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_image_replacement(uuid) TO authenticated;

COMMIT;
