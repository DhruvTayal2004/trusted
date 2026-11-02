import type { Unit } from '@/core/units';

export interface Product {
  id: string;
  shop_id: string;
  category_id: string | null;
  name: string;
  name_hi: string | null;
  aliases: string[];
  unit: Unit;
  is_loose: boolean;
  selling_price_paise: number;
  purchase_price_paise: number | null;
  barcode: string | null;
  min_stock_qty: string;
  stock_qty: string;
  is_quick: boolean;
  quick_sort: number;
  is_active: boolean;
  updated_at: string;
}

export interface Category { id: string; shop_id: string; name: string; sort_order: number }

export interface Customer {
  id: string; shop_id: string; name: string; phone: string | null; address: string | null; notes: string | null;
  balance_paise: number; credit_limit_paise: number | null; is_active: boolean; updated_at: string;
}

export interface Supplier {
  id: string; shop_id: string; name: string; phone: string | null; address: string | null; gstin: string | null; notes: string | null;
  balance_paise: number; is_active: boolean; updated_at: string;
}

export interface Sale {
  id: string; shop_id: string; member_id: string; shift_id: string | null; customer_id: string | null; status: string;
  subtotal_paise: number; discount_paise: number; total_paise: number; discount_reason: string | null; note: string | null;
  source: string; client_created_at: string; updated_at: string;
}

export interface SaleItem { id: string; sale_id: string; product_id: string | null; description: string; unit: Unit; qty: string; unit_price_paise: number; line_total_paise: number }

export interface Payment {
  id: string; shop_id: string; sale_id: string | null; customer_id: string | null; member_id: string; shift_id: string | null;
  method: 'cash' | 'upi' | 'credit'; status: string; amount_paise: number; upi_reference: string | null; note: string | null; client_created_at: string;
}

export interface LedgerEntry {
  id: string; customer_id: string; entry_type: string; amount_paise: number; sale_id: string | null; payment_id: string | null; entry_date: string; note: string | null; client_created_at: string;
}

export interface SupplierLedgerEntry {
  id: string; supplier_id: string; entry_type: string; amount_paise: number; purchase_id: string | null; payment_method: string | null; entry_date: string; note: string | null; client_created_at: string;
}

export interface Expense {
  id: string; member_id: string; shift_id: string | null; category_id: string | null; category_name: string; amount_paise: number;
  paid_method: 'cash' | 'upi' | 'credit'; expense_date: string; note: string | null; receipt_image_path: string | null; status: string; client_created_at: string;
}

export interface ExpenseCategory { id: string; name: string; requires_approval: boolean }

export interface Shift {
  id: string; member_id: string; status: 'open' | 'closed'; opened_at: string; opening_cash_paise: number; closed_at: string | null;
  expected_cash_paise: number | null; counted_cash_paise: number | null; cash_difference_paise: number | null; closing_notes: string | null;
}

export interface StockMovement {
  id: string; product_id: string; member_id: string | null; movement_type: string; qty_delta: string; unit_cost_paise: number | null;
  sale_id: string | null; purchase_id: string | null; reason: string | null; client_created_at: string;
}

export interface Purchase {
  id: string; supplier_id: string | null; member_id: string; invoice_number: string | null; invoice_date: string; invoice_image_path: string | null;
  subtotal_paise: number; total_paise: number; paid_paise: number; paid_method: string | null; note: string | null; client_created_at: string;
}

export interface MemberRow { id: string; display_name: string; role: string; is_active: boolean; permissions: Record<string, unknown> }
