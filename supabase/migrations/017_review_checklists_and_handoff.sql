-- Phase 20D: Reviewer Handoff, Annotation History, and Review Checklists
-- Target: Supabase PostgreSQL (run after migrations 001 through 016)
-- Prepares structured review checklists, handoff activity support, and realtime publications.
-- (Prepared for manual review; unexecuted per guidelines)

-- ============================================================================
-- 1. Extend batch_activity_events CHECK constraint for handoff & checklists
-- ============================================================================

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
      'batch_review_completed'
    )
  );

-- ============================================================================
-- 2. Structured Batch Review Checklists Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.batch_review_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general' CHECK (
    category IN ('Visual', 'Layout', 'Content', 'Quality', 'Brand', 'Review', 'Custom', 'general')
  ),
  is_completed boolean NOT NULL DEFAULT false,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  position integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_batch_review_checklists_batch_pos
  ON public.batch_review_checklists (batch_id, position ASC);

CREATE INDEX IF NOT EXISTS idx_batch_review_checklists_completed
  ON public.batch_review_checklists (batch_id, is_completed);

-- ============================================================================
-- 3. Row Level Security for batch_review_checklists
-- ============================================================================

ALTER TABLE public.batch_review_checklists ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.batch_review_checklists FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_review_checklists TO authenticated;

DROP POLICY IF EXISTS batch_review_checklists_select_authorized ON public.batch_review_checklists;
CREATE POLICY batch_review_checklists_select_authorized
  ON public.batch_review_checklists
  FOR SELECT
  USING (public.can_view_batch(batch_id));

DROP POLICY IF EXISTS batch_review_checklists_insert_authorized ON public.batch_review_checklists;
CREATE POLICY batch_review_checklists_insert_authorized
  ON public.batch_review_checklists
  FOR INSERT
  WITH CHECK (
    public.can_view_batch(batch_id)
    AND public.is_reviewer_or_admin()
  );

DROP POLICY IF EXISTS batch_review_checklists_update_authorized ON public.batch_review_checklists;
CREATE POLICY batch_review_checklists_update_authorized
  ON public.batch_review_checklists
  FOR UPDATE
  USING (
    public.can_view_batch(batch_id)
    AND public.is_reviewer_or_admin()
  )
  WITH CHECK (
    public.can_view_batch(batch_id)
    AND public.is_reviewer_or_admin()
  );

DROP POLICY IF EXISTS batch_review_checklists_delete_authorized ON public.batch_review_checklists;
CREATE POLICY batch_review_checklists_delete_authorized
  ON public.batch_review_checklists
  FOR DELETE
  USING (
    public.can_view_batch(batch_id)
    AND (
      auth.uid() = created_by
      OR public.is_admin()
    )
  );

-- ============================================================================
-- 4. Seed Default Batch Checklists RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_batch_default_checklists(
  p_batch_id uuid,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS SETOF public.batch_review_checklists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only seed if no items exist for this batch yet
  IF NOT EXISTS (SELECT 1 FROM public.batch_review_checklists WHERE batch_id = p_batch_id) THEN
    INSERT INTO public.batch_review_checklists (
      batch_id, title, description, category, position, is_default, created_by
    ) VALUES
      (p_batch_id, 'Color Accuracy & Palette Verification', 'Verify brand palette colors, contrast ratios, and color grading consistency across images.', 'Visual', 0, true, p_actor_id),
      (p_batch_id, 'Layout, Spacing & Safe Areas', 'Confirm grid alignment, proper padding/margins, and responsive safe-area cutoffs.', 'Layout', 1, true, p_actor_id),
      (p_batch_id, 'Typography, Font Hierarchy & Copy', 'Check typographic scale, font weights, spelling, grammar, and copy accuracy.', 'Content', 2, true, p_actor_id),
      (p_batch_id, 'Asset Resolution & Sharpness', 'Inspect image sharpness, vector sharpness, and verify absence of pixelation or compression artifacts.', 'Quality', 3, true, p_actor_id),
      (p_batch_id, 'Brand Guidelines & Consistency', 'Ensure logo clear-space, proper visual branding treatments, and styling consistency.', 'Brand', 4, true, p_actor_id),
      (p_batch_id, 'All Critical Feedback Resolved', 'Verify that all high and critical priority annotations have been satisfactorily resolved.', 'Review', 5, true, p_actor_id);
  END IF;

  RETURN QUERY
  SELECT * FROM public.batch_review_checklists
  WHERE batch_id = p_batch_id
  ORDER BY position ASC, created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_batch_default_checklists(uuid, uuid) TO authenticated;

-- ============================================================================
-- 5. Enable Realtime Replication
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'batch_review_checklists'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.batch_review_checklists;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Suppress publication errors in restricted environments
    NULL;
END;
$$;

