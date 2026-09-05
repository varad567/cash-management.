import { supabase } from './supabaseClient';
import { getPendingCount } from './offlineQueue';
import { computeExpectedClosing } from './registerMath';
import type { ShiftRegister } from './types';

// The currently open register for an outlet, or null if none is open.
export async function getOpenRegister(outletId: string): Promise<ShiftRegister | null> {
  const { data, error } = await supabase
    .from('shift_registers')
    .select('*')
    .eq('outlet_id', outletId)
    .eq('status', 'open')
    .maybeSingle();
  if (error) throw error;
  return data as ShiftRegister | null;
}

// The most recently closed register for an outlet — used to show the
// incoming cashier the amount they must confirm to open the next shift.
export async function getLastClosedRegister(outletId: string): Promise<ShiftRegister | null> {
  const { data, error } = await supabase
    .from('shift_registers')
    .select('*')
    .eq('outlet_id', outletId)
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as ShiftRegister | null;
}

// A single register's current live state, by id. The register held
// in top-level app state is fetched once and never updated after —
// every trigger-driven total (cash_sales, expenses_paid, etc.) keeps
// changing server-side as the shift goes on, so any screen showing
// those numbers or computing the expected-closing preview needs to
// re-fetch this, not trust a prop that may be minutes stale.
export async function getRegisterById(registerId: string): Promise<ShiftRegister> {
  const { data, error } = await supabase
    .from('shift_registers')
    .select('*')
    .eq('id', registerId)
    .single();
  if (error) throw error;
  return data as ShiftRegister;
}

interface OpenShiftParams {
  outletId: string;
  openedBy: string;
  shiftLabel?: string;
}

// Opens a new shift. The server (trigger) independently re-verifies the
// chain + opening balance, so this is not a trust-the-client operation —
// a stale UI or a tampered request is still rejected at the DB.
export async function openShift({ outletId, openedBy, shiftLabel }: OpenShiftParams) {
  const prev = await getLastClosedRegister(outletId);

  const { data, error } = await supabase
    .from('shift_registers')
    .insert({
      outlet_id: outletId,
      register_date: new Date().toISOString().slice(0, 10),
      shift_label: shiftLabel ?? null,
      previous_register_id: prev?.id ?? null,
      opening_balance: prev?.counted_closing ?? 0,
      opened_by: openedBy,
      status: 'open',
    })
    .select()
    .single();

  if (error) throw error;
  return data as ShiftRegister;
}

interface CloseShiftParams {
  registerId: string;
  countedClosing: number;
  closedBy: string;
}

// Closes the current shift. Refuses if any offline actions for this
// device are still unsynced — closing on stale/incomplete data would
// produce a false mismatch.
export async function closeShift({ registerId, countedClosing, closedBy }: CloseShiftParams) {
  const pending = await getPendingCount();
  if (pending > 0) {
    throw new Error(
      `${pending} offline entr${pending === 1 ? 'y is' : 'ies are'} still syncing. Reconnect and wait before closing this shift.`
    );
  }

  const { data: register, error: fetchError } = await supabase
    .from('shift_registers')
    .select('*')
    .eq('id', registerId)
    .single();
  if (fetchError) throw fetchError;

  const r = register as ShiftRegister;

  if (r.status !== 'open') {
    // Covers the common case: someone else already closed this shift
    // (e.g. two people on the same close screen, or a stale tab) —
    // give a clear message instead of letting the DB-level immutability
    // guard's exception surface as-is. That guard (migration 0024) is
    // still the real backstop for a true race between two simultaneous
    // close attempts — this check just makes the common, non-racy case
    // read nicely.
    throw new Error(
      r.closed_at
        ? `This shift was already closed at ${new Date(r.closed_at).toLocaleString()}.`
        : 'This shift is no longer open.'
    );
  }

  const expectedClosing = computeExpectedClosing(r);

  const { data, error } = await supabase
    .from('shift_registers')
    .update({
      status: 'closed',
      counted_closing: countedClosing,
      expected_closing: expectedClosing,
      closed_by: closedBy,
      closed_at: new Date().toISOString(),
    })
    .eq('id', registerId)
    .select()
    .single();

  if (error) throw error;
  return data as ShiftRegister;
}
