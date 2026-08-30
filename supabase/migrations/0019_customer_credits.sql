-- ============================================================
-- Customer credits: the last unbuilt Phase 1 feature
-- ============================================================
-- customer_credits had a schema and RLS since migration 0001 but no
-- register_id (added to every other transaction table in 0006) and
-- no way to actually consume a held credit. This adds both.

alter table customer_credits add column register_id uuid references shift_registers(id);
create index idx_credits_register on customer_credits(register_id);

create trigger trg_stamp_register_credits before insert on customer_credits
  for each row execute function stamp_current_register();

-- Cross-outlet integrity, matching the pattern from migration 0013.
create or replace function check_credit_matches_bill_outlet()
returns trigger as $$
declare
  v_bill_outlet uuid;
begin
  if new.bill_id is not null then
    select outlet_id into v_bill_outlet from bills where id = new.bill_id;
    if v_bill_outlet is distinct from new.outlet_id then
      raise exception 'Credit outlet does not match the outlet of the originating bill';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_check_credit_bill_outlet
before insert on customer_credits
for each row execute function check_credit_matches_bill_outlet();

-- Atomically apply a held credit against a bill: creates a payment
-- (the credit is real cash already collected, just excess) and marks
-- the credit adjusted. Same atomic-transaction pattern as
-- record_walk_in_sale, for the same reason — two separate writes
-- could leave the credit "used" with no payment ever created, or a
-- payment created against a credit that failed to update.
create or replace function use_customer_credit(
  p_credit_id uuid,
  p_bill_id uuid,
  p_used_by uuid
) returns void as $$
declare
  v_credit customer_credits;
  v_bill bills;
begin
  select * into v_credit from customer_credits where id = p_credit_id and status = 'held';
  if v_credit.id is null then
    raise exception 'Credit not found, or already used/refunded';
  end if;

  select * into v_bill from bills where id = p_bill_id;
  if v_bill.id is null then
    raise exception 'Target bill not found';
  end if;
  if v_bill.outlet_id != v_credit.outlet_id then
    raise exception 'Credit and bill must belong to the same outlet';
  end if;
  if v_credit.amount > v_bill.balance_due then
    raise exception 'Credit amount (%) exceeds the bill''s remaining balance (%)',
      v_credit.amount, v_bill.balance_due;
  end if;

  insert into payments (bill_id, outlet_id, amount, mode, register_date, received_by)
  values (p_bill_id, v_credit.outlet_id, v_credit.amount, 'cash', current_date, p_used_by);

  update customer_credits
  set status = 'adjusted', used_against_bill_id = p_bill_id, resolved_at = now()
  where id = p_credit_id;
end;
$$ language plpgsql;

grant execute on function use_customer_credit(uuid, uuid, uuid) to authenticated;

-- Refunding a credit (handing the cash back) doesn't touch a bill —
-- just closes it out. NOTE: unlike every other cash-out path in this
-- app (expenses, deposits, returns), this does NOT currently feed
-- into the open register's totals — there's no "credit refunds"
-- bucket in shift_registers. A refund here will not appear in the
-- shift-close reconciliation math. This is a known limitation, not
-- an oversight: adding a new bucket touches the register schema,
-- the close-shift math, and every dashboard that displays it, and
-- credits are described as an occasional edge case, not routine
-- volume — flagging clearly rather than quietly shipping a partial
-- fix to the reconciliation math.
create or replace function refund_customer_credit()
returns trigger as $$
begin
  if new.status = 'refunded' and old.status != 'refunded' then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_refund_customer_credit
before update on customer_credits
for each row execute function refund_customer_credit();
