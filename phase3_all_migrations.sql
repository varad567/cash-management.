-- ============================================================
-- Cash Management — Phase 3 consolidated migrations (0021-0026)
-- ============================================================
-- Run IN ORDER in the Supabase SQL Editor for a fresh project.
-- Migrations 0001-0020 (Phase 1-2 core schema) are unchanged and
-- not repeated here.
--
-- 0021 — app_config, alert_recipients, sync_failures + alert triggers
-- 0022 — alert_recipients: phone_number -> email (SMS dropped: TRAI DLT)
-- 0023 — notify on EVERY shift close, not just mismatches
-- 0024 — closed shift registers immutable (double-close/tamper fix)
-- 0025 — shift_disputes: 24-hour employee dispute window
-- 0026 — daily digest via pg_cron (03:30 UTC = 09:00 IST)
--
-- AFTER RUNNING: update the two app_config placeholder rows with
-- your real function URL and shared secret (see DEPLOY_PHASE3.md).


-- ############################################################
-- ## 0021_admin_alerts_and_config.sql
-- ############################################################

-- ============================================================
-- Phase 3: Admin config, SMS/WhatsApp alerts, sync-failure log
-- ============================================================
-- Three additions, independent of each other:
--
-- 1. app_config — small key/value store for the alert Edge
--    Function's URL and a shared secret, so triggers can call it
--    without hardcoding a URL in SQL or requiring a redeploy to
--    change it. Readable only by functions running as
--    security definer (same pattern already used for
--    enforce_shift_open_rules etc.) — never exposed to any client role.
--
-- 2. alert_recipients — phone numbers that should receive SMS/WhatsApp
--    alerts. HQ manages this from the app; the alert function reads it
--    with the service role, bypassing RLS.
--
-- 3. sync_failures — a permanent offline-sync failure (see
--    offlineQueue.ts) used to only reach console.error, which nobody
--    ever saw. Now every permanent failure gets a row here, and a
--    trigger fires an alert the moment it's written.

create extension if not exists pg_net;

-- ---------- 1. App config ----------
create table app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table app_config enable row level security;
-- No policies at all: RLS with zero policies means nobody using the
-- anon/authenticated role can read or write this table under any
-- circumstance. Only security definer functions (row_security = off)
-- and the service role can touch it.

-- Placeholders — replace 'value' with your real Edge Function URL and
-- a long random secret before relying on alerts (see SETUP_PHASE3.md).
insert into app_config (key, value) values
  ('alert_function_url', 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-alert'),
  ('alert_shared_secret', 'REPLACE-WITH-A-LONG-RANDOM-SECRET');

-- ---------- 2. Alert recipients ----------
create table alert_recipients (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null,
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table alert_recipients enable row level security;

create policy "alert_recipients_select_hq" on alert_recipients for select
  using ((auth.jwt() ->> 'app_role') = 'hq');
create policy "alert_recipients_write_hq" on alert_recipients for all
  using ((auth.jwt() ->> 'app_role') = 'hq')
  with check ((auth.jwt() ->> 'app_role') = 'hq');

-- ---------- 3. Sync failures ----------
create table sync_failures (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references outlets(id),
  device_id text not null,
  table_name text not null,
  error_message text not null,
  payload jsonb,
  created_at timestamptz not null default now(),
  notified boolean not null default false
);

alter table sync_failures enable row level security;

-- Any authenticated staff member can log a failure from their own
-- outlet (or null outlet for an hq/audit device) — this is a
-- diagnostic write, not a financial one, so it's intentionally permissive.
create policy "sync_failures_insert_own_outlet" on sync_failures for insert
  with check (
    outlet_id is null
    or outlet_id::text = (auth.jwt() ->> 'app_outlet_id')
    or (auth.jwt() ->> 'app_role') in ('hq', 'audit')
  );

create policy "sync_failures_select_hq_audit" on sync_failures for select
  using ((auth.jwt() ->> 'app_role') in ('hq', 'audit'));

-- ---------- Trigger: shift closed with a mismatch ----------
create or replace function notify_shift_mismatch()
returns trigger as $$
declare
  v_url text;
  v_secret text;
begin
  if new.status = 'closed'
     and old.status is distinct from 'closed'
     and coalesce(new.mismatch, 0) != 0 then

    select value into v_url from app_config where key = 'alert_function_url';
    select value into v_secret from app_config where key = 'alert_shared_secret';

    if v_url is not null then
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-alert-secret', v_secret
        ),
        body := jsonb_build_object(
          'type', 'shift_mismatch',
          'outlet_id', new.outlet_id,
          'register_id', new.id,
          'shift_label', new.shift_label,
          'mismatch', new.mismatch,
          'expected_closing', new.expected_closing,
          'counted_closing', new.counted_closing,
          'closed_at', new.closed_at
        )
      );
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_notify_shift_mismatch
after update on shift_registers
for each row execute function notify_shift_mismatch();

-- ---------- Trigger: a permanent sync failure was logged ----------
create or replace function notify_sync_failure()
returns trigger as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from app_config where key = 'alert_function_url';
  select value into v_secret from app_config where key = 'alert_shared_secret';

  if v_url is not null then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', v_secret
      ),
      body := jsonb_build_object(
        'type', 'sync_failure',
        'outlet_id', new.outlet_id,
        'table_name', new.table_name,
        'error_message', new.error_message,
        'created_at', new.created_at
      )
    );
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_notify_sync_failure
after insert on sync_failures
for each row execute function notify_sync_failure();


-- ############################################################
-- ## 0022_alert_recipients_email.sql
-- ############################################################

-- ============================================================
-- Phase 3 revision: alerts go by email, not SMS
-- ============================================================
-- SMS to Indian numbers requires TRAI DLT registration (3-10 working
-- days, ~₹5,900 one-time) regardless of provider (Twilio, MSG91, or
-- anyone else) — not feasible on a same-day timeline. Email has no
-- such registration requirement, so alert_recipients switches from
-- phone numbers to email addresses.

alter table alert_recipients rename column phone_number to email;

alter table alert_recipients
  add constraint chk_alert_recipients_email_format
  check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');


-- ############################################################
-- ## 0023_notify_every_shift_close.sql
-- ############################################################

-- ============================================================
-- Phase 3 extension: notify on every shift close, not just mismatches
-- ============================================================
-- Replaces trg_notify_shift_mismatch / notify_shift_mismatch with a
-- broader trg_notify_shift_closed / notify_shift_closed that fires on
-- every close. The Edge Function decides what to do with a clean vs
-- mismatched close (both go to the owner as a receipt; the closing
-- employee only gets their own confirmation copy).

drop trigger if exists trg_notify_shift_mismatch on shift_registers;
drop function if exists notify_shift_mismatch();

create or replace function notify_shift_closed()
returns trigger as $$
declare
  v_url text;
  v_secret text;
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then

    select value into v_url from app_config where key = 'alert_function_url';
    select value into v_secret from app_config where key = 'alert_shared_secret';

    if v_url is not null then
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-alert-secret', v_secret
        ),
        body := jsonb_build_object(
          'type', 'shift_closed',
          'outlet_id', new.outlet_id,
          'register_id', new.id,
          'shift_label', new.shift_label,
          'opened_by', new.opened_by,
          'closed_by', new.closed_by,
          'opening_balance', new.opening_balance,
          'cash_sales', new.cash_sales,
          'cash_collected_old_bills', new.cash_collected_old_bills,
          'online_received', new.online_received,
          'expenses_paid', new.expenses_paid,
          'deposits_made', new.deposits_made,
          'cash_returned', new.cash_returned,
          'credits_refunded', new.credits_refunded,
          'expected_closing', new.expected_closing,
          'counted_closing', new.counted_closing,
          'mismatch', new.mismatch,
          'closed_at', new.closed_at
        )
      );
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_notify_shift_closed
after update on shift_registers
for each row execute function notify_shift_closed();


-- ############################################################
-- ## 0024_shift_register_immutable_after_close.sql
-- ############################################################

-- ============================================================
-- Phase 3 fix: closed shift registers become immutable
-- ============================================================
-- Bug found: closeShift() updated shift_registers with no check
-- that the row was still 'open'. Two consequences:
--
--   1. Race condition — two people closing the same shift within
--      moments of each other: the second UPDATE silently overwrote
--      the first's counted_closing/expected_closing/closed_by, no
--      error, no trace beyond comparing email timestamps.
--
--   2. Tampering — anyone with outlet access could re-run an update
--      against an already-closed register at any later point and
--      quietly change its numbers. Given the whole point of this
--      system is preventing exactly this kind of manipulation, this
--      was a real gap, not just a race-condition edge case.
--
-- Fix: once a shift_registers row has status = 'closed', no further
-- UPDATE of any kind is allowed, ever — mirroring the "bills stay
-- immutable once paid" rule already used elsewhere in this schema.
-- Postgres's row-level locking means this also correctly blocks true
-- concurrent double-close attempts: the second transaction blocks on
-- the row lock, then re-reads OLD as 'closed' once the first commits,
-- and gets rejected — not a best-effort check, a guaranteed one.

create or replace function prevent_shift_register_modification_after_close()
returns trigger as $$
begin
  if old.status = 'closed' then
    raise exception 'This shift register was already closed at % by the recorded closer and can no longer be modified.', old.closed_at
      using errcode = 'P0001';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_prevent_reclose_shift
before update on shift_registers
for each row execute function prevent_shift_register_modification_after_close();


-- ############################################################
-- ## 0025_shift_disputes.sql
-- ############################################################

-- ============================================================
-- Phase 3 extension: 24-hour shift close dispute window
-- ============================================================
-- The employee who closed a shift receives a confirmation email with
-- the full breakdown. This gives them a way to formally flag "that
-- isn't what I counted" within 24 hours of the close.
--
-- Deliberately NOT an edit path: a dispute never changes the closed
-- register's numbers (those stay immutable per migration 0024). It
-- records the disagreement, timestamps it, and alerts HQ — who then
-- investigate out-of-band. This keeps the audit trail honest: the
-- original submission stands as recorded, with the objection attached
-- alongside it rather than overwriting it.

create table shift_disputes (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references shift_registers(id),
  outlet_id uuid not null references outlets(id),
  raised_by uuid not null references app_users(id),
  claimed_counted_closing numeric(12,2),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved')),
  hq_notes text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references app_users(id),
  -- One dispute per register: a second objection to the same close is
  -- a conversation with HQ, not another record.
  unique (register_id)
);

create index idx_shift_disputes_status on shift_disputes(status, created_at desc);
create index idx_shift_disputes_outlet on shift_disputes(outlet_id, created_at desc);

alter table shift_disputes enable row level security;

-- Staff can raise a dispute only on a register at their own outlet
-- that they personally closed. HQ/audit can see everything.
create policy "disputes_insert_own_close" on shift_disputes for insert
  with check (
    raised_by = auth.uid()
    and exists (
      select 1 from shift_registers sr
      where sr.id = register_id
        and sr.closed_by = auth.uid()
    )
  );

create policy "disputes_select" on shift_disputes for select
  using (
    raised_by = auth.uid()
    or (auth.jwt() ->> 'app_role') in ('hq', 'audit', 'manager')
  );

-- Only HQ resolves/annotates a dispute.
create policy "disputes_update_hq" on shift_disputes for update
  using ((auth.jwt() ->> 'app_role') = 'hq')
  with check ((auth.jwt() ->> 'app_role') = 'hq');

-- ---------- Enforce the 24-hour window server-side ----------
-- The UI hides the dispute button after 24h, but the window is a rule,
-- not a display preference — enforce it where it can't be bypassed.

create or replace function enforce_dispute_window()
returns trigger as $$
declare
  v_closed_at timestamptz;
  v_status register_status;
begin
  select closed_at, status into v_closed_at, v_status
  from shift_registers where id = new.register_id;

  if v_status != 'closed' then
    raise exception 'Cannot dispute a shift that has not been closed.'
      using errcode = 'P0001';
  end if;

  if v_closed_at is null or now() > v_closed_at + interval '24 hours' then
    raise exception 'The 24-hour window to dispute this shift close has passed. Contact HQ directly.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_enforce_dispute_window
before insert on shift_disputes
for each row execute function enforce_dispute_window();

-- ---------- Notify HQ immediately when a dispute is raised ----------
create or replace function notify_shift_dispute()
returns trigger as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from app_config where key = 'alert_function_url';
  select value into v_secret from app_config where key = 'alert_shared_secret';

  if v_url is not null then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', v_secret
      ),
      body := jsonb_build_object(
        'type', 'shift_dispute',
        'outlet_id', new.outlet_id,
        'register_id', new.register_id,
        'raised_by', new.raised_by,
        'claimed_counted_closing', new.claimed_counted_closing,
        'reason', new.reason,
        'created_at', new.created_at
      )
    );
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_notify_shift_dispute
after insert on shift_disputes
for each row execute function notify_shift_dispute();


-- ############################################################
-- ## 0026_daily_digest.sql
-- ############################################################

-- ============================================================
-- Phase 3 extension: daily digest email
-- ============================================================
-- Runs once a day per outlet and emails a rollup of the previous
-- day's activity, alongside (not instead of) the per-shift receipts.
--
-- Scheduled at 03:30 UTC = 09:00 IST. pg_cron schedules in UTC only,
-- so the offset is baked in here; if you ever move this, remember it
-- is NOT local time.

create extension if not exists pg_cron;

-- Sends one digest per outlet that had any closed shift in the window.
-- Called by cron (below) with no arguments for "yesterday", or
-- manually with an explicit date to re-send/backfill a specific day.
create or replace function send_daily_digest(p_date date default null)
returns void as $$
declare
  v_url text;
  v_secret text;
  v_date date;
  v_outlet record;
begin
  v_date := coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date - 1);

  select value into v_url from app_config where key = 'alert_function_url';
  select value into v_secret from app_config where key = 'alert_shared_secret';

  if v_url is null then
    return;
  end if;

  -- One digest per outlet with activity that day. Outlets with no
  -- closed shift are skipped entirely rather than sending an empty
  -- email — silence means nothing happened, which for a 24/7 outlet
  -- is itself worth noticing.
  for v_outlet in
    select
      o.id as outlet_id,
      o.name as outlet_name,
      count(*) as shift_count,
      coalesce(sum(sr.cash_sales), 0) as total_cash_sales,
      coalesce(sum(sr.cash_collected_old_bills), 0) as total_old_bills,
      coalesce(sum(sr.online_received), 0) as total_online,
      coalesce(sum(sr.expenses_paid), 0) as total_expenses,
      coalesce(sum(sr.deposits_made), 0) as total_deposits,
      coalesce(sum(sr.cash_returned), 0) as total_returned,
      coalesce(sum(sr.credits_refunded), 0) as total_credits_refunded,
      coalesce(sum(sr.mismatch), 0) as net_mismatch,
      coalesce(sum(abs(sr.mismatch)), 0) as gross_mismatch,
      count(*) filter (where abs(coalesce(sr.mismatch, 0)) > 0.005) as mismatch_count,
      jsonb_agg(
        jsonb_build_object(
          'shift_label', sr.shift_label,
          'closed_at', sr.closed_at,
          'closed_by_name', coalesce(au.full_name, 'Unknown'),
          'expected_closing', sr.expected_closing,
          'counted_closing', sr.counted_closing,
          'mismatch', sr.mismatch
        ) order by sr.closed_at
      ) as shifts
    from shift_registers sr
    join outlets o on o.id = sr.outlet_id
    left join app_users au on au.id = sr.closed_by
    where sr.status = 'closed'
      and (sr.closed_at at time zone 'Asia/Kolkata')::date = v_date
    group by o.id, o.name
  loop
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', v_secret
      ),
      body := jsonb_build_object(
        'type', 'daily_digest',
        'digest_date', v_date,
        'outlet_id', v_outlet.outlet_id,
        'shift_count', v_outlet.shift_count,
        'total_cash_sales', v_outlet.total_cash_sales,
        'total_old_bills', v_outlet.total_old_bills,
        'total_online', v_outlet.total_online,
        'total_expenses', v_outlet.total_expenses,
        'total_deposits', v_outlet.total_deposits,
        'total_returned', v_outlet.total_returned,
        'total_credits_refunded', v_outlet.total_credits_refunded,
        'net_mismatch', v_outlet.net_mismatch,
        'gross_mismatch', v_outlet.gross_mismatch,
        'mismatch_count', v_outlet.mismatch_count,
        'shifts', v_outlet.shifts
      )
    );
  end loop;
end;
$$ language plpgsql security definer set row_security = off;

-- 03:30 UTC = 09:00 IST, daily.
select cron.schedule(
  'daily-shift-digest',
  '30 3 * * *',
  $$select send_daily_digest()$$
);
