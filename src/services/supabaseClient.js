import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './supabaseConfig.js';

const { url, anonKey, isConfigured } = getSupabaseConfig();

/**
 * Singleton Supabase client initialized from Vite publishable environment variables.
 * Never use or expose the Supabase service-role key in frontend code.
 */
export const supabase = isConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const isSupabaseConfigured = isConfigured;

