# Phase 3 additions — setup checklist

Everything below is new since your last deploy: outlet management,
staff management (edit/deactivate/reset password), SMS alerts on
shift mismatches and sync failures, session auto-logout, and a
Supabase Pro upgrade recommendation.

## 0. Files to drop into your repo
```
supabase/migrations/0021_admin_alerts_and_config.sql
supabase/functions/send-alert/index.ts
supabase/functions/reset-user-password/index.ts
src/pages/OutletManagement.tsx
src/pages/StaffManagement.tsx
src/lib/staffService.ts
src/lib/useIdleLogout.ts
src/App.tsx                (replace — already has the new routes wired in)
src/components/NavShell.tsx (replace — already has the new nav links)
```
Then apply `src/lib/offlineQueue.patch.md` by hand — it's a small
surgical change, not a full-file replace, so it won't clobber
anything else in that file.

Typechecked clean against your actual repo (`tsc --noEmit`) and
linted with your existing oxlint config before handoff — 0 errors.

## 1. Upgrade to Supabase Pro
Dashboard → Project Settings → Billing → upgrade. ~$25/mo, well
within your ₹3-5k budget, and gives you point-in-time recovery —
the single highest-value thing to do today for a cash-audit system.
Do this first; everything else depends on the project staying healthy
under more load anyway.

## 2. Run the migration
Supabase SQL Editor → run `0021_admin_alerts_and_config.sql`.

Then update the two placeholder rows it inserts:
```sql
update app_config set value = 'https://<your-project-ref>.supabase.co/functions/v1/send-alert'
  where key = 'alert_function_url';
update app_config set value = '<a long random string>'
  where key = 'alert_shared_secret';
```
Generate the secret with e.g. `openssl rand -hex 32` — anything long
and random is fine, it just has to match what you set in step 4.

## 3. Sign up for Twilio
- twilio.com → free trial gives a working number + some credit;
  upgrade to a paid account (a few hundred rupees covers a lot of SMS
  at ~₹0.6-1/message) once you're past testing.
- Note your Account SID, Auth Token, and the Twilio phone number.

## 4. Set Edge Function secrets
```
supabase secrets set ALERT_SHARED_SECRET=<same value as app_config.alert_shared_secret>
supabase secrets set TWILIO_ACCOUNT_SID=<your sid>
supabase secrets set TWILIO_AUTH_TOKEN=<your token>
supabase secrets set TWILIO_FROM_NUMBER=<your twilio number, e.g. +1415...>
```

## 5. Deploy the two new Edge Functions
```
supabase functions deploy send-alert --no-verify-jwt
supabase functions deploy reset-user-password
```
(`send-alert` uses `--no-verify-jwt` because Postgres calls it
directly via pg_net — there's no user session to verify, the shared
secret header does that job instead. `reset-user-password` keeps
normal JWT verification since it's called by a logged-in HQ user.)

## 6. Add who gets alerted
Once deployed, log in as HQ and — for now, until you're at the UI for
it — insert directly via SQL Editor:
```sql
insert into alert_recipients (phone_number, label) values
  ('+91XXXXXXXXXX', 'Owner'),
  ('+91XXXXXXXXXX', 'Audit lead');
```
Use E.164 format (+91 followed by the 10-digit number, no spaces).

## 7. Test it
- Close a shift with a deliberate mismatch → SMS should arrive within
  a few seconds.
- Force a permanent sync failure (e.g. try to insert a bill with a
  duplicate bill_serial while offline, then reconnect) → same.

## 8. Auth hardening (dashboard settings, no code)
- Authentication → Rate Limits: confirm sign-in attempt limiting is
  on (it is by default, but worth checking given this handles cash).
- Authentication → Sessions: consider shortening JWT expiry if you
  want a hard server-side session limit in addition to the client-side
  10-minute idle auto-logout that's now built in for cashier/manager
  roles (`useIdleLogout` in `App.tsx`).

## What's still open after this
- Outlet/staff management UI exists now (`/outlets`, `/staff` — HQ
  nav), but alert_recipients has no UI yet (SQL only, per step 6).
- No scheduled/emailed periodic report — CSV export already works
  from Dashboard and Shift History for on-demand pulls.
