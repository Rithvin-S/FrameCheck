import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  THEMES,
  getStoredTheme,
  saveStoredTheme,
  applyThemeToDOM,
  resolveTheme,
  setupSystemThemeListener,
} from '../services/themeService.js';
import { useAuth } from './AuthContext.jsx';

const ThemeContext = createContext({
  theme: THEMES.SYSTEM,
  resolvedTheme: THEMES.LIGHT,
  isDark: false,
  setTheme: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }) {
  let authContext = null;
  try {
    authContext = useAuth();
  } catch {
    // AuthContext may be unavailable during isolated rendering
  }
  const currentUserId = authContext?.user?.id || 'guest';

  const [theme, setThemeState] = useState(() => getStoredTheme(currentUserId));
  const [resolvedTheme, setResolvedTheme] = useState(() => {
    const initialTheme = getStoredTheme(currentUserId);
    applyThemeToDOM(initialTheme);
    return resolveTheme(initialTheme);
  });

  // Apply theme when user ID changes
  useEffect(() => {
    const stored = getStoredTheme(currentUserId);
    setThemeState(stored);
    const resolved = applyThemeToDOM(stored);
    setResolvedTheme(resolved);
  }, [currentUserId]);

  // Set theme handler
  const setTheme = useCallback(
    (newTheme) => {
      if (!Object.values(THEMES).includes(newTheme)) return;
      setThemeState(newTheme);
      saveStoredTheme(currentUserId, newTheme);
      const resolved = applyThemeToDOM(newTheme);
      setResolvedTheme(resolved);
    },
    [currentUserId]
  );

  // Quick toggle between light and dark
  const toggleTheme = useCallback(() => {
    const next = resolvedTheme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
    setTheme(next);
  }, [resolvedTheme, setTheme]);

  // Listen to OS color scheme if theme is 'system'
  useEffect(() => {
    if (theme !== THEMES.SYSTEM) return;

    const cleanup = setupSystemThemeListener((newResolved) => {
      applyThemeToDOM(THEMES.SYSTEM);
      setResolvedTheme(newResolved);
    });

    return cleanup;
  }, [theme]);

  const value = {
    theme,
    resolvedTheme,
    isDark: resolvedTheme === THEMES.DARK,
    setTheme,
    toggleTheme,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

