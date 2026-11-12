-- Phase 7: Realtime synchronization support for collaborative batch review
-- Target: Supabase PostgreSQL (run after 001, 002, 003, and 004 migrations)
-- Preserves all existing tables, records, RLS policies, triggers, and RPCs.

-- 1. Lightweight tombstone event log for soft-deleted annotations.
--    annotations_select_authorized continues to exclude rows where deleted_at IS NOT NULL,
--    so soft-delete UPDATEs are not broadcast by postgres_changes on public.annotations.
--    This table emits an authorized INSERT notification containing only IDs (no content).
CREATE TABLE IF NOT EXISTS public.annotation_deletion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  annotation_id uuid NOT NULL,
  image_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT annotation_deletion_events_image_id_fkey
    FOREIGN KEY (image_id) REFERENCES public.batch_images (id) ON DELETE CASCADE,
  CONSTRAINT annotation_deletion_events_batch_id_fkey
    FOREIGN KEY (batch_id) REFERENCES public.batches (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_annotation_deletion_events_batch_time
  ON public.annotation_deletion_events (batch_id, deleted_at DESC);

ALTER TABLE public.annotation_deletion_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.annotation_deletion_events FROM anon, authenticated;
GRANT SELECT ON public.annotation_deletion_events TO authenticated;

DROP POLICY IF EXISTS annotation_deletion_events_select_authorized ON public.annotation_deletion_events;
CREATE POLICY annotation_deletion_events_select_authorized
  ON public.annotation_deletion_events
  FOR SELECT
  TO authenticated
  USING (public.can_view_batch_image(image_id));

-- 2. Trigger to record soft-delete transitions from public.annotations
CREATE OR REPLACE FUNCTION public.record_annotation_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_id uuid;
BEGIN
  IF old.deleted_at IS NULL AND new.deleted_at IS NOT NULL THEN
    SELECT bi.batch_id
    INTO v_batch_id
    FROM public.batch_images AS bi
    WHERE bi.id = new.image_id;

    IF v_batch_id IS NOT NULL THEN
      INSERT INTO public.annotation_deletion_events (
        annotation_id,
        image_id,
        batch_id,
        deleted_at
      )
      VALUES (
        new.id,
        new.image_id,
        v_batch_id,
        new.deleted_at
      );
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_annotations_record_soft_delete ON public.annotations;
CREATE TRIGGER trg_annotations_record_soft_delete
  AFTER UPDATE OF deleted_at ON public.annotations
  FOR EACH ROW
  WHEN (old.deleted_at IS NULL AND new.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.record_annotation_soft_delete();

-- 3. Enable Supabase Realtime publication idempotently for required tables
DO $$
DECLARE
  v_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table IN ARRAY ARRAY[
      'annotations',
      'annotation_deletion_events',
      'batch_images'
    ]
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = v_table
      ) THEN
        EXECUTE format(
          'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
          v_table
        );
      END IF;
    END LOOP;
  END IF;
END
$$;

