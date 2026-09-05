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
