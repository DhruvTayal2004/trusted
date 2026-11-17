import { callFunction } from '@/lib/ai';
import { newId } from '@/lib/ids';
import { uploadImage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';

/** Notebook scanner is online-only (needs the AI endpoint); data lives on the server, not in SQLite. */
export type ScanKind = 'customer_khata' | 'supplier_khata' | 'expenses' | 'purchases' | 'sales';
export const SCAN_KIND_LABELS: Record<ScanKind, { label: string; hint: string }> = {
  customer_khata: { label: 'Customer khata', hint: 'Udhaar register — who owes what' },
  supplier_khata: { label: 'Supplier account', hint: 'Payments to and bills from suppliers' },
  expenses: { label: 'Expense diary', hint: 'Kharcha — chai, bhada, bijli' },
  purchases: { label: 'Purchase bills', hint: 'Items bought from suppliers' },
  sales: { label: 'Daily sales (review only)', hint: 'Historical sales — import not supported in V1' },
};

export interface Scan { id: string; kind: ScanKind; batch_id: string; page_number: number; image_path: string; status: string; page_notes: string | null; error: string | null; created_at: string; entry_count?: number; pending_count?: number }
export interface ScanEntry {
  id: string; scan_id: string; row_index: number; party_name: string | null; entry_date: string | null; amount_paise: number | null; direction: 'debit' | 'credit' | 'unknown' | null;
  description: string | null; confidence: number; flags: string[]; party_name_final: string | null; party_id_final: string | null; entry_date_final: string | null; amount_paise_final: number | null;
  direction_final: 'debit' | 'credit' | null; description_final: string | null; status: 'pending' | 'approved' | 'rejected' | 'duplicate' | 'imported'; imported_record_table: string | null;
}

export async function uploadPage(shopId: string, memberId: string, kind: ScanKind, batchId: string, pageNumber: number, localUri: string): Promise<Scan> {
  const id = newId();
  const path = `${shopId}/${batchId}/${pageNumber}-${id.slice(0, 8)}.jpg`;
  await uploadImage('notebook-pages', path, localUri);
  const { data, error } = await supabase.from('notebook_scans').insert({ id, shop_id: shopId, member_id: memberId, kind, batch_id: batchId, page_number: pageNumber, image_path: path, status: 'uploaded' }).select().single();
  if (error) throw error;
  return data as Scan;
}

export async function extractPage(scanId: string): Promise<{ ok: boolean; rows?: number; error?: string; not_configured?: boolean; page_notes?: string | null }> {
  return callFunction('ai-extract', { scan_id: scanId }, { timeoutMs: 180_000 });
}

export async function listBatches(): Promise<{ batch_id: string; kind: ScanKind; pages: number; created_at: string; status: string; pending: number }[]> {
  const { data, error } = await supabase.from('notebook_scans').select('batch_id, kind, status, created_at, notebook_entries(status)').order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  const map = new Map<string, { batch_id: string; kind: ScanKind; pages: number; created_at: string; statuses: string[]; pending: number }>();
  for (const s of data as unknown as { batch_id: string; kind: ScanKind; status: string; created_at: string; notebook_entries: { status: string }[] }[]) {
    const b = map.get(s.batch_id) ?? { batch_id: s.batch_id, kind: s.kind, pages: 0, created_at: s.created_at, statuses: [], pending: 0 };
    b.pages++;
    b.statuses.push(s.status);
    b.pending += (s.notebook_entries ?? []).filter((e) => e.status === 'pending' || e.status === 'approved').length;
    map.set(s.batch_id, b);
  }
  return [...map.values()].map((b) => ({ ...b, status: b.statuses.includes('failed') ? 'failed' : b.statuses.every((x) => x === 'imported') ? 'imported' : b.statuses.includes('processing') || b.statuses.includes('uploaded') ? 'processing' : 'extracted' }));
}

export async function batchDetail(batchId: string): Promise<{ scans: Scan[]; entries: ScanEntry[] }> {
  const { data: scans, error } = await supabase.from('notebook_scans').select('*').eq('batch_id', batchId).order('page_number');
  if (error) throw error;
  const ids = (scans ?? []).map((s) => s.id);
  const { data: entries, error: e2 } = ids.length ? await supabase.from('notebook_entries').select('*').in('scan_id', ids).order('scan_id').order('row_index') : { data: [], error: null };
  if (e2) throw e2;
  return { scans: (scans ?? []) as Scan[], entries: (entries ?? []) as ScanEntry[] };
}

export async function updateEntry(id: string, patch: Partial<ScanEntry>): Promise<void> {
  const { error } = await supabase.from('notebook_entries').update(patch).eq('id', id);
  if (error) throw error;
}

export async function importEntries(ids: string[]): Promise<{ entry_id: string; imported_table: string | null; imported_id: string | null; error: string | null }[]> {
  const { data, error } = await supabase.rpc('import_notebook_entries', { p_entry_ids: ids });
  if (error) throw error;
  return data;
}

export async function existingLedgerFor(kind: ScanKind, partyIds: string[]): Promise<{ party_id: string; amount_paise: number; entry_date: string }[]> {
  if (!partyIds.length) return [];
  if (kind === 'customer_khata') {
    const { data } = await supabase.from('customer_ledger_entries').select('customer_id, amount_paise, entry_date').in('customer_id', partyIds).limit(2000);
    return (data ?? []).map((r) => ({ party_id: r.customer_id, amount_paise: r.amount_paise, entry_date: r.entry_date }));
  }
  const { data } = await supabase.from('supplier_ledger_entries').select('supplier_id, amount_paise, entry_date').in('supplier_id', partyIds).limit(2000);
  return (data ?? []).map((r) => ({ party_id: r.supplier_id, amount_paise: r.amount_paise, entry_date: r.entry_date }));
}
