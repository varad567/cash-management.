-- ============================================================
-- Expense approval workflow
-- ============================================================

-- ---------- Security fix: only HQ can approve, enforced server-side ----------
-- expenses_update (from migration 0002) allows ANY user with outlet
-- access to update an expense row — which technically means a
-- cashier could call the API directly and set their own
-- approved_by/approved_at, self-approving an expense that was
-- flagged specifically because it needed HQ sign-off. The UI would
-- never do this, but nothing at the DB level stopped it either.
create or replace function check_expense_approval()
returns trigger as $$
declare
  v_role user_role;
begin
  if new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    if (auth.jwt() ->> 'app_role') != 'hq' then
      raise exception 'Only HQ can approve an expense';
    end if;
    if new.approved_by is not null then
      select role into v_role from app_users where id = new.approved_by;
      if v_role is null or v_role != 'hq' then
        raise exception 'approved_by must be an HQ user';
      end if;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_check_expense_approval
before update on expenses
for each row execute function check_expense_approval();

-- ---------- Readable cross-outlet view for the approvals screen ----------
create view expenses_readable
with (security_invoker = true) as
select
  e.*,
  o.name as outlet_name,
  coalesce(au_created.full_name, 'Staff member') as created_by_name,
  au_approved.full_name as approved_by_name
from expenses e
join outlets o on o.id = e.outlet_id
left join app_users au_created on au_created.id = e.created_by
left join app_users au_approved on au_approved.id = e.approved_by;
