-- Phase 15: Shared Batch Collaborative Whiteboard
-- Target: Supabase PostgreSQL (run after 001 through 008 migrations)
-- Creates batch-level whiteboard storage independent from image annotations,
-- with full Row Level Security, creator ownership, and Supabase Realtime synchronization.
BEGIN;
-- 1. Helper function: check if authenticated user can view the batch whiteboard
CREATE OR REPLACE FUNCTION public.can_view_batch(target_batch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.batches AS b
      WHERE b.id = target_batch_id
        AND (
          b.owner_id = auth.uid()
          OR public.is_reviewer_or_admin()
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_batch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_batch(uuid) TO authenticated;

-- 2. Helper function: check if authenticated user can collaborate (insert/update/delete)
--    Only Reviewers and Admins are authorized to collaborate on the whiteboard.
--    Uploaders have view-only access.
CREATE OR REPLACE FUNCTION public.can_collaborate_on_batch_whiteboard(target_batch_id uuid)
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
      FROM public.batches AS b
      WHERE b.id = target_batch_id
    );
$$;

REVOKE ALL ON FUNCTION public.can_collaborate_on_batch_whiteboard(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_collaborate_on_batch_whiteboard(uuid) TO authenticated;

-- 3. Batch Whiteboard Elements Table
CREATE TABLE IF NOT EXISTS public.batch_whiteboard_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('sticky', 'text', 'rectangle', 'circle', 'arrow', 'pencil')),
  x double precision NOT NULL DEFAULT 0,
  y double precision NOT NULL DEFAULT 0,
  width double precision DEFAULT NULL,
  height double precision DEFAULT NULL,
  text text DEFAULT '',
  color text NOT NULL DEFAULT '#fef08a',
  geometry jsonb NOT NULL DEFAULT '{}'::jsonb,
  z_index integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_batch_whiteboard_elements_batch
  ON public.batch_whiteboard_elements (batch_id, z_index ASC);

CREATE INDEX IF NOT EXISTS idx_batch_whiteboard_elements_creator
  ON public.batch_whiteboard_elements (created_by);

-- Automatic updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_whiteboard_element_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_whiteboard_element_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_set_whiteboard_element_updated_at ON public.batch_whiteboard_elements;
CREATE TRIGGER trg_set_whiteboard_element_updated_at
  BEFORE UPDATE ON public.batch_whiteboard_elements
  FOR EACH ROW
  EXECUTE FUNCTION public.set_whiteboard_element_updated_at();

-- Enable RLS
ALTER TABLE public.batch_whiteboard_elements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.batch_whiteboard_elements FROM anon;
REVOKE ALL ON public.batch_whiteboard_elements FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_whiteboard_elements TO authenticated;

-- RLS Policies
-- SELECT: Authorized if user can view the batch (Uploaders can view their own batches, Reviewers/Admins can view all accessible batches)
DROP POLICY IF EXISTS batch_whiteboard_elements_select_authorized ON public.batch_whiteboard_elements;
CREATE POLICY batch_whiteboard_elements_select_authorized
  ON public.batch_whiteboard_elements
  FOR SELECT
  TO authenticated
  USING (public.can_view_batch(batch_id));

-- INSERT: Only Reviewers and Admins can create elements
DROP POLICY IF EXISTS batch_whiteboard_elements_insert_authorized ON public.batch_whiteboard_elements;
CREATE POLICY batch_whiteboard_elements_insert_authorized
  ON public.batch_whiteboard_elements
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.can_collaborate_on_batch_whiteboard(batch_id)
  );

-- UPDATE: Reviewers can update their own elements, Admins can update any element in the batch
DROP POLICY IF EXISTS batch_whiteboard_elements_update_authorized ON public.batch_whiteboard_elements;
CREATE POLICY batch_whiteboard_elements_update_authorized
  ON public.batch_whiteboard_elements
  FOR UPDATE
  TO authenticated
  USING (
    (created_by = auth.uid() OR public.is_admin())
    AND public.can_collaborate_on_batch_whiteboard(batch_id)
  )
  WITH CHECK (
    (created_by = auth.uid() OR public.is_admin())
    AND public.can_collaborate_on_batch_whiteboard(batch_id)
  );

-- DELETE: Reviewers can delete their own elements, Admins can delete any element
DROP POLICY IF EXISTS batch_whiteboard_elements_delete_authorized ON public.batch_whiteboard_elements;
CREATE POLICY batch_whiteboard_elements_delete_authorized
  ON public.batch_whiteboard_elements
  FOR DELETE
  TO authenticated
  USING (
    (created_by = auth.uid() OR public.is_admin())
    AND public.can_collaborate_on_batch_whiteboard(batch_id)
  );

-- 4. Allow profile lookup for whiteboard creators
DROP POLICY IF EXISTS profiles_select_whiteboard_creators ON public.profiles;
CREATE POLICY profiles_select_whiteboard_creators
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.batch_whiteboard_elements AS bwe
      WHERE bwe.created_by = profiles.id
        AND public.can_view_batch(bwe.batch_id)
    )
  );

-- 5. Enable Supabase Realtime publication
ALTER TABLE public.batch_whiteboard_elements REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'batch_whiteboard_elements'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.batch_whiteboard_elements;
    END IF;
  END IF;
END $$;
COMMIT;