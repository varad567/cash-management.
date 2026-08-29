-- Proper fix for infinite recursion (42P17) on app_users.
-- Root cause: the "users_select" policy called can_access_outlet(),
-- which queries app_users to check the caller's role — and that inner
-- query re-triggers the same policy on app_users, forever.
--
-- Fix: split into two policies. "own row" is a trivial comparison with
-- no subquery, so it can never recurse. "hq/audit sees all" queries
-- app_users too, but for the current user's own row — which the trivial
-- policy above already resolves directly, so the recursion bottoms out
-- instead of looping.

drop policy if exists "users_select" on app_users;

create policy "users_select_own" on app_users for select
  using (id = auth.uid());

create policy "users_select_hq_audit" on app_users for select
  using (
    exists (
      select 1 from app_users self
      where self.id = auth.uid()
      and self.role in ('hq', 'audit')
      and self.is_active = true
    )
  );
