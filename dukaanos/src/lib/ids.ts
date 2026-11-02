import * as Crypto from 'expo-crypto';

/** Client-generated UUID v4 — the idempotency key for every record and outbox op. */
export function newId(): string {
  return Crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Business date (YYYY-MM-DD) in the device's local time. Shops run on local time. */
export function todayLocal(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
