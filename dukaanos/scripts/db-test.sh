#!/usr/bin/env bash
# Applies all migrations to a throwaway Postgres database and runs the SQL behavioural tests.
# Requires a reachable Postgres (set PGHOST/PGPORT/PGUSER, or run `supabase start` and use its DB URL).
#   npm run db:test
#   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run db:test
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${DB_TEST_NAME:-dukaanos_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q)
if [[ -n "${DATABASE_URL:-}" ]]; then
  ADMIN=("${PSQL[@]}" "$DATABASE_URL")
  # derive a URL pointing at the test DB
  TEST_URL="${DATABASE_URL%/*}/$DB"
else
  ADMIN=("${PSQL[@]}")
  TEST_URL=""
fi
"${ADMIN[@]}" -c "drop database if exists $DB" -c "create database $DB"
if [[ -n "$TEST_URL" ]]; then T=("${PSQL[@]}" "$TEST_URL"); else T=("${PSQL[@]}" -d "$DB"); fi
"${T[@]}" -f supabase/tests/00_stub_supabase.sql
for f in supabase/migrations/*.sql; do echo "applying $f"; "${T[@]}" -f "$f"; done
"${T[@]}" -f supabase/tests/01_flows.sql
