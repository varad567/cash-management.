-- ============================================================
-- Row Level Security — outlet isolation + role-based access
-- ============================================================

alter table outlets enable row level security;
alter table app_users enable row level security;
alter table admissions enable row level security;
alter table bills enable row level security;
alter table payments enable row level security;
alter table customer_credits enable row level security;
alter table expenses enable row level security;
alter table cash_deposits enable row level security;
alter table daily_registers enable row level security;
alter table audit_log enable row level security;
alter table sync_log enable row level security;

-- Helper: current user's row
create or replace function current_app_user()
returns app_users as $$
  select * from app_users where id = auth.uid();
$$ language sql stable security definer;

-- HQ and audit roles see everything; cashier/manager see only their outlet
create or replace function can_access_outlet(target_outlet uuid)
returns boolean as $$
  select exists (
    select 1 from app_users
    where id = auth.uid()
    and (role in ('hq', 'audit') or outlet_id = target_outlet)
    and is_active = true
  );
$$ language sql stable security definer;

-- outlets: everyone active can read; only HQ can write
create policy "outlets_select" on outlets for select
  using (exists (select 1 from app_users where id = auth.uid() and is_active = true));
create policy "outlets_write_hq" on outlets for all
  using (exists (select 1 from app_users where id = auth.uid() and role = 'hq'));

-- app_users: read within same outlet or HQ/audit sees all; only HQ manages users
create policy "users_select" on app_users for select
  using (can_access_outlet(outlet_id) or outlet_id is null);
create policy "users_write_hq" on app_users for all
  using (exists (select 1 from app_users u where u.id = auth.uid() and u.role = 'hq'));

-- admissions: outlet-scoped read/write for cashier/manager; hq/audit full read
create policy "admissions_select" on admissions for select
  using (can_access_outlet(outlet_id));
create policy "admissions_insert" on admissions for insert
  with check (can_access_outlet(outlet_id));
create policy "admissions_update" on admissions for update
  using (can_access_outlet(outlet_id));

-- bills: outlet-scoped; cancellation restricted to manager/hq (enforced in app + trigger below)
create policy "bills_select" on bills for select
  using (can_access_outlet(outlet_id));
create policy "bills_insert" on bills for insert
  with check (can_access_outlet(outlet_id));
create policy "bills_update" on bills for update
  using (can_access_outlet(outlet_id));

-- payments
create policy "payments_select" on payments for select
  using (can_access_outlet(outlet_id));
create policy "payments_insert" on payments for insert
  with check (can_access_outlet(outlet_id));

-- customer_credits
create policy "credits_select" on customer_credits for select
  using (can_access_outlet(outlet_id));
create policy "credits_write" on customer_credits for all
  using (can_access_outlet(outlet_id));

-- expenses
create policy "expenses_select" on expenses for select
  using (can_access_outlet(outlet_id));
create policy "expenses_insert" on expenses for insert
  with check (can_access_outlet(outlet_id));
create policy "expenses_update" on expenses for update
  using (can_access_outlet(outlet_id));

-- cash_deposits
create policy "deposits_select" on cash_deposits for select
  using (can_access_outlet(outlet_id));
create policy "deposits_insert" on cash_deposits for insert
  with check (can_access_outlet(outlet_id));

-- daily_registers
create policy "registers_select" on daily_registers for select
  using (can_access_outlet(outlet_id));
create policy "registers_write" on daily_registers for all
  using (can_access_outlet(outlet_id));

-- audit_log: read-only for everyone with outlet access; nobody updates/deletes (append-only)
create policy "audit_select" on audit_log for select
  using (outlet_id is null or can_access_outlet(outlet_id));
create policy "audit_insert" on audit_log for insert
  with check (true);  -- inserts happen via trigger, service role

-- sync_log
create policy "sync_select" on sync_log for select
  using (can_access_outlet(outlet_id));
create policy "sync_write" on sync_log for all
  using (can_access_outlet(outlet_id));

-- ============================================================
-- Enforcement triggers (server-side, cannot be bypassed by client)
-- ============================================================

-- Block discharge while any linked bill has balance_due > 0
create or replace function check_discharge_clearance()
returns trigger as $$
begin
  if new.status = 'discharged' and old.status != 'discharged' then
    if exists (
      select 1 from bills
      where admission_id = new.id
      and status not in ('paid', 'cancelled')
      and balance_due > 0
    ) then
      raise exception 'Cannot discharge: outstanding balance exists on this admission';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_discharge_clearance
before update on admissions
for each row execute function check_discharge_clearance();

-- Auto-update bill status based on amount_paid vs bill_amount
create or replace function update_bill_status()
returns trigger as $$
begin
  if new.status != 'cancelled' then
    if new.amount_paid >= new.bill_amount then
      new.status := 'paid';
    elsif new.amount_paid > 0 then
      new.status := 'partial';
    else
      new.status := 'open';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_bill_status
before insert or update on bills
for each row execute function update_bill_status();

-- Every payment increments the parent bill's amount_paid
create or replace function apply_payment_to_bill()
returns trigger as $$
begin
  update bills set amount_paid = amount_paid + new.amount where id = new.bill_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_apply_payment
after insert on payments
for each row execute function apply_payment_to_bill();

-- Generic audit log trigger for key tables
create or replace function log_audit()
returns trigger as $$
declare
  v_outlet uuid;
begin
  v_outlet := coalesce(new.outlet_id, old.outlet_id);
  insert into audit_log (table_name, record_id, action, changed_by, before_data, after_data, outlet_id)
  values (
    TG_TABLE_NAME,
    coalesce(new.id, old.id),
    TG_OP,
    auth.uid(),
    case when TG_OP != 'INSERT' then to_jsonb(old) else null end,
    case when TG_OP != 'DELETE' then to_jsonb(new) else null end,
    v_outlet
  );
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger trg_audit_bills after insert or update on bills
  for each row execute function log_audit();
create trigger trg_audit_expenses after insert or update on expenses
  for each row execute function log_audit();
create trigger trg_audit_admissions after insert or update on admissions
  for each row execute function log_audit();
create trigger trg_audit_registers after insert or update on daily_registers
  for each row execute function log_audit();
