-- Review Status & Per-Image Completion
-- Target: Supabase PostgreSQL (run after 001, 002, and 003 migrations)

-- 1. Add persisted per-image completion fields to public.batch_images
ALTER TABLE public.batch_images
  ADD COLUMN IF NOT EXISTS is_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'batch_images_completed_by_fkey'
      AND conrelid = 'public.batch_images'::regclass
  ) THEN
    ALTER TABLE public.batch_images
      ADD CONSTRAINT batch_images_completed_by_fkey
      FOREIGN KEY (completed_by) REFERENCES public.profiles (id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'batch_images_completion_consistent'
      AND conrelid = 'public.batch_images'::regclass
  ) THEN
    ALTER TABLE public.batch_images
      ADD CONSTRAINT batch_images_completion_consistent
      CHECK (
        (is_completed = true AND completed_at IS NOT NULL)
        OR (is_completed = false AND completed_at IS NULL AND completed_by IS NULL)
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_batch_images_batch_completed
  ON public.batch_images (batch_id, is_completed);

-- 2. Protect immutable batch_images columns and maintain completion metadata on update
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

  IF new.original_filename IS DISTINCT FROM old.original_filename THEN
    RAISE EXCEPTION 'Image filename cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.relative_path IS DISTINCT FROM old.relative_path THEN
    RAISE EXCEPTION 'Image relative_path cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.storage_path IS DISTINCT FROM old.storage_path THEN
    RAISE EXCEPTION 'Image storage_path cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.mime_type IS DISTINCT FROM old.mime_type THEN
    RAISE EXCEPTION 'Image mime_type cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.file_size IS DISTINCT FROM old.file_size THEN
    RAISE EXCEPTION 'Image file_size cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.display_order IS DISTINCT FROM old.display_order THEN
    RAISE EXCEPTION 'Image display_order cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.created_at IS DISTINCT FROM old.created_at THEN
    RAISE EXCEPTION 'Image created_at cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.is_completed IS DISTINCT FROM old.is_completed THEN
    IF new.is_completed THEN
      new.completed_at := timezone('utc', now());
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

-- 3. Grant column-scoped UPDATE privilege and RLS policy matching batch view/review access
GRANT UPDATE (is_completed) ON public.batch_images TO authenticated;

DROP POLICY IF EXISTS batch_images_update_completion_authorized ON public.batch_images;
CREATE POLICY batch_images_update_completion_authorized
  ON public.batch_images
  FOR UPDATE
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
  )
  WITH CHECK (
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

-- 4. Single-query aggregated dashboard batch listing (enforces caller RLS via SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.list_dashboard_batches()
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  name text,
  created_at timestamptz,
  updated_at timestamptz,
  owner_name text,
  image_count integer,
  completed_image_count integer,
  total_annotation_count integer,
  open_annotation_count integer,
  review_status text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH visible_batches AS (
    SELECT
      b.id,
      b.owner_id,
      b.name,
      b.created_at,
      b.updated_at
    FROM public.batches AS b
  ),
  img_stats AS (
    SELECT
      bi.batch_id,
      count(*)::integer AS total_images,
      count(*) FILTER (WHERE bi.is_completed)::integer AS completed_images
    FROM public.batch_images AS bi
    WHERE bi.batch_id IN (SELECT vb.id FROM visible_batches AS vb)
    GROUP BY bi.batch_id
  ),
  ann_stats AS (
    SELECT
      bi.batch_id,
      count(*)::integer AS total_annotations,
      count(*) FILTER (WHERE a.status = 'open')::integer AS open_annotations
    FROM public.annotations AS a
    JOIN public.batch_images AS bi ON bi.id = a.image_id
    WHERE a.deleted_at IS NULL
      AND bi.batch_id IN (SELECT vb.id FROM visible_batches AS vb)
    GROUP BY bi.batch_id
  )
  SELECT
    vb.id,
    vb.owner_id,
    vb.name,
    vb.created_at,
    vb.updated_at,
    coalesce(p.display_name, 'Unknown') AS owner_name,
    coalesce(img_stats.total_images, 0) AS image_count,
    coalesce(img_stats.completed_images, 0) AS completed_image_count,
    coalesce(ann_stats.total_annotations, 0) AS total_annotation_count,
    coalesce(ann_stats.open_annotations, 0) AS open_annotation_count,
    CASE
      WHEN coalesce(img_stats.total_images, 0) > 0
       AND coalesce(img_stats.completed_images, 0) = img_stats.total_images
       AND coalesce(ann_stats.open_annotations, 0) = 0
        THEN 'review_completed'
      WHEN coalesce(img_stats.completed_images, 0) > 0
        OR coalesce(ann_stats.total_annotations, 0) > 0
        THEN 'in_review'
      ELSE 'not_started'
    END AS review_status
  FROM visible_batches AS vb
  LEFT JOIN public.profiles AS p ON p.id = vb.owner_id
  LEFT JOIN img_stats ON img_stats.batch_id = vb.id
  LEFT JOIN ann_stats ON ann_stats.batch_id = vb.id
  ORDER BY vb.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_dashboard_batches() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_dashboard_batches() TO authenticated;

