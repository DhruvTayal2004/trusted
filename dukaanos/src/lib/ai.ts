import { functionsUrl } from './env';
import { supabase } from './supabase';

/** Call an edge function as the signed-in user. Throws with the server's message on error. */
export async function callFunction<T>(name: string, body: Record<string, unknown> | FormData, opts: { timeoutMs?: number } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);
  try {
    const res = await fetch(functionsUrl(name), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) },
      body: body instanceof FormData ? body : JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(json.error ?? `Server error ${res.status}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}
