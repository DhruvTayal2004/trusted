/** Public (shippable) configuration. Secrets never live here — see supabase/functions. */
export const ENV = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
};

export const isSupabaseConfigured = ENV.supabaseUrl.startsWith('http') && ENV.supabaseAnonKey.length > 20;

export function functionsUrl(name: string): string {
  return `${ENV.supabaseUrl.replace(/\/$/, '')}/functions/v1/${name}`;
}
