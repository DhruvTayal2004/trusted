/**
 * Employee PIN login.
 *
 *  GET  ?shop_code=ABC123          → { shop_name, members: [{id, display_name}] }   (public)
 *  POST { shop_code, member_id, pin } → { access_token, refresh_token }            (public)
 *
 * Why: employees should not need email accounts, but RLS needs a real auth user per employee so the
 * server knows who recorded each transaction. On first successful PIN login we create a hidden auth user
 * for the member (email emp-<id>@employees.dukaanos.local) with a strong password derived from a server
 * pepper; later logins verify the PIN (bcrypt in Postgres, 5-attempt lockout) and sign in with that password.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminClient, env, handle, HttpError, json } from '../_shared/supabase.ts';

async function derivedPassword(memberId: string): Promise<string> {
  const pepper = env('EMPLOYEE_AUTH_PEPPER');
  if (!pepper || pepper.length < 16) throw new HttpError(500, 'EMPLOYEE_AUTH_PEPPER is not configured on the server');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`dukaanos-employee:${memberId}`));
  return 'E!' + Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(handle(async (req) => {
  const admin = adminClient();

  if (req.method === 'GET') {
    const code = new URL(req.url).searchParams.get('shop_code') ?? '';
    if (code.trim().length < 4) throw new HttpError(400, 'shop_code required');
    const { data, error } = await admin.rpc('lookup_shop_by_code', { p_code: code });
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, 'Shop not found. Check the code with the owner.');
    return json({ shop_name: data.shop_name, members: data.members });
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const body = (await req.json()) as { shop_code?: string; member_id?: string; pin?: string };
  if (!body.shop_code || !body.member_id || !body.pin) throw new HttpError(400, 'shop_code, member_id and pin are required');

  const { data: shop, error: lookupErr } = await admin.rpc('lookup_shop_by_code', { p_code: body.shop_code });
  if (lookupErr) throw new HttpError(500, lookupErr.message);
  if (!shop) throw new HttpError(404, 'Shop not found');

  const { data: member, error: pinErr } = await admin.rpc('verify_member_pin', { p_shop_id: shop.shop_id, p_member_id: body.member_id, p_pin: body.pin });
  if (pinErr) throw new HttpError(401, pinErr.message.replace(/^.*?:\s*/, ''));

  const email = `emp-${member.id}@employees.dukaanos.local`;
  const password = await derivedPassword(member.id);

  if (!member.user_id) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { member_id: member.id, shop_id: member.shop_id, kind: 'employee' } });
    if (createErr) throw new HttpError(500, 'Could not create employee login: ' + createErr.message);
    const { error: linkErr } = await admin.from('shop_members').update({ user_id: created.user.id }).eq('id', member.id);
    if (linkErr) throw new HttpError(500, linkErr.message);
  } else {
    // Keep the derived password in sync in case the pepper was rotated.
    await admin.auth.admin.updateUserById(member.user_id, { password });
  }

  const anon = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({ email, password });
  if (signErr || !session.session) throw new HttpError(500, 'Sign-in failed: ' + (signErr?.message ?? 'no session'));
  return json({ access_token: session.session.access_token, refresh_token: session.session.refresh_token, member: { id: member.id, display_name: member.display_name, role: member.role } });
}));
