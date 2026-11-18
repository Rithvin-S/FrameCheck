-- Phase 23: Image Versioning & Replacement Approval Workflow
-- Target: Supabase PostgreSQL (run after migrations 001 through 021)
-- Implements image versioning, replacement proposals, side-by-side comparison,
-- and reviewer approval/rejection while strictly preserving original images,
-- annotations, discussions, and review history.

BEGIN;

-- ============================================================================
-- 1. Image Versions Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.image_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL REFERENCES public.batch_images(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  file_size bigint NOT NULL,
  mime_type text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'pending_approval', 'approved', 'rejected')),
  cancellation_in_progress boolean NOT NULL DEFAULT false,
  correction_message text,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT image_versions_unique_image_version UNIQUE (image_id, version_number),
  CONSTRAINT image_versions_unique_storage_path UNIQUE (storage_path),
  CONSTRAINT image_versions_file_size_valid CHECK (file_size > 0),
  CONSTRAINT image_versions_mime_valid CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp'))
);

ALTER TABLE public.image_versions
  ADD COLUMN IF NOT EXISTS cancellation_in_progress boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_image_versions_batch_status
  ON public.image_versions (batch_id, status);

CREATE INDEX IF NOT EXISTS idx_image_versions_image_status
  ON public.image_versions (image_id, status);

CREATE INDEX IF NOT EXISTS idx_image_versions_uploaded_by
  ON public.image_versions (uploaded_by);

-- Enforce at most ONE pending replacement per logical image
CREATE UNIQUE INDEX IF NOT EXISTS idx_image_versions_unique_pending
  ON public.image_versions (image_id)
  WHERE status = 'pending_approval';

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
-- 2. Extend batch_images with Version Tracking Columns
-- ============================================================================

ALTER TABLE public.batch_images
  ADD COLUMN IF NOT EXISTS current_version_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS current_version_id uuid REFERENCES public.image_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replacement_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS pending_version_id uuid REFERENCES public.image_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_batch_images_current_version_id
  ON public.batch_images (current_version_id);

CREATE INDEX IF NOT EXISTS idx_batch_images_pending_version_id
  ON public.batch_images (pending_version_id);

CREATE INDEX IF NOT EXISTS idx_batch_images_replacement_status
  ON public.batch_images (replacement_status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.batch_images'::regclass
      AND conname = 'batch_images_replacement_status_valid'
  ) THEN
    ALTER TABLE public.batch_images
      ADD CONSTRAINT batch_images_replacement_status_valid
      CHECK (replacement_status IN ('none', 'pending_approval', 'approved', 'rejected'));
  END IF;
END;
$$;

-- Ensure authenticated users can only update is_completed on batch_images.
-- Direct client updates cannot modify version tracking or replacement columns.
REVOKE UPDATE ON public.batch_images FROM PUBLIC, anon, authenticated;
GRANT UPDATE (is_completed) ON public.batch_images TO authenticated;

-- ============================================================================
-- 3. Extend annotations with Version Association Columns
-- ============================================================================

ALTER TABLE public.annotations
  ADD COLUMN IF NOT EXISTS version_number integer,
  ADD COLUMN IF NOT EXISTS version_id uuid REFERENCES public.image_versions(id) ON DELETE SET NULL;

-- Remove default 1 if present so the BEFORE INSERT trigger can distinguish omitted vs supplied values,
-- and ensure new annotations reliably receive the active version.
ALTER TABLE public.annotations
  ALTER COLUMN version_number DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_annotations_image_version_active
  ON public.annotations (image_id, version_number, annotation_number ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_annotations_version_id
  ON public.annotations (version_id);

-- Update unique constraint on annotations so each version has clean #1, #2, #3 numbering
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.annotations'::regclass
      AND conname = 'annotations_unique_image_number'
  ) THEN
    ALTER TABLE public.annotations
      DROP CONSTRAINT annotations_unique_image_number;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.annotations'::regclass
      AND conname = 'annotations_unique_image_version_number'
  ) THEN
    ALTER TABLE public.annotations
      ADD CONSTRAINT annotations_unique_image_version_number
      UNIQUE (image_id, version_number, annotation_number);
  END IF;
END;
$$;

-- ============================================================================
-- 4. Backfill Existing Images as Version 1 (Original)
-- ============================================================================

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
  created_at,
  updated_at
)
SELECT
  bi.id,
  bi.batch_id,
  1,
  bi.storage_path,
  bi.original_filename,
  bi.file_size,
  bi.mime_type,
  b.owner_id,
  bi.created_at,
  'active',
  bi.created_at,
  bi.created_at
FROM public.batch_images bi
JOIN public.batches b ON b.id = bi.batch_id
ON CONFLICT (image_id, version_number) DO NOTHING;

-- Link current_version_id on batch_images
UPDATE public.batch_images bi
SET
  current_version_number = 1,
  current_version_id = iv.id,
  replacement_status = 'none'
FROM public.image_versions iv
WHERE iv.image_id = bi.id
  AND iv.version_number = 1
  AND bi.current_version_id IS NULL;

-- Link version_id on legacy annotations.
-- Temporarily disable trg_annotations_protect_columns for the legacy backfill so that both
-- active and soft-deleted annotations receive their historical version associations (version_number, version_id)
-- without violating the runtime protection against editing deleted annotations.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_annotations_protect_columns'
      AND tgrelid = 'public.annotations'::regclass
  ) THEN
    ALTER TABLE public.annotations DISABLE TRIGGER trg_annotations_protect_columns;
  END IF;
END $$;

UPDATE public.annotations a
SET
  version_number = 1,
  version_id = iv.id
FROM public.image_versions iv
WHERE iv.image_id = a.image_id
  AND iv.version_number = 1
  AND (a.version_id IS NULL OR a.version_number IS NULL);

-- Backfill any remaining null version_numbers on annotations to 1
UPDATE public.annotations
SET version_number = 1
WHERE version_number IS NULL;

-- Re-enable trg_annotations_protect_columns immediately after backfill completes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_annotations_protect_columns'
      AND tgrelid = 'public.annotations'::regclass
  ) THEN
    ALTER TABLE public.annotations ENABLE TRIGGER trg_annotations_protect_columns;
  END IF;
END $$;

-- Enforce NOT NULL on annotations.version_number after backfill completes
ALTER TABLE public.annotations
  ALTER COLUMN version_number SET NOT NULL;

-- ============================================================================
-- 5. Update Triggers for Annotation Insert & Batch Image Column Protection
-- ============================================================================

-- Allocate per-(image_id, version_number) monotonic annotation_number
CREATE OR REPLACE FUNCTION public.prepare_annotation_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next_number integer;
  v_now timestamptz := now();
  v_active_version_number integer;
  v_active_version_id uuid;
BEGIN
  -- Serialize number allocation per image across concurrent inserts
  PERFORM pg_advisory_xact_lock(
    hashtextextended(new.image_id::text, 0)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.batch_images AS bi
    WHERE bi.id = new.image_id
  ) THEN
    RAISE EXCEPTION 'Target batch image not found.'
      USING ERRCODE = '23503';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF new.created_by IS NULL THEN
      new.created_by := auth.uid();
    ELSIF new.created_by <> auth.uid() THEN
      RAISE EXCEPTION 'Annotation created_by must match the authenticated user.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1 & 2. Fail-Closed Active Version Resolution & Enforcement:
  -- Annotations can only be created against the currently active/approved image version.
  SELECT
    bi.current_version_number,
    bi.current_version_id
  INTO
    v_active_version_number,
    v_active_version_id
  FROM public.batch_images bi
  WHERE bi.id = new.image_id;

  -- Fail closed: active version must be configured on batch_images
  IF v_active_version_number IS NULL OR v_active_version_id IS NULL THEN
    RAISE EXCEPTION 'Active image version is not configured for this image.'
      USING ERRCODE = '22023';
  END IF;

  -- Fail closed: verify that the resolved active version exists, belongs to this image,
  -- has matching version number and version ID, and has status 'active' or 'approved'
  IF NOT EXISTS (
    SELECT 1
    FROM public.image_versions iv
    WHERE iv.id = v_active_version_id
      AND iv.image_id = new.image_id
      AND iv.version_number = v_active_version_number
      AND iv.status IN ('active', 'approved')
  ) THEN
    RAISE EXCEPTION 'Active image version is invalid or non-current for this image.'
      USING ERRCODE = '22023';
  END IF;

  -- Reject any explicitly supplied version_id that differs from the active version
  IF new.version_id IS NOT NULL AND new.version_id <> v_active_version_id THEN
    RAISE EXCEPTION 'Annotations can only be created against the currently active image version.'
      USING ERRCODE = '22023';
  END IF;

  -- Reject any explicitly supplied version_number that differs from the active version
  IF new.version_number IS NOT NULL AND new.version_number <> v_active_version_number THEN
    RAISE EXCEPTION 'Annotations can only be created against the currently active image version (Version %).', v_active_version_number
      USING ERRCODE = '22023';
  END IF;

  -- Authoritatively assign the verified active version
  new.version_number := v_active_version_number;
  new.version_id := v_active_version_id;

  -- Monotonic sequential number per (image_id, version_number)
  -- Annotation numbers must be unique within each version and never reused,
  -- including numbers belonging to soft-deleted annotations (NO deleted_at IS NULL).
  SELECT COALESCE(MAX(annotation_number), 0) + 1
  INTO v_next_number
  FROM public.annotations
  WHERE image_id = new.image_id
    AND version_number = new.version_number;

  new.annotation_number := v_next_number;
  new.created_at := v_now;
  new.updated_at := v_now;
  new.deleted_at := NULL;
  new.status := 'open';
  new.resolved_at := NULL;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_annotations_prepare_insert ON public.annotations;
CREATE TRIGGER trg_annotations_prepare_insert
  BEFORE INSERT ON public.annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.prepare_annotation_insert();

-- Protect batch_images columns while allowing atomic version transition
CREATE OR REPLACE FUNCTION public.protect_batch_image_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF new.id IS DISTINCT FROM old.id THEN
    RAISE EXCEPTION 'Image id cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.batch_id IS DISTINCT FROM old.batch_id THEN
    RAISE EXCEPTION 'Image batch_id cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.display_order IS DISTINCT FROM old.display_order THEN
    RAISE EXCEPTION 'Image display_order cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.created_at IS DISTINCT FROM old.created_at THEN
    RAISE EXCEPTION 'Image created_at cannot be modified.' USING ERRCODE = '42501';
  END IF;

  -- Fast path: if no versioning or storage columns are modified, allow completion status updates only
  IF new.replacement_status IS NOT DISTINCT FROM old.replacement_status
     AND new.pending_version_id IS NOT DISTINCT FROM old.pending_version_id
     AND new.current_version_id IS NOT DISTINCT FROM old.current_version_id
     AND new.current_version_number IS NOT DISTINCT FROM old.current_version_number
     AND new.storage_path IS NOT DISTINCT FROM old.storage_path
     AND new.original_filename IS NOT DISTINCT FROM old.original_filename
     AND new.mime_type IS NOT DISTINCT FROM old.mime_type
     AND new.file_size IS NOT DISTINCT FROM old.file_size
  THEN
    IF new.is_completed IS DISTINCT FROM old.is_completed THEN
      IF new.is_completed THEN
        new.completed_at := now();
        new.completed_by := auth.uid();
      ELSE
        new.completed_at := NULL;
        new.completed_by := NULL;
      END IF;
    ELSE
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    END IF;

    RETURN new;
  END IF;

  -- 2. State Transition & Version Metadata Protection
  -- Validate replacement_status transitions and ensure version pointers are consistent

  -- Case A: Transitioning to / maintaining 'pending_approval'
  IF new.replacement_status = 'pending_approval' THEN
    IF new.pending_version_id IS NULL THEN
      RAISE EXCEPTION 'pending_version_id cannot be null when replacement_status is pending_approval.'
        USING ERRCODE = '42501';
    END IF;

    -- Must reference a valid version belonging to this image with status pending_approval
    IF NOT EXISTS (
      SELECT 1
      FROM public.image_versions iv
      WHERE iv.id = new.pending_version_id
        AND iv.image_id = old.id
        AND iv.status = 'pending_approval'
    ) THEN
      RAISE EXCEPTION 'pending_version_id must reference a legitimate pending proposal for this image.'
        USING ERRCODE = '42501';
    END IF;

    -- Current active version pointers cannot change while proposing a replacement
    IF new.current_version_id IS DISTINCT FROM old.current_version_id
       OR new.current_version_number IS DISTINCT FROM old.current_version_number THEN
      RAISE EXCEPTION 'current_version cannot be modified while submitting a replacement proposal.'
        USING ERRCODE = '42501';
    END IF;

  -- Case B: Transitioning to / maintaining 'approved'
  ELSIF new.replacement_status = 'approved' THEN
    -- When approved, pending_version_id must be null
    IF new.pending_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'pending_version_id must be null when replacement_status is approved.'
        USING ERRCODE = '42501';
    END IF;

    -- Must correspond to a valid approved version and correct current-version pointer
    IF new.current_version_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.image_versions iv
      WHERE iv.id = new.current_version_id
        AND iv.image_id = old.id
        AND iv.version_number = new.current_version_number
        AND iv.status = 'approved'
        AND iv.storage_path = new.storage_path
        AND iv.original_filename = new.original_filename
        AND iv.file_size = new.file_size
        AND iv.mime_type = new.mime_type
    ) THEN
      RAISE EXCEPTION 'Approved status requires a matching approved version record and consistent version pointers.'
        USING ERRCODE = '42501';
    END IF;

    -- If this is a proposal cancellation returning to an already approved version (current_version_number > 1)
    IF old.pending_version_id IS NOT NULL
       AND new.current_version_id IS NOT DISTINCT FROM old.current_version_id THEN
      IF current_setting('framecheck.workflow_context', true) IS DISTINCT FROM 'cancel_image_replacement' THEN
        RAISE EXCEPTION 'Pending replacements can only be cancelled through the authorized cancellation workflow.'
          USING ERRCODE = '42501';
      END IF;

      -- Establish reliable authorization boundary: verify caller is proposal uploader, batch owner, or admin
      IF NOT EXISTS (
        SELECT 1
        FROM public.image_versions iv
        JOIN public.batches b ON b.id = iv.batch_id
        WHERE iv.id = old.pending_version_id
          AND iv.image_id = old.id
          AND iv.status = 'pending_approval'
          AND iv.cancellation_in_progress = true
          AND auth.uid() IS NOT NULL
          AND (
            iv.uploaded_by = auth.uid()
            OR b.owner_id = auth.uid()
            OR public.is_admin()
          )
      ) THEN
        RAISE EXCEPTION 'Unauthorized cancellation of replacement proposal.'
          USING ERRCODE = '42501';
      END IF;
    END IF;

  -- Case C: Transitioning to / maintaining 'rejected'
  ELSIF new.replacement_status = 'rejected' THEN
    IF new.pending_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'pending_version_id must be null when replacement_status is rejected.'
        USING ERRCODE = '42501';
    END IF;

    -- Must correspond to an actual rejected version for this image
    IF NOT EXISTS (
      SELECT 1
      FROM public.image_versions iv
      WHERE iv.image_id = old.id
        AND iv.status = 'rejected'
        AND (old.pending_version_id IS NULL OR iv.id = old.pending_version_id)
    ) THEN
      RAISE EXCEPTION 'rejected status requires an actual rejected version record for this image.'
        USING ERRCODE = '42501';
    END IF;

    -- Current active version pointers must not change on rejection
    IF new.current_version_id IS DISTINCT FROM old.current_version_id
       OR new.current_version_number IS DISTINCT FROM old.current_version_number THEN
      RAISE EXCEPTION 'current_version cannot be modified when rejecting a replacement.'
        USING ERRCODE = '42501';
    END IF;

  -- Case D: Transitioning to / maintaining 'none'
  ELSIF new.replacement_status = 'none' THEN
    IF new.pending_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'pending_version_id must be null when replacement_status is none.'
        USING ERRCODE = '42501';
    END IF;

    IF new.current_version_number <> 1 THEN
      RAISE EXCEPTION 'replacement_status cannot be none when current_version_number is greater than 1.'
        USING ERRCODE = '42501';
    END IF;

    -- A transition to none clearing a pending replacement (cancellation of initial replacement proposal)
    IF old.pending_version_id IS NOT NULL THEN
      IF current_setting('framecheck.workflow_context', true) IS DISTINCT FROM 'cancel_image_replacement' THEN
        RAISE EXCEPTION 'Pending replacements cannot be arbitrarily cleared to none.'
          USING ERRCODE = '42501';
      END IF;

      -- Establish reliable authorization boundary: verify caller is proposal uploader, batch owner, or admin
      IF NOT EXISTS (
        SELECT 1
        FROM public.image_versions iv
        JOIN public.batches b ON b.id = iv.batch_id
        WHERE iv.id = old.pending_version_id
          AND iv.image_id = old.id
          AND iv.status = 'pending_approval'
          AND iv.cancellation_in_progress = true
          AND auth.uid() IS NOT NULL
          AND (
            iv.uploaded_by = auth.uid()
            OR b.owner_id = auth.uid()
            OR public.is_admin()
          )
      ) THEN
        RAISE EXCEPTION 'Unauthorized cancellation of replacement proposal.'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    -- Current active version pointers must not change when in 'none'
    IF new.current_version_id IS DISTINCT FROM old.current_version_id
       OR new.current_version_number IS DISTINCT FROM old.current_version_number THEN
      RAISE EXCEPTION 'current_version cannot be modified directly.'
        USING ERRCODE = '42501';
    END IF;

  ELSE
    RAISE EXCEPTION 'Invalid replacement_status: %.', new.replacement_status USING ERRCODE = '42501';
  END IF;

  -- Allow storage properties to update ONLY when activating an approved version verified above
  IF (new.storage_path IS DISTINCT FROM old.storage_path
      OR new.original_filename IS DISTINCT FROM old.original_filename
      OR new.mime_type IS DISTINCT FROM old.mime_type
      OR new.file_size IS DISTINCT FROM old.file_size)
     AND (new.current_version_id IS NOT DISTINCT FROM old.current_version_id) THEN
    RAISE EXCEPTION 'Image storage properties cannot be modified without a new approved version.'
      USING ERRCODE = '42501';
  END IF;

  -- Preserve completion status functionality
  IF new.is_completed IS DISTINCT FROM old.is_completed THEN
    IF new.is_completed THEN
      new.completed_at := now();
      new.completed_by := auth.uid();
    ELSE
      new.completed_at := NULL;
      new.completed_by := NULL;
    END IF;
  ELSE
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_batch_images_protect_columns ON public.batch_images;
CREATE TRIGGER trg_batch_images_protect_columns
  BEFORE UPDATE ON public.batch_images
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_batch_image_columns();

-- ============================================================================
-- 6. Row Level Security on image_versions & Storage DELETE Policy
-- ============================================================================

ALTER TABLE public.image_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.image_versions FROM anon, authenticated;
GRANT SELECT ON public.image_versions TO authenticated;

DROP POLICY IF EXISTS image_versions_select_authorized ON public.image_versions;
CREATE POLICY image_versions_select_authorized
  ON public.image_versions
  FOR SELECT
  TO authenticated
  USING (public.can_view_batch_image(image_id));

-- Storage DELETE policy: strictly restricted to pending replacement image proposals.
-- Original, approved, and archived images CANNOT be deleted under this policy.
-- Only the proposal author, batch owner, or an Admin can delete a pending proposal file.
DROP POLICY IF EXISTS framecheck_images_delete_owner_or_admin ON storage.objects;
DROP POLICY IF EXISTS framecheck_images_delete_pending_replacement ON storage.objects;

CREATE POLICY framecheck_images_delete_pending_replacement
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'framecheck-images'
    AND EXISTS (
      SELECT 1
      FROM public.image_versions iv
      JOIN public.batches b ON b.id = iv.batch_id
      JOIN public.batch_images bi ON bi.id = iv.image_id
      WHERE iv.storage_path = storage.objects.name
        AND iv.status = 'pending_approval'
        AND iv.cancellation_in_progress = true
        AND bi.pending_version_id = iv.id
        AND (
          iv.uploaded_by = auth.uid()
          OR b.owner_id = auth.uid()
          OR public.is_admin()
        )
    )
  );

-- ============================================================================
-- 7. RPC: submit_image_replacement
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
-- 8. RPC: approve_image_replacement
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
-- 9. RPC: reject_image_replacement
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
-- 10. RPCs: Cancellation Reservation, Release, and Finalization
-- ============================================================================

-- RPC 10A: Reserve cancellation: sets cancellation_in_progress = true under row lock.
-- Blocks reviewers from concurrently approving or rejecting while the file is deleted from Storage.
CREATE OR REPLACE FUNCTION public.reserve_image_replacement_cancellation(
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
    RAISE EXCEPTION 'Only pending proposals can be cancelled (current status: %).', v_version.status
      USING ERRCODE = '22023';
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

  IF v_image.pending_version_id IS DISTINCT FROM target_version_id
     OR v_image.replacement_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'This version proposal is no longer the active pending replacement for this image.'
      USING ERRCODE = '23505';
  END IF;

  -- If already reserved by this authorized caller, safe to return existing reservation
  IF v_version.cancellation_in_progress THEN
    RETURN v_version;
  END IF;

  -- Set cancellation_in_progress
  UPDATE public.image_versions
  SET
    cancellation_in_progress = true,
    updated_at = now()
  WHERE id = target_version_id
  RETURNING * INTO v_version;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_image_replacement_cancellation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_image_replacement_cancellation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reserve_image_replacement_cancellation(uuid) TO authenticated;

-- RPC 10B: Release cancellation reservation: clears cancellation_in_progress if Storage deletion fails.
CREATE OR REPLACE FUNCTION public.release_image_replacement_cancellation(
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
    RAISE EXCEPTION 'Only pending proposals can have cancellation released.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_batch
  FROM public.batches
  WHERE id = v_version.batch_id;

  IF NOT (v_version.uploaded_by = v_caller_id OR v_batch.owner_id = v_caller_id OR public.is_admin()) THEN
    RAISE EXCEPTION 'Only the proposal author, batch owner, or an Admin can release cancellation.'
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

  IF v_image.pending_version_id IS DISTINCT FROM target_version_id
     OR v_image.replacement_status <> 'pending_approval' THEN
    RAISE EXCEPTION 'This version proposal is no longer the active pending replacement for this image.'
      USING ERRCODE = '23505';
  END IF;

  -- If not reserved, return current record
  IF NOT v_version.cancellation_in_progress THEN
    RETURN v_version;
  END IF;

  -- Release cancellation reservation
  UPDATE public.image_versions
  SET
    cancellation_in_progress = false,
    updated_at = now()
  WHERE id = target_version_id
  RETURNING * INTO v_version;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.release_image_replacement_cancellation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_image_replacement_cancellation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.release_image_replacement_cancellation(uuid) TO authenticated;

-- RPC 10C: Finalize cancellation: clears pending version from batch_images and deletes image_versions record.
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

-- ============================================================================
-- 11. Realtime Publication for image_versions
-- ============================================================================

ALTER TABLE public.image_versions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'image_versions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.image_versions;
    END IF;
  END IF;
END $$;

COMMIT;
