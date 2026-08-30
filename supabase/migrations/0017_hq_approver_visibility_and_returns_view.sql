-- ============================================================
-- HQ visibility: approver selection + cross-outlet returns view
-- ============================================================

-- ---------- Fix: HQ was invisible in the approver dropdown ----------
-- check_return_approver() already allows 'hq' as a valid approver,
-- but no RLS policy let a cashier at any outlet actually SEE an HQ
-- user's app_users row — so HQ could never appear as an option,
-- even though the business rule always allowed it. HQ acting as a
-- remote approver is a legitimate, low-risk thing to expose (just
-- name + role, to any authenticated staff member), unlike exposing
-- arbitrary colleagues at other outlets.
create policy "users_select_hq_visible_to_all" on app_users for select
  using (role = 'hq' and is_active = true);

-- ---------- Cross-outlet returns view, for the new HQ tab ----------
-- RLS on `returns` already lets HQ/audit select every outlet's rows
-- (can_access_outlet bypasses the outlet match for those roles) —
-- this view just adds readable names, same pattern as the other
-- _readable views.
create view returns_readable
with (security_invoker = true) as
select
  r.*,
  o.name as outlet_name,
  b.bill_serial,
  coalesce(au_created.full_name, 'Staff member') as created_by_name,
  coalesce(au_approved.full_name, 'Staff member') as approved_by_name
from returns r
join outlets o on o.id = r.outlet_id
join bills b on b.id = r.original_bill_id
left join app_users au_created on au_created.id = r.created_by
left join app_users au_approved on au_approved.id = r.approved_by;
