-- Pragmatic unblock: remove every policy on app_users that references
-- app_users from within its own condition (that's what causes 42P17
-- no matter how it's split). Replace with a single rule: a user can
-- only see their own row. This is all Phase 1 login needs.
--
-- "HQ/audit sees every user" is deferred to Phase 2, where it'll be
-- done properly via JWT custom claims (role stored in the auth token
-- itself) instead of a table lookup — the standard Supabase pattern
-- that avoids this recursion class entirely.

drop policy if exists "users_select" on app_users;
drop policy if exists "users_select_own" on app_users;
drop policy if exists "users_select_hq_audit" on app_users;
drop policy if exists "users_write_hq" on app_users;

create policy "users_select_self_only" on app_users for select
  using (id = auth.uid());
