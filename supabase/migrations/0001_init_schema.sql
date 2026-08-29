-- ============================================================
-- Cash Management + Patient Registration — Phase 1 schema
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Outlets & Users ----------

create table outlets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create type user_role as enum ('cashier', 'manager', 'audit', 'hq');

create table app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  outlet_id uuid references outlets(id),
  full_name text not null,
  role user_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
-- HQ/audit roles may have outlet_id = null (cross-outlet access)

-- ---------- Patient Registration module ----------

create type admission_status as enum ('admitted', 'discharged');

create table admissions (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id),
  patient_name text not null,
  ward_bed text,
  referring_doctor text,
  admitted_at timestamptz not null default now(),
  discharged_at timestamptz,
  status admission_status not null default 'admitted',
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now()
);

create index idx_admissions_outlet on admissions(outlet_id);
create index idx_admissions_status on admissions(status);

-- ---------- Billing ----------

create type bill_type as enum ('admitted_patient', 'walk_in');
create type bill_status as enum ('open', 'partial', 'paid', 'cancelled');

create table bills (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id),
  bill_serial text not null,               -- matches POS-generated serial
  bill_type bill_type not null,
  admission_id uuid references admissions(id),
  bill_amount numeric(12,2) not null check (bill_amount >= 0),
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0),
  balance_due numeric(12,2) generated always as (bill_amount - amount_paid) stored,
  status bill_status not null default 'open',
  cancelled_reason text,
  cancelled_by uuid references app_users(id),
  cancelled_at timestamptz,
  register_date date not null,             -- which day's register this bill counts toward
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  unique (outlet_id, bill_serial),
  -- enforce: only admitted_patient bills may carry a balance
  constraint chk_carry_forward check (
    bill_type = 'admitted_patient' or balance_due = 0 or status = 'cancelled'
  ),
  constraint chk_admission_link check (
    (bill_type = 'admitted_patient' and admission_id is not null) or
    (bill_type = 'walk_in' and admission_id is null)
  )
);

create index idx_bills_outlet_date on bills(outlet_id, register_date);
create index idx_bills_admission on bills(admission_id);
create index idx_bills_status on bills(status);

-- ---------- Payments (multi-mode per bill) ----------

create type payment_mode as enum ('cash', 'online');

create table payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id),
  outlet_id uuid not null references outlets(id),
  amount numeric(12,2) not null check (amount > 0),
  mode payment_mode not null,
  gateway_reference text,                  -- required for online, reconciled against gateway
  register_date date not null,             -- day this payment counts toward (actual event time, not sync time)
  received_by uuid not null references app_users(id),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_payments_bill on payments(bill_id);
create index idx_payments_outlet_date on payments(outlet_id, register_date);

-- ---------- Customer credits (round-up / excess) ----------

create type credit_status as enum ('held', 'adjusted', 'refunded');

create table customer_credits (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id),
  bill_id uuid references bills(id),        -- originating bill, if any
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  status credit_status not null default 'held',
  used_against_bill_id uuid references bills(id),
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ---------- Expenses ----------

create table expenses (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  receipt_url text,
  requires_hq_approval boolean not null default false,
  approved_by uuid references app_users(id),
  approved_at timestamptz,
  register_date date not null,
  created_by uuid not null references app_users(id),
  created_at timestamptz not null default now()
);

create index idx_expenses_outlet_date on expenses(outlet_id, register_date);

-- ---------- Cash deposits (drawer -> bank) ----------

create table cash_deposits (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id),
  amount numeric(12,2) not null check (amount > 0),
  bank_reference text,
  deposited_by uuid not null references app_users(id),
  register_date date not null,
  created_at timestamptz not null default now()
);

create index idx_deposits_outlet_date on cash_deposits(outlet_id, register_date);

-- ---------- Daily register (the reconciliation anchor) ----------

create type register_status as enum ('open', 'pending_sync', 'closed', 'flagged');

create table daily_registers (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id),
  register_date date not null,
  opening_balance numeric(12,2) not null,
  -- computed fields kept as columns (not generated) so they can be locked once closed
  cash_sales numeric(12,2) not null default 0,
  cash_collected_old_bills numeric(12,2) not null default 0,
  online_received numeric(12,2) not null default 0,
  expenses_paid numeric(12,2) not null default 0,
  deposits_made numeric(12,2) not null default 0,
  expected_closing numeric(12,2),
  counted_closing numeric(12,2),
  mismatch numeric(12,2),
  status register_status not null default 'open',
  closed_by uuid references app_users(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (outlet_id, register_date)
);

create index idx_registers_outlet_date on daily_registers(outlet_id, register_date);

-- ---------- Audit log (every mutation, everywhere) ----------

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  action text not null,               -- insert / update / cancel / approve
  changed_by uuid not null references app_users(id),
  reason text,
  before_data jsonb,
  after_data jsonb,
  outlet_id uuid references outlets(id),
  created_at timestamptz not null default now()
);

create index idx_audit_table_record on audit_log(table_name, record_id);
create index idx_audit_outlet_date on audit_log(outlet_id, created_at);

-- ---------- Offline sync support ----------
-- Client-generated local IDs are mapped to server IDs on sync so
-- entries created offline never collide across outlets/devices.

create table sync_log (
  id uuid primary key default gen_random_uuid(),
  local_id text not null,             -- client-generated (device+timestamp+random)
  table_name text not null,
  server_id uuid,                      -- filled once synced
  outlet_id uuid not null references outlets(id),
  device_id text not null,
  synced_at timestamptz,
  created_offline_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (local_id, device_id)
);
