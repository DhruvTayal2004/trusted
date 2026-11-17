/** Public (shippable) configuration. Secrets never live here — see supabase/functions. */
export const ENV = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  /** Optional: point edge-function calls elsewhere (local `deno run` during development). */
  functionsUrl: process.env.EXPO_PUBLIC_FUNCTIONS_URL ?? '',
};

export const isSupabaseConfigured = ENV.supabaseUrl.startsWith('http') && ENV.supabaseAnonKey.length > 20;

export function functionsUrl(name: string): string {
  if (ENV.functionsUrl) return `${ENV.functionsUrl.replace(/\/$/, '')}/${name}`;
  return `${ENV.supabaseUrl.replace(/\/$/, '')}/functions/v1/${name}`;
}
