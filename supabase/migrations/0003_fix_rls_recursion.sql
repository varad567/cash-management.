-- Fix: infinite recursion in RLS policies on app_users.
-- can_access_outlet() and current_app_user() query app_users internally
-- to check the caller's role — without this, Postgres re-applies the
-- app_users policies to that internal query, which calls the function
-- again, forever. Setting row_security = off makes these functions
-- bypass RLS for their own internal lookups only.

alter function can_access_outlet(uuid) set row_security = off;
alter function current_app_user() set row_security = off;
