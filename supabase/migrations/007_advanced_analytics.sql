-- Phase 9: Advanced Analytics Dashboard Aggregation Functions & Completer Visibility
-- Target: Supabase PostgreSQL (run after 001 through 006 migrations)
-- Strictly preserves all existing RLS boundaries; functions use SECURITY INVOKER.

-- 1. Allow authorized batch viewers to select profile rows of users who completed images in that batch
--    (Row-level policy mirroring profiles_select_annotation_creators from migration 003;
--     exposes id, display_name, role, created_at, updated_at with no sensitive credentials or emails)
DROP POLICY IF EXISTS profiles_select_image_completers ON public.profiles;
CREATE POLICY profiles_select_image_completers
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.batch_images AS bi
      WHERE bi.completed_by = profiles.id
        AND public.can_view_batch_image(bi.id)
    )
  );

-- 2. get_recent_activity: Returns actual recent review activity strictly scoped to caller's RLS
CREATE OR REPLACE FUNCTION public.get_recent_activity(limit_count integer DEFAULT 15)
RETURNS TABLE (
  event_type text,
  event_id text,
  occurred_at timestamptz,
  actor_id uuid,
  actor_name text,
  batch_id uuid,
  batch_name text,
  image_id uuid,
  image_filename text,
  annotation_number integer,
  details text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH visible_batches AS (
    SELECT b.id, b.name, b.owner_id, b.created_at
    FROM public.batches AS b
  ),
  visible_images AS (
    SELECT bi.id, bi.batch_id, bi.original_filename, bi.is_completed, bi.completed_at, bi.completed_by
    FROM public.batch_images AS bi
    JOIN visible_batches AS vb ON vb.id = bi.batch_id
  ),
  -- Event 1: Annotation Created
  ann_created AS (
    SELECT
      'annotation_created'::text AS event_type,
      a.id::text AS event_id,
      a.created_at AS occurred_at,
      a.created_by AS actor_id,
      coalesce(p.display_name, 'Reviewer') AS actor_name,
      vi.batch_id,
      vb.name AS batch_name,
      a.image_id,
      vi.original_filename AS image_filename,
      a.annotation_number,
      left(a.comment, 120) AS details
    FROM public.annotations AS a
    JOIN visible_images AS vi ON vi.id = a.image_id
    JOIN visible_batches AS vb ON vb.id = vi.batch_id
    LEFT JOIN public.profiles AS p ON p.id = a.created_by
    WHERE a.deleted_at IS NULL
  ),
  -- Event 2: Annotation Resolved (active annotations currently in resolved state)
  ann_resolved AS (
    SELECT
      'annotation_resolved'::text AS event_type,
      (a.id::text || '-resolved') AS event_id,
      a.resolved_at AS occurred_at,
      a.created_by AS actor_id,
      coalesce(p.display_name, 'Reviewer') AS actor_name,
      vi.batch_id,
      vb.name AS batch_name,
      a.image_id,
      vi.original_filename AS image_filename,
      a.annotation_number,
      left(a.comment, 120) AS details
    FROM public.annotations AS a
    JOIN visible_images AS vi ON vi.id = a.image_id
    JOIN visible_batches AS vb ON vb.id = vi.batch_id
    LEFT JOIN public.profiles AS p ON p.id = a.created_by
    WHERE a.deleted_at IS NULL
      AND a.status = 'resolved'
      AND a.resolved_at IS NOT NULL
  ),
  -- Event 3: Image Completed
  img_completed AS (
    SELECT
      'image_completed'::text AS event_type,
      vi.id::text AS event_id,
      vi.completed_at AS occurred_at,
      vi.completed_by AS actor_id,
      coalesce(p.display_name, 'Reviewer') AS actor_name,
      vi.batch_id,
      vb.name AS batch_name,
      vi.id AS image_id,
      vi.original_filename AS image_filename,
      NULL::integer AS annotation_number,
      'Image marked as completed'::text AS details
    FROM visible_images AS vi
    JOIN visible_batches AS vb ON vb.id = vi.batch_id
    LEFT JOIN public.profiles AS p ON p.id = vi.completed_by
    WHERE vi.is_completed = true
      AND vi.completed_at IS NOT NULL
  ),
  -- Event 4: Batch Created
  batch_created AS (
    SELECT
      'batch_created'::text AS event_type,
      vb.id::text AS event_id,
      vb.created_at AS occurred_at,
      vb.owner_id AS actor_id,
      coalesce(p.display_name, 'Uploader') AS actor_name,
      vb.id AS batch_id,
      vb.name AS batch_name,
      NULL::uuid AS image_id,
      NULL::text AS image_filename,
      NULL::integer AS annotation_number,
      'Batch created'::text AS details
    FROM visible_batches AS vb
    LEFT JOIN public.profiles AS p ON p.id = vb.owner_id
  ),
  -- Event 5: Annotation Deleted (tombstone events - actor is not stored in table, so actor columns remain NULL)
  ann_deleted AS (
    SELECT
      'annotation_deleted'::text AS event_type,
      ade.id::text AS event_id,
      ade.deleted_at AS occurred_at,
      NULL::uuid AS actor_id,
      NULL::text AS actor_name,
      ade.batch_id,
      vb.name AS batch_name,
      ade.image_id,
      vi.original_filename AS image_filename,
      NULL::integer AS annotation_number,
      'Annotation removed'::text AS details
    FROM public.annotation_deletion_events AS ade
    JOIN visible_batches AS vb ON vb.id = ade.batch_id
    LEFT JOIN visible_images AS vi ON vi.id = ade.image_id
  ),
  all_events AS (
    SELECT * FROM ann_created
    UNION ALL
    SELECT * FROM ann_resolved
    UNION ALL
    SELECT * FROM img_completed
    UNION ALL
    SELECT * FROM batch_created
    UNION ALL
    SELECT * FROM ann_deleted
  )
  SELECT *
  FROM all_events
  ORDER BY occurred_at DESC
  LIMIT coalesce(limit_count, 15);
$$;

REVOKE ALL ON FUNCTION public.get_recent_activity(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_activity(integer) TO authenticated;

-- 3. get_analytics_summary: Aggregates role-scoped metrics, breakdowns, time-series, and contributions
CREATE OR REPLACE FUNCTION public.get_analytics_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_is_admin boolean := public.is_admin();

  -- Overview variables
  v_total_batches int := 0;
  v_total_images int := 0;
  v_completed_images int := 0;
  v_pending_images int := 0;
  v_completion_pct numeric := 0;
  v_total_annotations int := 0;
  v_open_annotations int := 0;
  v_resolved_annotations int := 0;
  v_resolution_pct numeric := 0;
  v_total_storage_bytes bigint := 0;

  -- Status counts
  v_status_not_started int := 0;
  v_status_in_review int := 0;
  v_status_completed int := 0;

  -- JSON aggregates
  v_image_formats jsonb := '[]'::jsonb;
  v_time_trends jsonb := '[]'::jsonb;
  v_reviewer_contributions jsonb := '[]'::jsonb;
  v_my_contributions jsonb := '{}'::jsonb;
  v_user_distribution jsonb := NULL;
  v_top_batches jsonb := '[]'::jsonb;
BEGIN
  -- 1. Batch status and overview metrics from list_dashboard_batches() (inherits caller RLS)
  SELECT
    coalesce(count(*), 0)::int,
    coalesce(sum(image_count), 0)::int,
    coalesce(sum(completed_image_count), 0)::int,
    coalesce(sum(total_annotation_count), 0)::int,
    coalesce(sum(open_annotation_count), 0)::int,
    coalesce(count(*) FILTER (WHERE review_status = 'not_started'), 0)::int,
    coalesce(count(*) FILTER (WHERE review_status = 'in_review'), 0)::int,
    coalesce(count(*) FILTER (WHERE review_status = 'review_completed'), 0)::int
  INTO
    v_total_batches,
    v_total_images,
    v_completed_images,
    v_total_annotations,
    v_open_annotations,
    v_status_not_started,
    v_status_in_review,
    v_status_completed
  FROM public.list_dashboard_batches();

  v_pending_images := greatest(0, v_total_images - v_completed_images);
  v_resolved_annotations := greatest(0, v_total_annotations - v_open_annotations);

  IF v_total_images > 0 THEN
    v_completion_pct := round((v_completed_images::numeric / v_total_images::numeric) * 100, 1);
  ELSE
    v_completion_pct := 0;
  END IF;

  IF v_total_annotations > 0 THEN
    v_resolution_pct := round((v_resolved_annotations::numeric / v_total_annotations::numeric) * 100, 1);
  ELSE
    v_resolution_pct := 0;
  END IF;

  -- 2. Storage volume and format breakdown (strictly scoped to caller's visible images)
  -- Uses sum(fmt.bytes) from the format subquery to avoid invalid outer table references
  SELECT
    coalesce(sum(fmt.bytes), 0)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'mime_type', fmt.mime_type,
          'image_count', fmt.cnt,
          'count', fmt.cnt,
          'storage_bytes', fmt.bytes,
          'total_bytes', fmt.bytes
        ) ORDER BY fmt.cnt DESC
      ),
      '[]'::jsonb
    )
  INTO
    v_total_storage_bytes,
    v_image_formats
  FROM (
    SELECT
      bi.mime_type,
      count(*)::int AS cnt,
      coalesce(sum(bi.file_size), 0)::bigint AS bytes
    FROM public.batch_images AS bi
    JOIN public.batches AS b ON b.id = bi.batch_id
    GROUP BY bi.mime_type
  ) AS fmt;

  -- 3. 30-day time-series daily trend (last 30 calendar days ending today in UTC)
  -- Consistently groups and filters by (timestamp AT TIME ZONE 'UTC')::date
  WITH days AS (
    SELECT generate_series(
      ((now() AT TIME ZONE 'UTC')::date - 29)::timestamp,
      ((now() AT TIME ZONE 'UTC')::date)::timestamp,
      interval '1 day'
    )::date AS day
  ),
  daily_ann_created AS (
    SELECT
      (a.created_at AT TIME ZONE 'UTC')::date AS day,
      count(*)::int AS cnt
    FROM public.annotations AS a
    JOIN public.batch_images AS bi ON bi.id = a.image_id
    JOIN public.batches AS b ON b.id = bi.batch_id
    WHERE a.deleted_at IS NULL
      AND (a.created_at AT TIME ZONE 'UTC')::date >= ((now() AT TIME ZONE 'UTC')::date - 29)
    GROUP BY (a.created_at AT TIME ZONE 'UTC')::date
  ),
  daily_ann_resolved AS (
    SELECT
      (a.resolved_at AT TIME ZONE 'UTC')::date AS day,
      count(*)::int AS cnt
    FROM public.annotations AS a
    JOIN public.batch_images AS bi ON bi.id = a.image_id
    JOIN public.batches AS b ON b.id = bi.batch_id
    WHERE a.deleted_at IS NULL
      AND a.status = 'resolved'
      AND a.resolved_at IS NOT NULL
      AND (a.resolved_at AT TIME ZONE 'UTC')::date >= ((now() AT TIME ZONE 'UTC')::date - 29)
    GROUP BY (a.resolved_at AT TIME ZONE 'UTC')::date
  ),
  daily_img_completed AS (
    SELECT
      (bi.completed_at AT TIME ZONE 'UTC')::date AS day,
      count(*)::int AS cnt
    FROM public.batch_images AS bi
    JOIN public.batches AS b ON b.id = bi.batch_id
    WHERE bi.is_completed = true
      AND bi.completed_at IS NOT NULL
      AND (bi.completed_at AT TIME ZONE 'UTC')::date >= ((now() AT TIME ZONE 'UTC')::date - 29)
    GROUP BY (bi.completed_at AT TIME ZONE 'UTC')::date
  ),
  daily_batches_created AS (
    SELECT
      (b.created_at AT TIME ZONE 'UTC')::date AS day,
      count(*)::int AS cnt
    FROM public.batches AS b
    WHERE (b.created_at AT TIME ZONE 'UTC')::date >= ((now() AT TIME ZONE 'UTC')::date - 29)
    GROUP BY (b.created_at AT TIME ZONE 'UTC')::date
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', d.day,
        'label', to_char(d.day, 'Mon DD'),
        'annotations_created', coalesce(ac.cnt, 0),
        'annotations_resolved', coalesce(ar.cnt, 0),
        'images_completed', coalesce(ic.cnt, 0),
        'batches_created', coalesce(bc.cnt, 0)
      ) ORDER BY d.day ASC
    ),
    '[]'::jsonb
  )
  INTO v_time_trends
  FROM days AS d
  LEFT JOIN daily_ann_created AS ac ON ac.day = d.day
  LEFT JOIN daily_ann_resolved AS ar ON ar.day = d.day
  LEFT JOIN daily_img_completed AS ic ON ic.day = d.day
  LEFT JOIN daily_batches_created AS bc ON bc.day = d.day;

  -- 4. Reviewer contributions (active reviewers on visible batches; for Uploaders, strictly scoped to their batches)
  -- Uses grouped aggregate CTEs to eliminate repeated correlated subqueries
  WITH ann_by_user AS (
    SELECT
      a.created_by AS user_id,
      count(*)::int AS annotations_created,
      count(*) FILTER (WHERE a.status = 'resolved')::int AS annotations_resolved,
      max(a.created_at) AS last_ann_at
    FROM public.annotations AS a
    JOIN public.batch_images AS bi ON bi.id = a.image_id
    JOIN public.batches AS b ON b.id = bi.batch_id
    WHERE a.deleted_at IS NULL
    GROUP BY a.created_by
  ),
  img_by_user AS (
    SELECT
      bi.completed_by AS user_id,
      count(*)::int AS images_completed,
      max(bi.completed_at) AS last_completed_at
    FROM public.batch_images AS bi
    JOIN public.batches AS b ON b.id = bi.batch_id
    WHERE bi.is_completed = true
      AND bi.completed_by IS NOT NULL
    GROUP BY bi.completed_by
  ),
  contributor_ids AS (
    SELECT user_id FROM ann_by_user
    UNION
    SELECT user_id FROM img_by_user
  ),
  contributor_metrics AS (
    SELECT
      c.user_id,
      coalesce(p.display_name, 'Reviewer') AS display_name,
      coalesce(p.role, 'reviewer') AS role,
      coalesce(abu.annotations_created, 0)::int AS annotations_created,
      coalesce(abu.annotations_resolved, 0)::int AS annotations_resolved,
      coalesce(ibu.images_completed, 0)::int AS images_completed,
      greatest(abu.last_ann_at, ibu.last_completed_at) AS last_active
    FROM contributor_ids AS c
    LEFT JOIN ann_by_user AS abu ON abu.user_id = c.user_id
    LEFT JOIN img_by_user AS ibu ON ibu.user_id = c.user_id
    LEFT JOIN public.profiles AS p ON p.id = c.user_id
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', cm.user_id,
        'reviewer_id', cm.user_id,
        'display_name', cm.display_name,
        'role', cm.role,
        'annotations_created', cm.annotations_created,
        'annotations_resolved', cm.annotations_resolved,
        'images_completed', cm.images_completed,
        'last_active', cm.last_active
      ) ORDER BY cm.annotations_created DESC, cm.images_completed DESC
    ),
    '[]'::jsonb
  )
  INTO v_reviewer_contributions
  FROM contributor_metrics AS cm;

  -- 5. Personal contributions for the signed-in caller
  IF v_caller_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'annotations_created', (
        SELECT count(*)::int
        FROM public.annotations AS a
        JOIN public.batch_images AS bi ON bi.id = a.image_id
        JOIN public.batches AS b ON b.id = bi.batch_id
        WHERE a.created_by = v_caller_id
          AND a.deleted_at IS NULL
      ),
      'annotations_resolved', (
        SELECT count(*)::int
        FROM public.annotations AS a
        JOIN public.batch_images AS bi ON bi.id = a.image_id
        JOIN public.batches AS b ON b.id = bi.batch_id
        WHERE a.created_by = v_caller_id
          AND a.status = 'resolved'
          AND a.deleted_at IS NULL
      ),
      'images_completed', (
        SELECT count(*)::int
        FROM public.batch_images AS bi
        JOIN public.batches AS b ON b.id = bi.batch_id
        WHERE bi.completed_by = v_caller_id
          AND bi.is_completed = true
      ),
      'batches_contributed', (
        SELECT count(DISTINCT batch_id)::int
        FROM (
          SELECT bi.batch_id
          FROM public.annotations AS a
          JOIN public.batch_images AS bi ON bi.id = a.image_id
          WHERE a.created_by = v_caller_id
            AND a.deleted_at IS NULL
          UNION
          SELECT bi.batch_id
          FROM public.batch_images AS bi
          WHERE bi.completed_by = v_caller_id
            AND bi.is_completed = true
        ) AS touched
      )
    ) INTO v_my_contributions;
  END IF;

  -- 6. User role distribution (accessible only if caller is Admin)
  IF v_is_admin THEN
    SELECT jsonb_build_object(
      'uploaders', coalesce(count(*) FILTER (WHERE role = 'uploader'), 0)::int,
      'reviewers', coalesce(count(*) FILTER (WHERE role = 'reviewer'), 0)::int,
      'admins', coalesce(count(*) FILTER (WHERE role = 'admin'), 0)::int,
      'total_users', coalesce(count(*), 0)::int
    )
    INTO v_user_distribution
    FROM public.profiles;
  END IF;

  -- 7. Top / recent batches overview (useful for own-batch breakdown and quick monitoring)
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', row.id,
        'batch_id', row.id,
        'name', row.name,
        'owner_name', row.owner_name,
        'created_at', row.created_at,
        'updated_at', row.updated_at,
        'image_count', row.image_count,
        'total_images', row.image_count,
        'completed_images', row.completed_image_count,
        'completed_image_count', row.completed_image_count,
        'total_annotations', row.total_annotation_count,
        'open_annotations', row.open_annotation_count,
        'review_status', row.review_status,
        'completion_percentage', CASE
          WHEN row.image_count > 0 THEN round((row.completed_image_count::numeric / row.image_count::numeric) * 100, 1)
          ELSE 0
        END
      ) ORDER BY row.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_top_batches
  FROM (
    SELECT *
    FROM public.list_dashboard_batches()
    LIMIT 10
  ) AS row;

  -- Return comprehensive structured analytics object
  RETURN jsonb_build_object(
    'overview', jsonb_build_object(
      'total_batches', v_total_batches,
      'total_images', v_total_images,
      'completed_images', v_completed_images,
      'pending_images', v_pending_images,
      'completion_percentage', v_completion_pct,
      'total_annotations', v_total_annotations,
      'open_annotations', v_open_annotations,
      'resolved_annotations', v_resolved_annotations,
      'resolution_percentage', v_resolution_pct,
      'total_storage_bytes', v_total_storage_bytes
    ),
    'batch_statuses', jsonb_build_object(
      'not_started', v_status_not_started,
      'in_review', v_status_in_review,
      'review_completed', v_status_completed
    ),
    'image_formats', v_image_formats,
    'time_trends', v_time_trends,
    'reviewer_contributions', v_reviewer_contributions,
    'my_contributions', v_my_contributions,
    'user_distribution', v_user_distribution,
    'top_batches', v_top_batches
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_analytics_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_analytics_summary() TO authenticated;
