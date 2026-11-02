import { fromBool, getDb } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import type { MemberRow } from './types';

export async function listMembersLocal(): Promise<MemberRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; display_name: string; role: string; is_active: number; permissions: string }>('select * from members order by role, display_name');
  return rows.map((r) => ({ ...r, is_active: fromBool(r.is_active), permissions: safe(r.permissions) }));
}
function safe(s: string): Record<string, unknown> { try { return JSON.parse(s); } catch { return {}; } }

/** Managers only (RLS). Online-only operations. */
export async function listMembersServer() {
  const { data, error } = await supabase.from('shop_members').select('id, display_name, phone, role, is_active, permissions, user_id, created_at').order('role').order('display_name');
  if (error) throw error;
  return data;
}

export async function createEmployee(args: { shopId: string; displayName: string; phone?: string; role: 'employee' | 'admin'; permissions: object }) {
  const { data, error } = await supabase.from('shop_members').insert({ shop_id: args.shopId, display_name: args.displayName.trim(), phone: args.phone?.trim() || null, role: args.role, permissions: args.permissions }).select().single();
  if (error) throw error;
  return data;
}

export async function updateEmployee(id: string, patch: { display_name?: string; phone?: string | null; role?: string; is_active?: boolean; permissions?: object }) {
  const { error } = await supabase.from('shop_members').update(patch).eq('id', id);
  if (error) throw error;
}

export async function setEmployeePin(memberId: string, pin: string) {
  const { error } = await supabase.rpc('set_member_pin', { p_member_id: memberId, p_pin: pin });
  if (error) throw error;
}
