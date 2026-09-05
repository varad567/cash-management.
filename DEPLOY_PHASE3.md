# Phase 3 — deployment guide

Your Supabase project ref: **`eooqixdbuzktwmwdusth`**
Always double-check the dashboard URL contains this before running SQL —
you hit this exact trap earlier and ran migrations against the wrong project.

---

## Part A — What's already live

Done and verified in earlier steps, no action needed:

- Migrations 0021–0024
- `send-alert` Edge Function (email via Resend)
- `reset-user-password` Edge Function
- Secrets: `ALERT_SHARED_SECRET`, `RESEND_API_KEY`, `ALERT_FROM_EMAIL`
- Resend domain `bidwaihealthcare.com` verified
- Shift-close receipt + employee confirmation emails confirmed working
- Closed-register immutability confirmed (tested: direct SQL update rejected)

---

## Part B — What's new in this round

### 1. Run the two new migrations

Supabase SQL Editor (project `eooqixdbuzktwmwdusth`), **in order**:

1. `0025_shift_disputes.sql`
2. `0026_daily_digest.sql`

`0026` enables `pg_cron` and schedules the daily job. If `pg_cron` isn't
already enabled on the project, the `create extension` line handles it —
but on some plans you may need to enable it once from
**Database → Extensions** in the dashboard first.

Verify the cron job registered:
```sql
select jobname, schedule, active from cron.job;
```
You should see `daily-shift-digest` at `30 3 * * *`.

### 2. Replace and redeploy the Edge Function

Overwrite `supabase/functions/send-alert/index.ts` with the new version
(handles all four event types now: `shift_closed`, `sync_failure`,
`shift_dispute`, `daily_digest`), then:

```
supabase functions deploy send-alert --no-verify-jwt
```

No new secrets needed — it reuses the three you already set.

### 3. Replace the frontend files

```
src/App.tsx                     (replace)
src/components/NavShell.tsx     (replace)
src/lib/types.ts                (replace)
src/lib/disputeService.ts       (new)
src/pages/AlertRecipients.tsx   (new)
src/pages/MyShifts.tsx          (new)
src/pages/Disputes.tsx          (new)
```

Verified before handoff: `tsc --noEmit` clean, oxlint 0 errors,
`vite build` succeeds with all new pages bundling correctly.

---

## Part C — Hosting on Vercel

Your repo is `github.com/varad567/cash-management.` — note the **trailing
period is part of the actual repo name**. It's unusual and some tools
handle it badly. If Vercel's importer chokes on it, renaming the repo on
GitHub (Settings → rename to `cash-management`) is the cleanest fix; Vercel
will then import normally.

### First-time setup

1. **vercel.com** → **Add New** → **Project**
2. **Import Git Repository** → authorize GitHub → pick the repo
3. Vercel auto-detects Vite. Confirm:
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. **Environment Variables** — add both before the first deploy:
   ```
   VITE_SUPABASE_URL       = https://eooqixdbuzktwmwdusth.supabase.co
   VITE_SUPABASE_ANON_KEY  = <your anon key>
   ```
   Get these from Supabase → **Project Settings → API**. Use the **anon**
   key, never the service_role key — the anon key is meant to be public
   and is protected by your RLS policies; service_role bypasses RLS
   entirely and must never reach a browser.
5. **Deploy**

### SPA routing

This app uses client-side routing, so a hard refresh on `/disputes` or any
deep link will 404 unless Vercel rewrites everything to `index.html`. If
you don't already have `vercel.json` in the repo root, add it:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### After deploying

- Add the Vercel URL to Supabase → **Authentication → URL Configuration**
  → **Redirect URLs**, otherwise the password-reset links from the staff
  admin screen won't work.
- Pushes to your main branch auto-deploy from then on.

---

## Part D — Post-deploy checks

1. Log in as HQ → confirm nav shows **Outlets**, **Staff**, **Alerts**,
   **Disputes**, **My Shifts**
2. Log in as a cashier → confirm they see **My Shifts** but NOT Outlets /
   Staff / Alerts
3. **Alerts** screen → confirm your existing recipient(s) appear, add a
   second one
4. Close a test shift → confirm receipt + confirmation emails still arrive
5. From that closer's account → **My Shifts** → raise a test dispute →
   confirm the HQ alert email arrives and it shows on the Disputes screen
6. Test the digest without waiting for 9am:
   ```sql
   select send_daily_digest(current_date);
   ```
   (Pass an explicit date — the no-argument version does *yesterday*.)

---

## Still open

- **Supabase free tier** — no point-in-time recovery. You declined the Pro
  upgrade earlier; worth revisiting now that this is handling live
  cash-audit data across outlets with staff depending on it.
- Digest time is hardcoded to 09:00 IST in migration 0026. To change:
  ```sql
  select cron.unschedule('daily-shift-digest');
  select cron.schedule('daily-shift-digest', '<new UTC cron>', $$select send_daily_digest()$$);
  ```
  Remember pg_cron schedules in **UTC**, not local time.
