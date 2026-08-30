import { useEffect, useState } from 'react';
import { getOutletsOverview, type OutletOverview } from '../lib/hqDashboardService';

const POLL_INTERVAL_MS = 15000;

export default function HqDashboard() {
  const [overview, setOverview] = useState<OutletOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    async function refresh() {
      setOverview(await getOutletsOverview());
      setLastUpdated(new Date());
    }
    void refresh().finally(() => setLoading(false));
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-slate-800">Outlets</h2>
        <p className="text-xs text-slate-400">Updated {lastUpdated.toLocaleTimeString()}</p>
      </div>
      {overview.map(({ outlet, openRegister }) => (
        <div key={outlet.id} className="bg-white rounded-xl shadow p-6">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-medium text-slate-800">{outlet.name}</h3>
              {outlet.address && <p className="text-xs text-slate-500">{outlet.address}</p>}
            </div>
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${
                openRegister ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {openRegister ? 'Shift open' : 'No active shift'}
            </span>
          </div>
          {openRegister && (
            <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
              <Stat label="Opening balance" value={openRegister.opening_balance} />
              <Stat label="Cash sales" value={openRegister.cash_sales} />
              <Stat label="Old-bill collections" value={openRegister.cash_collected_old_bills} />
              <Stat label="Expenses paid" value={openRegister.expenses_paid} />
            </div>
          )}
        </div>
      ))}
      {overview.length === 0 && <p className="text-sm text-slate-500">No active outlets found.</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-slate-500 text-xs">{label}</p>
      <p className="font-semibold text-slate-800">₹{value.toFixed(2)}</p>
    </div>
  );
}
