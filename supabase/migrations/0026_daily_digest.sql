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
