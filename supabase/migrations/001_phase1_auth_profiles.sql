-- Phase 1: Authentication, user profiles, and role-based access control
-- Target: Supabase PostgreSQL

-- 1. Profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'uploader',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT profiles_role_valid CHECK (role IN ('uploader', 'reviewer', 'admin')),
  CONSTRAINT profiles_display_name_valid CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);
CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON public.profiles (created_at);

-- 2. Admin role check helper (SECURITY DEFINER avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 3. Automatic profile provisioning on user signup (always defaults to 'uploader')
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_display_name text;
BEGIN
  v_display_name := left(
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'User'
    ),
    100
  );

  -- Ignore any client-supplied role metadata; all new signups start as 'uploader'.
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (new.id, v_display_name, 'uploader')
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 4. Column protection trigger on profile updates
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF new.id IS DISTINCT FROM old.id THEN
    RAISE EXCEPTION 'Profile id cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.created_at IS DISTINCT FROM old.created_at THEN
    RAISE EXCEPTION 'Profile created_at cannot be modified.' USING ERRCODE = '42501';
  END IF;

  new.display_name := btrim(new.display_name);

  IF new.role IS DISTINCT FROM old.role THEN
    IF current_setting('app.allow_role_change', true) IS DISTINCT FROM 'true'
       AND session_user NOT IN ('postgres', 'supabase_admin') THEN
      RAISE EXCEPTION 'Role changes can only be performed by an Admin.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  new.updated_at := timezone('utc', now());
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_protect_columns ON public.profiles;
CREATE TRIGGER trg_profiles_protect_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_columns();

-- 5. Least-privilege table grants and Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS profiles_select_admin ON public.profiles;
CREATE POLICY profiles_select_admin
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS profiles_update_own_display_name ON public.profiles;
CREATE POLICY profiles_update_own_display_name
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 6. Secure Admin RPCs
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id uuid,
  email text,
  display_name text,
  role text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: Admin access required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    coalesce(u.email::text, '') AS email,
    p.display_name,
    p.role,
    p.created_at,
    p.updated_at
  FROM public.profiles AS p
  JOIN auth.users AS u ON u.id = p.id
  ORDER BY p.created_at ASC, p.display_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  target_user_id uuid,
  new_role text
)
RETURNS TABLE (
  id uuid,
  display_name text,
  role text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_current_role text;
  v_admin_count bigint;
BEGIN
  v_actor_id := auth.uid();

  IF v_actor_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: Admin access required.' USING ERRCODE = '42501';
  END IF;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user ID is required.' USING ERRCODE = '22023';
  END IF;

  IF new_role IS NULL OR new_role NOT IN ('uploader', 'reviewer', 'admin') THEN
    RAISE EXCEPTION 'Invalid role specified. Allowed roles: uploader, reviewer, admin.'
      USING ERRCODE = '22023';
  END IF;

  IF target_user_id = v_actor_id THEN
    RAISE EXCEPTION 'Users cannot modify their own role.' USING ERRCODE = '42501';
  END IF;

  SELECT p.role
  INTO v_current_role
  FROM public.profiles AS p
  WHERE p.id = target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_current_role = 'admin' AND new_role <> 'admin' THEN
    -- Lock current admin rows to prevent concurrent demotions from leaving 0 admins.
    PERFORM 1
    FROM public.profiles AS p
    WHERE p.role = 'admin'
    FOR UPDATE;

    SELECT count(*)
    INTO v_admin_count
    FROM public.profiles AS p
    WHERE p.role = 'admin';

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last remaining Admin.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  PERFORM set_config('app.allow_role_change', 'true', true);

  RETURN QUERY
  UPDATE public.profiles AS p
  SET role = new_role
  WHERE p.id = target_user_id
  RETURNING p.id, p.display_name, p.role, p.created_at, p.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(uuid, text) TO authenticated;

-- 7. Backfill profiles for any pre-existing auth.users rows (defaults to 'uploader')
INSERT INTO public.profiles (id, display_name, role)
SELECT
  u.id,
  left(
    coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
      'User'
    ),
    100
  ),
  'uploader'
FROM auth.users AS u
LEFT JOIN public.profiles AS p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

