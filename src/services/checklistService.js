import { isSupabaseConfigured, supabase } from './supabaseClient.js';

export const DEFAULT_CHECKLIST_CRITERIA = [
  {
    id: 'default-color',
    title: 'Color Accuracy & Palette Verification',
    description: 'Verify brand palette colors, contrast ratios, and color grading consistency across images.',
    category: 'Visual',
    position: 0,
    isDefault: true,
  },
  {
    id: 'default-layout',
    title: 'Layout, Spacing & Safe Areas',
    description: 'Confirm grid alignment, proper padding/margins, and responsive safe-area cutoffs.',
    category: 'Layout',
    position: 1,
    isDefault: true,
  },
  {
    id: 'default-typography',
    title: 'Typography, Font Hierarchy & Copy',
    description: 'Check typographic scale, font weights, spelling, grammar, and copy accuracy.',
    category: 'Content',
    position: 2,
    isDefault: true,
  },
  {
    id: 'default-resolution',
    title: 'Asset Resolution & Sharpness',
    description: 'Inspect image sharpness, vector sharpness, and verify absence of pixelation or compression artifacts.',
    category: 'Quality',
    position: 3,
    isDefault: true,
  },
  {
    id: 'default-brand',
    title: 'Brand Guidelines & Consistency',
    description: 'Ensure logo clear-space, proper visual branding treatments, and styling consistency.',
    category: 'Brand',
    position: 4,
    isDefault: true,
  },
  {
    id: 'default-critical',
    title: 'All Critical Feedback Resolved',
    description: 'Verify that all high and critical priority annotations have been satisfactorily resolved.',
    category: 'Review',
    position: 5,
    isDefault: true,
  },
];

export const CHECKLIST_CATEGORIES = [
  'All',
  'Visual',
  'Layout',
  'Content',
  'Quality',
  'Brand',
  'Review',
  'Custom',
];

const LOCAL_STORAGE_KEY_PREFIX = 'fc_checklists_';

function getLocalChecklists(batchId) {
  if (typeof window === 'undefined' || !batchId) return null;
  try {
    const raw = window.localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${batchId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocalChecklists(batchId, checklists) {
  if (typeof window === 'undefined' || !batchId) return;
  try {
    window.localStorage.setItem(
      `${LOCAL_STORAGE_KEY_PREFIX}${batchId}`,
      JSON.stringify(checklists)
    );
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Initializes default checklist items for a batch in memory/localStorage.
 */
function createDefaultLocalChecklists(batchId, creatorId = null) {
  const timestamp = new Date().toISOString();
  return DEFAULT_CHECKLIST_CRITERIA.map((crit, idx) => ({
    id: `chk-def-${crit.position}-${batchId.slice(0, 8)}`,
    batchId,
    title: crit.title,
    description: crit.description,
    category: crit.category,
    isCompleted: false,
    completedBy: null,
    completedAt: null,
    createdBy: creatorId,
    createdAt: timestamp,
    position: idx,
    isDefault: true,
  }));
}

/**
 * Calculates completion statistics and progress percentage.
 */
export function calculateChecklistProgress(checklists = []) {
  if (!Array.isArray(checklists) || checklists.length === 0) {
    return {
      total: 0,
      completed: 0,
      remaining: 0,
      percentage: 0,
      isAllCompleted: false,
    };
  }

  const total = checklists.length;
  const completed = checklists.filter((item) => item.isCompleted).length;
  const remaining = total - completed;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    total,
    completed,
    remaining,
    percentage,
    isAllCompleted: total > 0 && completed === total,
  };
}

/**
 * Normalizes a database row into a standardized checklist object.
 */
function normalizeChecklistRow(row) {
  return {
    id: row.id,
    batchId: row.batch_id,
    title: row.title,
    description: row.description || '',
    category: row.category || 'general',
    isCompleted: Boolean(row.is_completed),
    completedBy: row.completed_by || null,
    completedAt: row.completed_at || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at || new Date().toISOString(),
    position: typeof row.position === 'number' ? row.position : 0,
    isDefault: Boolean(row.is_default),
  };
}

/**
 * Fetches review checklists for a batch, auto-seeding defaults if not yet present.
 */
export async function fetchBatchChecklists(batchId, currentUserId = null) {
  if (!batchId) return [];

  // 1. Try Supabase if configured
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from('batch_review_checklists')
        .select('*')
        .eq('batch_id', batchId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data)) {
        if (data.length > 0) {
          const normalized = data.map(normalizeChecklistRow);
          saveLocalChecklists(batchId, normalized);
          return normalized;
        }

        // Table exists but is empty for this batch: seed default items
        const { data: seeded, error: seedErr } = await supabase.rpc(
          'seed_batch_default_checklists',
          { p_batch_id: batchId, p_actor_id: currentUserId }
        );

        if (!seedErr && Array.isArray(seeded) && seeded.length > 0) {
          const normalized = seeded.map(normalizeChecklistRow);
          saveLocalChecklists(batchId, normalized);
          return normalized;
        }

        // Direct insert fallback if RPC isn't available
        const defaultInserts = DEFAULT_CHECKLIST_CRITERIA.map((crit) => ({
          batch_id: batchId,
          title: crit.title,
          description: crit.description,
          category: crit.category,
          position: crit.position,
          is_default: true,
          created_by: currentUserId,
        }));

        const { data: inserted, error: insErr } = await supabase
          .from('batch_review_checklists')
          .insert(defaultInserts)
          .select('*');

        if (!insErr && Array.isArray(inserted) && inserted.length > 0) {
          const normalized = inserted.map(normalizeChecklistRow);
          saveLocalChecklists(batchId, normalized);
          return normalized;
        }
      }
    } catch (err) {
      // Table doesn't exist yet (migration unapplied), fallback to localStorage
      console.debug('Direct checklist read unmigrated, operating with local fallback:', err);
    }
  }

  // 2. Local fallback
  const local = getLocalChecklists(batchId);
  if (local && Array.isArray(local) && local.length > 0) {
    return local;
  }

  const defaultList = createDefaultLocalChecklists(batchId, currentUserId);
  saveLocalChecklists(batchId, defaultList);
  return defaultList;
}

/**
 * Toggles the completed status of a checklist item.
 */
export async function toggleChecklistItem({
  batchId,
  checklistId,
  isCompleted,
  currentUserId = null,
  currentUserName = 'Reviewer',
}) {
  if (!batchId || !checklistId) return null;

  const timestamp = isCompleted ? new Date().toISOString() : null;
  const completedBy = isCompleted ? currentUserId : null;

  let updatedItem = null;

  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from('batch_review_checklists')
        .update({
          is_completed: isCompleted,
          completed_by: completedBy,
          completed_at: timestamp,
          updated_at: new Date().toISOString(),
        })
        .eq('id', checklistId)
        .eq('batch_id', batchId)
        .select('*')
        .single();

      if (!error && data) {
        updatedItem = normalizeChecklistRow(data);
      }
    } catch (err) {
      console.debug('Failed to update checklist item in Supabase, updating local state:', err);
    }
  }

  // Update local storage copy
  const local = getLocalChecklists(batchId) || [];
  const idx = local.findIndex((item) => item.id === checklistId);
  if (idx !== -1) {
    const nextItem = updatedItem || {
      ...local[idx],
      isCompleted,
      completedBy,
      completedAt: timestamp,
      completedByName: isCompleted ? currentUserName : null,
    };
    local[idx] = nextItem;
    saveLocalChecklists(batchId, local);
    return nextItem;
  }

  if (updatedItem) {
    local.push(updatedItem);
    saveLocalChecklists(batchId, local);
    return updatedItem;
  }

  return null;
}

/**
 * Adds a custom checklist item to the batch review checklist.
 */
export async function addCustomChecklistItem({
  batchId,
  title,
  description = '',
  category = 'Custom',
  currentUserId = null,
}) {
  if (!batchId || !title?.trim()) return null;

  const local = getLocalChecklists(batchId) || [];
  const maxPos = local.reduce((max, cur) => Math.max(max, cur.position || 0), 0);
  const nextPos = maxPos + 1;
  const timestamp = new Date().toISOString();
  const trimmedTitle = title.trim();
  const trimmedDesc = description?.trim() || '';

  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from('batch_review_checklists')
        .insert({
          batch_id: batchId,
          title: trimmedTitle,
          description: trimmedDesc,
          category: category || 'Custom',
          position: nextPos,
          is_default: false,
          created_by: currentUserId,
        })
        .select('*')
        .single();

      if (!error && data) {
        const normalized = normalizeChecklistRow(data);
        local.push(normalized);
        saveLocalChecklists(batchId, local);
        return normalized;
      }
    } catch (err) {
      console.debug('Failed to insert custom checklist in Supabase, saving locally:', err);
    }
  }

  const newItem = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `chk-custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    batchId,
    title: trimmedTitle,
    description: trimmedDesc,
    category: category || 'Custom',
    isCompleted: false,
    completedBy: null,
    completedAt: null,
    createdBy: currentUserId,
    createdAt: timestamp,
    position: nextPos,
    isDefault: false,
  };

  local.push(newItem);
  saveLocalChecklists(batchId, local);
  return newItem;
}

/**
 * Deletes a custom checklist item. Default items cannot be deleted, only toggled.
 */
export async function deleteChecklistItem({ batchId, checklistId }) {
  if (!batchId || !checklistId) return false;

  if (isSupabaseConfigured && supabase) {
    try {
      await supabase
        .from('batch_review_checklists')
        .delete()
        .eq('id', checklistId)
        .eq('batch_id', batchId);
    } catch (err) {
      console.debug('Failed to delete checklist item in Supabase:', err);
    }
  }

  const local = getLocalChecklists(batchId) || [];
  const filtered = local.filter((item) => item.id !== checklistId);
  saveLocalChecklists(batchId, filtered);
  return true;
}

