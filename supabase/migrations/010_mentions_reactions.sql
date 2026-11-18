-- Phase 16A: Reviewer Mentions and Reactions
-- Target: Supabase PostgreSQL (run after 001 through 009 migrations)
-- Implements comment mentions referencing user IDs and emoji reactions
-- with unique constraints, Row Level Security, and Realtime synchronization.

BEGIN;

-- 1. Helper function: list authorized mentionable users for a batch
--    Exposes only id, display_name, and role; avoids exposing private user emails or data.
CREATE OR REPLACE FUNCTION public.get_mentionable_users(target_batch_id uuid)
RETURNS TABLE (
  id uuid,
  display_name text,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.display_name, p.role
  FROM public.profiles AS p
  WHERE auth.uid() IS NOT NULL
    AND public.can_view_batch(target_batch_id)
    AND (
      p.role IN ('reviewer', 'admin')
      OR EXISTS (
        SELECT 1 FROM public.batches b
        WHERE b.id = target_batch_id AND b.owner_id = p.id
      )
    )
  ORDER BY p.display_name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_mentionable_users(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_mentionable_users(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_mentionable_users(uuid) TO authenticated;

-- 2. Helper function: validate mention insertion authorization
--    Verifies actor is reviewer/admin, allowed to review image, and target user is eligible.
CREATE OR REPLACE FUNCTION public.can_insert_annotation_mention(
  target_annotation_id uuid,
  target_mentioned_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.is_reviewer_or_admin()
    AND EXISTS (
      SELECT 1
      FROM public.annotations AS a
      JOIN public.batch_images AS bi ON bi.id = a.image_id
      JOIN public.batches AS b ON b.id = bi.batch_id
      JOIN public.profiles AS p ON p.id = target_mentioned_user_id
      WHERE a.id = target_annotation_id
        AND a.deleted_at IS NULL
        AND public.can_review_batch_image(a.image_id)
        AND (
          p.role IN ('reviewer', 'admin')
          OR b.owner_id = p.id
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_insert_annotation_mention(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_insert_annotation_mention(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_insert_annotation_mention(uuid, uuid) TO authenticated;

-- 3. Annotation Mentions Table
--    Stores structured user references for comments independently from display names.
CREATE TABLE IF NOT EXISTS public.annotation_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  annotation_id uuid NOT NULL REFERENCES public.annotations(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT annotation_mentions_unique_user UNIQUE (annotation_id, mentioned_user_id)
);

ALTER TABLE public.annotation_mentions ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_annotation_mentions_annotation_id
  ON public.annotation_mentions (annotation_id);

CREATE INDEX IF NOT EXISTS idx_annotation_mentions_user_id
  ON public.annotation_mentions (mentioned_user_id);

ALTER TABLE public.annotation_mentions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.annotation_mentions FROM anon;
REVOKE ALL ON public.annotation_mentions FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.annotation_mentions TO authenticated;

-- RLS: SELECT mentions if user can view the batch image
DROP POLICY IF EXISTS annotation_mentions_select_authorized ON public.annotation_mentions;
CREATE POLICY annotation_mentions_select_authorized
  ON public.annotation_mentions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.annotations a
      WHERE a.id = annotation_mentions.annotation_id
        AND public.can_view_batch_image(a.image_id)
    )
  );

-- RLS: INSERT mentions if actor is authorized reviewer and target user is eligible
DROP POLICY IF EXISTS annotation_mentions_insert_authorized ON public.annotation_mentions;
CREATE POLICY annotation_mentions_insert_authorized
  ON public.annotation_mentions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_insert_annotation_mention(annotation_id, mentioned_user_id)
  );

-- RLS: DELETE mentions if user owns the annotation or is admin
DROP POLICY IF EXISTS annotation_mentions_delete_authorized ON public.annotation_mentions;
CREATE POLICY annotation_mentions_delete_authorized
  ON public.annotation_mentions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.annotations a
      WHERE a.id = annotation_mentions.annotation_id
        AND (a.created_by = auth.uid() OR public.is_admin())
    )
  );

-- 4. Annotation Reactions Table
--    Stores emoji reactions (👍, ❤️, 😂, 👀, ✅) with unique constraint per (annotation_id, user_id, emoji)
CREATE TABLE IF NOT EXISTS public.annotation_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  annotation_id uuid NOT NULL REFERENCES public.annotations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '👀', '✅')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT annotation_reactions_unique_user_emoji UNIQUE (annotation_id, user_id, emoji)
);

ALTER TABLE public.annotation_reactions ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_annotation_reactions_annotation_id
  ON public.annotation_reactions (annotation_id);

CREATE INDEX IF NOT EXISTS idx_annotation_reactions_user_id
  ON public.annotation_reactions (user_id);

ALTER TABLE public.annotation_reactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.annotation_reactions FROM anon;
REVOKE ALL ON public.annotation_reactions FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.annotation_reactions TO authenticated;

-- RLS: SELECT reactions if user can view the batch image
DROP POLICY IF EXISTS annotation_reactions_select_authorized ON public.annotation_reactions;
CREATE POLICY annotation_reactions_select_authorized
  ON public.annotation_reactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.annotations a
      WHERE a.id = annotation_reactions.annotation_id
        AND public.can_view_batch_image(a.image_id)
    )
  );

-- RLS: INSERT reaction if user can review the batch image and reacts as themselves
DROP POLICY IF EXISTS annotation_reactions_insert_authorized ON public.annotation_reactions;
CREATE POLICY annotation_reactions_insert_authorized
  ON public.annotation_reactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.annotations a
      WHERE a.id = annotation_reactions.annotation_id
        AND public.can_review_batch_image(a.image_id)
    )
  );

-- RLS: DELETE reaction if user owns the reaction
DROP POLICY IF EXISTS annotation_reactions_delete_authorized ON public.annotation_reactions;
CREATE POLICY annotation_reactions_delete_authorized
  ON public.annotation_reactions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- 5. Enable Supabase Realtime publication for reactions and mentions
ALTER TABLE public.annotation_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.annotation_mentions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'annotation_reactions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.annotation_reactions;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'annotation_mentions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.annotation_mentions;
    END IF;
  END IF;
END $$;

COMMIT;

