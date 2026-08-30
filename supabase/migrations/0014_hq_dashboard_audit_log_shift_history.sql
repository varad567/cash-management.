-- ============================================================
-- Phase 2 feature build: HQ dashboard, audit log, shift history
-- ============================================================

-- ---------- Fix: payments and cash_deposits were never audited ----------
-- log_audit() was only attached to bills, expenses, admissions, and
-- registers. The two most money-relevant append-only tables were
-- silently excluded from the audit trail this whole time.
create trigger trg_audit_payments after insert on payments
  for each row execute function log_audit();
create trigger trg_audit_deposits after insert on cash_deposits
  for each row execute function log_audit();

-- ---------- Fix: cashiers could read their own outlet's full audit trail ----------
-- The original policy let ANY role at an outlet see that outlet's
-- audit_log — including the cashier the log exists to watch. Tighten
-- to manager/hq/audit only, using the JWT role claim (no recursion
-- risk, consistent with the app_users policies from migration 0007).
drop policy if exists "audit_select" on audit_log;

create policy "audit_select" on audit_log for select
  using (
    (auth.jwt() ->> 'app_role') in ('manager', 'hq', 'audit')
    and (outlet_id is null or can_access_outlet(outlet_id))
  );

-- ---------- Readable views (LEFT JOIN — see migration 0013 for why) ----------

create view audit_log_readable
with (security_invoker = true) as
select
  al.*,
  coalesce(au.full_name, 'Unknown') as changed_by_name,
  o.name as outlet_name
from audit_log al
left join app_users au on au.id = al.changed_by
left join outlets o on o.id = al.outlet_id;

create view shift_registers_readable
with (security_invoker = true) as
select
  sr.*,
  o.name as outlet_name,
  coalesce(au_open.full_name, 'Unknown') as opened_by_name,
  au_close.full_name as closed_by_name
from shift_registers sr
join outlets o on o.id = sr.outlet_id
left join app_users au_open on au_open.id = sr.opened_by
left join app_users au_close on au_close.id = sr.closed_by;
