-- ============================================================
-- Phase 3 extension: 24-hour shift close dispute window
-- ============================================================
-- The employee who closed a shift receives a confirmation email with
-- the full breakdown. This gives them a way to formally flag "that
-- isn't what I counted" within 24 hours of the close.
--
-- Deliberately NOT an edit path: a dispute never changes the closed
-- register's numbers (those stay immutable per migration 0024). It
-- records the disagreement, timestamps it, and alerts HQ — who then
-- investigate out-of-band. This keeps the audit trail honest: the
-- original submission stands as recorded, with the objection attached
-- alongside it rather than overwriting it.

create table shift_disputes (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null references shift_registers(id),
  outlet_id uuid not null references outlets(id),
  raised_by uuid not null references app_users(id),
  claimed_counted_closing numeric(12,2),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved')),
  hq_notes text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references app_users(id),
  -- One dispute per register: a second objection to the same close is
  -- a conversation with HQ, not another record.
  unique (register_id)
);

create index idx_shift_disputes_status on shift_disputes(status, created_at desc);
create index idx_shift_disputes_outlet on shift_disputes(outlet_id, created_at desc);

alter table shift_disputes enable row level security;

-- Staff can raise a dispute only on a register at their own outlet
-- that they personally closed. HQ/audit can see everything.
create policy "disputes_insert_own_close" on shift_disputes for insert
  with check (
    raised_by = auth.uid()
    and exists (
      select 1 from shift_registers sr
      where sr.id = register_id
        and sr.closed_by = auth.uid()
    )
  );

create policy "disputes_select" on shift_disputes for select
  using (
    raised_by = auth.uid()
    or (auth.jwt() ->> 'app_role') in ('hq', 'audit', 'manager')
  );

-- Only HQ resolves/annotates a dispute.
create policy "disputes_update_hq" on shift_disputes for update
  using ((auth.jwt() ->> 'app_role') = 'hq')
  with check ((auth.jwt() ->> 'app_role') = 'hq');

-- ---------- Enforce the 24-hour window server-side ----------
-- The UI hides the dispute button after 24h, but the window is a rule,
-- not a display preference — enforce it where it can't be bypassed.

create or replace function enforce_dispute_window()
returns trigger as $$
declare
  v_closed_at timestamptz;
  v_status register_status;
begin
  select closed_at, status into v_closed_at, v_status
  from shift_registers where id = new.register_id;

  if v_status != 'closed' then
    raise exception 'Cannot dispute a shift that has not been closed.'
      using errcode = 'P0001';
  end if;

  if v_closed_at is null or now() > v_closed_at + interval '24 hours' then
    raise exception 'The 24-hour window to dispute this shift close has passed. Contact HQ directly.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_enforce_dispute_window
before insert on shift_disputes
for each row execute function enforce_dispute_window();

-- ---------- Notify HQ immediately when a dispute is raised ----------
create or replace function notify_shift_dispute()
returns trigger as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from app_config where key = 'alert_function_url';
  select value into v_secret from app_config where key = 'alert_shared_secret';

  if v_url is not null then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', v_secret
      ),
      body := jsonb_build_object(
        'type', 'shift_dispute',
        'outlet_id', new.outlet_id,
        'register_id', new.register_id,
        'raised_by', new.raised_by,
        'claimed_counted_closing', new.claimed_counted_closing,
        'reason', new.reason,
        'created_at', new.created_at
      )
    );
  end if;
  return new;
end;
$$ language plpgsql security definer set row_security = off;

create trigger trg_notify_shift_dispute
after insert on shift_disputes
for each row execute function notify_shift_dispute();
