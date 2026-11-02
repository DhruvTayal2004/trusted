/**
 * Weighing-scale abstraction.
 *
 * Shops use many different electronic scales; most cheap ones have no data port, some expose
 * RS-232 (via a USB-serial dongle) or Bluetooth SPP, and a few speak BLE. None of these are
 * supported by Expo Go, and the wire protocol differs per brand. V1 therefore ships:
 *   - ManualScale: always available; the cashier types/reads the weight (reliable fallback)
 *   - BluetoothSerialScale: an explicit "not connected" driver documenting the integration point.
 * A real driver implements ScaleDriver and is registered in `drivers` below. The sales screen
 * only talks to `useScale()`, so nothing else changes when a driver is added.
 */
import { useEffect, useState } from 'react';
import { createStore } from '@/lib/store';

export interface ScaleReading {
  grams: number; // always in grams for weight scales
  stable: boolean;
  at: string;
}

export interface ScaleDriver {
  id: string;
  label: string;
  /** Resolve true when the hardware is reachable. Must never throw. */
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  /** One reading, or null when not connected. Should resolve within ~2s. */
  readWeight(): Promise<ScaleReading | null>;
  /** Optional streaming reads. */
  subscribe?(cb: (r: ScaleReading) => void): () => void;
}

export const ManualScale: ScaleDriver = {
  id: 'manual',
  label: 'Manual entry',
  connect: async () => true,
  disconnect: async () => undefined,
  readWeight: async () => null,
};

/**
 * Placeholder for a Bluetooth-serial scale (e.g. Essae / Phoenix with SPP module). Requires a
 * development build with a BLE/serial native module and a per-model parser. Reports not connected.
 */
export const BluetoothSerialScale: ScaleDriver = {
  id: 'bt-serial',
  label: 'Bluetooth scale (not connected — needs device-specific driver)',
  connect: async () => false,
  disconnect: async () => undefined,
  readWeight: async () => null,
};

export const drivers: ScaleDriver[] = [ManualScale, BluetoothSerialScale];

interface ScaleState { driver: ScaleDriver; connected: boolean; last: ScaleReading | null }
export const scaleStore = createStore<ScaleState>({ driver: ManualScale, connected: true, last: null });

export async function selectScale(driver: ScaleDriver): Promise<boolean> {
  await scaleStore.get().driver.disconnect();
  const ok = await driver.connect();
  scaleStore.set({ driver, connected: ok, last: null });
  return ok;
}

/** Hook used by the quantity picker. `read()` returns grams or null (→ manual entry). */
export function useScale() {
  const s = scaleStore.use();
  const [reading, setReading] = useState<ScaleReading | null>(s.last);
  useEffect(() => {
    if (!s.connected || !s.driver.subscribe) return;
    return s.driver.subscribe((r) => {
      setReading(r);
      scaleStore.set({ last: r });
    });
  }, [s.driver, s.connected]);
  return {
    driver: s.driver,
    connected: s.connected && s.driver.id !== 'manual',
    reading,
    read: async () => {
      const r = await s.driver.readWeight();
      if (r) { setReading(r); scaleStore.set({ last: r }); }
      return r;
    },
  };
}
