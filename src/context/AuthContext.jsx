import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  getCurrentSession,
  registerWithEmail,
  signInWithEmail,
  signOutUser,
  subscribeToAuthChanges,
} from '../services/authService.js';
import { fetchProfileById } from '../services/profileService.js';
import { clearSignedUrlCache } from '../services/imageUploadService.js';
import { isSupabaseConfigured } from '../services/supabaseClient.js';

const AuthContext = createContext(null);

/**
 * Provides persisted Supabase session state and the database-backed user profile
 * (including authoritative role from public.profiles).
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [authInitializing, setAuthInitializing] = useState(isSupabaseConfigured);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');

  const user = session?.user ?? null;
  const userId = user?.id ?? null;
  const prevUserIdRef = useRef(null);

  useEffect(() => {
    const prevUserId = prevUserIdRef.current;
    prevUserIdRef.current = userId;

    if (prevUserId && prevUserId !== userId) {
      clearSignedUrlCache();
    }
  }, [userId]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthInitializing(false);
      return undefined;
    }

    let isMounted = true;

    getCurrentSession()
      .then((initialSession) => {
        if (isMounted) {
          setSession(initialSession);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSession(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setAuthInitializing(false);
        }
      });

    const unsubscribe = subscribeToAuthChanges((event, nextSession) => {
      if (event === 'SIGNED_OUT' || (prevUserIdRef.current && !nextSession?.user?.id)) {
        clearSignedUrlCache();
      }
      if (isMounted) {
        setSession(nextSession ?? null);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const loadProfile = useCallback(async (targetUserId) => {
    if (!targetUserId) {
      setProfile(null);
      setProfileError('');
      setProfileLoading(false);
      return null;
    }

    setProfileLoading(true);
    setProfileError('');

    try {
      const nextProfile = await fetchProfileById(targetUserId);
      setProfile(nextProfile);
      return nextProfile;
    } catch (error) {
      setProfile(null);
      setProfileError(
        error?.message ||
          'Unable to load your user profile. Ensure the Phase 1 SQL migration has been applied.'
      );
      return null;
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !userId) {
      setProfile(null);
      setProfileError('');
      setProfileLoading(false);
      return;
    }

    let cancelled = false;

    setProfileLoading(true);
    setProfileError('');

    fetchProfileById(userId)
      .then((nextProfile) => {
        if (!cancelled) {
          setProfile(nextProfile);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setProfile(null);
          setProfileError(
            error?.message ||
              'Unable to load your user profile. Ensure the Phase 1 SQL migration has been applied.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProfileLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signIn = useCallback(async ({ email, password }) => {
    const data = await signInWithEmail({ email, password });
    setSession(data.session ?? null);
    return data;
  }, []);

  const register = useCallback(async ({ email, password, displayName }) => {
    const result = await registerWithEmail({ email, password, displayName });
    if (result.session) {
      setSession(result.session);
    }
    return result;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) return null;
    return loadProfile(userId);
  }, [loadProfile, userId]);

  const signOut = useCallback(async () => {
    await signOutUser();
    clearSignedUrlCache();
    setSession(null);
    setProfile(null);
    setProfileError('');
  }, []);

  const loading =
    authInitializing ||
    profileLoading ||
    (Boolean(userId) && !profile && !profileError);

  const value = useMemo(
    () => ({
      isConfigured: isSupabaseConfigured,
      session,
      user,
      profile,
      loading,
      profileError,
      signIn,
      register,
      refreshProfile,
      signOut,
    }),
    [session, user, profile, loading, profileError, signIn, register, refreshProfile, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return context;
}
