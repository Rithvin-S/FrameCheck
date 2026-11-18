-- Fix Uploader Review Permissions
-- Target: Supabase PostgreSQL (run after 001, 002, 003, 004, and 005 migrations)
-- Preserves existing data, view access (can_view_batch_image), triggers, and Realtime functionality.

BEGIN;

-- 1. Dedicated helper for review actions (Reviewers and Admins only; Uploaders excluded)
--    Reuses public.can_view_batch_image to verify batch-level authorization.
CREATE OR REPLACE FUNCTION public.can_review_batch_image(target_image_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.is_reviewer_or_admin()
    AND public.can_view_batch_image(target_image_id);
$$;

REVOKE ALL ON FUNCTION public.can_review_batch_image(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_review_batch_image(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_review_batch_image(uuid) TO authenticated;

-- 2. Restrict annotation INSERT and UPDATE RLS policies to Reviewers and Admins
--    (annotations_select_authorized stays intact via can_view_batch_image so Uploaders can still view.)
DROP POLICY IF EXISTS annotations_insert_authorized ON public.annotations;
CREATE POLICY annotations_insert_authorized
  ON public.annotations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND deleted_at IS NULL
    AND public.can_review_batch_image(image_id)
  );

DROP POLICY IF EXISTS annotations_update_creator ON public.annotations;
CREATE POLICY annotations_update_creator
  ON public.annotations
  FOR UPDATE
  TO authenticated
  USING (
    (created_by = auth.uid() OR public.is_admin())
    AND deleted_at IS NULL
    AND public.can_review_batch_image(image_id)
  )
  WITH CHECK (
    (created_by = auth.uid() OR public.is_admin())
    AND deleted_at IS NULL
    AND public.can_review_batch_image(image_id)
  );

-- 3. Enforce reviewer/admin role check inside SECURITY DEFINER soft-delete & restore RPCs
--    while enforcing creator ownership with Admin exception and batch review access.
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

  IF NOT public.is_reviewer_or_admin() THEN
    RAISE EXCEPTION 'Only reviewers and admins can delete annotations.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.annotations
  WHERE id = target_annotation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Annotation not found.' USING ERRCODE = 'P0002';
  END IF;

  IF (v_row.created_by <> auth.uid() AND NOT public.is_admin())
     OR NOT public.can_review_batch_image(v_row.image_id) THEN
    RAISE EXCEPTION 'You can only delete your own annotations.'
      USING ERRCODE = '42501';
  END IF;

  IF v_row.deleted_at IS NOT NULL THEN
    RETURN v_row;
  END IF;

  PERFORM set_config('framecheck.allow_deleted_at_mutation', 'on', true);

  UPDATE public.annotations
  SET deleted_at = now()
  WHERE id = target_annotation_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_annotation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_annotation(uuid) FROM anon;
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

  IF NOT public.is_reviewer_or_admin() THEN
    RAISE EXCEPTION 'Only reviewers and admins can restore annotations.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.annotations
  WHERE id = target_annotation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Annotation not found.' USING ERRCODE = 'P0002';
  END IF;

  IF (v_row.created_by <> auth.uid() AND NOT public.is_admin())
     OR NOT public.can_review_batch_image(v_row.image_id) THEN
    RAISE EXCEPTION 'You can only restore your own annotations.'
      USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION public.restore_annotation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.restore_annotation(uuid) TO authenticated;

-- 4. Restrict batch_images completion updates to Reviewers and Admins only
--    Reuses public.can_view_batch to verify batch-level authorization.
DROP POLICY IF EXISTS batch_images_update_completion_authorized ON public.batch_images;
CREATE POLICY batch_images_update_completion_authorized
  ON public.batch_images
  FOR UPDATE
  TO authenticated
  USING (
    public.is_reviewer_or_admin()
    AND public.can_view_batch(batch_id)
  )
  WITH CHECK (
    public.is_reviewer_or_admin()
    AND public.can_view_batch(batch_id)
  );

COMMIT;
