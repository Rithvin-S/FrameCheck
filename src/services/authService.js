import { supabase } from './supabaseClient.js';

function getClientOrThrow() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.'
    );
  }
  return supabase;
}

/**
 * Retrieves the currently persisted Supabase auth session.
 */
export async function getCurrentSession() {
  const client = getClientOrThrow();
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session ?? null;
}

/**
 * Subscribes to Supabase auth state changes (sign in, sign out, token refresh).
 * @param {(event: string, session: import('@supabase/supabase-js').Session | null) => void} callback
 * @returns {() => void} Unsubscribe handler
 */
export function subscribeToAuthChanges(callback) {
  const client = getClientOrThrow();
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });

  return () => {
    subscription.unsubscribe();
  };
}

/**
 * Signs an existing user in with email and password.
 */
export async function signInWithEmail({ email, password }) {
  const client = getClientOrThrow();
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Registers a new user account with email, password, and display name.
 * Role assignment is enforced server-side in PostgreSQL (always 'uploader').
 */
export async function registerWithEmail({ email, password, displayName }) {
  const client = getClientOrThrow();
  const trimmedName = displayName.trim();

  const { data, error } = await client.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        display_name: trimmedName,
      },
    },
  });

  if (error) {
    throw error;
  }

  // Supabase returns an empty identities array when email confirmation is enabled
  // and the email already belongs to a registered user.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error('An account with this email address already exists. Please sign in instead.');
  }

  return {
    user: data.user ?? null,
    session: data.session ?? null,
    requiresEmailConfirmation: Boolean(data.user && !data.session),
  };
}

/**
 * Signs out the current user and clears the Supabase session.
 */
export async function signOutUser() {
  const client = getClientOrThrow();
  const { error } = await client.auth.signOut();
  if (error) {
    throw error;
  }
}

