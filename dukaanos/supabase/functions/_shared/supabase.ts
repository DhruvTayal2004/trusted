import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function env(name: string, fallback = ''): string {
  return Deno.env.get(name) ?? fallback;
}

/** Service-role client: bypasses RLS. Use only for explicitly privileged operations. */
export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Client that acts AS the calling user (RLS applies). Requires the request's Authorization header. */
export function userClient(req: Request): SupabaseClient {
  const auth = req.headers.get('Authorization') ?? '';
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

export async function requireMember(req: Request): Promise<{ client: SupabaseClient; member: { id: string; shop_id: string; role: string; display_name: string; permissions: Record<string, unknown> } }> {
  const client = userClient(req);
  const { data: userData, error } = await client.auth.getUser();
  if (error || !userData.user) throw new HttpError(401, 'Not authenticated');
  const { data: member } = await client.from('shop_members').select('id, shop_id, role, display_name, permissions').eq('user_id', userData.user.id).eq('is_active', true).maybeSingle();
  if (!member) throw new HttpError(403, 'Not a shop member');
  return { client, member };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: (e as Error).message ?? 'Internal error' }, 500);
    }
  };
}
