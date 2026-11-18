/**
 * FrameCheck - Theme Service (Phase 22D)
 * Manages light, dark, and system themes, OS preference detection,
 * DOM attribute application, and per-user local persistence.
 */

export const THEMES = Object.freeze({
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
});

const THEME_STORAGE_KEY_PREFIX = 'fc_theme_preference_';
const GLOBAL_THEME_STORAGE_KEY = 'fc_theme_preference';

/**
 * Resolves whether the current active theme should render dark or light.
 * If 'system', evaluates the OS window.matchMedia query.
 */
export function resolveTheme(theme = THEMES.SYSTEM) {
  if (theme === THEMES.DARK) return THEMES.DARK;
  if (theme === THEMES.LIGHT) return THEMES.LIGHT;

  if (typeof window !== 'undefined' && window.matchMedia) {
    try {
      const isOsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      return isOsDark ? THEMES.DARK : THEMES.LIGHT;
    } catch {
      return THEMES.LIGHT;
    }
  }

  return THEMES.LIGHT;
}

/**
 * Retrieves the stored theme preference for a user.
 */
export function getStoredTheme(userId = 'guest') {
  if (typeof window === 'undefined' || !window.localStorage) {
    return THEMES.SYSTEM;
  }

  try {
    const userKey = `${THEME_STORAGE_KEY_PREFIX}${userId || 'guest'}`;
    const userStored = window.localStorage.getItem(userKey);
    if (userStored && Object.values(THEMES).includes(userStored)) {
      return userStored;
    }

    const globalStored = window.localStorage.getItem(GLOBAL_THEME_STORAGE_KEY);
    if (globalStored && Object.values(THEMES).includes(globalStored)) {
      return globalStored;
    }
  } catch (err) {
    console.warn('[themeService] Failed reading stored theme:', err);
  }

  return THEMES.SYSTEM;
}

/**
 * Persists a user's theme preference.
 */
export function saveStoredTheme(userId = 'guest', theme = THEMES.SYSTEM) {
  if (typeof window === 'undefined' || !window.localStorage) return false;

  try {
    const userKey = `${THEME_STORAGE_KEY_PREFIX}${userId || 'guest'}`;
    window.localStorage.setItem(userKey, theme);
    window.localStorage.setItem(GLOBAL_THEME_STORAGE_KEY, theme);
    return true;
  } catch (err) {
    console.error('[themeService] Failed saving theme:', err);
    return false;
  }
}

/**
 * Applies the given theme to the HTML document.
 * Sets data-theme attribute, toggles dark-theme CSS classes, and configures color-scheme.
 */
export function applyThemeToDOM(theme = THEMES.SYSTEM) {
  if (typeof document === 'undefined') return THEMES.LIGHT;

  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  const body = document.body;

  if (resolved === THEMES.DARK) {
    root.setAttribute('data-theme', 'dark');
    root.classList.add('dark-theme');
    root.style.colorScheme = 'dark';
    if (body) {
      body.classList.add('dark-theme');
      body.setAttribute('data-theme', 'dark');
    }
  } else {
    root.setAttribute('data-theme', 'light');
    root.classList.remove('dark-theme');
    root.style.colorScheme = 'light';
    if (body) {
      body.classList.remove('dark-theme');
      body.setAttribute('data-theme', 'light');
    }
  }

  return resolved;
}

/**
 * Subscribes to OS color scheme changes when theme is set to 'system'.
 */
export function setupSystemThemeListener(onSystemChange) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};

  try {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      onSystemChange(e.matches ? THEMES.DARK : THEMES.LIGHT);
    };

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(handler);
      return () => mql.removeListener(handler);
    }
  } catch (err) {
    console.warn('[themeService] Could not attach OS theme listener:', err);
  }

  return () => {};
}

