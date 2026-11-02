import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { syncStore } from '@/lib/sync/engine';

/**
 * Tiny data hook for local-first screens: runs `fn` on mount, on focus, and after each sync pull.
 * Re-runs when `deps` change. Returns { data, loading, error, refresh }.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const version = useRef(0);

  const refresh = useCallback(async () => {
    const v = ++version.current;
    try {
      const d = await fnRef.current();
      if (v === version.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (v === version.current) setError((e as Error).message);
    } finally {
      if (v === version.current) setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, deps);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  useEffect(() => {
    let last = syncStore.get().lastSyncAt;
    const unsubscribe = syncStore.subscribe(() => {
      const now = syncStore.get().lastSyncAt;
      if (now !== last) {
        last = now;
        void refresh();
      }
    });
    return () => { unsubscribe(); };
  }, [refresh]);

  return { data, loading, error, refresh };
}
