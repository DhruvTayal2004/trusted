import * as SQLite from 'expo-sqlite';
import { LOCAL_SCHEMA, LOCAL_SCHEMA_VERSION } from './schema';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('dukaanos.db');
      await db.execAsync('pragma journal_mode = WAL; pragma foreign_keys = off;');
      await db.execAsync(LOCAL_SCHEMA);
      const row = await db.getFirstAsync<{ value: string }>(`select value from kv where key = 'schema_version'`);
      const current = row ? Number(row.value) : 0;
      if (current < LOCAL_SCHEMA_VERSION) {
        // Future migrations go here (ALTER TABLE ... when version < N).
        await db.runAsync(`insert or replace into kv(key, value) values ('schema_version', ?)`, String(LOCAL_SCHEMA_VERSION));
      }
      return db;
    })();
  }
  return dbPromise;
}

export async function kvGet(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('select value from kv where key = ?', key);
  return row?.value ?? null;
}

export async function kvSet(key: string, value: string | null): Promise<void> {
  const db = await getDb();
  if (value === null) await db.runAsync('delete from kv where key = ?', key);
  else await db.runAsync('insert or replace into kv(key, value) values (?, ?)', key, value);
}

/** Wipe all local data (sign-out of a device / switching shops). */
export async function resetLocalDb(): Promise<void> {
  const db = await getDb();
  const tables = await db.getAllAsync<{ name: string }>(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`);
  await db.withTransactionAsync(async () => {
    for (const t of tables) await db.runAsync(`delete from ${t.name}`);
  });
}

export const bool = (v: unknown) => (v ? 1 : 0);
export const fromBool = (v: unknown) => Number(v) === 1;
