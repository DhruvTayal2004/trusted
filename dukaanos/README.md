# DukaanOS

AI-powered operating system for Indian kirana stores — mobile-first, offline-first, Hindi/Hinglish friendly.
Built with Expo (React Native) + Supabase. Owner + 2–3 employees run the shop from phones; the system remembers,
calculates, records, checks and reports.

> Repository note: the `trusted` repo root is an unrelated static site. Everything DukaanOS lives in `dukaanos/`.
> Architecture and design decisions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## What works in V1

| Area | Status |
|---|---|
| Owner sign-up, create shop, add employees with PIN + granular permissions | ✅ |
| Employee PIN login (server-verified bcrypt, lockout, per-employee auth user → RLS) | ✅ (edge function `pin-login`) |
| Products (units kg/g/l/ml/pc/pkt/bag, loose vs packaged, barcode, min stock, quick buttons, aliases) | ✅ |
| Sales: quick grid, search, barcode, loose-goods qty picker, by-₹-amount, hold/resume tickets, discount (permission-gated), cash / UPI / udhaar / split | ✅ |
| Customer khata: balances, opening balance, payments, udhaar without bill, adjustments with reason, WhatsApp reminder link | ✅ |
| Suppliers: balances, purchases/receive stock, payments, purchase-price history | ✅ |
| Expenses with receipt photo, approval flow for flagged categories | ✅ |
| Shifts: open with float, live expected cash, close with itemised reconciliation, difference alerts | ✅ |
| UPI reconciliation (pending → verified/failed), never counted as drawer cash | ✅ |
| Inventory: every change is a stock movement; adjustments with reasons; physical count → count adjustments | ✅ |
| Refunds as reversal records (original sale immutable) | ✅ |
| Notebook scanner: batch photo → upload → AI extraction with confidence/flags → human review (match party, fix fields) → import with page provenance | ✅ (needs AI key) |
| AI assistant (Hindi/Hinglish/English) over deterministic SQL reports, answers tagged verified/estimate/unavailable | ✅ (needs AI key) |
| Voice order: record → transcription + product matching; typed Hinglish parsed on-device offline; prices only from catalogue; confirm before saving | ✅ (speech needs OpenAI Whisper key; typed path works offline) |
| Offline-first: SQLite mirror, outbox, idempotent RPCs, rejected-op review, conflict log, visible sync badge | ✅ |
| Reports: day / week / month / unusual activity; audit log | ✅ |
| WhatsApp notifications | ⚠️ Integration-ready. Without Meta credentials messages are queued and shown as **Not delivered** — never faked |
| Weighing scale | ⚠️ Abstraction + manual entry. Bluetooth/serial driver is a documented stub (needs a dev build + device-specific protocol) |
| Historical *sales* import from notebook | ❌ Review only in V1 (khata, supplier, expenses import works) |

## Prerequisites (Mac)

- Node 20+ (`node -v`), npm 10+
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- Expo Go on your phone **or** Xcode / Android Studio for simulators
- For PIN login, camera, barcode and audio: these work in Expo Go on SDK 58. Bluetooth scales will need a development build.

## 1. Backend setup (Supabase)

```bash
cd dukaanos
supabase login
supabase link --project-ref <your-project-ref>      # or: supabase start  (local stack)
supabase db push                                      # applies supabase/migrations/0001..0004
supabase functions deploy pin-login ai-extract ai-assistant ai-voice notify
cp .env.example .env                                  # fill values
supabase secrets set --env-file .env                  # server-side keys only (see below)
```

Secrets the edge functions read (never shipped to the phone):

| Secret | Purpose |
|---|---|
| `EMPLOYEE_AUTH_PEPPER` | **Required** for employee PIN login. `openssl rand -hex 32` |
| `AI_PROVIDER` + `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Notebook extraction, assistant, voice matching. Without a key those screens say "AI not connected". Default model `claude-opus-5-5`. |
| `OPENAI_API_KEY` | Also enables speech-to-text (Whisper) for voice orders |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp Business Cloud API. Without them, alerts are queued and marked not delivered |

Auth settings in the Supabase dashboard: enable Email provider; for development turn off "Confirm email" so owner sign-up is instant.
`pin-login` must be deployed with `verify_jwt = false` (already set in `supabase/config.toml`).

## 2. Mobile app

```bash
cd dukaanos
npm install
# .env must contain the two EXPO_PUBLIC_ values (anon key is public; RLS protects everything)
npx expo start            # press i (iOS simulator), a (Android), or scan QR with Expo Go
```

First run: sign up as owner → **Create your shop** → More → Employees → add employee → set PIN → Settings shows the **shop code**.
On the employee's phone: **Employee login with PIN** → shop code → name → PIN.

## 3. Tests

```bash
npm test            # vitest: money/paise arithmetic, units + Hinglish parsing, cart totals & payment splits,
                    # cash reconciliation, permissions, voice parser, notebook dedupe, sync error classification
npm run typecheck   # tsc --noEmit
npm run db:test     # applies migrations to a throwaway Postgres and runs supabase/tests/01_flows.sql:
                    # shop→employee→products→sale→stock→khata→expense→purchase→shift close→expected cash,
                    # idempotent replay, permission denials, immutability, RLS isolation, notebook import
```

`db:test` needs a reachable Postgres: either `supabase start` then
`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run db:test`, or any local Postgres via `PGHOST/PGPORT/PGUSER`.

Bundle smoke test (catches runtime import errors): `npx expo export --platform android`.

## 4. Builds

Android (APK for the shop's phones):
```bash
npm i -g eas-cli && eas login
eas build --profile preview --platform android     # installable .apk
```
iOS:
```bash
eas build --profile preview --platform ios          # internal distribution (needs Apple developer account)
```
Set `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` as EAS environment variables for each profile
(`eas env:create`), or edit `eas.json`. Local native builds: `npx expo run:android` / `npx expo run:ios`.

## 5. Deployment checklist

1. `supabase db push` on the production project; verify `npm run db:test` passed against the same migrations.
2. Deploy all five edge functions; set secrets; confirm `pin-login` GET `?shop_code=XXXXXX` returns the shop.
3. Storage buckets are created by migration `0004` (private: `notebook-pages`, `receipts`, `invoices`).
4. Schedule `queue_daily_notifications()` + the `notify` function (Supabase cron / pg_net) if WhatsApp is connected.
5. Build with `eas build --profile production` and distribute (Play internal testing or direct APK).
6. Rotate `EMPLOYEE_AUTH_PEPPER` only with a plan: employees re-login once (the function re-syncs passwords).

## Project layout

```
src/app          Expo Router screens: (auth) login/pin/create-shop · (app)/(tabs) home/sales/khata/inventory/more · stack screens
src/core         Pure domain logic + tests (money, units, cart, cash, permissions, voice, notebook, sync errors)
src/lib          supabase client, SQLite schema, repositories (local-first writes + outbox), sync engine, storage, scale
src/features     session store, sale cart store, pickers, data hook
src/ui           Design system (theme, Button, Card, Money, Field, …)
supabase/        migrations (schema, RLS, RPCs, storage), edge functions, SQL tests
```

## Acceptance workflows (V1)

1–3 Owner creates shop, employees, products → `(auth)/create-shop`, `employees/edit`, `products/new`
4–7 Employee sale with cash / UPI status / udhaar → `sale/new` (payments → `post_sale`)
8 Khata updates → trigger on `customer_ledger_entries`; 9 stock deducts → `stock_movements` trigger
10–12 Notebook photo → AI rows → review → import → `scanner/*`, `ai-extract`, `import_notebook_entries`
13–14 Purchase increases stock → `purchases/new` → `receive_purchase`
15–17 Shift close, reconciliation, owner sees difference → `shift/close`, `close_shift`, dashboard card
18–19 Offline records and sync without duplicates → outbox + client UUID idempotency (`sync.tsx` shows queue)
20 Owner asks AI → `assistant` → `ai-assistant` (deterministic RPCs)

Items 10–12 and 20 require an AI key; 18–19 are verified by the SQL replay test and the outbox design — end-to-end
device testing with airplane mode is still to be done on real hardware (see "Not yet verified" below).

## Not yet verified / known gaps

- Not run on a physical device in this environment (no simulator here): typecheck, unit tests, SQL tests and the Metro
  Android bundle pass; UI layout and camera/audio permissions need a device pass.
- Voice recording upload uses React Native's `FormData` file shape; verify against the deployed `ai-voice` function.
- Pull sync overwrites local product/customer caches with server values; a device with unsynced sales will briefly show
  server stock until its outbox pushes (push runs before pull, so this only shows if push fails mid-way).
- Expense/invoice photos taken offline are saved with path `upload_pending` and are not retried automatically yet.
- No automated UI tests.
