-- ============================================================================
-- FrameCheck 2.0 — Migration 023: Protect Internal Reviewer Discussions
-- ============================================================================
-- Objective:
-- Ensure uploaders only access primary annotation correction comments and shapes.
-- Restrict internal reviewer discussions, mentions, and emoji reactions exclusively
-- to authenticated reviewers and administrators at the PostgreSQL RLS policy level.
-- ============================================================================

-- 1. Restrict annotation_discussions SELECT to reviewers and admins only
DROP POLICY IF EXISTS annotation_discussions_select_authorized ON public.annotation_discussions;
CREATE POLICY annotation_discussions_select_authorized
  ON public.annotation_discussions
  FOR SELECT
  TO authenticated
  USING (
    public.is_reviewer_or_admin()
    AND EXISTS (
      SELECT 1 FROM public.annotations a
      WHERE a.id = annotation_discussions.annotation_id
        AND a.deleted_at IS NULL
        AND public.can_review_batch_image(a.image_id)
    )
  );

-- 2. Restrict annotation_mentions SELECT to reviewers and admins only
DROP POLICY IF EXISTS annotation_mentions_select_authorized ON public.annotation_mentions;
CREATE POLICY annotation_mentions_select_authorized
  ON public.annotation_mentions
  FOR SELECT
  TO authenticated
  USING (
    public.is_reviewer_or_admin()
    AND EXISTS (
      SELECT 1 FROM public.annotations a
      WHERE a.id = annotation_mentions.annotation_id
        AND a.deleted_at IS NULL
        AND public.can_review_batch_image(a.image_id)
    )
  );

-- 3. Restrict annotation_reactions SELECT to reviewers and admins only
DROP POLICY IF EXISTS annotation_reactions_select_authorized ON public.annotation_reactions;
CREATE POLICY annotation_reactions_select_authorized
  ON public.annotation_reactions
  FOR SELECT
  TO authenticated
  USING (
    public.is_reviewer_or_admin()
    AND EXISTS (
      SELECT 1 FROM public.annotations a
      WHERE a.id = annotation_reactions.annotation_id
        AND a.deleted_at IS NULL
        AND public.can_review_batch_image(a.image_id)
    )
  );

COMMENT ON TABLE public.annotation_discussions IS 
  'Internal reviewer collaborative discussion threads. Restricted to reviewers and administrators via RLS.';
