-- Phase 2: Batch management, image metadata, and private Supabase Storage
-- Target: Supabase PostgreSQL (run after 001_phase1_auth_profiles.sql)

-- 1. Role helper for Reviewers and Admins (SECURITY DEFINER avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_reviewer_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('reviewer', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_reviewer_or_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_reviewer_or_admin() TO authenticated;

-- 2. Batches table
CREATE TABLE IF NOT EXISTS public.batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT batches_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT batches_name_valid
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS idx_batches_owner_id ON public.batches (owner_id);
CREATE INDEX IF NOT EXISTS idx_batches_created_at ON public.batches (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batches_updated_at ON public.batches (updated_at DESC);

-- Protect immutable batch columns and maintain updated_at
CREATE OR REPLACE FUNCTION public.protect_batch_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF new.id IS DISTINCT FROM old.id THEN
    RAISE EXCEPTION 'Batch id cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.owner_id IS DISTINCT FROM old.owner_id THEN
    RAISE EXCEPTION 'Batch owner cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.created_at IS DISTINCT FROM old.created_at THEN
    RAISE EXCEPTION 'Batch created_at cannot be modified.' USING ERRCODE = '42501';
  END IF;

  new.name := btrim(new.name);
  new.updated_at := timezone('utc', now());
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_batches_protect_columns ON public.batches;
CREATE TRIGGER trg_batches_protect_columns
  BEFORE UPDATE ON public.batches
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_batch_columns();

-- 3. Batch images metadata table (binary files live in private Supabase Storage)
CREATE TABLE IF NOT EXISTS public.batch_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  original_filename text NOT NULL,
  relative_path text,
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,
  display_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT batch_images_batch_id_fkey
    FOREIGN KEY (batch_id) REFERENCES public.batches (id) ON DELETE CASCADE,
  CONSTRAINT batch_images_filename_valid
    CHECK (char_length(btrim(original_filename)) BETWEEN 1 AND 255),
  CONSTRAINT batch_images_relative_path_valid
    CHECK (relative_path IS NULL OR char_length(btrim(relative_path)) BETWEEN 1 AND 512),
  CONSTRAINT batch_images_storage_path_valid
    CHECK (char_length(btrim(storage_path)) > 0),
  CONSTRAINT batch_images_mime_valid
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT batch_images_file_size_valid
    CHECK (file_size > 0),
  CONSTRAINT batch_images_display_order_valid
    CHECK (display_order >= 1),
  CONSTRAINT batch_images_unique_order
    UNIQUE (batch_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_batch_images_batch_order
  ON public.batch_images (batch_id, display_order ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_batch_images_created_at
  ON public.batch_images (created_at);

-- Atomically allocate per-batch display_order and validate metadata on insert

CREATE OR REPLACE FUNCTION public.prepare_batch_image_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_next_order integer;
  v_owner_id uuid;
BEGIN
  -- Serialize display-order allocation per batch.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(new.batch_id::text, 0)
  );

  -- Get the actual owner of the batch.
  SELECT b.owner_id
  INTO v_owner_id
  FROM public.batches AS b
  WHERE b.id = new.batch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target batch not found.'
      USING ERRCODE = '23503';
  END IF;

  -- Validate the expected storage path structure:
  -- owner_id/batch_id/image_uuid.extension
  IF new.storage_path IS NULL
     OR new.storage_path !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpg|jpeg|png|webp)$'
  THEN
    RAISE EXCEPTION 'Invalid image storage path.'
      USING ERRCODE = '22023';
  END IF;

  -- Ensure the path belongs to the actual batch owner and batch.
  IF split_part(new.storage_path, '/', 1) <> v_owner_id::text
     OR split_part(new.storage_path, '/', 2) <> new.batch_id::text
  THEN
    RAISE EXCEPTION 'Image storage path does not match batch ownership.'
      USING ERRCODE = '42501';
  END IF;

  new.original_filename := btrim(new.original_filename);

  IF new.relative_path IS NOT NULL THEN
    new.relative_path := nullif(btrim(new.relative_path), '');
  END IF;

  SELECT coalesce(max(bi.display_order), 0) + 1
  INTO v_next_order
  FROM public.batch_images AS bi
  WHERE bi.batch_id = new.batch_id;

  new.display_order := v_next_order;

  RETURN new;
END;
$$;


DROP TRIGGER IF EXISTS trg_batch_images_prepare_insert ON public.batch_images;
CREATE TRIGGER trg_batch_images_prepare_insert
  BEFORE INSERT ON public.batch_images
  FOR EACH ROW
  EXECUTE FUNCTION public.prepare_batch_image_insert();

-- Keep batches.updated_at synchronized when images are added
CREATE OR REPLACE FUNCTION public.touch_batch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.batches
  SET updated_at = timezone('utc', now())
  WHERE id = new.batch_id;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_batch_images_touch_batch ON public.batch_images;
CREATE TRIGGER trg_batch_images_touch_batch
  AFTER INSERT ON public.batch_images
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_batch_updated_at();

-- 4. Least-privilege table grants and Row Level Security
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_images ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.batches FROM anon, authenticated;
GRANT SELECT, INSERT ON public.batches TO authenticated;
GRANT UPDATE (name) ON public.batches TO authenticated;

REVOKE ALL ON public.batch_images FROM anon, authenticated;
GRANT SELECT, INSERT ON public.batch_images TO authenticated;

-- Allow Reviewers to see display_name of batch owners without exposing unrelated profiles
DROP POLICY IF EXISTS profiles_select_batch_owners_for_reviewers ON public.profiles;
CREATE POLICY profiles_select_batch_owners_for_reviewers
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    public.is_reviewer_or_admin()
    AND EXISTS (
      SELECT 1
      FROM public.batches AS b
      WHERE b.owner_id = profiles.id
    )
  );

-- Batches policies
DROP POLICY IF EXISTS batches_select_authorized ON public.batches;
CREATE POLICY batches_select_authorized
  ON public.batches
  FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.is_reviewer_or_admin()
  );

DROP POLICY IF EXISTS batches_insert_own ON public.batches;
CREATE POLICY batches_insert_own
  ON public.batches
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS batches_update_owner_or_admin ON public.batches;
CREATE POLICY batches_update_owner_or_admin
  ON public.batches
  FOR UPDATE
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.is_admin()
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR public.is_admin()
  );

-- Batch images policies (no DELETE or UPDATE in Phase 2)
DROP POLICY IF EXISTS batch_images_select_authorized ON public.batch_images;
CREATE POLICY batch_images_select_authorized
  ON public.batch_images
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.batches AS b
      WHERE b.id = batch_id
        AND (
          b.owner_id = auth.uid()
          OR public.is_reviewer_or_admin()
        )
    )
  );

DROP POLICY IF EXISTS batch_images_insert_owner_or_admin ON public.batch_images;
CREATE POLICY batch_images_insert_owner_or_admin
  ON public.batch_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.batches AS b
      WHERE b.id = batch_id
        AND (
          b.owner_id = auth.uid()
          OR public.is_admin()
        )
    )
  );

-- 5. Private Supabase Storage bucket and RLS policies
-- Storage object path format: {owner_id}/{batch_id}/{image_uuid}.{ext}
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'framecheck-images',
  'framecheck-images',
  false,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.can_access_batch_storage_path(
  object_name text,
  require_write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_parts text[];
  v_owner_id uuid;
  v_batch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  v_parts := storage.foldername(object_name);
  IF array_length(v_parts, 1) <> 2 THEN
    RETURN false;
  END IF;

  BEGIN
    v_owner_id := v_parts[1]::uuid;
    v_batch_id := v_parts[2]::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;

  IF require_write THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.batches AS b
      WHERE b.id = v_batch_id
        AND b.owner_id = v_owner_id
        AND (b.owner_id = auth.uid() OR public.is_admin())
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.batches AS b
    WHERE b.id = v_batch_id
      AND b.owner_id = v_owner_id
      AND (b.owner_id = auth.uid() OR public.is_reviewer_or_admin())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_batch_storage_path(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_batch_storage_path(text, boolean) TO authenticated;

DROP POLICY IF EXISTS framecheck_images_select_authorized ON storage.objects;
CREATE POLICY framecheck_images_select_authorized
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'framecheck-images'
    AND public.can_access_batch_storage_path(name, false)
  );

DROP POLICY IF EXISTS framecheck_images_insert_owner_or_admin ON storage.objects;
CREATE POLICY framecheck_images_insert_owner_or_admin
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'framecheck-images'
    AND public.can_access_batch_storage_path(name, true)
  );
