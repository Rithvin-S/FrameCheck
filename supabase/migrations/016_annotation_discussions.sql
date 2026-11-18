-- Phase 20C: Annotation Discussions and Threaded Replies
-- Target: Supabase PostgreSQL (run after 001 through 015 migrations)
-- Implements per-annotation discussion messages with Row Level Security,
-- user mentions, activity feed logging, and Realtime synchronization.

BEGIN;

-- 1. Annotation Discussions Table
--    Stores chronological discussion messages attached to individual annotations.
CREATE TABLE IF NOT EXISTS public.annotation_discussions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  annotation_id uuid NOT NULL REFERENCES public.annotations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT annotation_discussions_message_valid
    CHECK (char_length(btrim(message)) BETWEEN 1 AND 2000)
);

ALTER TABLE public.annotation_discussions ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.annotation_discussions ALTER COLUMN updated_at SET DEFAULT now();

-- 2. Indexes for fast ordered retrieval
CREATE INDEX IF NOT EXISTS idx_annotation_discussions_annotation_id
  ON public.annotation_discussions (annotation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_annotation_discussions_user_id
  ON public.annotation_discussions (user_id);

-- 3. Row Level Security & Privileges
ALTER TABLE public.annotation_discussions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.annotation_discussions FROM PUBLIC;
REVOKE ALL ON public.annotation_discussions FROM anon;
REVOKE ALL ON public.annotation_discussions FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.annotation_discussions TO authenticated;

-- RLS: SELECT discussions if user can view the batch image
DROP POLICY IF EXISTS annotation_discussions_select_authorized ON public.annotation_discussions;
CREATE POLICY annotation_discussions_select_authorized
  ON public.annotation_discussions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.annotations a
      WHERE a.id = annotation_discussions.annotation_id
        AND a.deleted_at IS NULL
        AND public.can_view_batch_image(a.image_id)
    )
  );

-- RLS: INSERT discussions if actor is reviewer/admin and can review the image
DROP POLICY IF EXISTS annotation_discussions_insert_authorized ON public.annotation_discussions;
CREATE POLICY annotation_discussions_insert_authorized
  ON public.annotation_discussions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_reviewer_or_admin()
    AND EXISTS (
      SELECT 1 FROM public.annotations a
      WHERE a.id = annotation_discussions.annotation_id
        AND a.deleted_at IS NULL
        AND public.can_review_batch_image(a.image_id)
    )
  );

-- RLS: UPDATE message if user is the author or Admin
DROP POLICY IF EXISTS annotation_discussions_update_authorized ON public.annotation_discussions;
CREATE POLICY annotation_discussions_update_authorized
  ON public.annotation_discussions
  FOR UPDATE
  TO authenticated
  USING (
    (user_id = auth.uid() OR public.is_admin())
    AND EXISTS (
      SELECT 1 FROM public.annotations a
      WHERE a.id = annotation_discussions.annotation_id
        AND a.deleted_at IS NULL
        AND public.can_review_batch_image(a.image_id)
    )
  )
  WITH CHECK (
    (user_id = auth.uid() OR public.is_admin())
    AND EXISTS (
      SELECT 1 FROM public.annotations a
      WHERE a.id = annotation_discussions.annotation_id
        AND a.deleted_at IS NULL
        AND public.can_review_batch_image(a.image_id)
    )
  );

-- RLS: DELETE message if author or Admin
DROP POLICY IF EXISTS annotation_discussions_delete_authorized ON public.annotation_discussions;
CREATE POLICY annotation_discussions_delete_authorized
  ON public.annotation_discussions
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid() OR public.is_admin()
  );

-- 4. Activity Feed & Notification Triggers for Discussion Replies
CREATE OR REPLACE FUNCTION public.trg_log_discussion_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_annotation public.annotations%ROWTYPE;
  v_image public.batch_images%ROWTYPE;
  v_actor_name text;
  v_snippet text;
BEGIN
  SELECT * INTO v_annotation
  FROM public.annotations
  WHERE id = NEW.annotation_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_image
  FROM public.batch_images
  WHERE id = v_annotation.image_id;

  SELECT COALESCE(NULLIF(trim(display_name), ''), 'A reviewer') INTO v_actor_name
  FROM public.profiles
  WHERE id = NEW.user_id;

  v_actor_name := COALESCE(v_actor_name, 'A reviewer');
  v_snippet := COALESCE(substring(NEW.message from 1 for 120), '');

  -- 4a. Log activity event if batch_activity_events table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'batch_activity_events'
  ) THEN
    INSERT INTO public.batch_activity_events (
      batch_id,
      event_type,
      occurred_at,
      actor_id,
      image_id,
      annotation_id,
      annotation_number,
      details,
      metadata
    ) VALUES (
      v_image.batch_id,
      'comment_added',
      NEW.created_at,
      NEW.user_id,
      v_annotation.image_id,
      v_annotation.id,
      v_annotation.annotation_number,
      v_actor_name || ' replied to #' || v_annotation.annotation_number || ': "' || v_snippet || '"',
      jsonb_build_object(
        'discussion_id', NEW.id,
        'reply_preview', v_snippet,
        'actor_name', v_actor_name
      )
    );
  END IF;

  -- 4b. Notify annotation creator if creator is not the reply author
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notifications'
  ) AND v_annotation.created_by IS NOT NULL AND v_annotation.created_by <> NEW.user_id THEN
    INSERT INTO public.notifications (
      recipient_id,
      actor_id,
      type,
      title,
      message,
      batch_id,
      image_id,
      annotation_id,
      data
    ) VALUES (
      v_annotation.created_by,
      NEW.user_id,
      'mention',
      v_actor_name || ' replied to your annotation #' || v_annotation.annotation_number,
      v_snippet,
      v_image.batch_id,
      v_annotation.image_id,
      v_annotation.id,
      jsonb_build_object(
        'actorName', v_actor_name,
        'annotationNumber', v_annotation.annotation_number,
        'displayNumber', v_annotation.annotation_number,
        'discussionId', NEW.id
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_discussion_activity ON public.annotation_discussions;
CREATE TRIGGER trg_discussion_activity
  AFTER INSERT ON public.annotation_discussions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_discussion_activity();

-- 5. Enable Supabase Realtime publication
ALTER TABLE public.annotation_discussions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'annotation_discussions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.annotation_discussions;
    END IF;
  END IF;
END $$;

COMMIT;

