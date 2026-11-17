import { getDb, kvGet, kvSet } from '@/lib/db';
import { enqueue } from '@/lib/sync/outbox';
import { uploadImage } from '@/lib/storage';

/**
 * Photos taken offline: remembered here and uploaded on the next sync. After upload, the
 * record's path is fixed on the server through `set_attachment_path` (queued via the outbox).
 */
export interface PendingUpload { bucket: 'receipts' | 'invoices'; path: string; localUri: string; table: 'expenses' | 'purchases'; recordId: string; attempts: number }
const KEY = 'pending_uploads';

async function readAll(): Promise<PendingUpload[]> {
  try { return JSON.parse((await kvGet(KEY)) ?? '[]') as PendingUpload[]; } catch { return []; }
}

export async function rememberPendingUpload(u: Omit<PendingUpload, 'attempts'>): Promise<void> {
  const all = await readAll();
  all.push({ ...u, attempts: 0 });
  await kvSet(KEY, JSON.stringify(all));
}

export async function pendingUploadCount(): Promise<number> {
  return (await readAll()).length;
}

/** Try every pending upload once. Keeps failures for next time. Returns how many succeeded. */
export async function flushPendingUploads(): Promise<number> {
  const all = await readAll();
  if (!all.length) return 0;
  const remaining: PendingUpload[] = [];
  let done = 0;
  const db = await getDb();
  for (const u of all) {
    try {
      await uploadImage(u.bucket, u.path, u.localUri);
      const col = u.table === 'expenses' ? 'receipt_image_path' : 'invoice_image_path';
      await db.runAsync(`update ${u.table} set ${col} = ? where id = ?`, u.path, u.recordId);
      await enqueue('set_attachment_path', { p_table: u.table, p_id: u.recordId, p_path: u.path }, u.table, u.recordId);
      done++;
    } catch {
      remaining.push({ ...u, attempts: u.attempts + 1 });
    }
  }
  await kvSet(KEY, JSON.stringify(remaining));
  return done;
}
