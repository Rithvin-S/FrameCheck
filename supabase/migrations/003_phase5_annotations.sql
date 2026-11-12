-- Phase 5: Persisted annotations, comments, creator-only edits, and resolution workflow
-- Target: Supabase PostgreSQL (run after 001_phase1_auth_profiles.sql and 002_phase2_batches_and_images.sql)

-- 1. Helper to check whether the current authenticated user can inspect/annotate a batch image
CREATE OR REPLACE FUNCTION public.can_view_batch_image(target_image_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.batch_images AS bi
      JOIN public.batches AS b ON b.id = bi.batch_id
      WHERE bi.id = target_image_id
        AND (
          b.owner_id = auth.uid()
          OR public.is_reviewer_or_admin()
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_batch_image(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_batch_image(uuid) TO authenticated;

-- 2. Annotations table (soft-deleted via deleted_at so annotation numbers are never reused)
CREATE TABLE IF NOT EXISTS public.annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL,
  annotation_number integer NOT NULL,
  created_by uuid NOT NULL,
  cx double precision NOT NULL,
  cy double precision NOT NULL,
  r double precision NOT NULL,
  color text NOT NULL DEFAULT '#dc2626',
  comment text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  resolved_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT annotations_image_id_fkey
    FOREIGN KEY (image_id) REFERENCES public.batch_images (id) ON DELETE CASCADE,
  CONSTRAINT annotations_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT annotations_number_valid
    CHECK (annotation_number >= 1),
  CONSTRAINT annotations_unique_image_number
    UNIQUE (image_id, annotation_number),
  CONSTRAINT annotations_cx_valid
    CHECK (cx >= 0.0 AND cx <= 1.0),
  CONSTRAINT annotations_cy_valid
    CHECK (cy >= 0.0 AND cy <= 1.0),
  CONSTRAINT annotations_r_valid
    CHECK (r > 0.0 AND r <= 1.0),
  CONSTRAINT annotations_color_valid
    CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT annotations_comment_valid
    CHECK (char_length(btrim(comment)) BETWEEN 1 AND 2000),
  CONSTRAINT annotations_status_valid
    CHECK (status IN ('open', 'resolved')),
  CONSTRAINT annotations_resolved_at_consistent
    CHECK (
      (status = 'resolved' AND resolved_at IS NOT NULL)
      OR (status = 'open' AND resolved_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_annotations_image_active
  ON public.annotations (image_id, annotation_number ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_annotations_created_by_active
  ON public.annotations (created_by)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_annotations_image_status_active
  ON public.annotations (image_id, status)
  WHERE deleted_at IS NULL;

-- 3. Insert & Update protection triggers

-- Allocate monotonic per-image annotation_number (including deleted rows so numbers are never reused).
-- SECURITY DEFINER ensures soft-deleted rows are still visible to MAX(annotation_number) under RLS.
CREATE OR REPLACE FUNCTION public.prepare_annotation_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next_number integer;
  v_now timestamptz := timezone('utc', now());
BEGIN
  -- Serialize number allocation per image across concurrent inserts.
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

  new.comment := btrim(coalesce(new.comment, ''));
  new.color := lower(btrim(coalesce(new.color, '#dc2626')));
  new.status := 'open';
  new.resolved_at := NULL;
  new.deleted_at := NULL;
  new.created_at := v_now;
  new.updated_at := v_now;

  SELECT coalesce(max(a.annotation_number), 0) + 1
  INTO v_next_number
  FROM public.annotations AS a
  WHERE a.image_id = new.image_id;

  new.annotation_number := v_next_number;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_annotations_prepare_insert ON public.annotations;
CREATE TRIGGER trg_annotations_prepare_insert
  BEFORE INSERT ON public.annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.prepare_annotation_insert();

-- Protect immutable columns and synchronize resolved_at / updated_at on updates.
CREATE OR REPLACE FUNCTION public.protect_annotation_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := timezone('utc', now());
BEGIN
  IF new.id IS DISTINCT FROM old.id THEN
    RAISE EXCEPTION 'Annotation id cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.image_id IS DISTINCT FROM old.image_id THEN
    RAISE EXCEPTION 'Annotation image_id cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.annotation_number IS DISTINCT FROM old.annotation_number THEN
    RAISE EXCEPTION 'Annotation number cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.created_by IS DISTINCT FROM old.created_by THEN
    RAISE EXCEPTION 'Annotation creator cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.created_at IS DISTINCT FROM old.created_at THEN
    RAISE EXCEPTION 'Annotation created_at cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.deleted_at IS DISTINCT FROM old.deleted_at THEN
    IF current_setting('framecheck.allow_deleted_at_mutation', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Annotation deletion state must be changed via RPC.' USING ERRCODE = '42501';
    END IF;
  ELSIF old.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted annotations cannot be edited.' USING ERRCODE = '42501';
  END IF;

  new.comment := btrim(coalesce(new.comment, ''));
  new.color := lower(btrim(new.color));

  IF new.status = 'resolved' THEN
    IF old.status IS DISTINCT FROM 'resolved' OR old.resolved_at IS NULL THEN
      new.resolved_at := v_now;
    ELSE
      new.resolved_at := old.resolved_at;
    END IF;
  ELSE
    new.status := 'open';
    new.resolved_at := NULL;
  END IF;

  new.updated_at := v_now;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_annotations_protect_columns ON public.annotations;
CREATE TRIGGER trg_annotations_protect_columns
  BEFORE UPDATE ON public.annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_annotation_columns();

-- 4. Least-privilege table grants and Row Level Security
ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.annotations FROM anon, authenticated;
GRANT SELECT, INSERT ON public.annotations TO authenticated;
GRANT UPDATE (cx, cy, r, color, comment, status) ON public.annotations TO authenticated;

-- Allow authorized batch viewers to read the display_name of users who annotated images in that batch
DROP POLICY IF EXISTS profiles_select_annotation_creators ON public.profiles;
CREATE POLICY profiles_select_annotation_creators
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.annotations AS a
      WHERE a.created_by = profiles.id
        AND a.deleted_at IS NULL
        AND public.can_view_batch_image(a.image_id)
    )
  );

DROP POLICY IF EXISTS annotations_select_authorized ON public.annotations;
CREATE POLICY annotations_select_authorized
  ON public.annotations
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND public.can_view_batch_image(image_id)
  );

DROP POLICY IF EXISTS annotations_insert_authorized ON public.annotations;
CREATE POLICY annotations_insert_authorized
  ON public.annotations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND deleted_at IS NULL
    AND public.can_view_batch_image(image_id)
  );

DROP POLICY IF EXISTS annotations_update_creator ON public.annotations;
CREATE POLICY annotations_update_creator
  ON public.annotations
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    AND deleted_at IS NULL
    AND public.can_view_batch_image(image_id)
  )
  WITH CHECK (
    created_by = auth.uid()
    AND deleted_at IS NULL
    AND public.can_view_batch_image(image_id)
  );

-- 5. Creator-only soft-delete and restore RPCs (supports safe Undo/Redo without losing numbering)
CREATE OR REPLACE FUNCTION public.soft_delete_annotation(target_annotation_id uuid)
RETURNS public.annotations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.annotations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.annotations
  WHERE id = target_annotation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Annotation not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.created_by <> auth.uid() OR NOT public.can_view_batch_image(v_row.image_id) THEN
    RAISE EXCEPTION 'You can only delete your own annotations.' USING ERRCODE = '42501';
  END IF;

  IF v_row.deleted_at IS NOT NULL THEN
    RETURN v_row;
  END IF;

  PERFORM set_config('framecheck.allow_deleted_at_mutation', 'on', true);

  UPDATE public.annotations
  SET deleted_at = timezone('utc', now())
  WHERE id = target_annotation_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_annotation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_annotation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_annotation(target_annotation_id uuid)
RETURNS public.annotations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.annotations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.annotations
  WHERE id = target_annotation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Annotation not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.created_by <> auth.uid() OR NOT public.can_view_batch_image(v_row.image_id) THEN
    RAISE EXCEPTION 'You can only restore your own annotations.' USING ERRCODE = '42501';
  END IF;

  IF v_row.deleted_at IS NULL THEN
    RETURN v_row;
  END IF;

  PERFORM set_config('framecheck.allow_deleted_at_mutation', 'on', true);

  UPDATE public.annotations
  SET deleted_at = NULL
  WHERE id = target_annotation_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_annotation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_annotation(uuid) TO authenticated;

