-- ============================================================
-- Phase 2 audit pass: money-safety + data-integrity fixes
-- ============================================================

-- ---------- 1. Overpayment was never blocked ----------
-- balance_due is bill_amount - amount_paid; nothing stopped it going
-- negative. This check makes an overpaying UPDATE (triggered by
-- apply_payment_to_bill) fail with a proper 23514 — which the
-- frontend's offline queue already treats as a permanent error, so
-- it surfaces cleanly instead of corrupting the balance silently.
alter table bills
  add constraint chk_balance_due_nonneg check (balance_due >= 0);

-- ---------- 2. Cross-outlet data integrity ----------
-- Nothing previously checked that a payment/return's outlet actually
-- matches the outlet of the bill it references, or that a bill's
-- admission is at the same outlet as the bill. The UI never
-- constructs a mismatched request today, but nothing at the DB level
-- stopped one either.

create or replace function check_payment_matches_bill_outlet()
returns trigger as $$
declare
  v_bill_outlet uuid;
begin
  select outlet_id into v_bill_outlet from bills where id = new.bill_id;
  if v_bill_outlet is distinct from new.outlet_id then
    raise exception 'Payment outlet does not match the outlet of the bill it references';
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_check_payment_outlet
before insert on payments
for each row execute function check_payment_matches_bill_outlet();

create or replace function check_return_matches_bill_outlet()
returns trigger as $$
declare
  v_bill_outlet uuid;
begin
  select outlet_id into v_bill_outlet from bills where id = new.original_bill_id;
  if v_bill_outlet is distinct from new.outlet_id then
    raise exception 'Return outlet does not match the outlet of the bill it references';
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_check_return_outlet
before insert on returns
for each row execute function check_return_matches_bill_outlet();

create or replace function check_bill_matches_admission_outlet()
returns trigger as $$
declare
  v_admission_outlet uuid;
begin
  if new.admission_id is not null then
    select outlet_id into v_admission_outlet from admissions where id = new.admission_id;
    if v_admission_outlet is distinct from new.outlet_id then
      raise exception 'Bill outlet does not match the outlet of the admission it references';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_check_bill_admission_outlet
before insert or update on bills
for each row execute function check_bill_matches_admission_outlet();

-- ---------- 3. Return approver must be a manager at the SAME outlet ----------
-- Previously only checked role, not outlet — a manager from a
-- different outlet could be recorded as the approver.
create or replace function check_return_approver()
returns trigger as $$
declare
  v_role user_role;
  v_outlet uuid;
begin
  select role, outlet_id into v_role, v_outlet from app_users where id = new.approved_by;
  if v_role is null or v_role not in ('manager', 'hq') then
    raise exception 'Returns must be approved by a manager or HQ user';
  end if;
  if v_role = 'manager' and v_outlet is distinct from new.outlet_id then
    raise exception 'Approving manager must belong to the same outlet as the return';
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

-- ---------- 4. register_entries: INNER JOIN silently drops rows ----------
-- If an entry was created by an HQ-level user (outlet_id is null),
-- a cashier's RLS can't see that app_users row — with an INNER JOIN
-- that means the whole entry vanishes from their ledger, not just
-- the name. LEFT JOIN + a fallback label fixes this.
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
left join app_users au5 on au5.id = r.created_by;
