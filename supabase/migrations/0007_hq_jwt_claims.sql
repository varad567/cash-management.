-- ============================================================
-- Phase 2B: HQ access on app_users, via JWT custom claims
-- ============================================================
-- Migration 0005 unblocked login by reducing app_users to a single
-- "see your own row" policy — which also silently dropped HQ's
-- write access (create/edit users), not just HQ's read-all.
--
-- Fix: stop looking up role/outlet_id from app_users at query time
-- (that's what caused 42P17). Instead, inject role + outlet_id into
-- the JWT itself at login via a Supabase Auth "Custom Access Token"
-- hook, then read them straight off auth.jwt() in policies — no
-- table lookup, no recursion possible.
--
-- MANUAL STEP REQUIRED (cannot be done via SQL migration alone):
-- In the Supabase Dashboard, go to Authentication → Hooks →
-- "Customize Access Token (JWT) Claims hook" and enable it pointing
-- at public.custom_access_token_hook. Until that's enabled, this
-- migration has no effect and the old self-row-only behavior
-- continues (safe fallback, not broken).
--
-- Also note: claims are minted at sign-in, so any user already
-- logged in when this goes live needs to sign out/in once to pick
-- up their new app_role / app_outlet_id claims.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  v_role text;
  v_outlet_id uuid;
begin
  select role, outlet_id into v_role, v_outlet_id
  from public.app_users
  where id = (event->>'user_id')::uuid
  and is_active = true;

  claims := coalesce(event->'claims', '{}'::jsonb);

  if v_role is not null then
    claims := jsonb_set(claims, '{app_role}', to_jsonb(v_role));
    if v_outlet_id is not null then
      claims := jsonb_set(claims, '{app_outlet_id}', to_jsonb(v_outlet_id::text));
    end if;
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- Supabase's auth service (not the app) calls this hook, so it needs
-- its own grant — separate from anon/authenticated, who must never
-- call this directly.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

grant select on public.app_users to supabase_auth_admin;
create policy "auth_admin_reads_app_users" on public.app_users
  for select to supabase_auth_admin using (true);

-- ---------- Replace the self-only fallback with real HQ policies ----------

drop policy if exists "users_select_self_only" on app_users;

create policy "users_select_self" on app_users for select
  using (id = auth.uid());

create policy "users_select_hq_audit" on app_users for select
  using ((auth.jwt() ->> 'app_role') in ('hq', 'audit'));

-- Staff at the same outlet need to see each other for ordinary
-- workflows (e.g. picking the manager who approved a return) — this
-- was silently lost along with everything else in migration 0005.
-- Reads the outlet id straight from the JWT claim, so no app_users
-- subquery, no recursion.
create policy "users_select_same_outlet" on app_users for select
  using (outlet_id is not null and outlet_id::text = (auth.jwt() ->> 'app_outlet_id'));

create policy "users_insert_hq" on app_users for insert
  with check ((auth.jwt() ->> 'app_role') = 'hq');

create policy "users_update_hq" on app_users for update
  using ((auth.jwt() ->> 'app_role') = 'hq');

create policy "users_delete_hq" on app_users for delete
  using ((auth.jwt() ->> 'app_role') = 'hq');

-- Note on user creation: app_users.id references auth.users(id), and
-- only Supabase's service role can create auth.users rows. An HQ
-- "add user" screen therefore needs a server-side call (Edge
-- Function with the service key) that creates the auth user first,
-- then inserts the app_users row — the anon/authenticated client can
-- never do this directly, regardless of RLS. Not built in this
-- migration; flagging so it isn't assumed to already work.
