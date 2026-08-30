-- ============================================================
-- Phase 2 hotfix: walk-in bill + full payment must be atomic
-- ============================================================
-- Bug: chk_carry_forward (from 0001) requires balance_due = 0 on a
-- walk-in bill at the moment it's inserted. But balance_due only
-- reaches 0 once a payment row references the bill — which requires
-- the bill to already exist (payments.bill_id is a FK). Two separate
-- REST inserts can never satisfy this: the bill insert always fails
-- the check before the payment can exist, and the payment then fails
-- its FK because the bill never got created either.
--
-- Fix: convert the CHECK into a deferred constraint trigger (checked
-- at transaction commit, not per-statement), and add an RPC that
-- creates the bill + payment inside one transaction/function call —
-- so by the time the deferred check runs, both rows already exist.

alter table bills drop constraint if exists chk_carry_forward;

create or replace function check_carry_forward_rule()
returns trigger as $$
begin
  if new.bill_type != 'admitted_patient'
     and new.status != 'cancelled'
     and new.balance_due != 0 then
    raise exception 'Walk-in bills must be paid in full by the end of the transaction (bill %, balance_due %)', new.bill_serial, new.balance_due;
  end if;
  return new;
end;
$$ language plpgsql;

create constraint trigger trg_chk_carry_forward
after insert or update on bills
deferrable initially deferred
for each row execute function check_carry_forward_rule();

-- Atomic walk-in sale: bill + full payment in a single transaction.
-- security invoker (default) so it still runs as the calling user —
-- existing RLS/insert policies on bills and payments still apply,
-- this just removes the two-separate-REST-calls timing problem.
create or replace function record_walk_in_sale(
  p_outlet_id uuid,
  p_bill_serial text,
  p_bill_amount numeric,
  p_payment_amount numeric,
  p_payment_mode payment_mode,
  p_gateway_reference text,
  p_created_by uuid
) returns bills as $$
declare
  v_bill_id uuid;
  v_result bills;
begin
  if p_payment_amount != p_bill_amount then
    raise exception 'Walk-in bills must be paid in full: bill amount % does not match payment amount %', p_bill_amount, p_payment_amount;
  end if;

  insert into bills (outlet_id, bill_serial, bill_type, admission_id, bill_amount, register_date, created_by)
  values (p_outlet_id, p_bill_serial, 'walk_in', null, p_bill_amount, current_date, p_created_by)
  returning id into v_bill_id;

  insert into payments (bill_id, outlet_id, amount, mode, gateway_reference, register_date, received_by)
  values (v_bill_id, p_outlet_id, p_payment_amount, p_payment_mode, p_gateway_reference, current_date, p_created_by);

  select * into v_result from bills where id = v_bill_id;
  return v_result;
end;
$$ language plpgsql;

grant execute on function record_walk_in_sale(uuid, text, numeric, numeric, payment_mode, text, uuid) to authenticated;
