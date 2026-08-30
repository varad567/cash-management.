-- ============================================================
-- Close the flagged gap: credit refunds now feed reconciliation
-- ============================================================
-- A refund can happen in a different shift than the credit was
-- originally created in, so its cash impact must be attributed to
-- whichever register is OPEN AT REFUND TIME — same reasoning as why
-- payments distinguish "same shift" vs "old bill collection" rather
-- than using the bill's original register.
--
-- Also closes a related gap: there was no refunded_by column, so the
-- audit trail would show a credit was refunded but not who did it —
-- inconsistent with every other cash-out action in this schema.

alter table customer_credits
  add column refunded_register_id uuid references shift_registers(id),
  add column refunded_by uuid references app_users(id);

alter table shift_registers
  add column credits_refunded numeric(12,2) not null default 0;

-- Replaces the placeholder from migration 0019 (which only set
-- resolved_at) with the real stamping logic.
create or replace function refund_customer_credit()
returns trigger as $$
declare
  v_register_id uuid;
begin
  if new.status = 'refunded' and old.status != 'refunded' then
    select id into v_register_id
    from shift_registers
    where outlet_id = new.outlet_id and status = 'open'
    limit 1;

    if v_register_id is null then
      raise exception 'No open shift register for this outlet — open a shift before refunding a credit';
    end if;

    new.refunded_register_id := v_register_id;
    new.refunded_by := auth.uid();
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create or replace function apply_credit_refund_to_register()
returns trigger as $$
begin
  if new.status = 'refunded' and old.status != 'refunded' then
    update shift_registers
    set credits_refunded = credits_refunded + new.amount
    where id = new.refunded_register_id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_apply_credit_refund_to_register
after update on customer_credits
for each row execute function apply_credit_refund_to_register();

-- ---------- Add credit refunds to the unified ledger view ----------
create or replace view register_entries
with (security_invoker = true) as
select
  b.register_id, b.outlet_id, 'bill'::text as entry_type, b.bill_amount as amount,
  'Bill ' || b.bill_serial || ' (' || b.bill_type || ')' as description,
  b.created_by, coalesce(au1.full_name, 'Staff member') as created_by_name, b.created_at
from bills b
left join app_users au1 on au1.id = b.created_by
union all
select
  p.register_id, p.outlet_id, 'payment'::text, p.amount,
  'Payment (' || p.mode || ')',
  p.received_by, coalesce(au2.full_name, 'Staff member'), p.received_at
from payments p
left join app_users au2 on au2.id = p.received_by
union all
select
  e.register_id, e.outlet_id, 'expense'::text, e.amount,
  'Expense: ' || e.reason,
  e.created_by, coalesce(au3.full_name, 'Staff member'), e.created_at
from expenses e
left join app_users au3 on au3.id = e.created_by
union all
select
  d.register_id, d.outlet_id, 'deposit'::text, d.amount,
  'Cash deposit' || coalesce(' (' || d.bank_reference || ')', ''),
  d.deposited_by, coalesce(au4.full_name, 'Staff member'), d.created_at
from cash_deposits d
left join app_users au4 on au4.id = d.deposited_by
union all
select
  r.register_id, r.outlet_id, 'return'::text, -r.amount_returned,
  'Return: ' || r.reason,
  r.created_by, coalesce(au5.full_name, 'Staff member'), r.created_at
from returns r
left join app_users au5 on au5.id = r.created_by
union all
select
  cc.refunded_register_id as register_id, cc.outlet_id, 'credit_refund'::text, -cc.amount,
  'Credit refund: ' || cc.reason,
  cc.refunded_by, coalesce(au6.full_name, 'Staff member'), cc.resolved_at
from customer_credits cc
left join app_users au6 on au6.id = cc.refunded_by
where cc.status = 'refunded';
