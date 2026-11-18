-- Phase 13 Substep 1: Multi-tool annotation support (Circle, Arrow, Rectangle, Pencil, Callout)
-- Target: Supabase PostgreSQL (run after migrations 001 through 007)
-- Preserves all existing circle annotations, numbering sequence, RLS policies, and soft-delete/restore RPCs.

BEGIN;

-- 1. Add type and geometry columns if not present
ALTER TABLE public.annotations
  ADD COLUMN IF NOT EXISTS type text DEFAULT 'circle',
  ADD COLUMN IF NOT EXISTS geometry jsonb DEFAULT '{}'::jsonb;

-- 2. Backfill existing annotations safely
--    Temporarily disable the protection trigger because the backfill
--    must update existing soft-deleted annotations as well.
--    This is transaction-scoped and will roll back if migration fails.

ALTER TABLE public.annotations
  DISABLE TRIGGER trg_annotations_protect_columns;

--    a) Backfill type for any rows where type is NULL
UPDATE public.annotations
SET type = 'circle'
WHERE type IS NULL;

--    b) Ensure any non-empty geometry has its type tag set
--       without overwriting other properties
UPDATE public.annotations
SET geometry = geometry || jsonb_build_object('type', coalesce(type, 'circle'))
WHERE geometry IS NOT NULL
  AND geometry <> '{}'::jsonb
  AND NOT (geometry ? 'type');

--    c) Backfill geometry only for genuinely unpopulated rows
--       that have legacy circle coordinates
UPDATE public.annotations
SET
  type = 'circle',
  geometry = jsonb_build_object(
    'type', 'circle',
    'cx', cx,
    'cy', cy,
    'r', r
  )
WHERE (geometry IS NULL OR geometry = '{}'::jsonb)
  AND cx IS NOT NULL;

--    Re-enable protection immediately after the backfill
ALTER TABLE public.annotations
  ENABLE TRIGGER trg_annotations_protect_columns;

--    d) Enforce NOT NULL constraints explicitly
ALTER TABLE public.annotations
  ALTER COLUMN type SET NOT NULL,
  ALTER COLUMN geometry SET NOT NULL;

-- 3. Relax NOT NULL constraints on legacy circle-specific columns so non-circle tools can leave them null
ALTER TABLE public.annotations
  ALTER COLUMN cx DROP NOT NULL,
  ALTER COLUMN cy DROP NOT NULL,
  ALTER COLUMN r DROP NOT NULL;

-- 4. Drop legacy strict circle check constraints to make way for multi-type validation
ALTER TABLE public.annotations
  DROP CONSTRAINT IF EXISTS annotations_cx_valid,
  DROP CONSTRAINT IF EXISTS annotations_cy_valid,
  DROP CONSTRAINT IF EXISTS annotations_r_valid;

-- 5. Helper function: Safe comparison between circle columns and JSONB geometry
--    Guards against uncontrolled casting errors and evaluates safely in CHECK constraints and triggers.
CREATE OR REPLACE FUNCTION public.circle_columns_match_geometry(
  p_cx double precision,
  p_cy double precision,
  p_r double precision,
  p_geom jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cx double precision;
  v_cy double precision;
  v_r double precision;
BEGIN
  IF p_cx IS NULL OR p_cy IS NULL OR p_r IS NULL OR
     p_geom IS NULL OR jsonb_typeof(p_geom) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_geom->'cx') IS DISTINCT FROM 'number' OR
     jsonb_typeof(p_geom->'cy') IS DISTINCT FROM 'number' OR
     jsonb_typeof(p_geom->'r')  IS DISTINCT FROM 'number' THEN
    RETURN false;
  END IF;

  BEGIN
    v_cx := (p_geom->>'cx')::double precision;
    v_cy := (p_geom->>'cy')::double precision;
    v_r  := (p_geom->>'r')::double precision;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  IF v_cx IS NULL OR v_cy IS NULL OR v_r IS NULL OR
     v_cx = 'NaN'::double precision OR v_cy = 'NaN'::double precision OR v_r = 'NaN'::double precision OR
     v_cx = 'Infinity'::double precision OR v_cy = 'Infinity'::double precision OR v_r = 'Infinity'::double precision OR
     v_cx = '-Infinity'::double precision OR v_cy = '-Infinity'::double precision OR v_r = '-Infinity'::double precision THEN
    RETURN false;
  END IF;

  RETURN (abs(p_cx - v_cx) <= 1e-5 AND
          abs(p_cy - v_cy) <= 1e-5 AND
          abs(p_r  - v_r)  <= 1e-5);
END;
$$;

REVOKE ALL ON FUNCTION public.circle_columns_match_geometry(double precision, double precision, double precision, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.circle_columns_match_geometry(double precision, double precision, double precision, jsonb) TO authenticated, service_role;

-- 6. Geometry validation helper function
--    Validates normalized JSONB geometry for all 5 annotation types:
--    circle, arrow, rectangle, pencil, callout.
--    Pure/immutable function safe for CHECK constraints and triggers.
--    Uses NULL-safe type checks (IS DISTINCT FROM) and exception blocks
--    to prevent uncontrolled casting errors.
CREATE OR REPLACE FUNCTION public.validate_annotation_geometry(
  p_type text,
  p_geom jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type text;
  v_cx double precision;
  v_cy double precision;
  v_r double precision;
  v_sx double precision;
  v_sy double precision;
  v_ex double precision;
  v_ey double precision;
  v_x double precision;
  v_y double precision;
  v_w double precision;
  v_h double precision;
  v_px double precision;
  v_py double precision;
  v_bx double precision;
  v_by double precision;
  v_bw double precision;
  v_bh double precision;
  v_pt jsonb;
  v_points_len integer;
  v_text text;
BEGIN
  -- Geometry must be a valid JSON object
  IF p_type IS NULL OR p_geom IS NULL OR jsonb_typeof(p_geom) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;

  v_type := lower(btrim(p_type));

  -- If geometry explicitly specifies a type, it must be a JSON string and match p_type
  IF p_geom ? 'type' THEN
    IF jsonb_typeof(p_geom->'type') IS DISTINCT FROM 'string' OR
       lower(btrim(p_geom->>'type')) <> v_type THEN
      RETURN false;
    END IF;
  END IF;

  CASE v_type
    WHEN 'circle' THEN
      -- Required numeric fields: cx, cy, r
      IF jsonb_typeof(p_geom->'cx') IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'cy') IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'r')  IS DISTINCT FROM 'number' THEN
        RETURN false;
      END IF;

      BEGIN
        v_cx := (p_geom->>'cx')::double precision;
        v_cy := (p_geom->>'cy')::double precision;
        v_r  := (p_geom->>'r')::double precision;
      EXCEPTION WHEN OTHERS THEN
        RETURN false;
      END;

      IF v_cx IS NULL OR v_cy IS NULL OR v_r IS NULL OR
         v_cx = 'NaN'::double precision OR v_cy = 'NaN'::double precision OR v_r = 'NaN'::double precision OR
         v_cx = 'Infinity'::double precision OR v_cy = 'Infinity'::double precision OR v_r = 'Infinity'::double precision OR
         v_cx = '-Infinity'::double precision OR v_cy = '-Infinity'::double precision OR v_r = '-Infinity'::double precision OR
         v_cx < 0.0 OR v_cx > 1.0 OR
         v_cy < 0.0 OR v_cy > 1.0 OR
         v_r <= 0.0 OR v_r > 1.0 THEN
        RETURN false;
      END IF;

      RETURN true;

    WHEN 'arrow' THEN
      -- Required numeric fields: startX, startY, endX, endY
      IF jsonb_typeof(p_geom->'startX') IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'startY') IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'endX')   IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'endY')   IS DISTINCT FROM 'number' THEN
        RETURN false;
      END IF;

      BEGIN
        v_sx := (p_geom->>'startX')::double precision;
        v_sy := (p_geom->>'startY')::double precision;
        v_ex := (p_geom->>'endX')::double precision;
        v_ey := (p_geom->>'endY')::double precision;
      EXCEPTION WHEN OTHERS THEN
        RETURN false;
      END;

      IF v_sx IS NULL OR v_sy IS NULL OR v_ex IS NULL OR v_ey IS NULL OR
         v_sx = 'NaN'::double precision OR v_sy = 'NaN'::double precision OR
         v_ex = 'NaN'::double precision OR v_ey = 'NaN'::double precision OR
         v_sx = 'Infinity'::double precision OR v_sy = 'Infinity'::double precision OR
         v_ex = 'Infinity'::double precision OR v_ey = 'Infinity'::double precision OR
         v_sx = '-Infinity'::double precision OR v_sy = '-Infinity'::double precision OR
         v_ex = '-Infinity'::double precision OR v_ey = '-Infinity'::double precision OR
         v_sx < 0.0 OR v_sx > 1.0 OR
         v_sy < 0.0 OR v_sy > 1.0 OR
         v_ex < 0.0 OR v_ex > 1.0 OR
         v_ey < 0.0 OR v_ey > 1.0 THEN
        RETURN false;
      END IF;

      -- Arrow must have length > 0
      IF v_sx = v_ex AND v_sy = v_ey THEN
        RETURN false;
      END IF;

      RETURN true;

    WHEN 'rectangle' THEN
      -- Required numeric fields: x, y, width, height
      IF jsonb_typeof(p_geom->'x')      IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'y')      IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'width')  IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'height') IS DISTINCT FROM 'number' THEN
        RETURN false;
      END IF;

      BEGIN
        v_x := (p_geom->>'x')::double precision;
        v_y := (p_geom->>'y')::double precision;
        v_w := (p_geom->>'width')::double precision;
        v_h := (p_geom->>'height')::double precision;
      EXCEPTION WHEN OTHERS THEN
        RETURN false;
      END;

      IF v_x IS NULL OR v_y IS NULL OR v_w IS NULL OR v_h IS NULL OR
         v_x = 'NaN'::double precision OR v_y = 'NaN'::double precision OR
         v_w = 'NaN'::double precision OR v_h = 'NaN'::double precision OR
         v_x = 'Infinity'::double precision OR v_y = 'Infinity'::double precision OR
         v_w = 'Infinity'::double precision OR v_h = 'Infinity'::double precision OR
         v_x = '-Infinity'::double precision OR v_y = '-Infinity'::double precision OR
         v_w = '-Infinity'::double precision OR v_h = '-Infinity'::double precision OR
         v_x < 0.0 OR v_x > 1.0 OR
         v_y < 0.0 OR v_y > 1.0 OR
         v_w <= 0.0 OR v_w > 1.0 OR
         v_h <= 0.0 OR v_h > 1.0 THEN
        RETURN false;
      END IF;

      -- Normalized image boundary check: strict [0, 1] bounds matching frontend clamping
      IF (v_x + v_w) > 1.0 OR (v_y + v_h) > 1.0 THEN
        RETURN false;
      END IF;

      RETURN true;

    WHEN 'pencil' THEN
      -- Required field: points as array
      IF jsonb_typeof(p_geom->'points') IS DISTINCT FROM 'array' THEN
        RETURN false;
      END IF;

      v_points_len := jsonb_array_length(p_geom->'points');
      -- Must contain at least 2 points and not exceed upper limit of 1000 points
      IF v_points_len < 2 OR v_points_len > 1000 THEN
        RETURN false;
      END IF;

      FOR v_pt IN SELECT jsonb_array_elements(p_geom->'points')
      LOOP
        IF jsonb_typeof(v_pt) IS NOT DISTINCT FROM 'array' THEN
          IF jsonb_array_length(v_pt) <> 2 THEN
            RETURN false;
          END IF;
          IF jsonb_typeof(v_pt->0) IS DISTINCT FROM 'number' OR
             jsonb_typeof(v_pt->1) IS DISTINCT FROM 'number' THEN
            RETURN false;
          END IF;
          BEGIN
            v_px := (v_pt->>0)::double precision;
            v_py := (v_pt->>1)::double precision;
          EXCEPTION WHEN OTHERS THEN
            RETURN false;
          END;
        ELSIF jsonb_typeof(v_pt) IS NOT DISTINCT FROM 'object' THEN
          IF jsonb_typeof(v_pt->'x') IS DISTINCT FROM 'number' OR
             jsonb_typeof(v_pt->'y') IS DISTINCT FROM 'number' THEN
            RETURN false;
          END IF;
          BEGIN
            v_px := (v_pt->>'x')::double precision;
            v_py := (v_pt->>'y')::double precision;
          EXCEPTION WHEN OTHERS THEN
            RETURN false;
          END;
        ELSE
          RETURN false;
        END IF;

        IF v_px IS NULL OR v_py IS NULL OR
           v_px = 'NaN'::double precision OR v_py = 'NaN'::double precision OR
           v_px = 'Infinity'::double precision OR v_py = 'Infinity'::double precision OR
           v_px = '-Infinity'::double precision OR v_py = '-Infinity'::double precision OR
           v_px < 0.0 OR v_px > 1.0 OR
           v_py < 0.0 OR v_py > 1.0 THEN
          RETURN false;
        END IF;
      END LOOP;

      RETURN true;

    WHEN 'callout' THEN
      -- Required numeric fields: pointerX, pointerY, boxX, boxY, boxWidth, boxHeight
      -- Required text field: calloutText as JSON string
      IF jsonb_typeof(p_geom->'pointerX')    IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'pointerY')    IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'boxX')        IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'boxY')        IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'boxWidth')    IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'boxHeight')   IS DISTINCT FROM 'number' OR
         jsonb_typeof(p_geom->'calloutText') IS DISTINCT FROM 'string' THEN
        RETURN false;
      END IF;

      BEGIN
        v_px := (p_geom->>'pointerX')::double precision;
        v_py := (p_geom->>'pointerY')::double precision;
        v_bx := (p_geom->>'boxX')::double precision;
        v_by := (p_geom->>'boxY')::double precision;
        v_bw := (p_geom->>'boxWidth')::double precision;
        v_bh := (p_geom->>'boxHeight')::double precision;
        v_text := p_geom->>'calloutText';
      EXCEPTION WHEN OTHERS THEN
        RETURN false;
      END;

      IF v_px IS NULL OR v_py IS NULL OR
         v_bx IS NULL OR v_by IS NULL OR
         v_bw IS NULL OR v_bh IS NULL OR
         v_px = 'NaN'::double precision OR v_py = 'NaN'::double precision OR
         v_bx = 'NaN'::double precision OR v_by = 'NaN'::double precision OR
         v_bw = 'NaN'::double precision OR v_bh = 'NaN'::double precision OR
         v_px = 'Infinity'::double precision OR v_py = 'Infinity'::double precision OR
         v_bx = 'Infinity'::double precision OR v_by = 'Infinity'::double precision OR
         v_bw = 'Infinity'::double precision OR v_bh = 'Infinity'::double precision OR
         v_px = '-Infinity'::double precision OR v_py = '-Infinity'::double precision OR
         v_bx = '-Infinity'::double precision OR v_by = '-Infinity'::double precision OR
         v_bw = '-Infinity'::double precision OR v_bh = '-Infinity'::double precision OR
         v_px < 0.0 OR v_px > 1.0 OR
         v_py < 0.0 OR v_py > 1.0 OR
         v_bx < 0.0 OR v_bx > 1.0 OR
         v_by < 0.0 OR v_by > 1.0 OR
         v_bw <= 0.0 OR v_bw > 1.0 OR
         v_bh <= 0.0 OR v_bh > 1.0 THEN
        RETURN false;
      END IF;

      -- Normalized image boundary check: strict [0, 1] bounds matching frontend clamping
      IF (v_bx + v_bw) > 1.0 OR (v_by + v_bh) > 1.0 THEN
        RETURN false;
      END IF;

      -- Callout text validation: must not be empty or whitespace-only, max 2000 characters
      IF char_length(regexp_replace(v_text, '[[:space:]]', '', 'g')) = 0
         OR char_length(v_text) > 2000 THEN
        RETURN false;
      END IF;

      RETURN true;

    ELSE
      RETURN false;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_annotation_geometry(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_annotation_geometry(text, jsonb) TO authenticated, service_role;

-- 7. Add new constraints for supported annotation types, circle geometry integrity, and JSONB geometry validation
ALTER TABLE public.annotations
  DROP CONSTRAINT IF EXISTS annotations_type_valid,
  DROP CONSTRAINT IF EXISTS annotations_circle_geometry_valid,
  DROP CONSTRAINT IF EXISTS annotations_circle_columns_match_geometry,
  DROP CONSTRAINT IF EXISTS annotations_geometry_valid;

ALTER TABLE public.annotations
  ADD CONSTRAINT annotations_type_valid
    CHECK (type IN ('circle', 'arrow', 'rectangle', 'pencil', 'callout'));

ALTER TABLE public.annotations
  ADD CONSTRAINT annotations_circle_geometry_valid
    CHECK (
      (type = 'circle' AND
       cx IS NOT NULL AND cx >= 0.0 AND cx <= 1.0 AND
       cy IS NOT NULL AND cy >= 0.0 AND cy <= 1.0 AND
       r  IS NOT NULL AND r > 0.0  AND r <= 1.0)
      OR
      (type <> 'circle' AND
       cx IS NULL AND cy IS NULL AND r IS NULL)
    );

ALTER TABLE public.annotations
  ADD CONSTRAINT annotations_circle_columns_match_geometry
    CHECK (
      type <> 'circle' OR
      public.circle_columns_match_geometry(cx, cy, r, geometry)
    );

ALTER TABLE public.annotations
  ADD CONSTRAINT annotations_geometry_valid
    CHECK (public.validate_annotation_geometry(type, geometry));

-- 8. Index by image and annotation type for active records
CREATE INDEX IF NOT EXISTS idx_annotations_image_type_active
  ON public.annotations (image_id, type)
  WHERE deleted_at IS NULL;

-- 9. Update prepare_annotation_insert trigger function
--    Maintains per-image advisory lock and gapless monotonic numbering sequence.
--    Validates and synchronizes circle geometry bidirectionally between columns and JSONB.
--    Rejects geometry type mismatches with SQLSTATE 23514 instead of silently overwriting.
--    Rejects incomplete geometry payloads for all annotation tools.
--    Uses timezone-safe now() for timestamptz columns.
CREATE OR REPLACE FUNCTION public.prepare_annotation_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next_number integer;
  v_now timestamptz := now();
  v_has_legacy_cols boolean;
  v_has_geometry boolean;
BEGIN
  -- Serialize number allocation per image across concurrent inserts.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(new.image_id::text, 0)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.batch_images AS bi
    WHERE bi.id = new.image_id
  ) THEN
    RAISE EXCEPTION 'Target batch image not found.'
      USING ERRCODE = '23503';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF new.created_by IS NULL THEN
      new.created_by := auth.uid();
    ELSIF new.created_by <> auth.uid() THEN
      RAISE EXCEPTION 'Annotation created_by must match the authenticated user.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  new.type := lower(btrim(coalesce(new.type, 'circle')));
  IF new.type NOT IN ('circle', 'arrow', 'rectangle', 'pencil', 'callout') THEN
    RAISE EXCEPTION 'Unsupported annotation type: %', new.type
      USING ERRCODE = '23514';
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

  -- Circle geometry handling
  IF new.type = 'circle' THEN
    v_has_legacy_cols := (new.cx IS NOT NULL OR new.cy IS NOT NULL OR new.r IS NOT NULL);
    v_has_geometry := (new.geometry IS NOT NULL AND new.geometry <> '{}'::jsonb);

    IF NOT v_has_legacy_cols AND NOT v_has_geometry THEN
      RAISE EXCEPTION 'Circle annotation requires either legacy columns (cx, cy, r) or geometry payload.'
        USING ERRCODE = '23514';
    END IF;

    IF v_has_legacy_cols AND NOT v_has_geometry THEN
      -- Legacy-only insert: validate columns and synthesize geometry
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

    ELSIF v_has_geometry AND NOT v_has_legacy_cols THEN
      -- Geometry-only insert: validate geometry and populate columns
      IF NOT public.validate_annotation_geometry('circle', new.geometry) THEN
        RAISE EXCEPTION 'Invalid or incomplete circle geometry payload.'
          USING ERRCODE = '23514';
      END IF;

      new.cx := (new.geometry->>'cx')::double precision;
      new.cy := (new.geometry->>'cy')::double precision;
      new.r  := (new.geometry->>'r')::double precision;
      new.geometry := jsonb_build_object('type', 'circle', 'cx', new.cx, 'cy', new.cy, 'r', new.r);

    ELSE
      -- Both provided: validate both and reject conflicts using safe comparison
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
    END IF;

  ELSE
    -- Non-circle annotations must NOT retain legacy circle coordinates
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
  new.color := lower(btrim(coalesce(new.color, '#dc2626')));
  new.status := 'open';
  new.resolved_at := NULL;
  new.deleted_at := NULL;
  new.created_at := v_now;
  new.updated_at := v_now;

  SELECT coalesce(max(a.annotation_number), 0) + 1
  INTO v_next_number
  FROM public.annotations AS a
  WHERE a.image_id = new.image_id;

  new.annotation_number := v_next_number;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_annotations_prepare_insert ON public.annotations;
CREATE TRIGGER trg_annotations_prepare_insert
  BEFORE INSERT ON public.annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.prepare_annotation_insert();

-- 10. Update protect_annotation_columns trigger function
--     Locks immutable columns (id, image_id, annotation_number, created_by, created_at, type).
--     Synchronizes updated_at and resolved_at using timezone-safe now().
--     Synchronizes circle legacy columns and geometry bidirectionally, rejecting conflicting updates.
--     Rejects geometry type mismatches with SQLSTATE 23514 instead of silently overwriting.
--     Validates complete geometry on all update operations.
CREATE OR REPLACE FUNCTION public.protect_annotation_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_geom_changed boolean;
  v_cols_changed boolean;
BEGIN
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
      -- Neither representation modified (e.g. metadata-only update: comment, color, status)
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

DROP TRIGGER IF EXISTS trg_annotations_protect_columns ON public.annotations;
CREATE TRIGGER trg_annotations_protect_columns
  BEFORE UPDATE ON public.annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_annotation_columns();


-- 11. Update column-level UPDATE privileges to allow editing geometry
--     Remove any previous table-level UPDATE grant.
--     Preserve least-privilege column-level editing.
--     Immutable columns remain protected.

REVOKE ALL ON public.annotations FROM PUBLIC;
REVOKE ALL ON public.annotations FROM anon;

-- Remove any existing table-level UPDATE privilege.
REVOKE UPDATE ON public.annotations FROM authenticated;

GRANT SELECT, INSERT ON public.annotations TO authenticated;

-- Grant UPDATE only on editable annotation fields.
GRANT UPDATE (cx, cy, r, color, comment, status, geometry)
  ON public.annotations TO authenticated;

COMMIT;

