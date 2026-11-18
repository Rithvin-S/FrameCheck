/**
 * Supabase service layer for the collaborative batch whiteboard.
 * Manages database persistence, RLS operations, and Supabase Realtime synchronization.
 */

import { isSupabaseConfigured, supabase } from './supabaseClient.js';
import { getReviewerColor } from './annotationState.js';

export function mapWhiteboardElementRow(row, creatorNameFallback = 'Reviewer') {
  if (!row) return null;
  return {
    id: row.id,
    batchId: row.batch_id,
    type: row.type,
    x: Number(row.x),
    y: Number(row.y),
    width: row.width != null ? Number(row.width) : null,
    height: row.height != null ? Number(row.height) : null,
    text: row.text || '',
    color: row.color,
    geometry: row.geometry || {},
    zIndex: Number(row.z_index || 0),
    createdBy: row.created_by,
    creatorName: creatorNameFallback,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Loads all whiteboard elements for a batch, ordered by z_index.
 */
export async function listBatchWhiteboardElements(batchId) {
  if (!isSupabaseConfigured || !supabase || !batchId) return [];

  const { data, error } = await supabase
    .from('batch_whiteboard_elements')
    .select(`
      id,
      batch_id,
      type,
      x,
      y,
      width,
      height,
      text,
      color,
      geometry,
      z_index,
      created_by,
      created_at,
      updated_at
    `)
    .eq('batch_id', batchId)
    .order('z_index', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message || 'Failed to load whiteboard elements.');
  }

  // Batch lookup creator display names from profiles
  const creatorIds = Array.from(
    new Set((data || []).map((el) => el.created_by).filter(Boolean))
  );
  const creatorNameMap = new Map();
  if (creatorIds.length > 0) {
    try {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', creatorIds);
      if (profiles) {
        profiles.forEach((p) => {
          if (p.id && p.display_name) {
            creatorNameMap.set(p.id, p.display_name.trim());
          }
        });
      }
    } catch {
      // Graceful fallback to default creator name
    }
  }

  return (data || []).map((row) =>
    mapWhiteboardElementRow(row, creatorNameMap.get(row.created_by) || 'Reviewer')
  );
}

/**
 * Creates a new whiteboard element in the batch.
 */
export async function createWhiteboardElement({
  batchId,
  type,
  x,
  y,
  width = null,
  height = null,
  text = '',
  color = '#fef08a',
  geometry = {},
  zIndex = 0,
  createdBy,
  creatorNameFallback = 'Reviewer',
}) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase
    .from('batch_whiteboard_elements')
    .insert({
      batch_id: batchId,
      type,
      x,
      y,
      width,
      height,
      text,
      color,
      geometry,
      z_index: zIndex,
      created_by: createdBy,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to create whiteboard element.');
  }

  return mapWhiteboardElementRow(data, creatorNameFallback);
}

/**
 * Updates an existing whiteboard element.
 */
export async function updateWhiteboardElement(
  elementId,
  updates,
  creatorNameFallback = 'Reviewer'
) {
  if (!isSupabaseConfigured || !supabase || !elementId) return null;

  const patch = {};
  if (updates.x !== undefined) patch.x = updates.x;
  if (updates.y !== undefined) patch.y = updates.y;
  if (updates.width !== undefined) patch.width = updates.width;
  if (updates.height !== undefined) patch.height = updates.height;
  if (updates.text !== undefined) patch.text = updates.text;
  if (updates.color !== undefined) patch.color = updates.color;
  if (updates.geometry !== undefined) patch.geometry = updates.geometry;
  if (updates.zIndex !== undefined) patch.z_index = updates.zIndex;

  const { data, error } = await supabase
    .from('batch_whiteboard_elements')
    .update(patch)
    .eq('id', elementId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to update whiteboard element.');
  }

  return mapWhiteboardElementRow(data, creatorNameFallback);
}

/**
 * Deletes a whiteboard element from PostgreSQL.
 */
export async function deleteWhiteboardElement(elementId) {
  if (!isSupabaseConfigured || !supabase || !elementId) return false;

  const { error } = await supabase
    .from('batch_whiteboard_elements')
    .delete()
    .eq('id', elementId);

  if (error) {
    throw new Error(error.message || 'Failed to delete whiteboard element.');
  }
  return true;
}

/**
 * Subscribes to live whiteboard events, presence, and live cursors for a batch.
 */
export function subscribeToBatchWhiteboardRealtime({
  batchId,
  presenceUser = null,
  onPresenceSync = null,
  onElementUpsert = null,
  onElementDelete = null,
  onCursorBroadcast = null,
  onCursorLeave = null,
  onStatusChange = null,
}) {
  if (!isSupabaseConfigured || !supabase || !batchId) {
    return () => {};
  }

  const channelConfig =
    presenceUser && presenceUser.user_id
      ? {
          config: {
            presence: {
              key: presenceUser.user_id,
            },
          },
        }
      : {};

  const channel = supabase.channel(`batch-whiteboard-${batchId}`, channelConfig);

  const canTrack = Boolean(
    presenceUser &&
      presenceUser.user_id &&
      (presenceUser.role === 'reviewer' || presenceUser.role === 'admin')
  );

  let currentTrackedState = {
    user_id: presenceUser?.user_id,
    session_id: presenceUser?.sessionId || null,
    display_name: presenceUser?.display_name || 'Reviewer',
    role: presenceUser?.role,
    color:
      presenceUser?.color ||
      getReviewerColor(presenceUser?.user_id || presenceUser?.display_name),
  };

  const extractUniqueCollaborators = (presenceState) => {
    if (!presenceState || typeof presenceState !== 'object') {
      return [];
    }
    const userMap = new Map();

    Object.values(presenceState).forEach((presences) => {
      if (!Array.isArray(presences)) return;
      presences.forEach((p) => {
        if (!p || !p.user_id) return;
        userMap.set(p.user_id, {
          userId: p.user_id,
          sessionId: p.session_id || null,
          displayName: p.display_name || 'Reviewer',
          role: p.role,
          color: p.color || getReviewerColor(p.user_id || p.display_name),
        });
      });
    });

    return Array.from(userMap.values());
  };

  const notifyPresence = () => {
    if (typeof onPresenceSync === 'function') {
      const collaborators = extractUniqueCollaborators(channel.presenceState());
      onPresenceSync(collaborators);
    }
  };

  const trackPresence = async () => {
    if (!canTrack) return;
    try {
      await channel.track(currentTrackedState);
    } catch {
      // Gracefully ignore presence tracking errors
    }
  };

  const sendCursor = (payload) => {
    if (!canTrack) return;
    try {
      channel.send({
        type: 'broadcast',
        event: 'cursor',
        payload,
      });
    } catch {
      // Ignore
    }
  };

  const sendCursorLeave = (payload) => {
    if (!canTrack) return;
    try {
      channel.send({
        type: 'broadcast',
        event: 'cursor-leave',
        payload,
      });
    } catch {
      // Ignore
    }
  };

  channel
    .on('presence', { event: 'sync' }, notifyPresence)
    .on('presence', { event: 'join' }, notifyPresence)
    .on('presence', { event: 'leave' }, notifyPresence)
    .on('broadcast', { event: 'cursor' }, ({ payload }) => {
      if (payload && onCursorBroadcast) {
        onCursorBroadcast(payload);
      }
    })
    .on('broadcast', { event: 'cursor-leave' }, ({ payload }) => {
      if (payload && onCursorLeave) {
        onCursorLeave(payload);
      }
    })
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'batch_whiteboard_elements',
        filter: `batch_id=eq.${batchId}`,
      },
      (payload) => {
        if (payload?.new) {
          onElementUpsert?.(mapWhiteboardElementRow(payload.new));
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'batch_whiteboard_elements',
        filter: `batch_id=eq.${batchId}`,
      },
      (payload) => {
        if (payload?.new) {
          onElementUpsert?.(mapWhiteboardElementRow(payload.new));
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'batch_whiteboard_elements',
      },
      (payload) => {
        if (payload?.old?.id) {
          onElementDelete?.(payload.old.id);
        }
      }
    )
    .subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        trackPresence();
      }
      onStatusChange?.(status, error);
    });

  const unsubscribe = () => {
    if (canTrack) {
      channel.untrack().catch(() => {});
    }
    onPresenceSync?.([]);
    supabase.removeChannel(channel);
  };

  unsubscribe.sendCursor = sendCursor;
  unsubscribe.sendCursorLeave = sendCursorLeave;

  return unsubscribe;
}

