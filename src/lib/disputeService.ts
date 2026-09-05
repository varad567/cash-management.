import { supabase } from './supabaseClient';
import type { ShiftDispute, ShiftRegister } from './types';

export const DISPUTE_WINDOW_HOURS = 24;

export function isWithinDisputeWindow(closedAt: string | null): boolean {
  if (!closedAt) return false;
  const closed = new Date(closedAt).getTime();
  return Date.now() - closed < DISPUTE_WINDOW_HOURS * 60 * 60 * 1000;
}

export function disputeWindowRemaining(closedAt: string | null): string {
  if (!closedAt) return '';
  const msLeft =
    new Date(closedAt).getTime() + DISPUTE_WINDOW_HOURS * 60 * 60 * 1000 - Date.now();
  if (msLeft <= 0) return 'expired';
  const hours = Math.floor(msLeft / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.floor(msLeft / (60 * 1000)))}m left`;
}

// Shifts this user personally closed, most recent first — the source
// for "My Shifts". Includes any dispute already raised so the UI can
// show status instead of offering to raise a second one.
export async function getMyClosedShifts(
  userId: string,
  limit = 20
): Promise<(ShiftRegister & { dispute: ShiftDispute | null })[]> {
  const { data, error } = await supabase
    .from('shift_registers')
    .select('*, shift_disputes(*)')
    .eq('closed_by', userId)
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data as (ShiftRegister & { shift_disputes: ShiftDispute[] })[]) ?? []).map((r) => ({
    ...r,
    dispute: r.shift_disputes?.[0] ?? null,
  }));
}

interface RaiseDisputeParams {
  registerId: string;
  outletId: string;
  raisedBy: string;
  reason: string;
  claimedCountedClosing?: number | null;
}

// The 24-hour window and "you must have closed it yourself" rule are
// both enforced server-side (migration 0025) — this will throw with a
// readable message if either is violated.
export async function raiseDispute({
  registerId,
  outletId,
  raisedBy,
  reason,
  claimedCountedClosing,
}: RaiseDisputeParams): Promise<ShiftDispute> {
  const { data, error } = await supabase
    .from('shift_disputes')
    .insert({
      register_id: registerId,
      outlet_id: outletId,
      raised_by: raisedBy,
      reason: reason.trim(),
      claimed_counted_closing: claimedCountedClosing ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ShiftDispute;
}

export interface DisputeWithContext extends ShiftDispute {
  raised_by_name: string | null;
  outlet_name: string | null;
  register: Pick<
    ShiftRegister,
    'shift_label' | 'closed_at' | 'expected_closing' | 'counted_closing' | 'mismatch'
  > | null;
}

// HQ/audit view of all disputes.
export async function getDisputes(statusFilter?: string): Promise<DisputeWithContext[]> {
  let query = supabase
    .from('shift_disputes')
    .select(
      '*, app_users!shift_disputes_raised_by_fkey(full_name), outlets(name), shift_registers(shift_label, closed_at, expected_closing, counted_closing, mismatch)'
    )
    .order('created_at', { ascending: false });

  if (statusFilter) query = query.eq('status', statusFilter);

  const { data, error } = await query;
  if (error) throw error;

  type Raw = ShiftDispute & {
    app_users: { full_name: string } | null;
    outlets: { name: string } | null;
    shift_registers: DisputeWithContext['register'];
  };

  return ((data as Raw[]) ?? []).map((d) => ({
    ...d,
    raised_by_name: d.app_users?.full_name ?? null,
    outlet_name: d.outlets?.name ?? null,
    register: d.shift_registers ?? null,
  }));
}

export async function resolveDispute(
  disputeId: string,
  status: 'reviewed' | 'resolved',
  hqNotes: string,
  reviewedBy: string
): Promise<void> {
  const { error } = await supabase
    .from('shift_disputes')
    .update({
      status,
      hq_notes: hqNotes.trim() || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
    })
    .eq('id', disputeId);
  if (error) throw error;
}
