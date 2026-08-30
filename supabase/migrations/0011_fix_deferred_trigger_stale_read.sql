-- ============================================================
-- Phase 2 hotfix 2: deferred trigger was checking a stale NEW
-- ============================================================
-- Bug in migration 0009's fix: a deferred constraint trigger only
-- delays WHEN its function runs (until commit) — it does NOT refresh
-- the NEW row to reflect later changes in the same transaction. NEW
-- is still the tuple as it looked at the moment the original INSERT
-- ran (bill just created, amount_paid = 0, balance_due = full
-- amount). So even with deferral, the check was still failing on the
-- pre-payment snapshot, not the post-payment one — the atomic RPC
-- didn't help, because the check itself never looked at the bill's
-- final state.
--
-- Fix: re-query the bill by id from the table when the trigger
-- fires, instead of trusting NEW. At that point (commit time, after
-- the RPC's payment insert has already updated amount_paid) the
-- re-queried row reflects the true final state.

create or replace function check_carry_forward_rule()
returns trigger as $$
declare
  v_current bills;
begin
  select * into v_current from bills where id = new.id;

  if v_current.bill_type != 'admitted_patient'
     and v_current.status != 'cancelled'
     and v_current.balance_due != 0 then
    raise exception 'Walk-in bills must be paid in full by the end of the transaction (bill %, balance_due %)',
      v_current.bill_serial, v_current.balance_due;
  end if;
  return new;
end;
$$ language plpgsql;

-- No need to recreate the trigger itself — it already points at this
-- function by name, so the fix takes effect immediately.
