# Cash Management — Phase 1 Setup

## 1. Create a new Supabase project
- New standalone project (not the same one as Shift & Ledger)
- Recommended: upgrade to **Supabase Pro** before going live — gives point-in-time
  recovery, which matters a lot for a cash-audit system (lets you restore to any
  exact second if something looks tampered with)

## 2. Run the migrations
In Supabase SQL Editor, run in order:
1. `supabase/migrations/0001_init_schema.sql`
2. `supabase/migrations/0002_rls_policies.sql`

## 3. Create your first users
- Add outlets first (`outlets` table)
- Create auth users via Supabase Auth (email/password)
- Insert a matching row in `app_users` for each — this is what assigns their
  `outlet_id` and `role` (cashier / manager / audit / hq)
- HQ/audit users: leave `outlet_id` null — they see all outlets

## 4. Configure environment
Copy `.env.example` to `.env` and fill in your project's URL + anon key
(Settings → API in Supabase dashboard).

## 5. Local dev
```
npm install
npm run dev
```

## 6. Deploy
Same workflow as Shift & Ledger:
```
vercel --prod
```
Set the same env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in the
Vercel project settings.

## What's enforced at the database level (not just the UI)
These rules live in `0002_rls_policies.sql` as triggers, so they hold even if
someone bypasses the app UI:
- A walk-in bill cannot carry a balance — only `admitted_patient` bills can
- A patient cannot be discharged while any of their bills still has `balance_due > 0`
- Every insert/update to bills, expenses, admissions, and daily_registers is
  automatically logged to `audit_log` — no separate step needed
- Bill status (open/partial/paid) is auto-calculated from payments — nobody
  sets it by hand

## What Phase 1 does NOT yet include (coming in later phases)
- Patient registration UI (Phase 2)
- Daily register entry screen (Phase 2)
- Bill creation/payment UI (Phase 3)
- Customer credit / round-up handling UI (Phase 3)
- Expense + deposit entry, gateway reconciliation (Phase 4)
- Audit log viewer + HQ multi-outlet dashboard (Phase 5/6)

The database already supports all of the above — this phase just didn't build
the screens yet, so you're not maintaining unused UI while we validate the
schema and login flow first.
