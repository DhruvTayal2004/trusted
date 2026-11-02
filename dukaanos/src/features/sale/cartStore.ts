import type { CartLine } from '@/core/cart';
import { newId } from '@/lib/ids';
import { createStore } from '@/lib/store';
import type { Customer, Product } from '@/lib/repos/types';

/**
 * In-progress bill. Lives outside the screen so the voice-order and barcode screens can add lines,
 * and so an accidental back-navigation doesn't lose the bill. Multiple employees on different phones
 * naturally have separate tickets; on one shared phone, "Hold" parks a ticket.
 */
export interface CartState {
  lines: CartLine[];
  customer: Customer | null;
  discountPaise: number;
  discountReason: string;
  note: string;
  source: 'manual' | 'voice' | 'barcode' | 'quick';
  held: { id: string; label: string; lines: CartLine[]; customer: Customer | null }[];
}

export const cartStore = createStore<CartState>({ lines: [], customer: null, discountPaise: 0, discountReason: '', note: '', source: 'manual', held: [] });

export function addProductLine(product: Product, qty: string, unitPricePaise: number, source?: CartState['source']) {
  cartStore.set((s) => {
    const existing = s.lines.find((l) => l.productId === product.id && l.unitPricePaise === unitPricePaise);
    const lines = existing
      ? s.lines.map((l) => (l === existing ? { ...l, qty: String(Number(l.qty) + Number(qty)) } : l))
      : [...s.lines, { id: newId(), productId: product.id, description: product.name, unit: product.unit, qty, unitPricePaise }];
    return { ...s, lines, source: source ?? s.source };
  });
}

export function addFreeLine(description: string, unit: CartLine['unit'], qty: string, unitPricePaise: number) {
  cartStore.set((s) => ({ ...s, lines: [...s.lines, { id: newId(), productId: null, description, unit, qty, unitPricePaise }] }));
}

export function updateLine(id: string, patch: Partial<CartLine>) {
  cartStore.set((s) => ({ ...s, lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
}

export function removeLine(id: string) {
  cartStore.set((s) => ({ ...s, lines: s.lines.filter((l) => l.id !== id) }));
}

export function clearCart() {
  cartStore.set((s) => ({ ...s, lines: [], customer: null, discountPaise: 0, discountReason: '', note: '', source: 'manual' }));
}

export function holdCart(label: string) {
  cartStore.set((s) => ({ ...s, held: [...s.held, { id: newId(), label, lines: s.lines, customer: s.customer }], lines: [], customer: null, discountPaise: 0, discountReason: '' }));
}

export function resumeHeld(id: string) {
  cartStore.set((s) => {
    const h = s.held.find((x) => x.id === id);
    if (!h) return s;
    return { ...s, lines: h.lines, customer: h.customer, held: s.held.filter((x) => x.id !== id) };
  });
}
