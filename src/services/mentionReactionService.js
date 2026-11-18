import { isSupabaseConfigured, supabase } from './supabaseClient.js';

export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '👀', '✅'];

/**
 * Loads mentionable authorized users for a batch.
 * Invokes the secure get_mentionable_users RPC, with a graceful fallback to profiles query.
 */
export async function listBatchMentionableUsers(batchId) {
  if (!isSupabaseConfigured || !supabase || !batchId) return [];

  try {
    const { data, error } = await supabase.rpc('get_mentionable_users', {
      target_batch_id: batchId,
    });
    if (!error && Array.isArray(data)) {
      return data.map((u) => ({
        id: u.id,
        displayName: u.display_name?.trim() || 'Reviewer',
        role: u.role,
      }));
    }
  } catch {
    // Fallback if RPC has not been migrated yet
  }

  // Graceful fallback: query reviewers and admins
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, display_name, role')
      .in('role', ['reviewer', 'admin'])
      .order('display_name', { ascending: true });

    if (!error && Array.isArray(profiles)) {
      return profiles.map((u) => ({
        id: u.id,
        displayName: u.display_name?.trim() || 'Reviewer',
        role: u.role,
      }));
    }
  } catch {
    // Ignore fallback errors
  }

  return [];
}

/**
 * Loads all reactions for the batch's annotations, grouped by annotationId.
 */
export async function listBatchReactions(batchId) {
  if (!isSupabaseConfigured || !supabase || !batchId) return {};

  try {
    const { data, error } = await supabase
      .from('annotation_reactions')
      .select('id, annotation_id, user_id, emoji, created_at');

    if (error || !Array.isArray(data)) return {};

    const grouped = {};
    for (const r of data) {
      if (!grouped[r.annotation_id]) {
        grouped[r.annotation_id] = [];
      }
      grouped[r.annotation_id].push({
        id: r.id,
        annotationId: r.annotation_id,
        userId: r.user_id,
        emoji: r.emoji,
        createdAt: r.created_at,
      });
    }
    return grouped;
  } catch {
    return {};
  }
}

/**
 * Toggles a user's emoji reaction on an annotation comment.
 * If already reacted with this emoji, removes it; otherwise inserts it.
 */
export async function toggleAnnotationReaction({
  annotationId,
  emoji,
  userId,
}) {
  if (!isSupabaseConfigured || !supabase || !annotationId || !emoji || !userId) {
    return null;
  }

  if (!ALLOWED_REACTIONS.includes(emoji)) {
    throw new Error('Unsupported reaction emoji.');
  }

  try {
    // Check if reaction exists
    const { data: existing } = await supabase
      .from('annotation_reactions')
      .select('id')
      .eq('annotation_id', annotationId)
      .eq('user_id', userId)
      .eq('emoji', emoji)
      .maybeSingle();

    if (existing?.id) {
      // Remove reaction
      await supabase
        .from('annotation_reactions')
        .delete()
        .eq('id', existing.id);

      return {
        action: 'removed',
        annotationId,
        userId,
        emoji,
      };
    } else {
      // Add reaction
      const { data, error } = await supabase
        .from('annotation_reactions')
        .insert({
          annotation_id: annotationId,
          user_id: userId,
          emoji,
        })
        .select()
        .single();

      if (error) throw error;

      return {
        action: 'added',
        reaction: {
          id: data.id,
          annotationId: data.annotation_id,
          userId: data.user_id,
          emoji: data.emoji,
          createdAt: data.created_at,
        },
      };
    }
  } catch (err) {
    console.error('Failed to toggle reaction:', err);
    throw err;
  }
}

/**
 * Synchronizes mentioned user IDs for an annotation into annotation_mentions table.
 */
export async function syncAnnotationMentions({ annotationId, userIds = [] }) {
  if (!isSupabaseConfigured || !supabase || !annotationId) return;

  try {
    // Delete previous mentions
    await supabase
      .from('annotation_mentions')
      .delete()
      .eq('annotation_id', annotationId);

    // Insert new mentions
    const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueIds.length > 0) {
      await supabase
        .from('annotation_mentions')
        .insert(
          uniqueIds.map((uid) => ({
            annotation_id: annotationId,
            mentioned_user_id: uid,
          }))
        );
    }
  } catch {
    // Graceful fallback if table is pending migration
  }
}

/**
 * Inserts newly mentioned user IDs for an annotation into annotation_mentions table without deleting existing mentions.
 */
export async function addAnnotationMentions({ annotationId, userIds = [] }) {
  if (!isSupabaseConfigured || !supabase || !annotationId) return;
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  try {
    for (const uid of uniqueIds) {
      await supabase
        .from('annotation_mentions')
        .upsert(
          { annotation_id: annotationId, mentioned_user_id: uid },
          { onConflict: 'annotation_id,mentioned_user_id', ignoreDuplicates: true }
        );
    }
  } catch {
    // Graceful fallback if table is pending migration
  }
}

/**
 * Extracts mentioned user IDs from comment text by matching @display_name with available authorized users.
 */
export function extractMentionedUserIds(commentText, mentionableUsers = []) {
  if (!commentText || !Array.isArray(mentionableUsers) || mentionableUsers.length === 0) {
    return [];
  }

  const mentionedIds = new Set();
  const lowerText = commentText.toLowerCase();

  for (const user of mentionableUsers) {
    const name = user.displayName?.toLowerCase();
    if (name && (lowerText.includes(`@${name}`) || lowerText.includes(`@${name.replace(/\s+/g, '')}`))) {
      mentionedIds.add(user.id);
    }
  }

  return Array.from(mentionedIds);
}

/**
 * Groups an array of reactions into summary objects: { [emoji]: { count, userIds, hasReacted } }
 */
export function summarizeReactions(reactions = [], currentUserId = null) {
  const summary = {};
  for (const emoji of ALLOWED_REACTIONS) {
    summary[emoji] = {
      emoji,
      count: 0,
      userIds: [],
      hasReacted: false,
    };
  }

  if (Array.isArray(reactions)) {
    for (const r of reactions) {
      if (summary[r.emoji]) {
        summary[r.emoji].count += 1;
        summary[r.emoji].userIds.push(r.userId);
        if (currentUserId && r.userId === currentUserId) {
          summary[r.emoji].hasReacted = true;
        }
      }
    }
  }

  return summary;
}

