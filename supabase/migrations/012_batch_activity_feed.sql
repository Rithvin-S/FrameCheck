-- Phase 16C: Collaborative Activity Feed & Historical Event Persistence
-- Target: Supabase PostgreSQL (run after 001 through 011 migrations)
-- Implements persistent batch-level activity event storage, automatic triggers,
-- and a secure get_batch_activity_feed function strictly enforcing Row Level Security.

-- 1. Persistent Batch Activity Events Table
CREATE TABLE IF NOT EXISTS public.batch_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (
    event_type IN (
      'annotation_created',
      'annotation_geometry_edited',
      'annotation_resolved',
      'annotation_reopened',
      'annotation_deleted',
      'comment_added',
      'comment_mention',
      'whiteboard_created',
      'whiteboard_updated',
      'image_completed',
      'batch_review_completed'
    )
  ),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_id uuid REFERENCES public.batch_images(id) ON DELETE CASCADE,
  annotation_id uuid REFERENCES public.annotations(id) ON DELETE CASCADE,
  annotation_number integer,
  element_id uuid,
  element_type text,
  details text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Performance indices for batch activity queries
CREATE INDEX IF NOT EXISTS idx_batch_activity_events_batch_time
  ON public.batch_activity_events (batch_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_batch_activity_events_annotation
  ON public.batch_activity_events (annotation_id)
  WHERE annotation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_batch_activity_events_image
  ON public.batch_activity_events (image_id)
  WHERE image_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_batch_activity_events_actor
  ON public.batch_activity_events (actor_id);

-- 2. Row Level Security
ALTER TABLE public.batch_activity_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.batch_activity_events FROM anon;
GRANT SELECT, INSERT ON public.batch_activity_events TO authenticated;

DROP POLICY IF EXISTS batch_activity_events_select_authorized ON public.batch_activity_events;
CREATE POLICY batch_activity_events_select_authorized
  ON public.batch_activity_events
  FOR SELECT
  USING (public.can_view_batch(batch_id));

DROP POLICY IF EXISTS batch_activity_events_insert_authorized ON public.batch_activity_events;
CREATE POLICY batch_activity_events_insert_authorized
  ON public.batch_activity_events
  FOR INSERT
  WITH CHECK (
    public.can_view_batch(batch_id)
    AND (auth.uid() = actor_id OR public.is_reviewer_or_admin())
  );

-- 3. Automatic Triggers for Server-Side Event Capture

-- 3a. Annotations trigger
CREATE OR REPLACE FUNCTION public.trg_log_annotation_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_id uuid;
  v_actor_id uuid;
BEGIN
  SELECT bi.batch_id INTO v_batch_id
  FROM public.batch_images bi
  WHERE bi.id = COALESCE(new.image_id, old.image_id);

  IF v_batch_id IS NULL THEN
    RETURN COALESCE(new, old);
  END IF;

  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    v_actor_id := COALESCE(new.created_by, old.created_by);
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.batch_activity_events (
      batch_id,
      event_type,
      occurred_at,
      actor_id,
      image_id,
      annotation_id,
      annotation_number,
      details,
      metadata
    ) VALUES (
      v_batch_id,
      'annotation_created',
      new.created_at,
      new.created_by,
      new.image_id,
      new.id,
      new.annotation_number,
      new.comment,
      jsonb_build_object(
        'type', COALESCE(new.type, 'circle'),
        'color', new.color,
        'status', new.status
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    -- Soft deletion transition
    IF new.deleted_at IS NOT NULL AND (old.deleted_at IS NULL) THEN
      INSERT INTO public.batch_activity_events (
        batch_id,
        event_type,
        occurred_at,
        actor_id,
        image_id,
        annotation_id,
        annotation_number,
        details,
        metadata
      ) VALUES (
        v_batch_id,
        'annotation_deleted',
        COALESCE(new.deleted_at, now()),
        v_actor_id,
        new.image_id,
        new.id,
        new.annotation_number,
        'Deleted annotation',
        jsonb_build_object('type', COALESCE(new.type, 'circle'))
      );
      RETURN new;
    END IF;

    -- Status transition to resolved
    IF new.status = 'resolved' AND (old.status IS DISTINCT FROM 'resolved') THEN
      INSERT INTO public.batch_activity_events (
        batch_id,
        event_type,
        occurred_at,
        actor_id,
        image_id,
        annotation_id,
        annotation_number,
        details,
        metadata
      ) VALUES (
        v_batch_id,
        'annotation_resolved',
        COALESCE(new.resolved_at, timezone('utc', now())),
        v_actor_id,
        new.image_id,
        new.id,
        new.annotation_number,
        'Resolved feedback',
        jsonb_build_object('type', COALESCE(new.type, 'circle'))
      );
    -- Status transition to open (reopened)
    ELSIF new.status = 'open' AND old.status = 'resolved' THEN
      INSERT INTO public.batch_activity_events (
        batch_id,
        event_type,
        occurred_at,
        actor_id,
        image_id,
        annotation_id,
        annotation_number,
        details,
        metadata
      ) VALUES (
        v_batch_id,
        'annotation_reopened',
        timezone('utc', now()),
        v_actor_id,
        new.image_id,
        new.id,
        new.annotation_number,
        'Reopened feedback',
        jsonb_build_object('type', COALESCE(new.type, 'circle'))
      );
    END IF;

    -- Comment update independently from geometry
    IF new.comment IS DISTINCT FROM old.comment AND old.comment IS NOT NULL AND old.comment <> '' THEN
      INSERT INTO public.batch_activity_events (
        batch_id,
        event_type,
        occurred_at,
        actor_id,
        image_id,
        annotation_id,
        annotation_number,
        details,
        metadata
      ) VALUES (
        v_batch_id,
        'comment_added',
        timezone('utc', now()),
        v_actor_id,
        new.image_id,
        new.id,
        new.annotation_number,
        new.comment,
        jsonb_build_object('type', COALESCE(new.type, 'circle'))
      );
    END IF;

    -- Geometry update independently from comment
    IF (new.geometry IS DISTINCT FROM old.geometry OR new.cx IS DISTINCT FROM old.cx OR new.cy IS DISTINCT FROM old.cy OR new.r IS DISTINCT FROM old.r) THEN
      INSERT INTO public.batch_activity_events (
        batch_id,
        event_type,
        occurred_at,
        actor_id,
        image_id,
        annotation_id,
        annotation_number,
        details,
        metadata
      ) VALUES (
        v_batch_id,
        'annotation_geometry_edited',
        timezone('utc', now()),
        v_actor_id,
        new.image_id,
        new.id,
        new.annotation_number,
        'Updated annotation geometry',
        jsonb_build_object('type', COALESCE(new.type, 'circle'))
      );
    END IF;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_annotations_activity ON public.annotations;
CREATE TRIGGER trg_annotations_activity
  AFTER INSERT OR UPDATE ON public.annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_annotation_activity();

-- 3b. Mentions trigger
CREATE OR REPLACE FUNCTION public.trg_log_mention_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch_id uuid;
  v_image_id uuid;
  v_ann_number integer;
  v_actor_id uuid;
  v_target_name text;
BEGIN
  SELECT bi.batch_id, a.image_id, a.annotation_number, a.created_by
  INTO v_batch_id, v_image_id, v_ann_number, v_actor_id
  FROM public.annotations a
  JOIN public.batch_images bi ON bi.id = a.image_id
  WHERE a.id = new.annotation_id;

  IF v_batch_id IS NULL THEN
    RETURN new;
  END IF;

  SELECT p.display_name INTO v_target_name
  FROM public.profiles p
  WHERE p.id = new.mentioned_user_id;

  INSERT INTO public.batch_activity_events (
    batch_id,
    event_type,
    occurred_at,
    actor_id,
    image_id,
    annotation_id,
    annotation_number,
    details,
    metadata
  ) VALUES (
    v_batch_id,
    'comment_mention',
    new.created_at,
    COALESCE(auth.uid(), v_actor_id),
    v_image_id,
    new.annotation_id,
    v_ann_number,
    'Mentioned @' || COALESCE(v_target_name, 'reviewer'),
    jsonb_build_object(
      'mentioned_user_id', new.mentioned_user_id,
      'mentioned_name', v_target_name
    )
  );

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_mentions_activity ON public.annotation_mentions;
CREATE TRIGGER trg_mentions_activity
  AFTER INSERT ON public.annotation_mentions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_mention_activity();

-- 3c. Batch images trigger (Image completion & batch review completion)
CREATE OR REPLACE FUNCTION public.trg_log_image_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_all_completed boolean;
  v_all_resolved boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF new.is_completed = true AND (old.is_completed IS DISTINCT FROM true) THEN
      v_actor_id := COALESCE(new.completed_by, auth.uid());
      INSERT INTO public.batch_activity_events (
        batch_id,
        event_type,
        occurred_at,
        actor_id,
        image_id,
        annotation_id,
        annotation_number,
        details,
        metadata
      ) VALUES (
        new.batch_id,
        'image_completed',
        COALESCE(new.completed_at, timezone('utc', now())),
        v_actor_id,
        new.id,
        NULL,
        NULL,
        'Marked image #' || COALESCE(new.display_order::text, '1') || ' as completed',
        jsonb_build_object('is_completed', true, 'display_order', new.display_order)
      );

      -- Check if batch review has transitioned to completed
      SELECT
        NOT EXISTS (
          SELECT 1 FROM public.batch_images
          WHERE batch_id = new.batch_id AND (is_completed = false OR is_completed IS NULL)
        ),
        NOT EXISTS (
          SELECT 1 FROM public.annotations a
          JOIN public.batch_images bi ON bi.id = a.image_id
          WHERE bi.batch_id = new.batch_id AND a.deleted_at IS NULL AND a.status <> 'resolved'
        )
      INTO v_all_completed, v_all_resolved;

      IF v_all_completed AND v_all_resolved THEN
        -- Only insert batch_review_completed if not already logged recently
        IF NOT EXISTS (
          SELECT 1 FROM public.batch_activity_events
          WHERE batch_id = new.batch_id
            AND event_type = 'batch_review_completed'
            AND occurred_at > (timezone('utc', now()) - interval '10 minutes')
        ) THEN
          INSERT INTO public.batch_activity_events (
            batch_id,
            event_type,
            occurred_at,
            actor_id,
            image_id,
            annotation_id,
            annotation_number,
            details,
            metadata
          ) VALUES (
            new.batch_id,
            'batch_review_completed',
            timezone('utc', now()),
            v_actor_id,
            NULL,
            NULL,
            NULL,
            'Completed review for all images in this batch',
            jsonb_build_object('all_images_completed', true)
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_images_activity ON public.batch_images;
CREATE TRIGGER trg_images_activity
  AFTER UPDATE ON public.batch_images
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_image_activity();

-- 3d. Whiteboard elements trigger
CREATE OR REPLACE FUNCTION public.trg_log_whiteboard_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    v_actor_id := COALESCE(new.created_by, old.created_by);
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.batch_activity_events (
      batch_id,
      event_type,
      occurred_at,
      actor_id,
      image_id,
      annotation_id,
      annotation_number,
      element_id,
      element_type,
      details,
      metadata
    ) VALUES (
      new.batch_id,
      'whiteboard_created',
      new.created_at,
      new.created_by,
      NULL,
      NULL,
      NULL,
      new.id,
      new.type,
      CASE
        WHEN new.text IS NOT NULL AND btrim(new.text) <> '' THEN LEFT(btrim(new.text), 100)
        ELSE 'Added ' || new.type || ' element to whiteboard'
      END,
      jsonb_build_object('element_type', new.type, 'color', new.color)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF (new.text IS DISTINCT FROM old.text OR new.x IS DISTINCT FROM old.x OR new.y IS DISTINCT FROM old.y OR new.geometry IS DISTINCT FROM old.geometry OR new.color IS DISTINCT FROM old.color) THEN
      INSERT INTO public.batch_activity_events (
        batch_id,
        event_type,
        occurred_at,
        actor_id,
        image_id,
        annotation_id,
        annotation_number,
        element_id,
        element_type,
        details,
        metadata
      ) VALUES (
        new.batch_id,
        'whiteboard_updated',
        new.updated_at,
        v_actor_id,
        NULL,
        NULL,
        NULL,
        new.id,
        new.type,
        CASE
          WHEN new.text IS NOT NULL AND btrim(new.text) <> '' THEN LEFT(btrim(new.text), 100)
          ELSE 'Updated ' || new.type || ' element on whiteboard'
        END,
        jsonb_build_object('element_type', new.type, 'color', new.color)
      );
    END IF;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_whiteboard_activity ON public.batch_whiteboard_elements;
CREATE TRIGGER trg_whiteboard_activity
  AFTER INSERT OR UPDATE ON public.batch_whiteboard_elements
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_whiteboard_activity();

-- 4. Idempotent Backfill of Pre-existing Events
DO $$
BEGIN
  -- Backfill annotations created
  INSERT INTO public.batch_activity_events (
    batch_id, event_type, occurred_at, actor_id, image_id, annotation_id, annotation_number, details, metadata
  )
  SELECT
    bi.batch_id,
    'annotation_created',
    a.created_at,
    a.created_by,
    a.image_id,
    a.id,
    a.annotation_number,
    a.comment,
    jsonb_build_object('type', COALESCE(a.type, 'circle'), 'color', a.color, 'status', a.status)
  FROM public.annotations a
  JOIN public.batch_images bi ON bi.id = a.image_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.batch_activity_events bae
    WHERE bae.annotation_id = a.id AND bae.event_type = 'annotation_created'
  );

  -- Backfill resolved annotations
  INSERT INTO public.batch_activity_events (
    batch_id, event_type, occurred_at, actor_id, image_id, annotation_id, annotation_number, details, metadata
  )
  SELECT
    bi.batch_id,
    'annotation_resolved',
    COALESCE(a.resolved_at, a.updated_at),
    a.created_by,
    a.image_id,
    a.id,
    a.annotation_number,
    'Resolved feedback',
    jsonb_build_object('type', COALESCE(a.type, 'circle'))
  FROM public.annotations a
  JOIN public.batch_images bi ON bi.id = a.image_id
  WHERE a.status = 'resolved'
    AND NOT EXISTS (
      SELECT 1 FROM public.batch_activity_events bae
      WHERE bae.annotation_id = a.id AND bae.event_type = 'annotation_resolved'
    );

  -- Backfill completed images
  INSERT INTO public.batch_activity_events (
    batch_id, event_type, occurred_at, actor_id, image_id, annotation_id, annotation_number, details, metadata
  )
  SELECT
    bi.batch_id,
    'image_completed',
    COALESCE(bi.completed_at, bi.created_at),
    COALESCE(bi.completed_by, b.owner_id),
    bi.id,
    NULL,
    NULL,
    'Marked image #' || COALESCE(bi.display_order::text, '1') || ' as completed',
    jsonb_build_object('is_completed', true, 'display_order', bi.display_order)
  FROM public.batch_images bi
  JOIN public.batches b ON b.id = bi.batch_id
  WHERE bi.is_completed = true
    AND NOT EXISTS (
      SELECT 1 FROM public.batch_activity_events bae
      WHERE bae.image_id = bi.id AND bae.event_type = 'image_completed'
    );

  -- Backfill whiteboard elements
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'batch_whiteboard_elements') THEN
    INSERT INTO public.batch_activity_events (
      batch_id, event_type, occurred_at, actor_id, image_id, annotation_id, annotation_number, element_id, element_type, details, metadata
    )
    SELECT
      we.batch_id,
      'whiteboard_created',
      we.created_at,
      we.created_by,
      NULL,
      NULL,
      NULL,
      we.id,
      we.type,
      CASE
        WHEN we.text IS NOT NULL AND btrim(we.text) <> '' THEN LEFT(btrim(we.text), 100)
        ELSE 'Added ' || we.type || ' element to whiteboard'
      END,
      jsonb_build_object('element_type', we.type, 'color', we.color)
    FROM public.batch_whiteboard_elements we
    WHERE NOT EXISTS (
      SELECT 1 FROM public.batch_activity_events bae
      WHERE bae.element_id = we.id AND bae.event_type = 'whiteboard_created'
    );
  END IF;
END;
$$;

-- 5. Primary Activity Feed Query RPC
CREATE OR REPLACE FUNCTION public.get_batch_activity_feed(
  target_batch_id uuid,
  limit_count integer DEFAULT 50,
  offset_count integer DEFAULT 0
)
RETURNS TABLE (
  id text,
  event_type text,
  occurred_at timestamptz,
  actor_id uuid,
  actor_name text,
  image_id uuid,
  image_filename text,
  image_position integer,
  annotation_id uuid,
  annotation_number integer,
  element_id uuid,
  element_type text,
  details text,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Strict permission check: caller must be authorized to view the batch
  IF NOT public.can_view_batch(target_batch_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    bae.id::text,
    bae.event_type,
    bae.occurred_at,
    bae.actor_id,
    COALESCE(p.display_name, 'Reviewer') AS actor_name,
    bae.image_id,
    bi.original_filename AS image_filename,
    bi.display_order AS image_position,
    bae.annotation_id,
    bae.annotation_number,
    bae.element_id,
    bae.element_type,
    bae.details,
    bae.metadata
  FROM public.batch_activity_events bae
  LEFT JOIN public.profiles p ON p.id = bae.actor_id
  LEFT JOIN public.batch_images bi ON bi.id = bae.image_id
  WHERE bae.batch_id = target_batch_id
  ORDER BY bae.occurred_at DESC, bae.id DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_batch_activity_feed(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_batch_activity_feed(uuid, integer, integer) TO authenticated;

-- 6. Add batch_activity_events to Supabase Realtime publication
ALTER TABLE public.batch_activity_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'batch_activity_events'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.batch_activity_events;
    END IF;
  END IF;
END
$$;
