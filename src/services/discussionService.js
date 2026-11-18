import { isSupabaseConfigured, supabase } from './supabaseClient.js';
import { addAnnotationMentions, extractMentionedUserIds } from './mentionReactionService.js';

let hasDiscussionsTable = true;
const localDiscussionStore = new Map(); // batchId -> Map<annotationId, message[]>

/**
 * Normalizes a raw database or local discussion message.
 */
export function mapDiscussionRow(row, authorFallback = 'Reviewer') {
  if (!row) return null;
  const authorName =
    row.author?.display_name?.trim() ||
    row.profiles?.display_name?.trim() ||
    row.authorName?.trim() ||
    authorFallback ||
    'Reviewer';
  const authorRole =
    row.author?.role ||
    row.profiles?.role ||
    row.authorRole ||
    'reviewer';

  return {
    id: row.id,
    annotationId: row.annotation_id || row.annotationId,
    userId: row.user_id || row.userId,
    authorName,
    authorRole,
    message: String(row.message || '').trim(),
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

/**
 * Loads all discussions for a batch, grouped by annotation ID.
 */
export async function listBatchDiscussions(batchId) {
  if (!batchId) return {};

  const localMap = localDiscussionStore.get(batchId);
  const localGrouped = {};
  if (localMap) {
    for (const [annId, msgs] of localMap.entries()) {
      localGrouped[annId] = [...msgs];
    }
  }

  if (!isSupabaseConfigured || !supabase || !hasDiscussionsTable) {
    return localGrouped;
  }

  try {
    // Attempt query with profiles join
    let rows = null;
    let queryError = null;

    try {
      const res = await supabase
        .from('annotation_discussions')
        .select(`
          id,
          annotation_id,
          user_id,
          message,
          created_at,
          updated_at,
          author:profiles (
            display_name,
            role
          )
        `)
        .order('created_at', { ascending: true });

      rows = res.data;
      queryError = res.error;
    } catch (joinErr) {
      queryError = joinErr;
    }

    // Fallback query without explicit foreign key join if relation is not detected
    if (queryError || !Array.isArray(rows)) {
      const simpleRes = await supabase
        .from('annotation_discussions')
        .select('*')
        .order('created_at', { ascending: true });

      if (simpleRes.error) {
        // Table not migrated yet
        hasDiscussionsTable = false;
        return localGrouped;
      }
      rows = simpleRes.data || [];
    }

    const grouped = {};
    for (const r of rows) {
      const mapped = mapDiscussionRow(r);
      if (!mapped || !mapped.annotationId) continue;
      if (!grouped[mapped.annotationId]) {
        grouped[mapped.annotationId] = [];
      }
      grouped[mapped.annotationId].push(mapped);
    }

    // Merge with any in-memory local discussion messages
    for (const [annId, msgs] of Object.entries(localGrouped)) {
      if (!grouped[annId]) {
        grouped[annId] = msgs;
      } else {
        const existingIds = new Set(grouped[annId].map((m) => m.id));
        for (const m of msgs) {
          if (!existingIds.has(m.id)) {
            grouped[annId].push(m);
          }
        }
        grouped[annId].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      }
    }

    return grouped;
  } catch (err) {
    console.warn('Failed to load batch discussions, falling back to local store:', err);
    hasDiscussionsTable = false;
    return localGrouped;
  }
}

/**
 * Creates a new discussion message for an annotation.
 */
export async function createDiscussionMessage({
  batchId,
  annotationId,
  userId,
  authorName = 'Reviewer',
  authorRole = 'reviewer',
  message,
  mentionableUsers = [],
}) {
  const trimmed = String(message || '').trim();
  if (!trimmed) {
    throw new Error('Message cannot be empty.');
  }
  if (trimmed.length > 2000) {
    throw new Error('Message must be 2000 characters or fewer.');
  }
  if (!annotationId || !userId) {
    throw new Error('Annotation and user IDs are required.');
  }

  const mentionedUserIds = extractMentionedUserIds(trimmed, mentionableUsers);

  // If Supabase is configured and table exists, persist to database
  if (isSupabaseConfigured && supabase && hasDiscussionsTable) {
    try {
      const { data, error } = await supabase
        .from('annotation_discussions')
        .insert({
          annotation_id: annotationId,
          user_id: userId,
          message: trimmed,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      // Sync mentions to annotation_mentions table
      if (mentionedUserIds.length > 0) {
        addAnnotationMentions({
          annotationId,
          userIds: mentionedUserIds,
        }).catch((err) => console.warn('Failed to sync discussion mentions:', err));
      }

      const createdMsg = mapDiscussionRow({
        ...data,
        authorName,
        authorRole,
      });

      // Update local cache
      if (batchId) {
        let batchMap = localDiscussionStore.get(batchId);
        if (!batchMap) {
          batchMap = new Map();
          localDiscussionStore.set(batchId, batchMap);
        }
        const currentList = batchMap.get(annotationId) || [];
        batchMap.set(annotationId, [...currentList, createdMsg]);
      }

      return createdMsg;
    } catch (dbErr) {
      console.warn('Database discussion insert failed, using fallback:', dbErr);
      // If table doesn't exist, mark hasDiscussionsTable false and fall through
      if (dbErr?.code === '42P01' || dbErr?.message?.includes('does not exist')) {
        hasDiscussionsTable = false;
      } else {
        throw dbErr;
      }
    }
  }

  // Fallback: create in-memory discussion message
  const fallbackMsg = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    annotationId,
    userId,
    authorName,
    authorRole,
    message: trimmed,
    createdAt: new Date().toISOString(),
    updatedAt: null,
  };

  if (batchId) {
    let batchMap = localDiscussionStore.get(batchId);
    if (!batchMap) {
      batchMap = new Map();
      localDiscussionStore.set(batchId, batchMap);
    }
    const currentList = batchMap.get(annotationId) || [];
    batchMap.set(annotationId, [...currentList, fallbackMsg]);
  }

  // Also sync mentions if supported
  if (mentionedUserIds.length > 0) {
    addAnnotationMentions({
      annotationId,
      userIds: mentionedUserIds,
    }).catch(() => {});
  }

  return fallbackMsg;
}

/**
 * Deletes a discussion message.
 */
export async function deleteDiscussionMessage({
  batchId,
  annotationId,
  messageId,
}) {
  if (!messageId || !annotationId) return false;

  // Remove from local memory cache
  if (batchId) {
    const batchMap = localDiscussionStore.get(batchId);
    if (batchMap && batchMap.has(annotationId)) {
      const filtered = batchMap.get(annotationId).filter((m) => m.id !== messageId);
      batchMap.set(annotationId, filtered);
    }
  }

  if (!isSupabaseConfigured || !supabase || !hasDiscussionsTable) {
    return true;
  }

  try {
    const { error } = await supabase
      .from('annotation_discussions')
      .delete()
      .eq('id', messageId);

    if (error) {
      console.warn('Failed to delete discussion message in database:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Error deleting discussion message:', err);
    return false;
  }
}

