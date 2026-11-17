/**
 * Classifies server errors for the outbox. Pure (no RN imports) so it is unit-testable.
 * Permanent = the server will never accept this op (validation, permission, constraint) → mark rejected, keep for review.
 * Transient = network / 5xx / timeout → keep pending, retry on next sync.
 */
export const PERMANENT_PG_CODES = new Set(['42501', 'P0001', 'P0002', '23514', '23503', '22P02', '23505', '42883', '42P01', '22003', '22007']);

export function rpcErrorMessage(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const e = err as { message?: string; details?: string; hint?: string; code?: string };
  return e.message || e.details || e.hint || e.code || 'Unknown error';
}

export function isPermanentRpcError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; status?: number } | null;
  if (!e) return false;
  if (typeof e.status === 'number' && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) return true;
  if (e.code && PERMANENT_PG_CODES.has(e.code)) return true;
  const msg = (e.message ?? '').toLowerCase();
  if (/network|fetch failed|timeout|timed out|socket|econn|offline|failed to fetch/.test(msg)) return false;
  return msg.includes('row-level security') || msg.includes('not permitted') || msg.includes('permission') || msg.includes('does not match') || msg.includes('required');
}
