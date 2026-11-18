
-- Phase 22D: Theme and Onboarding Support
-- Target: Supabase PostgreSQL (run after migrations 001 through 020)
-- Adds theme preferences, onboarding completion tracking,
-- and synchronization with user workspace preferences.

BEGIN;

-- ============================================================================
-- 1. Profiles Table Extension
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'system';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Ensure the theme constraint exists even if the column already existed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_theme_valid'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_theme_valid
      CHECK (theme IN ('system', 'light', 'dark'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_profiles_theme
  ON public.profiles (theme);

-- ============================================================================
-- 2. Workspace Preferences JSONB Schema
-- ============================================================================
-- Migration 019 already creates user_workspace_preferences.
-- This migration does not replace or modify its existing JSONB structure.
--
-- Supported additional keys:
--   theme: "system" | "light" | "dark"
--   onboardingCompleted: boolean
--
-- Existing preference keys remain untouched.

-- ============================================================================
-- 3. Synchronization Trigger Function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_profile_theme_and_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pref_theme text;
  pref_onboarding boolean;
  raw_onboarding text;
BEGIN
  -- Prevent authenticated users from changing another user's profile.
  -- A NULL auth.uid() is allowed for trusted backend/service-role operations.
  IF auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Not authorized to update another user profile';
  END IF;

  IF NEW.preferences IS NOT NULL
     AND jsonb_typeof(NEW.preferences) = 'object' THEN

    pref_theme := NEW.preferences->>'theme';
    raw_onboarding := NEW.preferences->>'onboardingCompleted';

    -- Accept only supported theme values.
    IF pref_theme NOT IN ('system', 'light', 'dark') THEN
      pref_theme := NULL;
    END IF;

    -- Convert only valid boolean strings.
    IF raw_onboarding IN ('true', 'false') THEN
      pref_onboarding := raw_onboarding::boolean;
    ELSE
      pref_onboarding := NULL;
    END IF;

    UPDATE public.profiles
    SET
      theme = COALESCE(pref_theme, theme),
      onboarding_completed = COALESCE(pref_onboarding, onboarding_completed),
      updated_at = now()
    WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_theme_and_onboarding
  ON public.user_workspace_preferences;

CREATE TRIGGER trg_sync_profile_theme_and_onboarding
  AFTER INSERT OR UPDATE OF preferences
  ON public.user_workspace_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_theme_and_onboarding();

-- ============================================================================
-- 4. Appearance Settings RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_appearance_settings()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  result json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT json_build_object(
    'userId', id,
    'theme', COALESCE(theme, 'system'),
    'onboardingCompleted', COALESCE(onboarding_completed, false)
  )
  INTO result
  FROM public.profiles
  WHERE id = auth.uid();

  RETURN result;
END;
$$;

-- Restrict RPC execution to authenticated users.
REVOKE ALL
  ON FUNCTION public.get_user_appearance_settings()
  FROM PUBLIC, anon;

GRANT EXECUTE
  ON FUNCTION public.get_user_appearance_settings()
  TO authenticated;

COMMIT;
