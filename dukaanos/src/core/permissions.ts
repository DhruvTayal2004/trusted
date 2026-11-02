export type Role = 'owner' | 'admin' | 'employee';

export interface MemberPermissions {
  can_refund: boolean;
  can_discount: boolean;
  max_discount_pct: number;
  can_receive_stock: boolean;
  can_adjust_stock: boolean;
  can_record_expense: boolean;
  can_view_purchase_price: boolean;
}

export const DEFAULT_EMPLOYEE_PERMISSIONS: MemberPermissions = {
  can_refund: false,
  can_discount: false,
  max_discount_pct: 0,
  can_receive_stock: false,
  can_adjust_stock: false,
  can_record_expense: true,
  can_view_purchase_price: false,
};

export const ALL_PERMISSIONS: MemberPermissions = {
  can_refund: true,
  can_discount: true,
  max_discount_pct: 100,
  can_receive_stock: true,
  can_adjust_stock: true,
  can_record_expense: true,
  can_view_purchase_price: true,
};

export interface Actor {
  role: Role;
  permissions: Partial<MemberPermissions> | null | undefined;
}

export function isManager(a: Actor): boolean {
  return a.role === 'owner' || a.role === 'admin';
}

export function can(a: Actor, key: keyof Omit<MemberPermissions, 'max_discount_pct'>): boolean {
  if (isManager(a)) return true;
  return Boolean(a.permissions?.[key] ?? DEFAULT_EMPLOYEE_PERMISSIONS[key]);
}

/** Same rule as post_sale(): managers unlimited; employees need can_discount and ≤ max_discount_pct. */
export function canApplyDiscount(a: Actor, subtotalPaise: number, discountPaise: number): { ok: boolean; reason?: string } {
  if (discountPaise <= 0) return { ok: true };
  if (isManager(a)) return { ok: true };
  if (!can(a, 'can_discount')) return { ok: false, reason: 'Discount not allowed for this employee' };
  const max = a.permissions?.max_discount_pct ?? 0;
  if (subtotalPaise <= 0) return { ok: false, reason: 'Nothing to discount' };
  const pct = (discountPaise * 100) / subtotalPaise;
  if (pct > max + 1e-9) return { ok: false, reason: `Discount limit is ${max}%` };
  return { ok: true };
}

/** Screens / actions available by role (UI gating only — the server re-checks everything). */
export function visibleActions(a: Actor) {
  return {
    sales: true,
    voiceOrder: true,
    khata: true,
    expenses: can(a, 'can_record_expense'),
    receiveStock: can(a, 'can_receive_stock'),
    stockAdjust: can(a, 'can_adjust_stock'),
    shiftClose: true,
    dashboard: isManager(a),
    products: isManager(a),
    employees: isManager(a),
    suppliers: isManager(a) || can(a, 'can_receive_stock'),
    scanner: isManager(a),
    assistant: isManager(a),
    reports: isManager(a),
    approvals: isManager(a),
    auditLog: isManager(a),
    purchasePrice: can(a, 'can_view_purchase_price'),
  };
}
