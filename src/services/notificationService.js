import { isSupabaseConfigured, supabase } from './supabaseClient.js';

export function mapNotificationRow(row, actorNameFallback = 'A reviewer') {
  if (!row) return null;
  return {
    id: row.id,
    recipientId: row.recipient_id,
    actorId: row.actor_id,
    actorName: row.data?.actorName || actorNameFallback,
    type: row.type,
    title: row.title,
    message: row.message,
    batchId: row.batch_id,
    imageId: row.image_id,
    annotationId: row.annotation_id,
    data: row.data || {},
    isRead: Boolean(row.is_read),
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/**
 * Loads paginated notifications for the specified user.
 */
export async function listUserNotifications({
  userId,
  limit = 20,
  offset = 0,
  unreadOnly = false,
}) {
  if (!isSupabaseConfigured || !supabase || !userId) {
    return { notifications: [], total: 0 };
  }

  try {
    let query = supabase
      .from('notifications')
      .select(
        `
        id,
        recipient_id,
        actor_id,
        type,
        title,
        message,
        batch_id,
        image_id,
        annotation_id,
        data,
        is_read,
        read_at,
        created_at
      `,
        { count: 'exact' }
      )
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    const { data, count, error } = await query;
    if (error) {
      throw error;
    }

    // Fetch actor display names if available
    const actorIds = Array.from(
      new Set((data || []).map((n) => n.actor_id).filter(Boolean))
    );
    const actorNameMap = new Map();
    if (actorIds.length > 0) {
      try {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', actorIds);
        if (profiles) {
          profiles.forEach((p) => {
            if (p.id && p.display_name) {
              actorNameMap.set(p.id, p.display_name.trim());
            }
          });
        }
      } catch {
        // Fallback to notification data actorName
      }
    }

    const notifications = (data || []).map((row) =>
      mapNotificationRow(
        row,
        actorNameMap.get(row.actor_id) || row.data?.actorName || 'A reviewer'
      )
    );

    return {
      notifications,
      total: count ?? notifications.length,
    };
  } catch (err) {
    console.error('Failed to list user notifications:', err);
    return { notifications: [], total: 0 };
  }
}

/**
 * Returns count of unread notifications for a user.
 */
export async function getUnreadNotificationCount(userId) {
  if (!isSupabaseConfigured || !supabase || !userId) return 0;

  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', userId)
      .eq('is_read', false);

    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

/**
 * Marks a single notification as read.
 */
export async function markNotificationAsRead(notificationId) {
  if (!isSupabaseConfigured || !supabase || !notificationId) return false;

  try {
    const { error } = await supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('id', notificationId);

    return !error;
  } catch {
    return false;
  }
}

/**
 * Marks all notifications for a user as read.
 */
export async function markAllNotificationsAsRead(userId) {
  if (!isSupabaseConfigured || !supabase || !userId) return false;

  try {
    const { error } = await supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
      })
      .eq('recipient_id', userId)
      .eq('is_read', false);

    return !error;
  } catch {
    return false;
  }
}

/**
 * Subscribes to real-time notification events for a user.
 */
export function subscribeToUserNotifications({
  userId,
  onNewNotification,
  onUnreadChange,
}) {
  if (!isSupabaseConfigured || !supabase || !userId) {
    return () => {};
  }

  const channel = supabase
    .channel(`user-notifications-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${userId}`,
      },
      (payload) => {
        if (payload?.new) {
          onNewNotification?.(mapNotificationRow(payload.new));
          onUnreadChange?.();
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${userId}`,
      },
      () => {
        onUnreadChange?.();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

