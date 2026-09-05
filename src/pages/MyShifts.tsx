import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import {
  getMyClosedShifts,
  raiseDispute,
  isWithinDisputeWindow,
  disputeWindowRemaining,
} from '../lib/disputeService';
import { computeExpectedClosing } from '../lib/registerMath';
import type { ShiftDispute, ShiftRegister } from '../lib/types';

type MyShift = ShiftRegister & { dispute: ShiftDispute | null };

function money(n: number | null | undefined): string {
  return `₹${(n ?? 0).toFixed(2)}`;
}

export default function MyShifts() {
  const { appUser } = useAuth();
  const [shifts, setShifts] = useState<MyShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [claimedAmount, setClaimedAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!appUser) return;
    setLoading(true);
    try {
      setShifts(await getMyClosedShifts(appUser.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your shifts');
    } finally {
      setLoading(false);
    }
  }, [appUser]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitDispute(shift: MyShift) {
    if (!appUser || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await raiseDispute({
        registerId: shift.id,
        outletId: shift.outlet_id,
        raisedBy: appUser.id,
        reason,
        claimedCountedClosing: claimedAmount ? Number(claimedAmount) : null,
      });
      setDisputingId(null);
      setReason('');
      setClaimedAmount('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not raise dispute');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">My Shifts</h2>
      <p className="text-sm text-slate-500 mb-4">
        Shifts you closed. If a closing doesn't match what you counted, you can flag it within 24
        hours.
      </p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <div className="space-y-3">
        {shifts.map((s) => {
          const canDispute = !s.dispute && isWithinDisputeWindow(s.closed_at);
          const mismatched = Math.abs(s.mismatch ?? 0) > 0.005;
          return (
            <div key={s.id} className="bg-white rounded-xl shadow p-4">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="font-medium text-slate-800">
                    {s.shift_label || 'Shift'}{' '}
                    <span className="font-normal text-slate-400 text-sm">
                      {s.closed_at ? new Date(s.closed_at).toLocaleString() : ''}
                    </span>
                  </p>
                  <p className="text-sm text-slate-500">
                    Counted {money(s.counted_closing)} · Expected{' '}
                    {money(s.expected_closing ?? computeExpectedClosing(s))}
                  </p>
                </div>
                <span
                  className={`text-xs font-medium shrink-0 ${mismatched ? 'text-red-600' : 'text-green-700'}`}
                >
                  {mismatched
                    ? `${money(Math.abs(s.mismatch ?? 0))} ${(s.mismatch ?? 0) > 0 ? 'over' : 'short'}`
                    : 'Matched'}
                </span>
              </div>

              {s.dispute && (
                <div className="mt-3 text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="font-medium text-amber-900">
                    Disputed · {s.dispute.status}
                  </p>
                  <p className="text-slate-600 mt-1">{s.dispute.reason}</p>
                  {s.dispute.hq_notes && (
                    <p className="text-slate-600 mt-2">
                      <strong>HQ:</strong> {s.dispute.hq_notes}
                    </p>
                  )}
                </div>
              )}

              {canDispute && disputingId !== s.id && (
                <button
                  onClick={() => setDisputingId(s.id)}
                  className="mt-3 text-sm text-slate-600 underline"
                >
                  This doesn't match what I counted ({disputeWindowRemaining(s.closed_at)})
                </button>
              )}

              {!s.dispute && !canDispute && (
                <p className="mt-3 text-xs text-slate-400">
                  Dispute window closed. Contact HQ directly if there's an issue.
                </p>
              )}

              {disputingId === s.id && (
                <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                  <input
                    type="number"
                    inputMode="decimal"
                    className="w-full border border-slate-300 rounded-lg px-4 py-3"
                    placeholder="What you actually counted (optional)"
                    value={claimedAmount}
                    onChange={(e) => setClaimedAmount(e.target.value)}
                  />
                  <textarea
                    className="w-full border border-slate-300 rounded-lg px-4 py-3"
                    rows={3}
                    placeholder="What went wrong?"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <p className="text-xs text-slate-500">
                    This won't change the closed shift — it records your objection and notifies HQ.
                  </p>
                  <div className="flex gap-2">
                    <button
                      disabled={!reason.trim() || submitting}
                      onClick={() => void submitDispute(s)}
                      className="flex-1 bg-slate-800 text-white rounded-lg py-3 font-medium disabled:opacity-40"
                    >
                      {submitting ? 'Submitting…' : 'Submit'}
                    </button>
                    <button
                      onClick={() => {
                        setDisputingId(null);
                        setReason('');
                        setClaimedAmount('');
                      }}
                      className="flex-1 border border-slate-300 rounded-lg py-3 font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {shifts.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">
            You haven't closed any shifts yet.
          </p>
        )}
      </div>
    </div>
  );
}
