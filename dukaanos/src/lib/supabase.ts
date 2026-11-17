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

export { isPermanentRpcError, rpcErrorMessage } from '@/core/sync/errors';
