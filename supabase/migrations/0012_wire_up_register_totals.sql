-- ============================================================
-- Phase 2 hotfix 3: shift register totals were never live
-- ============================================================
-- Audit finding: cash_sales, cash_collected_old_bills,
-- online_received, expenses_paid, and deposits_made are all declared
-- on shift_registers and read everywhere (dashboard, shift-close
-- math, the mismatch calculation) — but no trigger anywhere ever
-- wrote to them. Only cash_returned (added in migration 0008) was
-- ever actually kept live. The core reconciliation math has been
-- silently running against zeros regardless of real activity.
--
-- Fix: mirror the same pattern already used for cash_returned
-- (apply_return_to_register in 0008) for every other bucket.

-- ---------- Payments: cash sale vs old-bill collection vs online ----------
-- A cash payment counts as a NEW sale if it's paid in the same shift
-- the bill was created; if the bill was created in an earlier shift
-- (a carried-forward admitted-patient balance), it's an old-bill
-- collection instead. Online payments go to a single bucket
-- regardless of which shift the bill originated in, matching the
-- original schema (there's only one online_received column).
create or replace function apply_payment_to_register()
returns trigger as $$
declare
  v_bill_register_id uuid;
begin
  select register_id into v_bill_register_id from bills where id = new.bill_id;

  if new.mode = 'online' then
    update shift_registers set online_received = online_received + new.amount
    where id = new.register_id;
  elsif new.register_id = v_bill_register_id then
    update shift_registers set cash_sales = cash_sales + new.amount
    where id = new.register_id;
  else
    update shift_registers set cash_collected_old_bills = cash_collected_old_bills + new.amount
    where id = new.register_id;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_apply_payment_to_register
after insert on payments
for each row execute function apply_payment_to_register();

-- ---------- Expenses ----------
create or replace function apply_expense_to_register()
returns trigger as $$
begin
  update shift_registers set expenses_paid = expenses_paid + new.amount
  where id = new.register_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_apply_expense_to_register
after insert on expenses
for each row execute function apply_expense_to_register();

-- ---------- Cash deposits (drawer -> bank) ----------
create or replace function apply_deposit_to_register()
returns trigger as $$
begin
  update shift_registers set deposits_made = deposits_made + new.amount
  where id = new.register_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_apply_deposit_to_register
after insert on cash_deposits
for each row execute function apply_deposit_to_register();

-- ---------- Defense-in-depth: non-negative at the DB level too ----------
-- Every contributing table already has amount > 0, so these running
-- totals can never legitimately go negative from trigger activity —
-- these constraints just make sure user-entered fields (opening
-- balance, counted closing) can't either.
alter table shift_registers
  add constraint chk_opening_balance_nonneg check (opening_balance >= 0),
  add constraint chk_counted_closing_nonneg check (counted_closing is null or counted_closing >= 0);
