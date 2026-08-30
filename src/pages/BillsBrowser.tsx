import { useEffect, useState } from 'react';
import { searchBills } from '../lib/billService';
import type { Bill, BillStatus } from '../lib/types';

const STATUS_OPTIONS: BillStatus[] = ['open', 'partial', 'paid', 'cancelled'];

const STATUS_STYLES: Record<BillStatus, string> = {
  open: 'bg-amber-50 text-amber-700',
  partial: 'bg-blue-50 text-blue-700',
  paid: 'bg-green-50 text-green-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

export default function BillsBrowser() {
  const [serial, setSerial] = useState('');
  const [status, setStatus] = useState<BillStatus | ''>('');
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void searchBills({ serial: serial || undefined, status: status || undefined })
      .then(setBills)
      .finally(() => setLoading(false));
  }, [serial, status]);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex gap-2">
        <input
          className="flex-1 border border-slate-300 rounded-lg px-4 py-3"
          placeholder="Search by bill serial…"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
        />
        <select
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as BillStatus | '')}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && bills.length === 0 && <p className="text-sm text-slate-500">No bills found.</p>}

      <div className="space-y-2">
        {bills.map((b) => (
          <div key={b.id} className="bg-white rounded-lg shadow p-4 flex justify-between items-center">
            <div>
              <p className="font-medium text-slate-800">{b.bill_serial}</p>
              <p className="text-xs text-slate-500">
                {b.bill_type === 'admitted_patient' ? 'Admitted patient' : 'Walk-in'}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-slate-800">₹{b.bill_amount.toFixed(2)}</p>
              {b.balance_due > 0 && (
                <p className="text-xs text-red-600">Balance ₹{b.balance_due.toFixed(2)}</p>
              )}
            </div>
            <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_STYLES[b.status]}`}>
              {b.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
