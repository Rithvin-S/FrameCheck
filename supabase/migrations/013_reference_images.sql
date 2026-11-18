-- Phase 18A: Reference Image Database, Private Storage, and Permission Foundation
-- Target: Supabase PostgreSQL (run after migrations 001 through 012)
-- Establishes dedicated private reference image storage, reference_images schema,
-- comprehensive Row Level Security (RLS), ownership enforcement, cross-image protection triggers,
-- and Supabase Realtime synchronization.

BEGIN;

-- ============================================================================
-- 1. Dedicated Private Supabase Storage Bucket
-- ============================================================================

-- Ensure the dedicated private bucket exists for reference images.
-- Reference images must NEVER be public; access is strictly authenticated & authorized.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'framecheck-reference-images',
  'framecheck-reference-images',
  false,
  52428800, -- 50 MB per file, matching framecheck-images standard
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================================
-- 2. Reference Images Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reference_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL,
  annotation_id uuid,
  created_by uuid NOT NULL,
  original_filename text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reference_images_image_id_fkey
    FOREIGN KEY (image_id) REFERENCES public.batch_images (id) ON DELETE CASCADE,
  CONSTRAINT reference_images_annotation_id_fkey
    FOREIGN KEY (annotation_id) REFERENCES public.annotations (id) ON DELETE CASCADE,
  CONSTRAINT reference_images_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT reference_images_filename_valid
    CHECK (char_length(btrim(original_filename)) BETWEEN 1 AND 255),
  CONSTRAINT reference_images_storage_path_valid
    CHECK (char_length(btrim(storage_path)) > 0),
  CONSTRAINT reference_images_mime_valid
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT reference_images_file_size_valid
    CHECK (file_size > 0 AND file_size <= 52428800),
  CONSTRAINT reference_images_comment_valid
    CHECK (char_length(comment) <= 2000)
);

-- Indexes for efficient querying by image, annotation, creator, and storage path
CREATE INDEX IF NOT EXISTS idx_reference_images_image_id
  ON public.reference_images (image_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_reference_images_annotation_id
  ON public.reference_images (annotation_id)
  WHERE annotation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reference_images_created_by
  ON public.reference_images (created_by);

CREATE INDEX IF NOT EXISTS idx_reference_images_storage_path
  ON public.reference_images (storage_path);

-- ============================================================================
-- 3. Validation and Integrity Triggers
-- ============================================================================

-- Enforce strict cross-image integrity, valid hierarchy, and data hygiene on insert/update
CREATE OR REPLACE FUNCTION public.validate_reference_image_record()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_annotation_image_id uuid;
  v_annotation_deleted_at timestamptz;
  v_batch_id uuid;
  v_path_parts text[];
  v_path_batch_id uuid;
  v_path_image_id uuid;
  v_filename text;
  v_ext text;
BEGIN
  -- 1. Ensure target batch image exists and get its batch_id
  SELECT bi.batch_id
  INTO v_batch_id
  FROM public.batch_images AS bi
  WHERE bi.id = NEW.image_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referenced batch image % does not exist.', NEW.image_id
      USING ERRCODE = '23503';
  END IF;

  -- 2. Validate storage_path structure: must have exactly two folder levels ({batch_id}/{image_id}/{filename})
  IF NEW.storage_path IS NULL THEN
    RAISE EXCEPTION 'Reference image storage_path cannot be null.'
      USING ERRCODE = '22023';
  END IF;

  v_path_parts := string_to_array(NEW.storage_path, '/');
  IF coalesce(array_length(v_path_parts, 1), 0) <> 3 THEN
    RAISE EXCEPTION 'Reference image storage_path must have exactly two folder levels ({batch_id}/{image_id}/{filename}).'
      USING ERRCODE = '22023';
  END IF;

  -- Validate batch and image UUIDs in the path
  BEGIN
    v_path_batch_id := v_path_parts[1]::uuid;
    v_path_image_id := v_path_parts[2]::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Reference image storage_path contains invalid batch or image UUID.'
      USING ERRCODE = '22023';
  END;

  -- Enforce that storage_path batch_id and image_id match the actual database records
  IF v_path_image_id <> NEW.image_id THEN
    RAISE EXCEPTION 'Storage path image_id (%) does not match record image_id (%).',
      v_path_image_id, NEW.image_id
      USING ERRCODE = '22023';
  END IF;

  IF v_path_batch_id <> v_batch_id THEN
    RAISE EXCEPTION 'Storage path batch_id (%) does not match actual image batch_id (%).',
      v_path_batch_id, v_batch_id
      USING ERRCODE = '22023';
  END IF;

  -- Validate filename format: strictly a UUID with supported image extension
  v_filename := v_path_parts[3];
  IF v_filename IS NULL
     OR v_filename !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpg|jpeg|png|webp)$'
  THEN
    RAISE EXCEPTION 'Storage path filename must be a valid UUID with a supported image extension (.jpg, .jpeg, .png, .webp).'
      USING ERRCODE = '22023';
  END IF;

  -- Validate extension is consistent with MIME type
  v_ext := lower(split_part(v_filename, '.', 2));
  NEW.mime_type := lower(btrim(coalesce(NEW.mime_type, '')));
  IF (NEW.mime_type = 'image/jpeg' AND v_ext NOT IN ('jpg', 'jpeg'))
     OR (NEW.mime_type = 'image/png' AND v_ext <> 'png')
     OR (NEW.mime_type = 'image/webp' AND v_ext <> 'webp') THEN
    RAISE EXCEPTION 'Reference image storage_path extension (.%) does not match mime_type (%).',
      v_ext, NEW.mime_type
      USING ERRCODE = '22023';
  END IF;

  -- 3. If annotation_id is set, enforce strict cross-image consistency
  IF NEW.annotation_id IS NOT NULL THEN
    SELECT a.image_id, a.deleted_at
    INTO v_annotation_image_id, v_annotation_deleted_at
    FROM public.annotations AS a
    WHERE a.id = NEW.annotation_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Referenced annotation % does not exist.', NEW.annotation_id
        USING ERRCODE = '23503';
    END IF;

    IF v_annotation_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot attach a reference image to a soft-deleted annotation.'
        USING ERRCODE = '23503';
    END IF;

    -- Annotation must belong to the exact same reviewed image
    IF v_annotation_image_id <> NEW.image_id THEN
      RAISE EXCEPTION 'Cross-image annotation association forbidden: annotation % belongs to image %, not image %.',
        NEW.annotation_id, v_annotation_image_id, NEW.image_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- 4. Auto-populate created_by if omitted and guard against user spoofing on INSERT
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    IF NEW.created_by IS NULL THEN
      NEW.created_by := auth.uid();
    ELSIF NEW.created_by <> auth.uid() THEN
      RAISE EXCEPTION 'Reference image created_by must match the authenticated user.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 5. Clean strings
  NEW.original_filename := btrim(coalesce(NEW.original_filename, ''));
  NEW.comment := btrim(coalesce(NEW.comment, ''));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reference_images_validate ON public.reference_images;
CREATE TRIGGER trg_reference_images_validate
  BEFORE INSERT OR UPDATE ON public.reference_images
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_reference_image_record();

-- Column protection trigger to prevent tampering with immutable properties
CREATE OR REPLACE FUNCTION public.protect_reference_image_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Reference image id cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF NEW.image_id IS DISTINCT FROM OLD.image_id THEN
    RAISE EXCEPTION 'Reference image target image_id cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF NEW.annotation_id IS DISTINCT FROM OLD.annotation_id THEN
    RAISE EXCEPTION 'Reference image annotation_id cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
    RAISE EXCEPTION 'Reference image storage_path cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF NEW.original_filename IS DISTINCT FROM OLD.original_filename THEN
    RAISE EXCEPTION 'Reference image original_filename cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF NEW.mime_type IS DISTINCT FROM OLD.mime_type THEN
    RAISE EXCEPTION 'Reference image mime_type cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF NEW.file_size IS DISTINCT FROM OLD.file_size THEN
    RAISE EXCEPTION 'Reference image file_size cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Reference image creator cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Reference image created_at cannot be modified.' USING ERRCODE = '42501';
  END IF;

  NEW.comment := btrim(coalesce(NEW.comment, ''));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reference_images_protect_columns ON public.reference_images;
CREATE TRIGGER trg_reference_images_protect_columns
  BEFORE UPDATE ON public.reference_images
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_reference_image_columns();

-- ============================================================================
-- 4. Table Grants and Row Level Security
-- ============================================================================

ALTER TABLE public.reference_images ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.reference_images FROM anon;
REVOKE ALL ON public.reference_images FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.reference_images TO authenticated;
GRANT UPDATE (comment) ON public.reference_images TO authenticated;

-- SELECT: Authorized viewers of the batch image can read references.
-- Active annotation-level references require the parent annotation to not be soft-deleted.
DROP POLICY IF EXISTS reference_images_select_authorized ON public.reference_images;
CREATE POLICY reference_images_select_authorized
  ON public.reference_images
  FOR SELECT
  TO authenticated
  USING (
    public.can_view_batch_image(image_id)
    AND (
      annotation_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.annotations AS a
        WHERE a.id = annotation_id
          AND a.deleted_at IS NULL
      )
    )
  );

-- INSERT: Only active Reviewers and Admins can create references.
-- Image-level references: any active reviewer or admin can attach to the image.
-- Annotation-level references: only the creator of that parent annotation (or Admin) can attach a reference to it.
DROP POLICY IF EXISTS reference_images_insert_authorized ON public.reference_images;
CREATE POLICY reference_images_insert_authorized
  ON public.reference_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.can_review_batch_image(image_id)
    AND (
      annotation_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.annotations AS a
        WHERE a.id = annotation_id
          AND a.deleted_at IS NULL
          AND (a.created_by = auth.uid() OR public.is_admin())
      )
    )
  );

-- UPDATE: Only creator (or Admin) can update reference metadata.
-- Annotation-level references require the caller to be the parent annotation creator (or Admin).
DROP POLICY IF EXISTS reference_images_update_authorized ON public.reference_images;
CREATE POLICY reference_images_update_authorized
  ON public.reference_images
  FOR UPDATE
  TO authenticated
  USING (
    public.can_review_batch_image(image_id)
    AND (
      public.is_admin()
      OR (
        (annotation_id IS NULL AND created_by = auth.uid())
        OR
        (annotation_id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM public.annotations AS a
          WHERE a.id = annotation_id
            AND a.deleted_at IS NULL
            AND a.created_by = auth.uid()
        ))
      )
    )
  )
  WITH CHECK (
    public.can_review_batch_image(image_id)
    AND (
      public.is_admin()
      OR (
        (annotation_id IS NULL AND created_by = auth.uid())
        OR
        (annotation_id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM public.annotations AS a
          WHERE a.id = annotation_id
            AND a.deleted_at IS NULL
            AND a.created_by = auth.uid()
        ))
      )
    )
  );

-- DELETE: Only creator (or Admin) can delete references.
-- Annotation-level references require the caller to be the parent annotation creator (or Admin).
DROP POLICY IF EXISTS reference_images_delete_authorized ON public.reference_images;
CREATE POLICY reference_images_delete_authorized
  ON public.reference_images
  FOR DELETE
  TO authenticated
  USING (
    public.can_review_batch_image(image_id)
    AND (
      public.is_admin()
      OR (
        (annotation_id IS NULL AND created_by = auth.uid())
        OR
        (annotation_id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM public.annotations AS a
          WHERE a.id = annotation_id
            AND a.created_by = auth.uid()
        ))
      )
    )
  );

-- ============================================================================
-- 5. Storage Authorization Helper Function
-- ============================================================================

-- Path format: {batch_id}/{image_id}/{reference_uuid}.{ext}
CREATE OR REPLACE FUNCTION public.can_access_reference_storage_path(
  object_name text,
  action text DEFAULT 'select'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_parts text[];
  v_batch_id uuid;
  v_image_id uuid;
  v_filename text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF object_name IS NULL THEN
    RETURN false;
  END IF;

  v_parts := storage.foldername(object_name);
  -- Expected structure: {batch_id}/{image_id}/{filename} (exactly 2 folder levels)
  IF coalesce(array_length(v_parts, 1), 0) <> 2 THEN
    RETURN false;
  END IF;

  BEGIN
    v_batch_id := v_parts[1]::uuid;
    v_image_id := v_parts[2]::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;

  -- Validate filename format: strictly a UUID with supported image extension, no subdirectories
  v_filename := storage.filename(object_name);
  IF v_filename IS NULL
     OR v_filename !~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpg|jpeg|png|webp)$'
  THEN
    RETURN false;
  END IF;

  -- Verify image exists and belongs to the specified batch
  IF NOT EXISTS (
    SELECT 1
    FROM public.batch_images AS bi
    WHERE bi.id = v_image_id
      AND bi.batch_id = v_batch_id
  ) THEN
    RETURN false;
  END IF;

  -- Evaluate action permissions
  IF action = 'select' THEN
    -- Requires authorized batch viewer, a matching reference_images record for the exact storage_path,
    -- matching image_id, and an active parent annotation when annotation_id is not NULL.
    RETURN public.can_view_batch_image(v_image_id)
      AND EXISTS (
        SELECT 1
        FROM public.reference_images AS ri
        WHERE ri.storage_path = object_name
          AND ri.image_id = v_image_id
          AND (
            ri.annotation_id IS NULL
            OR EXISTS (
              SELECT 1
              FROM public.annotations AS a
              WHERE a.id = ri.annotation_id
                AND a.deleted_at IS NULL
            )
          )
      );
  ELSIF action = 'insert' THEN
    -- Only active Reviewers and Admins can upload reference images
    RETURN public.can_review_batch_image(v_image_id);
  ELSIF action = 'delete' THEN
    -- Admins can always delete
    IF public.is_admin() THEN
      RETURN true;
    END IF;

    -- If a reference_images record exists for this storage path:
    -- Verify caller ownership:
    -- - Image-level reference: reference creator
    -- - Annotation-level reference: parent annotation creator
    IF EXISTS (
      SELECT 1
      FROM public.reference_images AS ri
      WHERE ri.storage_path = object_name
    ) THEN
      RETURN EXISTS (
        SELECT 1
        FROM public.reference_images AS ri
        LEFT JOIN public.annotations AS a ON a.id = ri.annotation_id
        WHERE ri.storage_path = object_name
          AND (
            (ri.annotation_id IS NULL AND ri.created_by = auth.uid())
            OR
            (ri.annotation_id IS NOT NULL AND a.created_by = auth.uid())
          )
          AND public.can_review_batch_image(v_image_id)
      );
    END IF;

    -- If no reference_images record exists (orphaned file):
    -- Do NOT grant general reviewer deletion access!
    RETURN false;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_reference_storage_path(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_reference_storage_path(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_reference_storage_path(text, text) TO authenticated;

-- ============================================================================
-- 6. Storage Object RLS Policies
-- ============================================================================

-- Drop any previous update policy to prevent moving or renaming objects through Storage UPDATE
DROP POLICY IF EXISTS framecheck_reference_images_update_authorized ON storage.objects;

DROP POLICY IF EXISTS framecheck_reference_images_select_authorized ON storage.objects;
CREATE POLICY framecheck_reference_images_select_authorized
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'framecheck-reference-images'
    AND public.can_access_reference_storage_path(name, 'select')
  );

DROP POLICY IF EXISTS framecheck_reference_images_insert_authorized ON storage.objects;
CREATE POLICY framecheck_reference_images_insert_authorized
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'framecheck-reference-images'
    AND public.can_access_reference_storage_path(name, 'insert')
  );

DROP POLICY IF EXISTS framecheck_reference_images_delete_authorized ON storage.objects;
CREATE POLICY framecheck_reference_images_delete_authorized
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'framecheck-reference-images'
    AND (
      public.is_admin()
      OR public.can_access_reference_storage_path(name, 'delete')
      OR (
        -- Orphaned object cleanup: ONLY the Storage owner can delete their own orphaned upload
        owner::text = (auth.uid())::text
        AND public.can_access_reference_storage_path(name, 'insert')
        AND NOT EXISTS (
          SELECT 1
          FROM public.reference_images AS ri
          WHERE ri.storage_path = name
        )
      )
    )
  );

-- ============================================================================
-- 7. Profile Privacy: Narrowly Scoped Helper Function
-- ============================================================================

-- Drop broad profile select policy if it exists from previous drafts
DROP POLICY IF EXISTS profiles_select_reference_image_creators ON public.profiles;

-- Narrowly scoped helper to look up display names for reference image creators
-- Exposes ONLY id and display_name without granting broad SELECT on public.profiles.
CREATE OR REPLACE FUNCTION public.get_reference_image_creator_names(target_image_id uuid)
RETURNS TABLE (
  id uuid,
  display_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.display_name
  FROM public.profiles AS p
  WHERE auth.uid() IS NOT NULL
    AND public.can_view_batch_image(target_image_id)
    AND EXISTS (
      SELECT 1
      FROM public.reference_images AS ri
      LEFT JOIN public.annotations AS a ON a.id = ri.annotation_id
      WHERE ri.image_id = target_image_id
        AND ri.created_by = p.id
        AND (ri.annotation_id IS NULL OR a.deleted_at IS NULL)
    );
$$;

REVOKE ALL ON FUNCTION public.get_reference_image_creator_names(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_reference_image_creator_names(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_reference_image_creator_names(uuid) TO authenticated;

-- ============================================================================
-- 8. Realtime Synchronization Preparation
-- ============================================================================

ALTER TABLE public.reference_images REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'reference_images'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.reference_images;
    END IF;
  END IF;
END $$;

COMMIT;
