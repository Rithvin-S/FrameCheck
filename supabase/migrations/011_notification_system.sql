-- Phase 16B: In-App Notification System
-- Target: Supabase PostgreSQL (run after 001 through 010 migrations)
-- Implements in-app notifications for mentions, reactions, status changes, and batch activity
-- with strict RLS policies, automated triggers, deduplication, and Realtime synchronization.

-- 1. Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('mention', 'reaction', 'status_change', 'batch_activity')),
  title text NOT NULL,
  message text NOT NULL,
  batch_id uuid REFERENCES public.batches(id) ON DELETE CASCADE,
  image_id uuid REFERENCES public.batch_images(id) ON DELETE CASCADE,
  annotation_id uuid REFERENCES public.annotations(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for instant unread query and listing
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON public.notifications (recipient_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_batch_id
  ON public.notifications (batch_id);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.notifications FROM anon;
REVOKE ALL ON public.notifications FROM authenticated;

GRANT SELECT, DELETE ON public.notifications TO authenticated;

GRANT UPDATE (is_read, read_at)
ON public.notifications TO authenticated;

-- RLS: Recipients can only read their own notifications
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (recipient_id = auth.uid());

-- RLS: Recipients can update (mark as read) their own notifications
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- RLS: Recipients can delete/dismiss their own notifications
DROP POLICY IF EXISTS notifications_delete_own ON public.notifications;
CREATE POLICY notifications_delete_own
  ON public.notifications
  FOR DELETE
  TO authenticated
  USING (recipient_id = auth.uid());

-- Direct client INSERT is revoked; all notifications are generated strictly via SECURITY DEFINER triggers.
DROP POLICY IF EXISTS notifications_insert_authorized ON public.notifications;

-- 2. Automated Notification Trigger: Mentions
CREATE OR REPLACE FUNCTION public.notify_on_annotation_mention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_name text;
  v_annotation public.annotations%ROWTYPE;
  v_batch_id uuid;
  v_snippet text;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL OR v_actor_id = new.mentioned_user_id THEN
    RETURN new;
  END IF;

  SELECT * INTO v_annotation
  FROM public.annotations
  WHERE id = new.annotation_id;

  IF NOT FOUND THEN
    RETURN new;
  END IF;

  SELECT bi.batch_id INTO v_batch_id
  FROM public.batch_images bi
  WHERE bi.id = v_annotation.image_id;

  SELECT COALESCE(NULLIF(trim(display_name), ''), 'A reviewer') INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor_id;

  v_actor_name := COALESCE(v_actor_name, 'A reviewer');

  v_snippet := COALESCE(substring(v_annotation.comment from 1 for 120), '');

  -- Avoid duplicate notification for the same annotation mention
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE recipient_id = new.mentioned_user_id
      AND annotation_id = new.annotation_id
      AND type = 'mention'
  ) THEN
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
      new.mentioned_user_id,
      v_actor_id,
      'mention',
      v_actor_name || ' mentioned you in a review comment',
      v_snippet,
      v_batch_id,
      v_annotation.image_id,
      new.annotation_id,
      jsonb_build_object('actorName', v_actor_name, 'annotationNumber', v_annotation.annotation_number, 'displayNumber', v_annotation.annotation_number)
    );
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_annotation_mention ON public.annotation_mentions;
CREATE TRIGGER trg_notify_on_annotation_mention
  AFTER INSERT ON public.annotation_mentions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_annotation_mention();

-- 3. Automated Notification Trigger: Reactions
CREATE OR REPLACE FUNCTION public.notify_on_annotation_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_name text;
  v_annotation public.annotations%ROWTYPE;
  v_batch_id uuid;
  v_snippet text;
BEGIN
  SELECT * INTO v_annotation
  FROM public.annotations
  WHERE id = new.annotation_id;

  IF NOT FOUND THEN
    RETURN new;
  END IF;

  -- Do not notify if user reacted to their own comment
  IF v_annotation.created_by = new.user_id THEN
    RETURN new;
  END IF;

  SELECT bi.batch_id INTO v_batch_id
  FROM public.batch_images bi
  WHERE bi.id = v_annotation.image_id;

  SELECT COALESCE(NULLIF(trim(display_name), ''), 'A reviewer') INTO v_actor_name
  FROM public.profiles
  WHERE id = new.user_id;

  v_actor_name := COALESCE(v_actor_name, 'A reviewer');

  v_snippet := COALESCE(substring(v_annotation.comment from 1 for 100), '');

  -- Insert notification for comment author
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
    new.user_id,
    'reaction',
    v_actor_name || ' reacted ' || new.emoji || ' to your comment',
    v_snippet,
    v_batch_id,
    v_annotation.image_id,
    new.annotation_id,
    jsonb_build_object('emoji', new.emoji, 'actorName', v_actor_name, 'annotationNumber', v_annotation.annotation_number, 'displayNumber', v_annotation.annotation_number)
  );

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_annotation_reaction ON public.annotation_reactions;
CREATE TRIGGER trg_notify_on_annotation_reaction
  AFTER INSERT ON public.annotation_reactions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_annotation_reaction();

-- 4. Automated Notification Trigger: Status Changes (Resolved / Reopened)
CREATE OR REPLACE FUNCTION public.notify_on_annotation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_name text;
  v_batch_id uuid;
  v_status_label text;
  v_snippet text;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL OR old.status = new.status THEN
    RETURN new;
  END IF;

  -- Only notify if the actor is not the creator of the annotation
  IF new.created_by = v_actor_id THEN
    RETURN new;
  END IF;

  SELECT bi.batch_id INTO v_batch_id
  FROM public.batch_images bi
  WHERE bi.id = new.image_id;

  SELECT COALESCE(NULLIF(trim(display_name), ''), 'A reviewer') INTO v_actor_name
  FROM public.profiles
  WHERE id = v_actor_id;

  v_actor_name := COALESCE(v_actor_name, 'A reviewer');

  v_status_label := CASE WHEN new.status = 'resolved' THEN 'resolved' ELSE 'reopened' END;
  v_snippet := COALESCE(substring(new.comment from 1 for 100), '');

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
    new.created_by,
    v_actor_id,
    'status_change',
    v_actor_name || ' marked #' || new.annotation_number || ' as ' || v_status_label,
    v_snippet,
    v_batch_id,
    new.image_id,
    new.id,
    jsonb_build_object('status', new.status, 'actorName', v_actor_name, 'annotationNumber', new.annotation_number, 'displayNumber', new.annotation_number)
  );

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_annotation_status_change ON public.annotations;
CREATE TRIGGER trg_notify_on_annotation_status_change
  AFTER UPDATE OF status ON public.annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_annotation_status_change();

-- 5. Enable Realtime on notifications
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'notifications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
  END IF;
END $$;

