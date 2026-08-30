-- ============================================================
-- Phase 2A: Shift-based register model
-- ============================================================
-- Outlets run 24/7 with a variable number of shifts per day per
-- outlet (no fixed 2/3-shift pattern), so reconciliation moves
-- from "one row per outlet per day" to "one row per shift
-- instance", opened and closed explicitly by cashiers.

alter table daily_registers rename to shift_registers;

-- The old (outlet_id, register_date) uniqueness no longer holds —
-- multiple shifts can share a date. Drop it; a partial unique index
-- below enforces the real invariant (one OPEN register per outlet).
alter table shift_registers
  drop constraint if exists daily_registers_outlet_id_register_date_key;

alter table shift_registers
  add column opened_at timestamptz not null default now(),
  add column opened_by uuid references app_users(id),
  add column previous_register_id uuid references shift_registers(id),
  add column shift_label text,               -- free-text, e.g. "Morning" — informational only
  add column cash_returned numeric(12,2) not null default 0;

-- Only one open register per outlet at a time.
create unique index idx_one_open_register_per_outlet
  on shift_registers(outlet_id)
  where status = 'open';

create index idx_registers_previous on shift_registers(previous_register_id);

-- ---------- Shift-open enforcement ----------
-- A new shift must chain to the most recently closed register for
-- that outlet, and its opening_balance must equal that register's
-- confirmed counted_closing (the mandatory handover count). The
-- very first shift ever opened for an outlet has no predecessor.

create or replace function enforce_shift_open_rules()
returns trigger as $$
declare
  v_prev shift_registers;
begin
  select * into v_prev
  from shift_registers
  where outlet_id = new.outlet_id and status = 'closed'
  order by closed_at desc
  limit 1;

  if v_prev.id is not null then
    if new.previous_register_id is null or new.previous_register_id != v_prev.id then
      raise exception 'New shift must chain to the most recently closed register for this outlet (expected previous_register_id = %)', v_prev.id;
    end if;
    if new.counted_closing is not null and v_prev.counted_closing is null then
      raise exception 'Previous register has no confirmed closing count';
    end if;
    if new.opening_balance is distinct from v_prev.counted_closing then
      raise exception 'Opening balance (%) must match the previous shift''s confirmed counted_closing (%)', new.opening_balance, v_prev.counted_closing;
    end if;
  else
    if new.previous_register_id is not null then
      raise exception 'No previous closed register exists for this outlet; previous_register_id must be null for the first shift';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_enforce_shift_open
before insert on shift_registers
for each row execute function enforce_shift_open_rules();

-- Closing requires a counted_closing value — no closing a register blind.
create or replace function enforce_shift_close_rules()
returns trigger as $$
begin
  if new.status = 'closed' and old.status != 'closed' then
    if new.counted_closing is null then
      raise exception 'Cannot close a shift without a confirmed counted_closing amount';
    end if;
    new.mismatch := coalesce(new.counted_closing, 0) - coalesce(new.expected_closing, 0);
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_enforce_shift_close
before update on shift_registers
for each row execute function enforce_shift_close_rules();

-- ---------- Bind transactions to the currently open register ----------
-- register_id is stamped server-side (never trusted from the client)
-- so a shift can't be attributed retroactively or across outlets.

alter table bills add column register_id uuid references shift_registers(id);
alter table payments add column register_id uuid references shift_registers(id);
alter table expenses add column register_id uuid references shift_registers(id);
alter table cash_deposits add column register_id uuid references shift_registers(id);

create index idx_bills_register on bills(register_id);
create index idx_payments_register on payments(register_id);
create index idx_expenses_register on expenses(register_id);
create index idx_deposits_register on cash_deposits(register_id);

create or replace function stamp_current_register()
returns trigger as $$
declare
  v_register_id uuid;
begin
  select id into v_register_id
  from shift_registers
  where outlet_id = new.outlet_id and status = 'open'
  limit 1;

  if v_register_id is null then
    raise exception 'No open shift register for this outlet — open a shift before recording transactions';
  end if;

  new.register_id := v_register_id;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_stamp_register_bills before insert on bills
  for each row execute function stamp_current_register();
create trigger trg_stamp_register_payments before insert on payments
  for each row execute function stamp_current_register();
create trigger trg_stamp_register_expenses before insert on expenses
  for each row execute function stamp_current_register();
create trigger trg_stamp_register_deposits before insert on cash_deposits
  for each row execute function stamp_current_register();
