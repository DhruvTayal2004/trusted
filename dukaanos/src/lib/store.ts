import { useSyncExternalStore } from 'react';

/** Minimal external store (no extra dependency). */
export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  const get = () => state;
  const set = (patch: Partial<T> | ((s: T) => T)) => {
    state = typeof patch === 'function' ? (patch as (s: T) => T)(state) : { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const use = <S = T>(selector: (s: T) => S = (s) => s as unknown as S): S =>
    useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
  return { get, set, subscribe, use };
}
