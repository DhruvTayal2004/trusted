import type { Session } from '@supabase/supabase-js';
import { ALL_PERMISSIONS, DEFAULT_EMPLOYEE_PERMISSIONS, type MemberPermissions, type Role } from '@/core/permissions';
import { kvGet, kvSet, resetLocalDb } from '@/lib/db';
import { functionsUrl, isSupabaseConfigured } from '@/lib/env';
import { createStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export interface Member {
  id: string;
  shop_id: string;
  user_id: string | null;
  role: Role;
  display_name: string;
  permissions: MemberPermissions;
  is_active: boolean;
}

export interface Shop {
  id: string;
  name: string;
  phone: string | null;
  timezone: string;
  settings: Record<string, unknown>;
}

export type SessionStatus = 'loading' | 'not_configured' | 'signed_out' | 'no_shop' | 'ready';

interface SessionState {
  status: SessionStatus;
  session: Session | null;
  member: Member | null;
  shop: Shop | null;
  error: string | null;
}

export const sessionStore = createStore<SessionState>({ status: 'loading', session: null, member: null, shop: null, error: null });

function normaliseMember(row: Record<string, unknown>): Member {
  const role = row.role as Role;
  const base = role === 'employee' ? DEFAULT_EMPLOYEE_PERMISSIONS : ALL_PERMISSIONS;
  return {
    id: String(row.id),
    shop_id: String(row.shop_id),
    user_id: (row.user_id as string | null) ?? null,
    role,
    display_name: String(row.display_name),
    permissions: { ...base, ...((row.permissions as Partial<MemberPermissions>) ?? {}) },
    is_active: Boolean(row.is_active),
  };
}

/** Load the member + shop for the signed-in user. Falls back to the cached copy when offline. */
async function loadMembership(session: Session): Promise<void> {
  try {
    const { data: m, error } = await supabase.from('shop_members').select('*').eq('user_id', session.user.id).eq('is_active', true).maybeSingle();
    if (error) throw error;
    if (!m) {
      sessionStore.set({ status: 'no_shop', session, member: null, shop: null, error: null });
      return;
    }
    const { data: s, error: e2 } = await supabase.from('shops').select('id,name,phone,timezone,settings').eq('id', m.shop_id).single();
    if (e2) throw e2;
    const member = normaliseMember(m);
    const shop = s as Shop;
    await kvSet('cached_member', JSON.stringify(member));
    await kvSet('cached_shop', JSON.stringify(shop));
    sessionStore.set({ status: 'ready', session, member, shop, error: null });
  } catch (err) {
    // Offline: use cache if it belongs to this user
    const cm = await kvGet('cached_member');
    const cs = await kvGet('cached_shop');
    if (cm && cs) {
      const member = JSON.parse(cm) as Member;
      if (member.user_id === session.user.id) {
        sessionStore.set({ status: 'ready', session, member, shop: JSON.parse(cs) as Shop, error: null });
        return;
      }
    }
    sessionStore.set({ status: 'signed_out', session: null, member: null, shop: null, error: (err as Error).message });
  }
}

export async function bootstrapSession(): Promise<void> {
  if (!isSupabaseConfigured) {
    sessionStore.set({ status: 'not_configured' });
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (data.session) await loadMembership(data.session);
  else sessionStore.set({ status: 'signed_out', session: null, member: null, shop: null });

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      sessionStore.set({ status: 'signed_out', session: null, member: null, shop: null });
    } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      const current = sessionStore.get();
      if (!current.member || current.session?.user.id !== session.user.id) void loadMembership(session);
      else sessionStore.set({ session });
    }
  });
}

export async function signInOwner(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function signUpOwner(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signUp({ email, password });
  return error ? error.message : null;
}

export async function createShop(name: string, ownerName: string, phone: string): Promise<string | null> {
  const { error } = await supabase.rpc('create_shop', { p_name: name, p_owner_name: ownerName, p_phone: phone || null });
  if (error) return error.message;
  const { data } = await supabase.auth.getSession();
  if (data.session) await loadMembership(data.session);
  return null;
}

/**
 * Employee PIN sign-in. The `pin-login` edge function verifies the PIN server-side (bcrypt, lockout)
 * and returns a real Supabase session for that employee's own auth user, so RLS knows who is acting.
 */
export async function signInWithPin(shopCode: string, memberId: string, pin: string): Promise<string | null> {
  try {
    const res = await fetch(functionsUrl('pin-login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shop_code: shopCode.trim(), member_id: memberId, pin }),
    });
    const body = (await res.json()) as { error?: string; access_token?: string; refresh_token?: string };
    if (!res.ok || !body.access_token || !body.refresh_token) return body.error ?? `Login failed (${res.status})`;
    const { error } = await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
    return error ? error.message : null;
  } catch (e) {
    return `Network error: ${(e as Error).message}. PIN login needs internet the first time.`;
  }
}

/** Public lookup used by the PIN screen: shop name + employee list for a shop code (via edge function). */
export async function lookupShopForPin(shopCode: string): Promise<{ shop_name: string; members: { id: string; display_name: string }[] } | { error: string }> {
  try {
    const res = await fetch(functionsUrl('pin-login') + '?shop_code=' + encodeURIComponent(shopCode.trim()));
    return (await res.json()) as { shop_name: string; members: { id: string; display_name: string }[] } | { error: string };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  await resetLocalDb();
  sessionStore.set({ status: 'signed_out', session: null, member: null, shop: null, error: null });
}

export function useSession() {
  return sessionStore.use();
}

export function useMember(): Member {
  const m = sessionStore.use((s) => s.member);
  if (!m) throw new Error('useMember called outside a ready session');
  return m;
}
