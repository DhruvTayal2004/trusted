# DukaanOS V1 — Architecture

## Repository note
The `trusted` repository root contains an unrelated static marketing site (TrustedAEO, a Claude Design
handoff). It was left untouched. DukaanOS lives entirely under `dukaanos/`.

## Stack (verified versions, Nov 2026)
| Layer | Choice |
|---|---|
| Mobile | Expo SDK 58, React Native 0.88, TypeScript, Expo Router (file routes in `src/app`) |
| Local data | `expo-sqlite` (WAL mode), one DB per device, outbox table for offline writes |
| Backend | Supabase: Postgres 15/16, Auth, Storage, Edge Functions (Deno) |
| AI | Edge functions call Anthropic (Claude) or OpenAI through one `AiProvider` interface. Keys never ship in the app. |
| Tests | `vitest` for pure domain logic (`src/core`), SQL behavioural tests for RPC/RLS (`supabase/tests`) |

## Core principles
1. **Money is integer paise.** No floats anywhere in financial code. `src/core/money.ts` owns formatting and arithmetic.
2. **Quantities are decimal strings/`Decimal`** (decimal.js) in the product's own unit; conversions live in `src/core/units.ts`.
3. **Financial tables are append-only.** Postgres triggers forbid UPDATE/DELETE on `sale_items`, `payments` (amount), `customer_ledger_entries`, `supplier_ledger_entries`, `stock_movements`, `refunds`. Corrections are reversal rows.
4. **One write path.** The app never inserts financial rows directly: it calls RPCs (`post_sale`, `post_khata_payment`, `post_expense`, `receive_purchase`, `post_stock_adjustment`, `open_shift`, `close_shift`, `post_refund`, `import_notebook_entries`). Every RPC is `security definer`, re-checks the caller's role/permissions, and is **idempotent on the client-generated UUID**.
5. **Stock and balances are caches.** `products.stock_qty`, `customers.balance_paise`, `suppliers.balance_paise` are maintained by triggers from the ledger tables and can be rebuilt.
6. **RLS everywhere.** `current_shop_id()` / `is_manager()` / `has_permission()` helpers gate every table. Employees only see their own sales/payments/expenses/shifts.
7. **AI never produces numbers.** The assistant calls deterministic SQL functions (`daily_summary`, `sales_summary_range`, `shift_cash_summary`, `customer_statement`, `product_stock_report`, `anomaly_report`) and only phrases the result. Answers are tagged *verified* / *estimate* / *unavailable*.

## Identity & roles
- Owner signs up with email+password (Supabase Auth) and calls `create_shop()`.
- Each employee gets their own `auth.users` row (created by the `pin-login` edge function the first time a PIN is set) so RLS can identify the actor. Employees unlock the shop device with **shop code + their name + 4–6 digit PIN**. The edge function verifies the PIN with `verify_member_pin()` (bcrypt, 5 attempts → 15 min lock) and returns a real Supabase session for that employee's auth user.
- Roles: `owner`, `admin` (managers), `employee`. Fine-grained employee permissions in `shop_members.permissions` JSON: `can_refund`, `can_discount`, `max_discount_pct`, `can_receive_stock`, `can_adjust_stock`, `can_record_expense`, `can_view_purchase_price`.

## Offline-first sync
```
UI ──writes──▶ SQLite (local tables)  +  outbox(op_id, rpc, payload, status)
                     ▲                           │
                     │ pull_changes(since)        │ push: call RPC with same payload (idempotent on id)
                     └──────── Supabase ◀────────┘
```
- Every record id is a client UUID (`expo-crypto randomUUID`). Replaying an op is harmless: RPCs return the existing row.
- Outbox is pushed in insertion order; a permanent server rejection (validation / permission) marks the op `rejected` with the server message and surfaces it in **Sync status** — it is never silently dropped.
- Pull uses `pull_changes(since)` keyed on `updated_at`; master-data conflicts (product edited on two devices) are detected by comparing the local `updated_at` with the server's at push time and logged in `sync_conflicts` for the owner to resolve; last server write wins for the cache.
- Local projections (stock, balances) are applied optimistically on write and replaced by server values on pull.

## Directory map
```
dukaanos/
  src/app/              Expo Router screens (auth, owner tabs, employee tabs, stack screens)
  src/core/             Pure, tested domain logic: money, units, cart, cash reconciliation, permissions, voice parsing, dedupe
  src/lib/              supabase client, sqlite db + migrations, repositories, sync engine, ai client, scale abstraction
  src/ui/               Design system: theme, Button, Card, Money, Input, Screen, ListRow, EmptyState
  src/features/         Stores + hooks (auth/session, shop data, sync status)
  supabase/migrations/  0001 schema · 0002 RLS · 0003 RPCs · 0004 storage
  supabase/functions/   pin-login · ai-extract · ai-assistant · ai-voice · notify   (Deno)
  supabase/tests/       SQL behavioural tests (run against any Postgres)
  docs/                 this file, RUNBOOK
```

## Notebook scanner pipeline
1. `scanner/index` — batch capture with `expo-camera` (multiple pages, kind: customer khata / supplier / expenses / purchases).
2. Images uploaded to private bucket `notebook-pages/<shop_id>/<batch>/<page>.jpg`; a `notebook_scans` row per page.
3. `ai-extract` edge function: downloads the page, sends it to the vision model with a strict JSON schema prompt, stores raw output in `raw_extraction`, writes one `notebook_entries` row per line with `confidence` and `flags` (`unreadable_amount`, `date_missing`, `name_uncertain`, `possible_duplicate`). Nothing is imported here.
4. Review screen: owner edits name/date/amount/direction, matches party to an existing customer/supplier (fuzzy match suggestions), approves/rejects. Low-confidence rows cannot be approved without an explicit edit-confirm.
5. `import_notebook_entries()` RPC imports approved rows as `notebook_import` ledger entries, each pointing back at `scan_entry_id` → page image. Opening balances are a separate manual step (`post_khata_entry` type `opening_balance`).

## Weighing scale abstraction
`src/lib/scale/` defines `ScaleDriver { connect, readWeight, disconnect }` with a `ManualScale` driver (always available) and a `BluetoothSerialScale` stub that reports *not connected* until a device-specific driver is added. Sales screen uses `useScale()` which falls back to manual entry.

## Notifications
`notifications_outbox` rows are produced by RPCs (cash discrepancy, daily report, low stock, reminders). The `notify` edge function drains the queue through a `NotificationProvider` interface: `WhatsAppCloudProvider` (Meta Cloud API, needs credentials) or `TestProvider` (marks `skipped_no_provider`). The owner's Alerts screen shows the true delivery status.
