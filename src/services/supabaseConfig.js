/**
 * Placeholder configuration boundary for future Supabase integration
 * (Auth, PostgreSQL, Storage, and Realtime).
 *
 * No Supabase client is initialized during the initial frontend foundation phase.
 */

/**
 * Reads public client-side Supabase environment variables defined via Vite.
 * @returns {{ url: string, anonKey: string, isConfigured: boolean }}
 */
export function getSupabaseConfig() {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

  return {
    url,
    anonKey,
    isConfigured: Boolean(url && anonKey),
  };
}

