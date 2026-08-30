-- ============================================================
-- Phase 2C: Sales returns
-- ============================================================
-- A return never edits the original bill (bills stay immutable
-- once paid — the POS remains the system of record for the bill
-- itself). This just logs the cash-out + stock-reversal event and
-- feeds it into the current shift's close math. No commission or
-- margin logic here — that stays entirely in the POS.

create table returns (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id),
  original_bill_id uuid not null references bills(id),
  register_id uuid references shift_registers(id),
  amount_returned numeric(12,2) not null check (amount_returned > 0),
  reason text not null,
  stock_reversed boolean not null default false,
  approved_by uuid not null references app_users(id),
  created_by uuid not null references app_users(id),
  register_date date not null,
  created_at timestamptz not null default now()
);

create index idx_returns_outlet_date on returns(outlet_id, register_date);
create index idx_returns_bill on returns(original_bill_id);
create index idx_returns_register on returns(register_id);

alter table returns enable row level security;

create policy "returns_select" on returns for select
  using (can_access_outlet(outlet_id));
create policy "returns_insert" on returns for insert
  with check (can_access_outlet(outlet_id));

-- Bind to the currently open shift register, same as other transactions.
create trigger trg_stamp_register_returns before insert on returns
  for each row execute function stamp_current_register();

-- Manager/HQ approval required — enforced server-side, not just in the UI.
create or replace function check_return_approver()
returns trigger as $$
declare
  v_role user_role;
begin
  select role into v_role from app_users where id = new.approved_by;
  if v_role is null or v_role not in ('manager', 'hq') then
    raise exception 'Returns must be approved by a manager or HQ user';
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_check_return_approver
before insert on returns
for each row execute function check_return_approver();

create trigger trg_audit_returns after insert on returns
  for each row execute function log_audit();

-- Mirrors trg_apply_payment: every return accumulates into the
-- open register's cash_returned, same pattern as payments -> bills.
create or replace function apply_return_to_register()
returns trigger as $$
begin
  update shift_registers
  set cash_returned = cash_returned + new.amount_returned
  where id = new.register_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_apply_return
after insert on returns
for each row execute function apply_return_to_register();
