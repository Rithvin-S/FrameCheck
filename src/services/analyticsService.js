import { supabase } from './supabaseClient.js';

function getClientOrThrow() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.'
    );
  }
  return supabase;
}

/**
 * Formats raw byte count into human-readable unit (B, KB, MB, GB).
 * Handles zero and invalid inputs safely.
 */
export function formatStorageBytes(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  if (num < 1024) return `${num} B`;
  const kb = num / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * Formats a decimal or percentage number into a display string.
 */
export function formatPercent(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '0%';
  return `${num.toFixed(digits)}%`;
}

/**
 * Formats an ISO timestamp into a concise activity string.
 */
export function formatActivityTimestamp(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Returns metadata and presentation properties for each activity event type.
 */
export function getActivityMeta(item) {
  switch (item?.event_type) {
    case 'annotation_created':
      return {
        badgeLabel: 'New Annotation',
        badgeClass: 'fc-activity-badge-created',
        icon: 'annotation',
        summary: item.actor_name
          ? `${item.actor_name} added #${item.annotation_number || 'annotation'}`
          : `Added #${item.annotation_number || 'annotation'}`,
        targetLink: item.batch_id && item.image_id
          ? `/batches/${item.batch_id}/review?image=${item.image_id}`
          : item.batch_id
            ? `/batches/${item.batch_id}`
            : null,
        targetLabel: item.image_filename
          ? `${item.image_filename} (${item.batch_name || 'Batch'})`
          : item.batch_name || 'View Image',
      };

    case 'annotation_resolved':
      return {
        badgeLabel: 'Resolved',
        badgeClass: 'fc-activity-badge-resolved',
        icon: 'check-circle',
        summary: item.actor_name
          ? `${item.actor_name} resolved #${item.annotation_number || 'annotation'}`
          : `Resolved #${item.annotation_number || 'annotation'}`,
        targetLink: item.batch_id && item.image_id
          ? `/batches/${item.batch_id}/review?image=${item.image_id}`
          : item.batch_id
            ? `/batches/${item.batch_id}`
            : null,
        targetLabel: item.image_filename
          ? `${item.image_filename} (${item.batch_name || 'Batch'})`
          : item.batch_name || 'View Image',
      };

    case 'image_completed':
      return {
        badgeLabel: 'Image Completed',
        badgeClass: 'fc-activity-badge-completed',
        icon: 'image-check',
        summary: item.actor_name
          ? `${item.actor_name} completed image`
          : 'Image marked as completed',
        targetLink: item.batch_id && item.image_id
          ? `/batches/${item.batch_id}/review?image=${item.image_id}`
          : item.batch_id
            ? `/batches/${item.batch_id}`
            : null,
        targetLabel: item.image_filename
          ? `${item.image_filename} (${item.batch_name || 'Batch'})`
          : item.batch_name || 'View Image',
      };

    case 'batch_created':
      return {
        badgeLabel: 'New Batch',
        badgeClass: 'fc-activity-badge-batch',
        icon: 'folder-plus',
        summary: item.actor_name
          ? `${item.actor_name} created batch`
          : 'New batch created',
        targetLink: item.batch_id ? `/batches/${item.batch_id}` : null,
        targetLabel: item.batch_name || 'Open Batch',
      };

    case 'annotation_deleted':
      return {
        badgeLabel: 'Annotation Removed',
        badgeClass: 'fc-activity-badge-deleted',
        icon: 'trash',
        summary: 'Annotation removed',
        targetLink: item.batch_id ? `/batches/${item.batch_id}` : null,
        targetLabel: item.batch_name || 'Open Batch',
      };

    default:
      return {
        badgeLabel: 'Activity',
        badgeClass: 'fc-activity-badge-default',
        icon: 'activity',
        summary: item?.details || 'System event',
        targetLink: item?.batch_id ? `/batches/${item.batch_id}` : null,
        targetLabel: item?.batch_name || 'View',
      };
  }
}

/**
 * Fetches the complete analytics summary JSON from public.get_analytics_summary().
 * Enforces the caller's RLS boundaries through PostgreSQL SECURITY INVOKER.
 */
export async function fetchAnalyticsSummary() {
  const client = getClientOrThrow();
  const { data, error } = await client.rpc('get_analytics_summary');

  if (error) {
    throw error;
  }

  return (
    data ?? {
      overview: {
        total_batches: 0,
        total_images: 0,
        completed_images: 0,
        pending_images: 0,
        completion_percentage: 0,
        total_annotations: 0,
        open_annotations: 0,
        resolved_annotations: 0,
        resolution_percentage: 0,
        total_storage_bytes: 0,
      },
      batch_statuses: {
        not_started: 0,
        in_review: 0,
        review_completed: 0,
      },
      image_formats: [],
      time_trends: [],
      reviewer_contributions: [],
      my_contributions: {
        annotations_created: 0,
        annotations_resolved: 0,
        images_completed: 0,
        batches_contributed: 0,
      },
      user_distribution: null,
      top_batches: [],
    }
  );
}

/**
 * Fetches recent actual review activity from public.get_recent_activity(limit_count).
 */
export async function fetchRecentActivity(limit = 15) {
  const client = getClientOrThrow();
  const { data, error } = await client.rpc('get_recent_activity', {
    limit_count: limit,
  });

  if (error) {
    throw error;
  }

  return data ?? [];
}

