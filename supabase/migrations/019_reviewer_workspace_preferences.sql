-- Phase 21C: Reviewer-Specific Workspace Preferences
-- Target: Supabase PostgreSQL (run after migrations 001 through 018)
-- Prepares reviewer workspace preferences storage, profile preferences column, and RLS policies.
-- (Prepared for manual review; unexecuted per guidelines)

-- ============================================================================
-- 1. Reviewer Workspace Preferences Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_workspace_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Performance Index
CREATE INDEX IF NOT EXISTS idx_user_workspace_preferences_user_id
  ON public.user_workspace_preferences (user_id);

-- ============================================================================
-- 2. Extend Profiles Table for Inlined Preferences
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS workspace_preferences jsonb DEFAULT '{}'::jsonb;

-- ============================================================================
-- 3. Row Level Security (RLS) Policies
-- ============================================================================

ALTER TABLE public.user_workspace_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own preferences" ON public.user_workspace_preferences;
CREATE POLICY "Users can view their own preferences"
  ON public.user_workspace_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own preferences" ON public.user_workspace_preferences;
CREATE POLICY "Users can insert their own preferences"
  ON public.user_workspace_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own preferences" ON public.user_workspace_preferences;
CREATE POLICY "Users can update their own preferences"
  ON public.user_workspace_preferences
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own preferences" ON public.user_workspace_preferences;
CREATE POLICY "Users can delete their own preferences"
  ON public.user_workspace_preferences
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- 4. Secure Helper Functions (RPC)
-- ============================================================================

-- Retrieve a user's workspace preferences
CREATE OR REPLACE FUNCTION public.get_user_workspace_preferences(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT preferences
  FROM public.user_workspace_preferences
  WHERE user_id = p_user_id;
$$;

-- Upsert a user's workspace preferences
CREATE OR REPLACE FUNCTION public.update_user_workspace_preferences(p_preferences jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.user_workspace_preferences (user_id, preferences, updated_at)
  VALUES (v_user_id, p_preferences, now())
  ON CONFLICT (user_id) DO UPDATE
    SET preferences = EXCLUDED.preferences,
        updated_at = now()
  RETURNING preferences INTO v_result;

  -- Also sync to profiles.workspace_preferences for query convenience
  UPDATE public.profiles
  SET workspace_preferences = p_preferences,
      updated_at = now()
  WHERE id = v_user_id;

  RETURN v_result;
END;
$$;

-- Permissions
GRANT ALL ON public.user_workspace_preferences TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_workspace_preferences(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_workspace_preferences(jsonb) TO authenticated;

