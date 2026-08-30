-- ============================================================
-- Phase 2 hotfix: return amount validation + unified entries ledger
-- ============================================================

-- ---------- Fix: nothing capped a return at what was actually paid ----------
-- A cashier could currently enter a return larger than the bill's
-- amount_paid, or multiple partial returns that together exceed it.

create or replace function check_return_amount()
returns trigger as $$
declare
  v_paid numeric;
  v_already_returned numeric;
begin
  select amount_paid into v_paid from bills where id = new.original_bill_id;
  select coalesce(sum(amount_returned), 0) into v_already_returned
  from returns where original_bill_id = new.original_bill_id;

  if new.amount_returned > (v_paid - v_already_returned) then
    raise exception 'Return amount (%) exceeds the remaining returnable amount on this bill (%)',
      new.amount_returned, v_paid - v_already_returned;
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_check_return_amount
before insert on returns
for each row execute function check_return_amount();

-- ---------- Unified ledger for the dashboard entries table ----------
-- security_invoker=true is required here: without it, a view runs
-- with its OWNER's privileges (bypassing RLS on bills/payments/etc
-- entirely) rather than the querying user's — a real security hole
-- if left at the Postgres default.

create view register_entries
with (security_invoker = true) as
select
  b.register_id,
  b.outlet_id,
  'bill'::text as entry_type,
  b.bill_amount as amount,
  'Bill ' || b.bill_serial || ' (' || b.bill_type || ')' as description,
  b.created_by,
  au1.full_name as created_by_name,
  b.created_at
from bills b
join app_users au1 on au1.id = b.created_by
union all
select
  p.register_id,
  p.outlet_id,
  'payment'::text,
  p.amount,
  'Payment (' || p.mode || ')',
  p.received_by,
  au2.full_name,
  p.received_at
from payments p
join app_users au2 on au2.id = p.received_by
union all
select
  e.register_id,
  e.outlet_id,
  'expense'::text,
  e.amount,
  'Expense: ' || e.reason,
  e.created_by,
  au3.full_name,
  e.created_at
from expenses e
join app_users au3 on au3.id = e.created_by
union all
select
  d.register_id,
  d.outlet_id,
  'deposit'::text,
  d.amount,
  'Cash deposit' || coalesce(' (' || d.bank_reference || ')', ''),
  d.deposited_by,
  au4.full_name,
  d.created_at
from cash_deposits d
join app_users au4 on au4.id = d.deposited_by
union all
select
  r.register_id,
  r.outlet_id,
  'return'::text,
  -r.amount_returned,
  'Return: ' || r.reason,
  r.created_by,
  au5.full_name,
  r.created_at
from returns r
join app_users au5 on au5.id = r.created_by;
