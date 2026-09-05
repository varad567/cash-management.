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
