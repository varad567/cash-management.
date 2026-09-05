-- ============================================================
-- Phase 3 fix: closed shift registers become immutable
-- ============================================================
-- Bug found: closeShift() updated shift_registers with no check
-- that the row was still 'open'. Two consequences:
--
--   1. Race condition — two people closing the same shift within
--      moments of each other: the second UPDATE silently overwrote
--      the first's counted_closing/expected_closing/closed_by, no
--      error, no trace beyond comparing email timestamps.
--
--   2. Tampering — anyone with outlet access could re-run an update
--      against an already-closed register at any later point and
--      quietly change its numbers. Given the whole point of this
--      system is preventing exactly this kind of manipulation, this
--      was a real gap, not just a race-condition edge case.
--
-- Fix: once a shift_registers row has status = 'closed', no further
-- UPDATE of any kind is allowed, ever — mirroring the "bills stay
-- immutable once paid" rule already used elsewhere in this schema.
-- Postgres's row-level locking means this also correctly blocks true
-- concurrent double-close attempts: the second transaction blocks on
-- the row lock, then re-reads OLD as 'closed' once the first commits,
-- and gets rejected — not a best-effort check, a guaranteed one.

create or replace function prevent_shift_register_modification_after_close()
returns trigger as $$
begin
  if old.status = 'closed' then
    raise exception 'This shift register was already closed at % by the recorded closer and can no longer be modified.', old.closed_at
      using errcode = 'P0001';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_prevent_reclose_shift
before update on shift_registers
for each row execute function prevent_shift_register_modification_after_close();
