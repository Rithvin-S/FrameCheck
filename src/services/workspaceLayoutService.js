import { supabase } from './supabaseClient.js';

export const DEFAULT_THUMBNAILS_WIDTH = 250;
export const MIN_THUMBNAILS_WIDTH = 180;
export const MAX_THUMBNAILS_WIDTH = 420;

export const DEFAULT_SIDEBAR_WIDTH = 360;
export const MIN_SIDEBAR_WIDTH = 280;
export const MAX_SIDEBAR_WIDTH = 560;

export const MIN_CANVAS_WIDTH = 360;

export const DEFAULT_LAYOUT = {
  id: 'preset-default',
  name: 'Default',
  description: 'Balanced workspace with left thumbnails and right review sidebar.',
  isPreset: true,
  thumbnailsWidth: DEFAULT_THUMBNAILS_WIDTH,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  panelLayout: 'default',
  isThumbnailsCollapsed: false,
  isSidebarCollapsed: false,
  isThumbnailsVisible: true,
  isSidebarVisible: true,
};

export const BUILTIN_PRESETS = [
  DEFAULT_LAYOUT,
  {
    id: 'preset-comments-focus',
    name: 'Review & Comments Focus',
    description: 'Expanded sidebar for reading comments, checklists, and discussions.',
    isPreset: true,
    thumbnailsWidth: 200,
    sidebarWidth: 480,
    panelLayout: 'default',
    isThumbnailsCollapsed: false,
    isSidebarCollapsed: false,
    isThumbnailsVisible: true,
    isSidebarVisible: true,
  },
  {
    id: 'preset-canvas-focus',
    name: 'Canvas Focus (Collapsed)',
    description: 'Collapses both panels to 44px slim rails for maximum canvas room.',
    isPreset: true,
    thumbnailsWidth: DEFAULT_THUMBNAILS_WIDTH,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    panelLayout: 'default',
    isThumbnailsCollapsed: true,
    isSidebarCollapsed: true,
    isThumbnailsVisible: true,
    isSidebarVisible: true,
  },
  {
    id: 'preset-left-handed',
    name: 'Left-Handed (Swapped)',
    description: 'Swapped dock positions: Review sidebar on the left, thumbnails on the right.',
    isPreset: true,
    thumbnailsWidth: DEFAULT_THUMBNAILS_WIDTH,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    panelLayout: 'swapped',
    isThumbnailsCollapsed: false,
    isSidebarCollapsed: false,
    isThumbnailsVisible: true,
    isSidebarVisible: true,
  },
  {
    id: 'preset-sidebar-only',
    name: 'Review Sidebar Only',
    description: 'Hides thumbnail filmstrip to dedicate full workspace to image and comments.',
    isPreset: true,
    thumbnailsWidth: DEFAULT_THUMBNAILS_WIDTH,
    sidebarWidth: 380,
    panelLayout: 'default',
    isThumbnailsCollapsed: false,
    isSidebarCollapsed: false,
    isThumbnailsVisible: false,
    isSidebarVisible: true,
  },
  {
    id: 'preset-thumbnails-only',
    name: 'Thumbnails Only',
    description: 'Hides review sidebar to maximize image preview while navigating batches.',
    isPreset: true,
    thumbnailsWidth: 280,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    panelLayout: 'default',
    isThumbnailsCollapsed: false,
    isSidebarCollapsed: false,
    isThumbnailsVisible: true,
    isSidebarVisible: false,
  },
];

const ACTIVE_LAYOUT_KEY_PREFIX = 'fc_workspace_active_layout_';
const SAVED_LAYOUTS_KEY_PREFIX = 'fc_workspace_saved_layouts_';
const LEGACY_LAYOUT_STORAGE_KEY = 'fc_workspace_panel_layout';

/**
 * Validates and clamps layout values within safe visual boundaries.
 * Prevents invalid properties, crashes, or unrecoverable hidden navigation states.
 */
export function sanitizeLayoutData(raw = {}, fallback = DEFAULT_LAYOUT) {
  if (!raw || typeof raw !== 'object') {
    return { ...fallback };
  }

  const tw = Number(raw.thumbnailsWidth);
  const sw = Number(raw.sidebarWidth);

  const thumbnailsWidth =
    Number.isFinite(tw) && tw >= MIN_THUMBNAILS_WIDTH && tw <= MAX_THUMBNAILS_WIDTH
      ? Math.round(tw)
      : fallback.thumbnailsWidth ?? DEFAULT_THUMBNAILS_WIDTH;

  const sidebarWidth =
    Number.isFinite(sw) && sw >= MIN_SIDEBAR_WIDTH && sw <= MAX_SIDEBAR_WIDTH
      ? Math.round(sw)
      : fallback.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH;

  const panelLayout = raw.panelLayout === 'swapped' ? 'swapped' : 'default';
  const isThumbnailsCollapsed = Boolean(raw.isThumbnailsCollapsed);
  const isSidebarCollapsed = Boolean(raw.isSidebarCollapsed);

  let isThumbnailsVisible = raw.isThumbnailsVisible !== false;
  let isSidebarVisible = raw.isSidebarVisible !== false;

  // Guardrail: Prevent hiding all workspace navigation panels simultaneously.
  // At least one panel must remain visible.
  if (!isThumbnailsVisible && !isSidebarVisible) {
    isSidebarVisible = true;
  }

  return {
    id: raw.id || fallback.id || 'custom',
    name: raw.name || fallback.name || 'Custom',
    description: raw.description || '',
    isPreset: Boolean(raw.isPreset),
    thumbnailsWidth,
    sidebarWidth,
    panelLayout,
    isThumbnailsCollapsed,
    isSidebarCollapsed,
    isThumbnailsVisible,
    isSidebarVisible,
  };
}

/**
 * Loads the user's active layout preference.
 * Scoped by userId to prevent settings bleed across accounts.
 */
export function getActiveLayoutPreference(userId = 'guest') {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_LAYOUT };
  }

  const key = `${ACTIVE_LAYOUT_KEY_PREFIX}${userId || 'guest'}`;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      return sanitizeLayoutData(parsed, DEFAULT_LAYOUT);
    }

    // Check for legacy un-scoped layout key from Phase 21A
    const legacyRaw = window.localStorage.getItem(LEGACY_LAYOUT_STORAGE_KEY);
    if (legacyRaw) {
      const parsedLegacy = JSON.parse(legacyRaw);
      const sanitized = sanitizeLayoutData(parsedLegacy, DEFAULT_LAYOUT);
      // Migrate forward to user-scoped key
      saveActiveLayoutPreference(userId, sanitized);
      return sanitized;
    }
  } catch {
    // Return default on parse failure
  }

  return { ...DEFAULT_LAYOUT };
}

/**
 * Saves the active layout preference for the current user.
 */
export function saveActiveLayoutPreference(userId = 'guest', layoutData) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const key = `${ACTIVE_LAYOUT_KEY_PREFIX}${userId || 'guest'}`;
  try {
    const sanitized = sanitizeLayoutData(layoutData);
    window.localStorage.setItem(key, JSON.stringify(sanitized));
  } catch {
    // Ignore storage quota or disabled localStorage exceptions
  }
}

/**
 * Retrieves custom saved layouts for a user.
 * Tries Supabase user_workspace_layouts if available, falling back smoothly to localStorage.
 */
export async function fetchUserSavedLayouts(userId = 'guest') {
  const localKey = `${SAVED_LAYOUTS_KEY_PREFIX}${userId || 'guest'}`;
  let localList = [];

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(localKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          localList = parsed.map((item) => sanitizeLayoutData(item));
        }
      }
    } catch {
      localList = [];
    }
  }

  // If user is authenticated and Supabase is configured, attempt to fetch database layouts
  if (supabase && userId && userId !== 'guest') {
    try {
      const { data, error } = await supabase
        .from('user_workspace_layouts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data)) {
        const dbList = data.map((row) => ({
          id: row.id,
          name: row.name,
          isPreset: false,
          isDefault: row.is_default,
          ...sanitizeLayoutData(row.layout_data),
        }));

        // Sync to local cache for resilient offline navigation
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            window.localStorage.setItem(localKey, JSON.stringify(dbList));
          } catch {
            // Ignore
          }
        }
        return dbList;
      }
    } catch {
      // Table may not exist yet if migration 018 has not been executed; fall back to localList
    }
  }

  return localList;
}

/**
 * Saves a new custom workspace layout for a user.
 * Writes to Supabase if available, and guarantees local persistence.
 */
export async function saveUserLayout({ userId = 'guest', name, layoutData }) {
  const cleanName = String(name || '').trim().slice(0, 50);
  if (!cleanName) {
    throw new Error('Please enter a valid name for this layout.');
  }

  const cleanData = sanitizeLayoutData(layoutData);
  const layoutId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newLayout = {
    ...cleanData,
    id: layoutId,
    name: cleanName,
    isPreset: false,
  };

  const localKey = `${SAVED_LAYOUTS_KEY_PREFIX}${userId || 'guest'}`;
  let currentList = [];

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(localKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          currentList = parsed;
        }
      }
    } catch {
      currentList = [];
    }

    // Replace if name matches, or append
    const existingIndex = currentList.findIndex(
      (item) => item.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (existingIndex >= 0) {
      currentList[existingIndex] = { ...newLayout, id: currentList[existingIndex].id };
    } else {
      currentList.push(newLayout);
    }

    try {
      window.localStorage.setItem(localKey, JSON.stringify(currentList));
    } catch {
      // Ignore
    }
  }

  // Attempt database persistence
  if (supabase && userId && userId !== 'guest') {
    try {
      const { data, error } = await supabase
        .from('user_workspace_layouts')
        .upsert(
          {
            user_id: userId,
            name: cleanName,
            layout_data: cleanData,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id, name' }
        )
        .select()
        .single();

      if (!error && data) {
        newLayout.id = data.id;
      }
    } catch {
      // Safe fallback if migration 018 has not been run
    }
  }

  return newLayout;
}

/**
 * Deletes a custom saved layout for a user.
 */
export async function deleteUserLayout({ userId = 'guest', layoutId }) {
  if (!layoutId || layoutId.startsWith('preset-')) {
    throw new Error('Default presets cannot be deleted.');
  }

  const localKey = `${SAVED_LAYOUTS_KEY_PREFIX}${userId || 'guest'}`;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(localKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter((item) => item.id !== layoutId);
          window.localStorage.setItem(localKey, JSON.stringify(filtered));
        }
      }
    } catch {
      // Ignore
    }
  }

  // Attempt database deletion
  if (supabase && userId && userId !== 'guest') {
    try {
      await supabase
        .from('user_workspace_layouts')
        .delete()
        .eq('id', layoutId)
        .eq('user_id', userId);
    } catch {
      // Safe fallback
    }
  }

  return true;
}

