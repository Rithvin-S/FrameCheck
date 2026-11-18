-- FrameCheck - Phase 20A: Annotation Assignment and Priority Management
-- Target: Supabase PostgreSQL (run after 001 through 014 migrations)
-- Adds assigned_to (FK to profiles) and priority ('critical' | 'high' | 'medium' | 'low')
-- to public.annotations with strict column-level grants, Row Level Security, trigger protections,
-- and indexes for efficient filtering.

BEGIN;

-- ============================================================================
-- Section 1: Add Additive Columns to public.annotations
-- ============================================================================

-- 1.1 assigned_to: UUID referencing public.profiles (reviewers and admins only)
ALTER TABLE public.annotations
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

-- 1.2 priority: Text priority level defaulting to 'medium'
ALTER TABLE public.annotations
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium';

-- 1.3 Priority check constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'annotations_priority_check'
      AND conrelid = 'public.annotations'::regclass
  ) THEN
    ALTER TABLE public.annotations
      ADD CONSTRAINT annotations_priority_check
      CHECK (priority IN ('critical', 'high', 'medium', 'low'));
  END IF;
END $$;


-- ============================================================================
-- Section 2: Assignee Validation Trigger
-- ============================================================================

-- Validates that when an annotation is assigned to a user, that user is an active
-- reviewer or administrator authorized to participate in the image's batch.
CREATE OR REPLACE FUNCTION public.validate_annotation_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_eligible boolean;
BEGIN
  IF NEW.assigned_to IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.batch_images bi
      JOIN public.batches b ON b.id = bi.batch_id
      JOIN public.profiles p ON p.id = NEW.assigned_to
      WHERE bi.id = NEW.image_id
        AND p.role IN ('reviewer', 'admin')
        AND public.can_view_batch(b.id)
    ) INTO v_is_eligible;

    IF NOT v_is_eligible THEN
      RAISE EXCEPTION 'Assignee must be an active reviewer or administrator eligible for this batch.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_annotation_assignment() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_annotation_assignment() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_annotations_validate_assignment ON public.annotations;
CREATE TRIGGER trg_annotations_validate_assignment
  BEFORE INSERT OR UPDATE OF assigned_to ON public.annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_annotation_assignment();


-- ============================================================================
-- Section 3: Update protect_annotation_columns Trigger Function
-- ============================================================================

-- Updates protect_annotation_columns() to normalize and validate priority,
-- protect assigned_to and priority from unintended mutation during trusted layer
-- deletion reassignment, and preserve all Phase 13/19 integrity guarantees.
CREATE OR REPLACE FUNCTION public.protect_annotation_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_geom_changed boolean;
  v_cols_changed boolean;
  v_is_trusted_layer_reassignment boolean;
BEGIN
  -- Strict immutable identity and creator columns (Phase 13 preservation)
  IF new.id IS DISTINCT FROM old.id THEN
    RAISE EXCEPTION 'Annotation id cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.image_id IS DISTINCT FROM old.image_id THEN
    RAISE EXCEPTION 'Annotation image_id cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.annotation_number IS DISTINCT FROM old.annotation_number THEN
    RAISE EXCEPTION 'Annotation number cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.created_by IS DISTINCT FROM old.created_by THEN
    RAISE EXCEPTION 'Annotation creator cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF new.created_at IS DISTINCT FROM old.created_at THEN
    RAISE EXCEPTION 'Annotation created_at cannot be modified.' USING ERRCODE = '42501';
  END IF;

  -- Annotation tool type is immutable once created
  IF new.type IS DISTINCT FROM old.type THEN
    RAISE EXCEPTION 'Annotation type cannot be modified.' USING ERRCODE = '42501';
  END IF;

  -- Determine if this update is executing from the trusted layer deletion trigger
  -- by checking the unforgeable layer_deletion_in_progress tracking table
  v_is_trusted_layer_reassignment := (
    new.layer_id = 'default'
    AND old.layer_id IS DISTINCT FROM 'default'
    AND EXISTS (
      SELECT 1
      FROM public.layer_deletion_in_progress ldip
      WHERE ldip.layer_id = old.layer_id
        AND ldip.txid = txid_current()
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.batch_annotation_layers bal
      WHERE bal.id::text = old.layer_id
    )
  );

  -- Narrowly scoped handling for trusted layer deletion reassignment
  IF v_is_trusted_layer_reassignment THEN
    -- Strictly prohibit modifying any other annotation column on active or soft-deleted annotations
    IF new.cx IS DISTINCT FROM old.cx OR
       new.cy IS DISTINCT FROM old.cy OR
       new.r IS DISTINCT FROM old.r OR
       new.color IS DISTINCT FROM old.color OR
       new.comment IS DISTINCT FROM old.comment OR
       new.status IS DISTINCT FROM old.status OR
       new.geometry IS DISTINCT FROM old.geometry OR
       new.style IS DISTINCT FROM old.style OR
       new.custom_properties IS DISTINCT FROM old.custom_properties OR
       new.labels IS DISTINCT FROM old.labels OR
       new.assigned_to IS DISTINCT FROM old.assigned_to OR
       new.priority IS DISTINCT FROM old.priority OR
       new.resolved_at IS DISTINCT FROM old.resolved_at OR
       new.deleted_at IS DISTINCT FROM old.deleted_at OR
       new.created_at IS DISTINCT FROM old.created_at OR
       new.created_by IS DISTINCT FROM old.created_by OR
       new.annotation_number IS DISTINCT FROM old.annotation_number OR
       new.image_id IS DISTINCT FROM old.image_id OR
       new.id IS DISTINCT FROM old.id OR
       new.type IS DISTINCT FROM old.type THEN
      RAISE EXCEPTION 'Layer deletion reassignment cannot modify other annotation fields.'
        USING ERRCODE = '42501';
    END IF;

    new.layer_id := 'default';
    -- On soft-deleted annotations, preserve original updated_at; on active annotations, refresh updated_at
    IF old.deleted_at IS NOT NULL THEN
      new.updated_at := old.updated_at;
    ELSE
      new.updated_at := v_now;
    END IF;

    RETURN new;
  END IF;

  -- Standard soft-delete protection (Phase 13 preservation)
  IF new.deleted_at IS DISTINCT FROM old.deleted_at THEN
    IF current_setting('framecheck.allow_deleted_at_mutation', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Annotation deletion state must be changed via RPC.' USING ERRCODE = '42501';
    END IF;
  ELSIF old.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted annotations cannot be edited.' USING ERRCODE = '42501';
  END IF;

  -- Validate incoming geometry type tag before modifying or overwriting it
  IF new.geometry IS NOT NULL AND new.geometry <> '{}'::jsonb THEN
    IF new.geometry ? 'type' THEN
      IF jsonb_typeof(new.geometry->'type') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Geometry type property must be a string.'
          USING ERRCODE = '23514';
      END IF;

      IF lower(btrim(new.geometry->>'type')) <> new.type THEN
        RAISE EXCEPTION 'Geometry type "%" does not match annotation type "%".',
          new.geometry->>'type', new.type
          USING ERRCODE = '23514';
      END IF;
    ELSE
      new.geometry := new.geometry || jsonb_build_object('type', new.type);
    END IF;
  END IF;

  -- Synchronize and validate geometry according to annotation type
  IF new.type = 'circle' THEN
    v_geom_changed := (new.geometry IS DISTINCT FROM old.geometry);
    v_cols_changed := (new.cx IS DISTINCT FROM old.cx OR new.cy IS DISTINCT FROM old.cy OR new.r IS DISTINCT FROM old.r);

    IF v_geom_changed AND NOT v_cols_changed THEN
      -- Geometry-only update: JSONB geometry is the canonical representation
      IF NOT public.validate_annotation_geometry('circle', new.geometry) THEN
        RAISE EXCEPTION 'Invalid or incomplete circle geometry payload.'
          USING ERRCODE = '23514';
      END IF;

      new.cx := (new.geometry->>'cx')::double precision;
      new.cy := (new.geometry->>'cy')::double precision;
      new.r  := (new.geometry->>'r')::double precision;
      new.geometry := jsonb_build_object('type', 'circle', 'cx', new.cx, 'cy', new.cy, 'r', new.r);

    ELSIF v_cols_changed AND NOT v_geom_changed THEN
      -- Legacy-only update: synchronize JSONB from legacy columns
      IF new.cx IS NULL OR new.cy IS NULL OR new.r IS NULL OR
         new.cx < 0.0 OR new.cx > 1.0 OR
         new.cy < 0.0 OR new.cy > 1.0 OR
         new.r <= 0.0 OR new.r > 1.0 THEN
        RAISE EXCEPTION 'Invalid circle coordinates on legacy columns.'
          USING ERRCODE = '23514';
      END IF;

      new.geometry := jsonb_build_object(
        'type', 'circle',
        'cx', new.cx,
        'cy', new.cy,
        'r', new.r
      );

    ELSIF v_geom_changed AND v_cols_changed THEN
      -- Both representations modified: validate both, reject conflicting values
      IF NOT public.validate_annotation_geometry('circle', new.geometry) THEN
        RAISE EXCEPTION 'Invalid or incomplete circle geometry payload.'
          USING ERRCODE = '23514';
      END IF;

      IF new.cx IS NULL OR new.cy IS NULL OR new.r IS NULL OR
         new.cx < 0.0 OR new.cx > 1.0 OR
         new.cy < 0.0 OR new.cy > 1.0 OR
         new.r <= 0.0 OR new.r > 1.0 THEN
        RAISE EXCEPTION 'Invalid circle coordinates on legacy columns.'
          USING ERRCODE = '23514';
      END IF;

      IF NOT public.circle_columns_match_geometry(new.cx, new.cy, new.r, new.geometry) THEN
        RAISE EXCEPTION 'Conflicting circle geometry values between columns (cx=%, cy=%, r=%) and geometry payload.',
          new.cx, new.cy, new.r
          USING ERRCODE = '23514';
      END IF;

      -- Canonical synchronization
      new.cx := (new.geometry->>'cx')::double precision;
      new.cy := (new.geometry->>'cy')::double precision;
      new.r  := (new.geometry->>'r')::double precision;
      new.geometry := jsonb_build_object('type', 'circle', 'cx', new.cx, 'cy', new.cy, 'r', new.r);

    ELSE
      -- Neither representation modified (e.g. metadata-only update: comment, color, status, style, custom_properties, labels, layer_id, assigned_to, priority)
      -- Verify existing geometry and ensure exact consistency
      IF NOT public.validate_annotation_geometry('circle', new.geometry) THEN
        RAISE EXCEPTION 'Existing circle geometry is invalid.'
          USING ERRCODE = '23514';
      END IF;

      IF NOT public.circle_columns_match_geometry(new.cx, new.cy, new.r, new.geometry) THEN
        RAISE EXCEPTION 'Conflicting circle geometry values between columns and geometry payload.'
          USING ERRCODE = '23514';
      END IF;

      new.cx := (new.geometry->>'cx')::double precision;
      new.cy := (new.geometry->>'cy')::double precision;
      new.r  := (new.geometry->>'r')::double precision;
      new.geometry := jsonb_build_object('type', 'circle', 'cx', new.cx, 'cy', new.cy, 'r', new.r);
    END IF;

  ELSE
    -- Non-circle annotations must keep legacy columns NULL
    new.cx := NULL;
    new.cy := NULL;
    new.r := NULL;

    IF new.geometry IS NULL OR new.geometry = '{}'::jsonb THEN
      RAISE EXCEPTION '% annotation requires complete geometry payload.', new.type
        USING ERRCODE = '23514';
    END IF;

    -- Validate complete geometry structure
    IF NOT public.validate_annotation_geometry(new.type, new.geometry) THEN
      RAISE EXCEPTION 'Invalid or incomplete geometry payload for % annotation.', new.type
        USING ERRCODE = '23514';
    END IF;
  END IF;

  new.comment := btrim(coalesce(new.comment, ''));
  new.color := lower(btrim(new.color));

  -- Normalize and validate priority
  new.priority := lower(btrim(coalesce(new.priority, 'medium')));
  IF new.priority NOT IN ('critical', 'high', 'medium', 'low') THEN
    RAISE EXCEPTION 'Invalid annotation priority "%". Must be critical, high, medium, or low.', new.priority
      USING ERRCODE = '23514';
  END IF;

  IF new.status = 'resolved' THEN
    IF old.status IS DISTINCT FROM 'resolved' OR old.resolved_at IS NULL THEN
      new.resolved_at := v_now;
    ELSE
      new.resolved_at := old.resolved_at;
    END IF;
  ELSE
    new.status := 'open';
    new.resolved_at := NULL;
  END IF;

  new.updated_at := v_now;
  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_annotation_columns() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.protect_annotation_columns() TO authenticated, service_role;


-- ============================================================================
-- Section 4: Row Level Security for Profiles (Assignee Visibility)
-- ============================================================================

-- Ensure authenticated users authorized to view an image can also view the display_name
-- of reviewers assigned to annotations on that image, without exposing private data.
DROP POLICY IF EXISTS profiles_select_annotation_assignees ON public.profiles;
CREATE POLICY profiles_select_annotation_assignees
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.annotations AS a
      WHERE a.assigned_to = profiles.id
        AND a.deleted_at IS NULL
        AND public.can_view_batch_image(a.image_id)
    )
  );


-- ============================================================================
-- Section 5: Permissions & Column-Level Grants
-- ============================================================================

-- Revoke column-level UPDATE on the new columns from PUBLIC and anon
REVOKE UPDATE (assigned_to, priority) ON public.annotations FROM PUBLIC, anon;

-- Grant column-level UPDATE on assigned_to and priority to authenticated role
GRANT UPDATE (assigned_to, priority) ON public.annotations TO authenticated;


-- ============================================================================
-- Section 6: Indexes for Performance
-- ============================================================================

-- Index for filtering active annotations by image and priority
CREATE INDEX IF NOT EXISTS idx_annotations_image_priority
  ON public.annotations (image_id, priority)
  WHERE deleted_at IS NULL;

-- Index for filtering active annotations by image and assigned reviewer
CREATE INDEX IF NOT EXISTS idx_annotations_image_assigned_to
  ON public.annotations (image_id, assigned_to)
  WHERE deleted_at IS NULL;

COMMIT;

