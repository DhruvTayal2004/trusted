import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { ENV, isSupabaseConfigured } from './env';

/**
 * Single Supabase client. The anon key is public by design; every table is protected by RLS and
 * every financial write goes through a security-definer RPC that re-checks the caller.
 */
export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? ENV.supabaseUrl : 'https://not-configured.invalid',
  isSupabaseConfigured ? ENV.supabaseAnonKey : 'not-configured',
  {
    auth: {
      storage: Platform.OS === 'web' ? undefined : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

// Refresh tokens only while the app is in the foreground (recommended pattern for RN).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Normalise Postgres/PostgREST errors to a short message the UI can show. */
export function rpcErrorMessage(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const e = err as { message?: string; details?: string; hint?: string; code?: string };
  return e.message || e.details || e.hint || e.code || 'Unknown error';
}

/** Permanent (do-not-retry) failures: validation and permission errors raised by RPCs/RLS. */
export function isPermanentRpcError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const code = e?.code ?? '';
  if (['42501', 'P0001', 'P0002', '23514', '23503', '22P02', '23505', '42883', '42P01'].includes(code)) return true;
  const msg = (e?.message ?? '').toLowerCase();
  return msg.includes('row-level security') || msg.includes('not permitted') || msg.includes('permission');
}
