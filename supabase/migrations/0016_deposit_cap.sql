-- ============================================================
-- Deep audit pass: deposit cap (fraud-relevant gap)
-- ============================================================
-- Nothing previously stopped a cashier from logging a deposit larger
-- than what's actually in the drawer — which would artificially hide
-- a shortage in the reconciliation math. This is precisely the kind
-- of manipulation this whole system exists to catch.

create or replace function check_deposit_amount()
returns trigger as $$
declare
  v_available numeric;
begin
  select opening_balance + cash_sales + cash_collected_old_bills
         - expenses_paid - deposits_made - cash_returned
  into v_available
  from shift_registers
  where outlet_id = new.outlet_id and status = 'open';

  if new.amount > v_available then
    raise exception 'Deposit amount (%) exceeds cash currently available in the drawer (%)',
      new.amount, v_available;
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_check_deposit_amount
before insert on cash_deposits
for each row execute function check_deposit_amount();
