import { supabase } from './supabaseClient.js';

export const ROLES = {
  UPLOADER: 'uploader',
  REVIEWER: 'reviewer',
  ADMIN: 'admin',
};

export const ROLE_OPTIONS = [ROLES.UPLOADER, ROLES.REVIEWER, ROLES.ADMIN];

export const ROLE_LABELS = {
  [ROLES.UPLOADER]: 'Uploader',
  [ROLES.REVIEWER]: 'Reviewer',
  [ROLES.ADMIN]: 'Admin',
};

export function formatRoleLabel(role) {
  return ROLE_LABELS[role] ?? 'Unknown';
}

function getClientOrThrow() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.'
    );
  }
  return supabase;
}

/**
 * Fetches the authenticated user's profile record from public.profiles.
 * @param {string} userId
 */
export async function fetchProfileById(userId) {
  const client = getClientOrThrow();
  const { data, error } = await client
    .from('profiles')
    .select('id, display_name, role, created_at, updated_at')
    .eq('id', userId)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Fetches all registered users with email addresses for Admin management.
 * Authorization is enforced inside the PostgreSQL RPC.
 */
export async function fetchAllUsersForAdmin() {
  const client = getClientOrThrow();
  const { data, error } = await client.rpc('admin_list_users');

  if (error) {
    throw error;
  }

  return data ?? [];
}

/**
 * Updates another user's role via the secure PostgreSQL Admin RPC.
 * Self-modification and removing the last Admin are rejected server-side.
 */
export async function updateUserRoleAsAdmin({ targetUserId, newRole }) {
  const client = getClientOrThrow();
  const { data, error } = await client.rpc('admin_update_user_role', {
    target_user_id: targetUserId,
    new_role: newRole,
  });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data[0] ?? null : data;
}

