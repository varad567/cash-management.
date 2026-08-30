import { useEffect, useState } from 'react';
import { getPayableBillsForAdmission, recordPayment } from '../lib/billService';
import { getActiveAdmissions } from '../lib/admissionService';
import { useAuth } from '../lib/AuthContext';
import type { Admission, Bill, PaymentMode } from '../lib/types';

export default function CollectPayment() {
  const { appUser } = useAuth();
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [admissionId, setAdmissionId] = useState('');
  const [bills, setBills] = useState<Bill[]>([]);
  const [billId, setBillId] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [gatewayRef, setGatewayRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const selectedBill = bills.find((b) => b.id === billId) ?? null;
  const overLimit = selectedBill != null && amount !== '' && Number(amount) > selectedBill.balance_due;
  const notPositive = amount !== '' && Number(amount) <= 0;

  useEffect(() => {
    if (appUser?.outlet_id) void getActiveAdmissions(appUser.outlet_id).then(setAdmissions);
  }, [appUser?.outlet_id]);

  useEffect(() => {
    setBillId('');
    setBills([]);
    if (admissionId) void getPayableBillsForAdmission(admissionId).then(setBills);
  }, [admissionId]);

  async function handleSubmit() {
    if (!appUser?.outlet_id || !selectedBill || !amount) return;
    if (notPositive) {
      setError('Amount must be greater than zero');
      return;
    }
    if (overLimit) {
      setError(`Amount exceeds this bill's remaining balance (₹${selectedBill.balance_due.toFixed(2)})`);
      return;
    }
    if (mode === 'online' && !gatewayRef) {
      setError('Enter the gateway reference for an online payment');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await recordPayment({
        billId: selectedBill.id,
        outletId: appUser.outlet_id,
        amount: Number(amount),
        mode,
        gatewayReference: mode === 'online' ? gatewayRef : undefined,
        receivedBy: appUser.id,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record payment');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto mt-12 bg-white rounded-xl shadow p-8 text-center">
        <h2 className="text-xl font-semibold text-green-700 mb-2">Payment recorded</h2>
        <button
          onClick={() => {
            setDone(false);
            setAdmissionId('');
            setAmount('');
          }}
          className="bg-slate-800 text-white rounded-lg py-3 px-6 font-medium"
        >
          Collect Another Payment
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Collect Payment on Existing Bill</h2>

      <label className="block text-sm font-medium text-slate-700 mb-1">Patient</label>
      <select
        className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-4"
        value={admissionId}
        onChange={(e) => setAdmissionId(e.target.value)}
      >
        <option value="">Select patient…</option>
        {admissions.map((a) => (
          <option key={a.id} value={a.id}>
            {a.patient_name} {a.ward_bed ? `(${a.ward_bed})` : ''}
          </option>
        ))}
      </select>

      {admissionId && bills.length === 0 && (
        <p className="text-sm text-slate-500 mb-4">No outstanding bills for this patient.</p>
      )}

      {bills.length > 0 && (
        <>
          <label className="block text-sm font-medium text-slate-700 mb-1">Bill</label>
          <select
            className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-4"
            value={billId}
            onChange={(e) => setBillId(e.target.value)}
          >
            <option value="">Select bill…</option>
            {bills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.bill_serial} — balance ₹{b.balance_due.toFixed(2)}
              </option>
            ))}
          </select>
        </>
      )}

      {selectedBill && (
        <>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 text-sm">
            <p>Bill total: ₹{selectedBill.bill_amount.toFixed(2)}</p>
            <p>Paid so far: ₹{selectedBill.amount_paid.toFixed(2)}</p>
            <p className="font-medium mt-1">Remaining: ₹{selectedBill.balance_due.toFixed(2)}</p>
          </div>

          <label className="block text-sm font-medium text-slate-700 mb-1">Amount being paid now</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            max={selectedBill.balance_due}
            className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {notPositive && <p className="text-sm text-red-600 mb-3">Amount must be greater than zero.</p>}
          {overLimit && (
            <p className="text-sm text-red-600 mb-3">
              Can't exceed the remaining balance of ₹{selectedBill.balance_due.toFixed(2)}.
            </p>
          )}
          {!notPositive && !overLimit && <div className="mb-4" />}

          <label className="block text-sm font-medium text-slate-700 mb-1">Payment mode</label>
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setMode('cash')}
              className={`flex-1 py-2 rounded-lg font-medium ${mode === 'cash' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              Cash
            </button>
            <button
              onClick={() => setMode('online')}
              className={`flex-1 py-2 rounded-lg font-medium ${mode === 'online' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              Online
            </button>
          </div>
          {mode === 'online' && (
            <input
              className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-4"
              value={gatewayRef}
              onChange={(e) => setGatewayRef(e.target.value)}
              placeholder="Gateway reference"
            />
          )}

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

          <button
            disabled={!amount || notPositive || overLimit || submitting}
            onClick={() => void handleSubmit()}
            className="w-full bg-slate-800 text-white font-medium rounded-lg py-3 disabled:opacity-40"
          >
            {submitting ? 'Saving…' : 'Record Payment'}
          </button>
        </>
      )}
    </div>
  );
}
