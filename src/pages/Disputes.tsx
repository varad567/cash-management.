import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { getDisputes, resolveDispute, type DisputeWithContext } from '../lib/disputeService';

function money(n: number | null | undefined): string {
  return `₹${(n ?? 0).toFixed(2)}`;
}

export default function Disputes() {
  const { appUser } = useAuth();
  const [disputes, setDisputes] = useState<DisputeWithContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('open');

  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const isHq = appUser?.role === 'hq';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDisputes(await getDisputes(filter || undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load disputes');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleResolve(id: string, status: 'reviewed' | 'resolved') {
    if (!appUser) return;
    setSavingId(id);
    setError(null);
    try {
      await resolveDispute(id, status, notesById[id] ?? '', appUser.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update dispute');
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Shift Disputes</h2>
      <p className="text-sm text-slate-500 mb-4">
        Closes an employee flagged as not matching what they counted. The original register is never
        altered — resolve these by investigating, not by editing the shift.
      </p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <div className="flex gap-2 mb-4">
        {[
          { value: 'open', label: 'Open' },
          { value: 'reviewed', label: 'Reviewed' },
          { value: 'resolved', label: 'Resolved' },
          { value: '', label: 'All' },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium ${
              filter === f.value ? 'bg-slate-800 text-white' : 'bg-white border border-slate-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {disputes.map((d) => (
          <div key={d.id} className="bg-white rounded-xl shadow p-4">
            <div className="flex justify-between items-start gap-2 mb-2">
              <div>
                <p className="font-medium text-slate-800">
                  {d.outlet_name ?? 'Unknown outlet'}
                  {d.register?.shift_label ? ` · ${d.register.shift_label}` : ''}
                </p>
                <p className="text-sm text-slate-500">
                  Raised by {d.raised_by_name ?? 'Unknown'} ·{' '}
                  {new Date(d.created_at).toLocaleString()}
                </p>
              </div>
              <span
                className={`text-xs font-medium px-2 py-1 rounded shrink-0 ${
                  d.status === 'open'
                    ? 'bg-amber-100 text-amber-900'
                    : d.status === 'reviewed'
                      ? 'bg-blue-100 text-blue-900'
                      : 'bg-green-100 text-green-900'
                }`}
              >
                {d.status}
              </span>
            </div>

            <table className="text-sm text-slate-600 mb-3">
              <tbody>
                <tr>
                  <td className="pr-4">As recorded — expected</td>
                  <td className="text-right">{money(d.register?.expected_closing)}</td>
                </tr>
                <tr>
                  <td className="pr-4">As recorded — counted</td>
                  <td className="text-right">{money(d.register?.counted_closing)}</td>
                </tr>
                <tr>
                  <td className="pr-4">As recorded — mismatch</td>
                  <td className="text-right">{money(d.register?.mismatch)}</td>
                </tr>
                {d.claimed_counted_closing != null && (
                  <tr className="font-medium text-slate-800">
                    <td className="pr-4">They say they counted</td>
                    <td className="text-right">{money(d.claimed_counted_closing)}</td>
                  </tr>
                )}
              </tbody>
            </table>

            <p className="text-sm bg-slate-50 border-l-2 border-slate-300 pl-3 py-2 mb-3">
              {d.reason}
            </p>

            {d.hq_notes && (
              <p className="text-sm text-slate-600 mb-3">
                <strong>HQ notes:</strong> {d.hq_notes}
              </p>
            )}

            {isHq && d.status !== 'resolved' && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <textarea
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  rows={2}
                  placeholder="Notes on what you found (optional)"
                  value={notesById[d.id] ?? ''}
                  onChange={(e) => setNotesById({ ...notesById, [d.id]: e.target.value })}
                />
                <div className="flex gap-2">
                  {d.status === 'open' && (
                    <button
                      disabled={savingId === d.id}
                      onClick={() => void handleResolve(d.id, 'reviewed')}
                      className="flex-1 border border-slate-300 rounded-lg py-2 text-sm font-medium"
                    >
                      Mark reviewed
                    </button>
                  )}
                  <button
                    disabled={savingId === d.id}
                    onClick={() => void handleResolve(d.id, 'resolved')}
                    className="flex-1 bg-slate-800 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-40"
                  >
                    {savingId === d.id ? 'Saving…' : 'Mark resolved'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {disputes.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">
            No {filter || ''} disputes.
          </p>
        )}
      </div>
    </div>
  );
}
