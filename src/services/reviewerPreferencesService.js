import { supabase } from './supabaseClient.js';
import { DEFAULT_ANNOTATION_COLOR } from './annotationState.js';

export const DEFAULT_REVIEWER_PREFERENCES = Object.freeze({
  defaultColor: DEFAULT_ANNOTATION_COLOR || '#dc2626',
  zoomPreference: 'fit', // 'fit' | 'actual' | 'remember'
  toolbarPosition: 'top', // 'top' | 'bottom'
  defaultTool: 'circle', // 'circle' | 'select' | 'arrow' | 'rectangle' | 'freehand' | 'callout' | 'marker'
  toolbarDensity: 'comfortable', // 'comfortable' | 'compact'
  showLiveCursors: true,
  autoSelectNewAnnotation: true,
  defaultPriority: 'medium', // 'low' | 'medium' | 'high' | 'urgent'
  defaultStrokeWidth: 3,
  theme: 'system', // 'light' | 'dark' | 'system'
  onboardingCompleted: false,
});

export const THEME_PREFERENCE_OPTIONS = [
  { id: 'light', label: 'Light Theme', description: 'Clean white surfaces with high contrast text.' },
  { id: 'dark', label: 'Dark Theme', description: 'Dark palette reduced eye strain in low-light environments.' },
  { id: 'system', label: 'System Default', description: 'Automatically matches your operating system appearance.' },
];

export const ZOOM_PREFERENCE_OPTIONS = [
  {
    id: 'fit',
    label: 'Auto-Fit to Screen',
    description: 'Automatically sizes images to fit comfortably within the workspace canvas on load.',
  },
  {
    id: 'actual',
    label: '1:1 Actual Size',
    description: 'Displays images at 100% native resolution for fine pixel inspection.',
  },
  {
    id: 'remember',
    label: 'Remember Last Zoom',
    description: 'Maintains your current manual zoom magnification across batch images.',
  },
];

export const TOOLBAR_POSITION_OPTIONS = [
  { id: 'top', label: 'Top (Docked)', description: 'Traditional bar docked above the canvas.' },
  { id: 'bottom', label: 'Bottom (Floating)', description: 'Floating bar docked along the bottom.' },
];

export const TOOLBAR_DENSITY_OPTIONS = [
  { id: 'comfortable', label: 'Comfortable', description: 'Standard button padding and spacing.' },
  { id: 'compact', label: 'Compact', description: 'Condensed spacing for smaller screens.' },
];

const PREFERENCES_STORAGE_KEY_PREFIX = 'fc_reviewer_preferences_';

/**
 * Validates and clamps reviewer preferences, ensuring safe fallbacks.
 */
export function sanitizeReviewerPreferences(raw = {}, fallback = DEFAULT_REVIEWER_PREFERENCES) {
  if (!raw || typeof raw !== 'object') {
    return { ...fallback };
  }

  // Validate hex color
  let defaultColor = fallback.defaultColor;
  if (typeof raw.defaultColor === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw.defaultColor)) {
    defaultColor = raw.defaultColor;
  }

  // Validate zoom preference
  const validZoom = ['fit', 'actual', 'remember'];
  const zoomPreference = validZoom.includes(raw.zoomPreference)
    ? raw.zoomPreference
    : fallback.zoomPreference;

  // Validate toolbar position
  const validPos = ['top', 'bottom'];
  const toolbarPosition = validPos.includes(raw.toolbarPosition)
    ? raw.toolbarPosition
    : fallback.toolbarPosition;

  // Validate default tool
  const validTools = [
    'select',
    'circle',
    'arrow',
    'line',
    'rectangle',
    'polygon',
    'cloud',
    'freehand',
    'highlighter',
    'callout',
    'textbox',
    'blur',
    'marker',
  ];
  const defaultTool = validTools.includes(raw.defaultTool)
    ? raw.defaultTool
    : fallback.defaultTool;

  // Validate toolbar density
  const validDensity = ['comfortable', 'compact'];
  const toolbarDensity = validDensity.includes(raw.toolbarDensity)
    ? raw.toolbarDensity
    : fallback.toolbarDensity;

  // Validate priority
  const validPriorities = ['low', 'medium', 'high', 'urgent'];
  const defaultPriority = validPriorities.includes(raw.defaultPriority)
    ? raw.defaultPriority
    : fallback.defaultPriority;

  // Validate stroke width
  const sw = Number(raw.defaultStrokeWidth);
  const defaultStrokeWidth = Number.isFinite(sw) && sw >= 1 && sw <= 16
    ? Math.round(sw)
    : fallback.defaultStrokeWidth;

  const showLiveCursors = raw.showLiveCursors !== false;
  const autoSelectNewAnnotation = raw.autoSelectNewAnnotation !== false;

  const validThemes = ['light', 'dark', 'system'];
  const theme = validThemes.includes(raw.theme)
    ? raw.theme
    : fallback.theme || 'system';

  const onboardingCompleted = raw.onboardingCompleted === true;

  return {
    defaultColor,
    zoomPreference,
    toolbarPosition,
    defaultTool,
    toolbarDensity,
    showLiveCursors,
    autoSelectNewAnnotation,
    defaultPriority,
    defaultStrokeWidth,
    theme,
    onboardingCompleted,
  };
}

/**
 * Loads a reviewer's workspace preferences.
 * Reads user-isolated localStorage first, then syncs with Supabase if available.
 */
export async function fetchReviewerPreferences(userId = 'guest') {
  const localKey = `${PREFERENCES_STORAGE_KEY_PREFIX}${userId || 'guest'}`;
  let localPrefs = DEFAULT_REVIEWER_PREFERENCES;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(localKey);
      if (raw) {
        localPrefs = sanitizeReviewerPreferences(JSON.parse(raw));
      }
    } catch {
      localPrefs = DEFAULT_REVIEWER_PREFERENCES;
    }
  }

  // Attempt database retrieval if authenticated and Supabase configured
  if (supabase && userId && userId !== 'guest') {
    try {
      const { data, error } = await supabase
        .from('user_workspace_preferences')
        .select('preferences')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data?.preferences) {
        const synced = sanitizeReviewerPreferences(data.preferences, localPrefs);
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            window.localStorage.setItem(localKey, JSON.stringify(synced));
          } catch {
            // Ignore quota issues
          }
        }
        return synced;
      }
    } catch {
      // Table may not exist if migration 019 has not been executed; localPrefs remains authoritative
    }
  }

  return localPrefs;
}

/**
 * Synchronously retrieves cached reviewer preferences from user-scoped localStorage.
 * Used for instant, zero-flicker workspace initialization.
 */
export function getCachedReviewerPreferences(userId = 'guest') {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_REVIEWER_PREFERENCES };
  }

  const localKey = `${PREFERENCES_STORAGE_KEY_PREFIX}${userId || 'guest'}`;
  try {
    const raw = window.localStorage.getItem(localKey);
    if (raw) {
      return sanitizeReviewerPreferences(JSON.parse(raw));
    }
  } catch {
    // Ignore
  }

  return { ...DEFAULT_REVIEWER_PREFERENCES };
}

/**
 * Saves reviewer preferences for the current authenticated user.
 * Writes to user-scoped localStorage and attempts database sync.
 */
export async function saveReviewerPreferences(userId = 'guest', nextPreferences) {
  const sanitized = sanitizeReviewerPreferences(nextPreferences);
  const localKey = `${PREFERENCES_STORAGE_KEY_PREFIX}${userId || 'guest'}`;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(localKey, JSON.stringify(sanitized));
    } catch {
      // Ignore
    }
  }

  // Attempt database persistence
  if (supabase && userId && userId !== 'guest') {
    try {
      await supabase
        .from('user_workspace_preferences')
        .upsert(
          {
            user_id: userId,
            preferences: sanitized,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
    } catch {
      // Safe fallback if migration 019 has not been executed
    }
  }

  return sanitized;
}
