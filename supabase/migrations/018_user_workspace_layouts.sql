-- Phase 21B: User Workspace Layouts and Panel Preferences
-- Target: Supabase PostgreSQL (run after migrations 001 through 017)
-- Prepares user workspace layout storage, panel visibility preferences, and RLS policies.
-- (Prepared for manual review; unexecuted per guidelines)

-- ============================================================================
-- 1. User Workspace Layouts Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_workspace_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  layout_data jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_layouts_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT workspace_layouts_user_name_key UNIQUE (user_id, name)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_workspace_layouts_user_id
  ON public.user_workspace_layouts (user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_layouts_user_default
  ON public.user_workspace_layouts (user_id, is_default)
  WHERE is_default = true;

-- ============================================================================
-- 2. Row Level Security (RLS) Policies
-- ============================================================================

ALTER TABLE public.user_workspace_layouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own workspace layouts" ON public.user_workspace_layouts;
CREATE POLICY "Users can view their own workspace layouts"
  ON public.user_workspace_layouts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own workspace layouts" ON public.user_workspace_layouts;
CREATE POLICY "Users can insert their own workspace layouts"
  ON public.user_workspace_layouts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own workspace layouts" ON public.user_workspace_layouts;
CREATE POLICY "Users can update their own workspace layouts"
  ON public.user_workspace_layouts
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own workspace layouts" ON public.user_workspace_layouts;
CREATE POLICY "Users can delete their own workspace layouts"
  ON public.user_workspace_layouts
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- 3. Extend Profiles Table for Active Workspace Layout Preference
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_workspace_layout jsonb DEFAULT NULL;

-- ============================================================================
-- 4. Helper Stored Functions (RPC)
-- ============================================================================

-- Secure function to retrieve a user's saved layouts
CREATE OR REPLACE FUNCTION public.get_user_workspace_layouts(p_user_id uuid)
RETURNS SETOF public.user_workspace_layouts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT *
  FROM public.user_workspace_layouts
  WHERE user_id = p_user_id
  ORDER BY created_at ASC;
$$;

-- Secure function to upsert a workspace layout
CREATE OR REPLACE FUNCTION public.save_user_workspace_layout(
  p_name text,
  p_layout_data jsonb,
  p_is_default boolean DEFAULT false
)
RETURNS public.user_workspace_layouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_layout public.user_workspace_layouts;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_is_default THEN
    UPDATE public.user_workspace_layouts
    SET is_default = false
    WHERE user_id = v_user_id;
  END IF;

  INSERT INTO public.user_workspace_layouts (user_id, name, layout_data, is_default, updated_at)
  VALUES (v_user_id, btrim(p_name), p_layout_data, p_is_default, now())
  ON CONFLICT (user_id, name) DO UPDATE
    SET layout_data = EXCLUDED.layout_data,
        is_default = EXCLUDED.is_default,
        updated_at = now()
  RETURNING * INTO v_layout;

  RETURN v_layout;
END;
$$;

-- Secure function to delete a user workspace layout
CREATE OR REPLACE FUNCTION public.delete_user_workspace_layout(p_layout_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.user_workspace_layouts
  WHERE id = p_layout_id AND user_id = v_user_id;

  RETURN FOUND;
END;
$$;

-- Permissions
GRANT ALL ON public.user_workspace_layouts TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_workspace_layouts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_user_workspace_layout(text, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_workspace_layout(uuid) TO authenticated;

