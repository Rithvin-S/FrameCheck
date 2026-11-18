-- FrameCheck - Phase 19: Advanced Annotation Customization & Organization
-- Target: Supabase PostgreSQL (run after 001 through 013 migrations)
-- Adds customizable drawing styles, structured custom properties, labels, and layer management
-- with least-privilege Column-Level Grants, Row Level Security, and Realtime synchronization.

BEGIN;

-- ============================================================================
-- Section 1: Add Additive Columns to public.annotations
-- ============================================================================

-- 1.1 style: jsonb storing strokeWidth, strokeOpacity, strokeColor, lineStyle,
--     fillEnabled, fillColor, fillOpacity, arrowHead, marker, markerColor
ALTER TABLE public.annotations
  ADD COLUMN IF NOT EXISTS style jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 1.2 custom_properties: jsonb array of structured metadata objects
--     [ { id, name, type, value, options } ]
ALTER TABLE public.annotations
  ADD COLUMN IF NOT EXISTS custom_properties jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 1.3 labels: jsonb array of label objects or identifiers
--     [ { id, name, color } ]
ALTER TABLE public.annotations
  ADD COLUMN IF NOT EXISTS labels jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 1.4 layer_id: text identifier linking to a batch annotation layer (default: 'default')
ALTER TABLE public.annotations
  ADD COLUMN IF NOT EXISTS layer_id text NOT NULL DEFAULT 'default';


-- ============================================================================
-- Section 2: Validation Functions & Constraints for Annotation Columns
-- ============================================================================

-- 2.1 Validate style object structure
CREATE OR REPLACE FUNCTION public.validate_annotation_style(p_style jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_style IS NULL THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_style) <> 'object' THEN
    RETURN false;
  END IF;

  -- Validate strokeWidth if present and not null
  IF p_style ? 'strokeWidth' AND jsonb_typeof(p_style->'strokeWidth') <> 'null' THEN
    IF jsonb_typeof(p_style->'strokeWidth') <> 'number' OR
       (p_style->>'strokeWidth')::double precision <= 0 OR
       (p_style->>'strokeWidth')::double precision > 50 THEN
      RETURN false;
    END IF;
  END IF;

  -- Validate strokeOpacity if present and not null
  IF p_style ? 'strokeOpacity' AND jsonb_typeof(p_style->'strokeOpacity') <> 'null' THEN
    IF jsonb_typeof(p_style->'strokeOpacity') <> 'number' OR
       (p_style->>'strokeOpacity')::double precision < 0 OR
       (p_style->>'strokeOpacity')::double precision > 1 THEN
      RETURN false;
    END IF;
  END IF;

  -- Validate strokeColor if present and not null
  IF p_style ? 'strokeColor' AND jsonb_typeof(p_style->'strokeColor') <> 'null' THEN
    IF jsonb_typeof(p_style->'strokeColor') <> 'string' OR
       (p_style->>'strokeColor') !~* '^#[0-9a-f]{6}$' THEN
      RETURN false;
    END IF;
  END IF;

  -- Validate lineStyle if present and not null
  IF p_style ? 'lineStyle' AND jsonb_typeof(p_style->'lineStyle') <> 'null' THEN
    IF jsonb_typeof(p_style->'lineStyle') <> 'string' OR
       (p_style->>'lineStyle') NOT IN ('solid', 'dashed', 'dotted') THEN
      RETURN false;
    END IF;
  END IF;

  -- Validate fillEnabled if present and not null
  IF p_style ? 'fillEnabled' AND jsonb_typeof(p_style->'fillEnabled') <> 'null' THEN
    IF jsonb_typeof(p_style->'fillEnabled') <> 'boolean' THEN
      RETURN false;
    END IF;
  END IF;

  -- Validate fillColor if present and not null
  IF p_style ? 'fillColor' AND jsonb_typeof(p_style->'fillColor') <> 'null' THEN
    IF jsonb_typeof(p_style->'fillColor') <> 'string' OR
       (p_style->>'fillColor') !~* '^#[0-9a-f]{6}$' THEN
      RETURN false;
    END IF;
  END IF;

  -- Validate fillOpacity if present and not null
  IF p_style ? 'fillOpacity' AND jsonb_typeof(p_style->'fillOpacity') <> 'null' THEN
    IF jsonb_typeof(p_style->'fillOpacity') <> 'number' OR
       (p_style->>'fillOpacity')::double precision < 0 OR
       (p_style->>'fillOpacity')::double precision > 1 THEN
      RETURN false;
    END IF;
  END IF;

  -- Validate arrowHead if present and not null
  IF p_style ? 'arrowHead' AND jsonb_typeof(p_style->'arrowHead') <> 'null' THEN
    IF jsonb_typeof(p_style->'arrowHead') <> 'string' OR
       (p_style->>'arrowHead') NOT IN ('standard', 'filled', 'stealth', 'double') THEN
      RETURN false;
    END IF;
  END IF;

  -- Validate marker if present and not null
  IF p_style ? 'marker' AND jsonb_typeof(p_style->'marker') <> 'null' THEN
    IF jsonb_typeof(p_style->'marker') <> 'string' OR
       (p_style->>'marker') NOT IN ('star', 'flag', 'bug', 'pin', 'warning') THEN
      RETURN false;
    END IF;
  END IF;

  -- Validate markerColor if present and not null
  IF p_style ? 'markerColor' AND jsonb_typeof(p_style->'markerColor') <> 'null' THEN
    IF jsonb_typeof(p_style->'markerColor') <> 'string' OR
       (p_style->>'markerColor') !~* '^#[0-9a-f]{6}$' THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_annotation_style(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_annotation_style(jsonb) TO authenticated, service_role;

-- 2.2 Validate custom_properties array structure
CREATE OR REPLACE FUNCTION public.validate_custom_properties(p_props jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_type text;
  v_name text;
  v_lower_name text;
  v_names text[] := ARRAY[]::text[];
  v_val jsonb;
  v_val_text text;
  v_opt jsonb;
  v_opt_text text;
  v_opt_texts text[];
BEGIN
  IF p_props IS NULL OR jsonb_typeof(p_props) <> 'array' THEN
    RETURN false;
  END IF;

  IF jsonb_array_length(p_props) > 50 THEN
    RETURN false;
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(p_props)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RETURN false;
    END IF;

    -- Validate id if present
    IF v_item ? 'id' AND jsonb_typeof(v_item->'id') <> 'null' THEN
      IF jsonb_typeof(v_item->'id') <> 'string' OR
         char_length(btrim(v_item->>'id')) = 0 OR
         char_length(v_item->>'id') > 100 THEN
        RETURN false;
      END IF;
    END IF;

    -- Validate name
    IF NOT (v_item ? 'name') OR jsonb_typeof(v_item->'name') <> 'string' THEN
      RETURN false;
    END IF;

    v_name := btrim(v_item->>'name');
    IF char_length(v_name) < 1 OR char_length(v_name) > 100 THEN
      RETURN false;
    END IF;

    -- Enforce case-insensitive uniqueness of property names within annotation
    v_lower_name := lower(v_name);
    IF v_lower_name = ANY(v_names) THEN
      RETURN false;
    END IF;
    v_names := array_append(v_names, v_lower_name);

    -- Validate type
    IF NOT (v_item ? 'type') OR jsonb_typeof(v_item->'type') <> 'string' THEN
      RETURN false;
    END IF;

    v_type := lower(btrim(v_item->>'type'));
    IF v_type NOT IN ('text', 'number', 'boolean', 'date', 'select') THEN
      RETURN false;
    END IF;

    -- Validate options for select and other types
    IF v_type = 'select' THEN
      -- A select property must contain a valid, non-empty options array
      IF NOT (v_item ? 'options') OR jsonb_typeof(v_item->'options') <> 'array' THEN
        RETURN false;
      END IF;

      IF jsonb_array_length(v_item->'options') < 1 OR jsonb_array_length(v_item->'options') > 100 THEN
        RETURN false;
      END IF;

      v_opt_texts := ARRAY[]::text[];
      FOR v_opt IN SELECT jsonb_array_elements(v_item->'options')
      LOOP
        IF jsonb_typeof(v_opt) <> 'string' THEN
          RETURN false;
        END IF;
        v_opt_text := btrim(v_opt#>>'{}');
        IF char_length(v_opt_text) < 1 OR char_length(v_opt_text) > 100 THEN
          RETURN false;
        END IF;
        -- Reject duplicate options (case-insensitive)
        IF lower(v_opt_text) = ANY(v_opt_texts) THEN
          RETURN false;
        END IF;
        v_opt_texts := array_append(v_opt_texts, lower(v_opt_text));
      END LOOP;

    ELSIF v_item ? 'options' AND jsonb_typeof(v_item->'options') <> 'null' THEN
      -- Optional options array for non-select types (must be array of strings if present)
      IF jsonb_typeof(v_item->'options') <> 'array' THEN
        RETURN false;
      END IF;
      FOR v_opt IN SELECT jsonb_array_elements(v_item->'options')
      LOOP
        IF jsonb_typeof(v_opt) <> 'string' OR char_length(v_opt#>>'{}') > 100 THEN
          RETURN false;
        END IF;
      END LOOP;
    END IF;

    -- Validate value
    IF v_item ? 'value' AND jsonb_typeof(v_item->'value') <> 'null' THEN
      v_val := v_item->'value';
      IF v_type = 'number' THEN
        IF jsonb_typeof(v_val) = 'number' THEN
          NULL;
        ELSIF jsonb_typeof(v_val) = 'string' THEN
          v_val_text := btrim(v_val#>>'{}');
          IF v_val_text <> '' AND v_val_text !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
            RETURN false;
          END IF;
        ELSE
          RETURN false;
        END IF;
      ELSIF v_type = 'boolean' THEN
        IF jsonb_typeof(v_val) <> 'boolean' THEN
          RETURN false;
        END IF;
      ELSIF v_type = 'date' THEN
        IF jsonb_typeof(v_val) <> 'string' THEN
          RETURN false;
        END IF;
        v_val_text := btrim(v_val#>>'{}');
        IF v_val_text <> '' THEN
          -- Strict YYYY-MM-DD pattern
          IF v_val_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            RETURN false;
          END IF;
          -- Calendar date validity (leap years, 28-31 day months, valid year range)
          BEGIN
            PERFORM v_val_text::date;
          EXCEPTION WHEN OTHERS THEN
            RETURN false;
          END;
        END IF;
      ELSIF v_type = 'select' THEN
        IF jsonb_typeof(v_val) <> 'string' THEN
          RETURN false;
        END IF;
        v_val_text := btrim(v_val#>>'{}');
        -- Non-empty selected value must match one of the declared options
        IF v_val_text <> '' THEN
          IF NOT (lower(v_val_text) = ANY(v_opt_texts)) THEN
            RETURN false;
          END IF;
        END IF;
      ELSIF v_type = 'text' THEN
        IF jsonb_typeof(v_val) <> 'string' OR char_length(v_val#>>'{}') > 2000 THEN
          RETURN false;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_custom_properties(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_custom_properties(jsonb) TO authenticated, service_role;

-- 2.3 Validate labels array structure (accepts both string names and objects with name or text)
CREATE OR REPLACE FUNCTION public.validate_annotation_labels(p_labels jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_name text;
  v_color text;
BEGIN
  IF p_labels IS NULL OR jsonb_typeof(p_labels) <> 'array' THEN
    RETURN false;
  END IF;

  IF jsonb_array_length(p_labels) > 50 THEN
    RETURN false;
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(p_labels)
  LOOP
    IF jsonb_typeof(v_item) = 'string' THEN
      v_name := btrim(v_item#>>'{}');
      IF char_length(v_name) < 1 OR char_length(v_name) > 50 THEN
        RETURN false;
      END IF;
    ELSIF jsonb_typeof(v_item) = 'object' THEN
      IF v_item ? 'name' AND jsonb_typeof(v_item->'name') = 'string' THEN
        v_name := btrim(v_item->>'name');
      ELSIF v_item ? 'text' AND jsonb_typeof(v_item->'text') = 'string' THEN
        v_name := btrim(v_item->>'text');
      ELSE
        RETURN false;
      END IF;

      IF char_length(v_name) < 1 OR char_length(v_name) > 50 THEN
        RETURN false;
      END IF;

      IF v_item ? 'id' AND jsonb_typeof(v_item->'id') <> 'null' THEN
        IF jsonb_typeof(v_item->'id') <> 'string' OR
           char_length(btrim(v_item->>'id')) = 0 OR
           char_length(v_item->>'id') > 100 THEN
          RETURN false;
        END IF;
      END IF;

      IF v_item ? 'color' AND jsonb_typeof(v_item->'color') <> 'null' THEN
        IF jsonb_typeof(v_item->'color') <> 'string' THEN
          RETURN false;
        END IF;
        v_color := btrim(v_item->>'color');
        IF v_color !~* '^#[0-9a-f]{6}$' THEN
          RETURN false;
        END IF;
      END IF;
    ELSE
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_annotation_labels(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_annotation_labels(jsonb) TO authenticated, service_role;

-- 2.4 Apply constraints to public.annotations
ALTER TABLE public.annotations
  DROP CONSTRAINT IF EXISTS annotations_style_valid;
ALTER TABLE public.annotations
  ADD CONSTRAINT annotations_style_valid
    CHECK (public.validate_annotation_style(style));

ALTER TABLE public.annotations
  DROP CONSTRAINT IF EXISTS annotations_custom_properties_valid;
ALTER TABLE public.annotations
  ADD CONSTRAINT annotations_custom_properties_valid
    CHECK (public.validate_custom_properties(custom_properties));

ALTER TABLE public.annotations
  DROP CONSTRAINT IF EXISTS annotations_labels_valid;
ALTER TABLE public.annotations
  ADD CONSTRAINT annotations_labels_valid
    CHECK (public.validate_annotation_labels(labels));

-- Index on layer_id for active annotations
CREATE INDEX IF NOT EXISTS idx_annotations_layer_id_active
  ON public.annotations (layer_id)
  WHERE deleted_at IS NULL;


-- ============================================================================
-- Section 3: Batch Annotation Layers & Layer Deletion Tracking Tables
-- ============================================================================

-- 3.1 batch_annotation_layers table
CREATE TABLE IF NOT EXISTS public.batch_annotation_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  display_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT batch_annotation_layers_name_nonempty CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT batch_annotation_layers_color_valid CHECK (color ~* '^#[0-9a-f]{6}$'),
  CONSTRAINT batch_annotation_layers_unique_name_per_batch UNIQUE (batch_id, name)
);

CREATE INDEX IF NOT EXISTS idx_batch_annotation_layers_batch_order
  ON public.batch_annotation_layers (batch_id, display_order ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_batch_annotation_layers_created_by
  ON public.batch_annotation_layers (created_by);

-- 3.2 Trusted tracking table for in-progress layer deletions
--     Used exclusively by privileged SECURITY DEFINER triggers to authorize cascading layer reassignments.
--     Zero access is granted to PUBLIC, anon, or authenticated users.
CREATE TABLE IF NOT EXISTS public.layer_deletion_in_progress (
  layer_id text PRIMARY KEY,
  txid bigint NOT NULL DEFAULT txid_current()
);

ALTER TABLE public.layer_deletion_in_progress ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.layer_deletion_in_progress FROM PUBLIC;
REVOKE ALL ON public.layer_deletion_in_progress FROM anon;
REVOKE ALL ON public.layer_deletion_in_progress FROM authenticated;
GRANT ALL ON public.layer_deletion_in_progress TO service_role;


-- ============================================================================
-- Section 4: Triggers for Layer Integrity, Ownership & Safe Deletion
-- ============================================================================

-- 4.1 Write protection & auto-population trigger for batch_annotation_layers
CREATE OR REPLACE FUNCTION public.handle_batch_annotation_layers_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Enforce authenticated creator ownership to prevent identity impersonation
    IF auth.uid() IS NOT NULL THEN
      IF NEW.created_by IS NOT NULL AND NEW.created_by <> auth.uid() THEN
        RAISE EXCEPTION 'Layer created_by must match the authenticated user.'
          USING ERRCODE = '42501';
      END IF;
      NEW.created_by := auth.uid();
    END IF;

    NEW.name := btrim(NEW.name);
    NEW.color := lower(btrim(NEW.color));
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Prevent modifying immutable identity, batch association, creator, or creation timestamp
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Layer id cannot be modified.' USING ERRCODE = '42501';
    END IF;

    IF NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
      RAISE EXCEPTION 'Layer batch_id cannot be modified.' USING ERRCODE = '42501';
    END IF;

    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Layer creator cannot be modified.' USING ERRCODE = '42501';
    END IF;

    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Layer created_at cannot be modified.' USING ERRCODE = '42501';
    END IF;

    NEW.name := btrim(NEW.name);
    NEW.color := lower(btrim(NEW.color));
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_batch_annotation_layers_write() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_batch_annotation_layers_write() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_batch_annotation_layers_write ON public.batch_annotation_layers;
CREATE TRIGGER trg_batch_annotation_layers_write
  BEFORE INSERT OR UPDATE ON public.batch_annotation_layers
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_batch_annotation_layers_write();

-- 4.2 Safe Layer Deletion Trigger
-- When an authorized layer deletion occurs, records the layer in public.layer_deletion_in_progress
-- and reassigns all annotations referencing the layer to 'default'.
-- Removes the tracking row immediately after reassignment completes.
CREATE OR REPLACE FUNCTION public.handle_batch_annotation_layer_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_layer_id_str text;
BEGIN
  v_layer_id_str := OLD.id::text;

  -- Record this layer deletion in the trusted, unforgeable tracking table
  INSERT INTO public.layer_deletion_in_progress (layer_id, txid)
  VALUES (v_layer_id_str, txid_current())
  ON CONFLICT (layer_id) DO UPDATE SET txid = EXCLUDED.txid;

  -- Reassign all annotations referencing the deleted layer to 'default'
  UPDATE public.annotations
  SET layer_id = 'default'
  WHERE layer_id = v_layer_id_str;

  -- Remove tracking entry immediately after the reassignment completes
  DELETE FROM public.layer_deletion_in_progress
  WHERE layer_id = v_layer_id_str;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_batch_annotation_layer_deleted() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_batch_annotation_layer_deleted() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_batch_annotation_layers_after_delete ON public.batch_annotation_layers;
CREATE TRIGGER trg_batch_annotation_layers_after_delete
  AFTER DELETE ON public.batch_annotation_layers
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_batch_annotation_layer_deleted();

-- 4.3 Validate layer_id assignment on public.annotations
-- Ensures annotations cannot be assigned to nonexistent layers or layers from other batches.
-- Acquires a shared row lock (FOR SHARE) on the target layer to eliminate concurrent deletion races.
CREATE OR REPLACE FUNCTION public.validate_annotation_layer_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_id uuid;
BEGIN
  -- Default layer is always permitted
  IF NEW.layer_id IS NULL OR btrim(NEW.layer_id) = '' OR NEW.layer_id = 'default' THEN
    NEW.layer_id := 'default';
    RETURN NEW;
  END IF;

  -- Look up batch_id for the target image
  SELECT bi.batch_id INTO v_batch_id
  FROM public.batch_images bi
  WHERE bi.id = NEW.image_id;

  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'Target batch image not found for annotation.'
      USING ERRCODE = '23503';
  END IF;

  -- Verify custom layer belongs to the exact same batch and lock for share to prevent concurrent deletion
  BEGIN
    PERFORM 1
    FROM public.batch_annotation_layers bal
    WHERE bal.id = NEW.layer_id::uuid
      AND bal.batch_id = v_batch_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid layer_id: layer does not exist in this batch.'
        USING ERRCODE = '23503';
    END IF;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid layer_id: not a valid UUID.'
        USING ERRCODE = '23503';
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_annotation_layer_assignment() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_annotation_layer_assignment() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_annotations_validate_layer ON public.annotations;
CREATE TRIGGER trg_annotations_validate_layer
  BEFORE INSERT OR UPDATE OF layer_id ON public.annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_annotation_layer_assignment();

-- 4.4 Update protect_annotation_columns trigger function
--     Preserves all Phase 13 (Migration 008) geometry, circle legacy synchronization,
--     immutable columns, soft-delete restrictions, comment/color normalization, and status handling.
--     Authorizes layer reassignment strictly during trusted layer deletion (verified via
--     public.layer_deletion_in_progress) while strictly prohibiting modification of any other column.
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
      -- Neither representation modified (e.g. metadata-only update: comment, color, status, style, custom_properties, labels, layer_id)
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

DROP TRIGGER IF EXISTS trg_annotations_protect_columns ON public.annotations;
CREATE TRIGGER trg_annotations_protect_columns
  BEFORE UPDATE ON public.annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_annotation_columns();


-- ============================================================================
-- Section 5: Row Level Security for batch_annotation_layers
-- ============================================================================

ALTER TABLE public.batch_annotation_layers ENABLE ROW LEVEL SECURITY;

-- 5.1 SELECT: Any user authorized to view the batch can view its annotation layers
DROP POLICY IF EXISTS batch_annotation_layers_select_authorized ON public.batch_annotation_layers;
CREATE POLICY batch_annotation_layers_select_authorized
  ON public.batch_annotation_layers
  FOR SELECT
  TO authenticated
  USING (public.can_view_batch(batch_id));

-- 5.2 INSERT: Only reviewers and admins with batch access can create layers
--     Creator identity is strictly checked against auth.uid()
DROP POLICY IF EXISTS batch_annotation_layers_insert_authorized ON public.batch_annotation_layers;
CREATE POLICY batch_annotation_layers_insert_authorized
  ON public.batch_annotation_layers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_reviewer_or_admin()
    AND public.can_view_batch(batch_id)
    AND (created_by = auth.uid() OR created_by IS NULL)
  );

-- 5.3 UPDATE: Layer creator (with active reviewer status) or Admin can rename/modify layer within the batch
DROP POLICY IF EXISTS batch_annotation_layers_update_authorized ON public.batch_annotation_layers;
CREATE POLICY batch_annotation_layers_update_authorized
  ON public.batch_annotation_layers
  FOR UPDATE
  TO authenticated
  USING (
    public.is_reviewer_or_admin()
    AND public.can_view_batch(batch_id)
    AND (created_by = auth.uid() OR public.is_admin())
  )
  WITH CHECK (
    public.is_reviewer_or_admin()
    AND public.can_view_batch(batch_id)
    AND (created_by = auth.uid() OR public.is_admin())
  );

-- 5.4 DELETE: Layer creator (with active reviewer status) or Admin can delete layer within the batch
DROP POLICY IF EXISTS batch_annotation_layers_delete_authorized ON public.batch_annotation_layers;
CREATE POLICY batch_annotation_layers_delete_authorized
  ON public.batch_annotation_layers
  FOR DELETE
  TO authenticated
  USING (
    public.is_reviewer_or_admin()
    AND public.can_view_batch(batch_id)
    AND (created_by = auth.uid() OR public.is_admin())
  );


-- ============================================================================
-- Section 6: Permissions & Column-Level Grants
-- ============================================================================

-- Table permissions for batch_annotation_layers
REVOKE ALL ON public.batch_annotation_layers FROM PUBLIC;
REVOKE ALL ON public.batch_annotation_layers FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_annotation_layers TO authenticated;

-- Table permissions for public.annotations:
-- 6.1 Revoke all table-level privileges from PUBLIC and anon
REVOKE ALL ON public.annotations FROM PUBLIC;
REVOKE ALL ON public.annotations FROM anon;

-- 6.2 Revoke table-level UPDATE from authenticated to enforce column-level updates
REVOKE UPDATE ON public.annotations FROM authenticated;

-- Ensure authenticated role retains SELECT and INSERT on annotations
GRANT SELECT, INSERT ON public.annotations TO authenticated;

-- 6.3 Explicitly revoke column-level UPDATE on EVERY column of public.annotations
--     from PUBLIC, anon, and authenticated to eliminate any residual column grants
--     from migrations 001–013 or default privileges.
REVOKE UPDATE (
  id,
  image_id,
  annotation_number,
  created_by,
  created_at,
  type,
  deleted_at,
  resolved_at,
  updated_at,
  cx,
  cy,
  r,
  color,
  comment,
  status,
  geometry,
  style,
  custom_properties,
  labels,
  layer_id
) ON public.annotations FROM PUBLIC, anon, authenticated;

-- 6.4 Grant column-level UPDATE exclusively on the 11 authorized editable columns to authenticated
GRANT UPDATE (
  cx,
  cy,
  r,
  color,
  comment,
  status,
  geometry,
  style,
  custom_properties,
  labels,
  layer_id
) ON public.annotations TO authenticated;

-- Ensure annotations_update_authorized policy permits Creator or Admin,
-- strictly enforces deleted_at IS NULL on direct client UPDATEs (soft-delete/restore
-- RPCs are SECURITY DEFINER and bypass RLS), and preserves batch review authorization.
DROP POLICY IF EXISTS annotations_update_creator ON public.annotations;
DROP POLICY IF EXISTS annotations_update_authorized ON public.annotations;

CREATE POLICY annotations_update_authorized
  ON public.annotations
  FOR UPDATE
  TO authenticated
  USING (
    (created_by = auth.uid() OR public.is_admin())
    AND deleted_at IS NULL
    AND public.can_review_batch_image(image_id)
  )
  WITH CHECK (
    (created_by = auth.uid() OR public.is_admin())
    AND deleted_at IS NULL
    AND public.can_review_batch_image(image_id)
  );


-- ============================================================================
-- Section 7: Realtime Publication
-- ============================================================================

ALTER TABLE public.batch_annotation_layers REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'batch_annotation_layers'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.batch_annotation_layers;
    END IF;
  END IF;
END $$;

COMMIT;
