/**
 * FrameCheck - Keyboard Shortcuts Service (Phase 22C)
 * Manages default and custom keyboard shortcuts, conflict detection,
 * browser key combination normalization, and per-user persistence.
 */

export const DEFAULT_SHORTCUTS = Object.freeze({
  // Tool Shortcuts
  tool_select: { key: 'v', label: 'Select / Move Tool', category: 'tools', description: 'Switch to selection and manipulation tool' },
  tool_circle: { key: 'c', label: 'Circle Tool', category: 'tools', description: 'Draw circle annotations' },
  tool_arrow: { key: 'a', label: 'Arrow Tool', category: 'tools', description: 'Draw directional arrow annotations' },
  tool_line: { key: 'l', label: 'Straight Line Tool', category: 'tools', description: 'Draw straight line annotations' },
  tool_rectangle: { key: 'r', label: 'Rectangle Tool', category: 'tools', description: 'Draw bounding box annotations' },
  tool_polygon: { key: 'g', label: 'Polygon Tool', category: 'tools', description: 'Draw multi-point polygon annotations' },
  tool_cloud: { key: 'u', label: 'Cloud Tool', category: 'tools', description: 'Draw revision cloud annotations' },
  tool_pencil: { key: 'p', label: 'Pencil Tool', category: 'tools', description: 'Draw freehand sketch annotations' },
  tool_highlighter: { key: 'i', label: 'Highlighter Tool', category: 'tools', description: 'Draw semi-transparent highlighter strokes' },
  tool_callout: { key: 't', label: 'Callout Box Tool', category: 'tools', description: 'Create text callout boxes with leader lines' },
  tool_textbox: { key: 'x', label: 'Text Box Tool', category: 'tools', description: 'Insert plain text annotations' },
  tool_blur: { key: 'b', label: 'Blur / Redaction Tool', category: 'tools', description: 'Redact sensitive content with blur boxes' },
  tool_marker: { key: 'm', label: 'Marker / Stamp Tool', category: 'tools', description: 'Stamp icons and status badges' },
  tool_pan: { key: 'h', label: 'Pan / Hand Tool', category: 'tools', description: 'Pan around zoomed images' },
  tool_magnifier: { key: 'z', label: 'Toggle Magnifier', category: 'tools', description: 'Toggle pixel-level zoom loupe lens' },

  // Navigation Shortcuts
  nav_prev_image: { key: 'PageUp', label: 'Previous Image', category: 'navigation', description: 'Navigate to previous image in batch' },
  nav_next_image: { key: 'PageDown', label: 'Next Image', category: 'navigation', description: 'Navigate to next image in batch' },
  nav_next_incomplete: { key: 'Shift+N', label: 'Next Incomplete Image', category: 'navigation', description: 'Jump to next unreviewed image' },

  // Canvas & View Shortcuts
  view_rotate_ccw: { key: '[', label: 'Rotate CCW (90°)', category: 'view', description: 'Rotate image counter-clockwise' },
  view_rotate_cw: { key: ']', label: 'Rotate CW (90°)', category: 'view', description: 'Rotate image clockwise' },
  view_focus_mode: { key: 'f', label: 'Toggle Focus Mode', category: 'view', description: 'Enter/exit distraction-free full workspace' },
  view_fit: { key: '0', label: 'Fit to Screen', category: 'view', description: 'Scale canvas to fit within viewport' },
  view_actual_size: { key: '1', label: 'Actual Size (100%)', category: 'view', description: 'Reset zoom to 100% 1:1 scale' },
  view_toggle_thumbnails: { key: 'Alt+1', label: 'Toggle Thumbnails Panel', category: 'view', description: 'Show or hide image thumbnails rail' },
  view_toggle_sidebar: { key: 'Alt+2', label: 'Toggle Review Sidebar', category: 'view', description: 'Show or hide review sidebar' },

  // History & Editing Shortcuts
  action_undo: { key: 'Ctrl+Z', label: 'Undo', category: 'actions', description: 'Revert last annotation edit or drawing' },
  action_redo: { key: 'Ctrl+Y', label: 'Redo', category: 'actions', description: 'Redo previously reverted annotation edit' },
  action_delete: { key: 'Delete', label: 'Delete Selected', category: 'actions', description: 'Delete currently selected annotation(s)' },
});

export const SHORTCUT_CATEGORIES = [
  { id: 'tools', label: 'Annotation Tools' },
  { id: 'navigation', label: 'Image Navigation' },
  { id: 'view', label: 'Canvas & View' },
  { id: 'actions', label: 'Editing & History' },
];

/**
 * System and browser reserved key combinations that FrameCheck must never hijack.
 */
export const RESERVED_SHORTCUTS = new Set([
  'Ctrl+R',
  'Ctrl+Shift+R',
  'F5',
  'Ctrl+W',
  'Ctrl+Shift+W',
  'Ctrl+T',
  'Ctrl+Shift+T',
  'Ctrl+N',
  'Ctrl+Shift+N',
  'Ctrl+P',
  'Ctrl+S',
  'Ctrl+F',
  'Ctrl+Q',
  'F11',
  'F12',
  'Alt+F4',
]);

const SHORTCUTS_STORAGE_KEY_PREFIX = 'fc_reviewer_shortcuts_';

/**
 * Normalizes a shortcut string into standard modifier order: Ctrl+Alt+Shift+<Key>.
 */
export function normalizeShortcut(shortcutStr) {
  if (!shortcutStr || typeof shortcutStr !== 'string') return '';
  const parts = shortcutStr.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return '';

  let hasCtrl = false;
  let hasAlt = false;
  let hasShift = false;
  let mainKey = '';

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control' || lower === 'meta' || lower === 'cmd') {
      hasCtrl = true;
    } else if (lower === 'alt' || lower === 'option') {
      hasAlt = true;
    } else if (lower === 'shift') {
      hasShift = true;
    } else {
      mainKey = part;
    }
  }

  if (!mainKey && (hasCtrl || hasAlt || hasShift)) {
    return '';
  }

  const prefix = [];
  if (hasCtrl) prefix.push('Ctrl');
  if (hasAlt) prefix.push('Alt');
  if (hasShift) prefix.push('Shift');

  // Format main key
  let formattedKey = mainKey;
  if (mainKey.length === 1) {
    formattedKey = (hasCtrl || hasAlt || hasShift) ? mainKey.toUpperCase() : mainKey.toLowerCase();
  } else {
    // Standardize well-known multi-character keys
    const lowerKey = mainKey.toLowerCase();
    if (lowerKey === 'pageup') formattedKey = 'PageUp';
    else if (lowerKey === 'pagedown') formattedKey = 'PageDown';
    else if (lowerKey === 'delete' || lowerKey === 'del') formattedKey = 'Delete';
    else if (lowerKey === 'backspace') formattedKey = 'Backspace';
    else if (lowerKey === 'escape' || lowerKey === 'esc') formattedKey = 'Escape';
    else if (lowerKey === 'enter') formattedKey = 'Enter';
    else if (lowerKey === 'tab') formattedKey = 'Tab';
    else if (lowerKey === 'space' || lowerKey === 'spacebar') formattedKey = 'Space';
  }

  prefix.push(formattedKey);
  return prefix.join('+');
}

/**
 * Converts a KeyboardEvent into a normalized FrameCheck shortcut string.
 * Returns null if the event represents only a modifier key press.
 */
export function keyboardEventToShortcut(event) {
  if (!event || typeof event !== 'object') return null;

  const key = event.key;
  if (!key) return null;

  // Ignore bare modifier keydown
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    return null;
  }

  const hasCtrl = Boolean(event.ctrlKey || event.metaKey);
  const hasAlt = Boolean(event.altKey);
  const hasShift = Boolean(event.shiftKey);

  const prefix = [];
  if (hasCtrl) prefix.push('Ctrl');
  if (hasAlt) prefix.push('Alt');
  if (hasShift) prefix.push('Shift');

  let mainKey = key;
  if (key === 'Delete' || event.code === 'Delete') {
    mainKey = 'Delete';
  } else if (key === 'PageUp' || event.code === 'PageUp') {
    mainKey = 'PageUp';
  } else if (key === 'PageDown' || event.code === 'PageDown') {
    mainKey = 'PageDown';
  } else if (key === 'Escape' || event.code === 'Escape') {
    mainKey = 'Escape';
  } else if (key === 'Backspace' || event.code === 'Backspace') {
    mainKey = 'Backspace';
  } else if (key === ' ' || event.code === 'Space') {
    mainKey = 'Space';
  } else if (key.length === 1) {
    mainKey = (hasCtrl || hasAlt || hasShift) ? key.toUpperCase() : key.toLowerCase();
  }

  prefix.push(mainKey);
  return prefix.join('+');
}

/**
 * Determines whether a KeyboardEvent matches a given shortcut string.
 */
export function matchesShortcut(event, targetShortcut) {
  if (!event || !targetShortcut) return false;
  const current = keyboardEventToShortcut(event);
  if (!current) return false;
  return normalizeShortcut(current) === normalizeShortcut(targetShortcut);
}

/**
 * Checks whether a candidate shortcut conflicts with reserved combinations or other configured shortcuts.
 * Returns null if valid, or an object describing the conflict.
 */
export function findShortcutConflict(actionId, candidateShortcut, activeShortcuts) {
  const normalizedCandidate = normalizeShortcut(candidateShortcut);
  if (!normalizedCandidate) {
    return { type: 'invalid', message: 'Shortcut cannot be empty or solely modifier keys.' };
  }

  // 1. Reserved browser/system shortcuts check
  if (RESERVED_SHORTCUTS.has(normalizedCandidate)) {
    return {
      type: 'reserved',
      message: `"${normalizedCandidate}" is reserved by the browser or operating system.`,
    };
  }

  // 2. Conflict with other FrameCheck shortcuts
  for (const [otherActionId, mapping] of Object.entries(activeShortcuts)) {
    if (otherActionId === actionId) continue;
    const existingKey = typeof mapping === 'string' ? mapping : mapping?.key;
    if (existingKey && normalizeShortcut(existingKey) === normalizedCandidate) {
      const def = DEFAULT_SHORTCUTS[otherActionId];
      return {
        type: 'duplicate',
        conflictingActionId: otherActionId,
        label: def?.label || otherActionId,
        message: `Already assigned to "${def?.label || otherActionId}".`,
      };
    }
  }

  return null;
}

/**
 * Retrieves the active shortcut map for a user (merged with defaults).
 */
export function getStoredShortcuts(userId = 'guest') {
  const result = {};
  for (const [actionId, def] of Object.entries(DEFAULT_SHORTCUTS)) {
    result[actionId] = def.key;
  }

  if (typeof window === 'undefined' || !window.localStorage) {
    return result;
  }

  try {
    const key = `${SHORTCUTS_STORAGE_KEY_PREFIX}${userId || 'guest'}`;
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [actionId, customKey] of Object.entries(parsed)) {
          if (DEFAULT_SHORTCUTS[actionId] && typeof customKey === 'string' && customKey.trim()) {
            result[actionId] = customKey.trim();
          }
        }
      }
    }
  } catch (err) {
    console.warn('[keyboardShortcutsService] Failed to load stored shortcuts:', err);
  }

  return result;
}

/**
 * Persists customized shortcuts for a given user.
 */
export function saveStoredShortcuts(userId = 'guest', shortcutsMap = {}) {
  if (typeof window === 'undefined' || !window.localStorage) return false;

  try {
    const key = `${SHORTCUTS_STORAGE_KEY_PREFIX}${userId || 'guest'}`;
    const sanitized = {};
    for (const [actionId, shortcutKey] of Object.entries(shortcutsMap)) {
      if (DEFAULT_SHORTCUTS[actionId] && typeof shortcutKey === 'string') {
        sanitized[actionId] = shortcutKey.trim();
      }
    }
    window.localStorage.setItem(key, JSON.stringify(sanitized));
    return true;
  } catch (err) {
    console.error('[keyboardShortcutsService] Failed to persist shortcuts:', err);
    return false;
  }
}

/**
 * Resets a user's customized shortcuts back to factory defaults.
 */
export function resetStoredShortcuts(userId = 'guest') {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const key = `${SHORTCUTS_STORAGE_KEY_PREFIX}${userId || 'guest'}`;
      window.localStorage.removeItem(key);
    } catch {
      // Ignore
    }
  }

  const defaults = {};
  for (const [actionId, def] of Object.entries(DEFAULT_SHORTCUTS)) {
    defaults[actionId] = def.key;
  }
  return defaults;
}

