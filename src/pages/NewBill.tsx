import { useEffect, useState } from 'react';
import { createBill, createWalkInSale, recordPayment } from '../lib/billService';
import { billSerialExists } from '../lib/returnsService';
import { getActiveAdmissions } from '../lib/admissionService';
import { useAuth } from '../lib/AuthContext';
import type { Admission, BillType, PaymentMode } from '../lib/types';

export default function NewBill() {
  const { appUser } = useAuth();
  const [billType, setBillType] = useState<BillType>('walk_in');
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [admissionId, setAdmissionId] = useState('');
  const [billSerial, setBillSerial] = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [gatewayRef, setGatewayRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (billType === 'admitted_patient' && appUser?.outlet_id) {
      void getActiveAdmissions(appUser.outlet_id).then(setAdmissions);
    }
  }, [billType, appUser?.outlet_id]);

  // Walk-in bills must be collected in full — the amount field is
  // locked to the bill total; only admitted-patient bills allow a
  // partial amount. This mirrors the DB constraint (chk_carry_forward)
  // so the cashier sees the rule up front instead of hitting an error.
  const effectivePayment = billType === 'walk_in' ? billAmount : paymentAmount;

  async function handleSubmit() {
    if (!appUser?.outlet_id || !billAmount || !billSerial) return;
    const trimmedSerial = billSerial.trim();
    if (!trimmedSerial) {
      setError('Enter a bill number');
      return;
    }
    if (Number(billAmount) <= 0) {
      setError('Bill amount must be greater than zero');
      return;
    }
    if (paymentAmount && Number(paymentAmount) < 0) {
      setError('Payment amount cannot be negative');
      return;
    }
    if (billType === 'admitted_patient' && paymentAmount && Number(paymentAmount) > Number(billAmount)) {
      setError('Payment now cannot exceed the bill amount for a brand-new bill');
      return;
    }
    if (billType === 'admitted_patient' && !admissionId) {
      setError('Select the patient admission this bill belongs to');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Duplicate check needs a live query — only run it when online.
      // If offline, there's nothing to check against yet, so the bill
      // still queues normally; a genuine duplicate is caught by the
      // offline queue's permanent-failure handling once it syncs
      // (see OfflineIndicator) rather than blocking offline entry
      // entirely.
      if (navigator.onLine) {
        try {
          if (await billSerialExists(appUser.outlet_id, trimmedSerial)) {
            setError('A bill with this number already exists at this outlet — check for a duplicate entry.');
            setSubmitting(false);
            return;
          }
        } catch {
          // Connection dropped mid-check — fall through to the same
          // offline-safe path rather than blocking the cashier here.
        }
      }

      if (billType === 'walk_in') {
        // Walk-in: bill + full payment must be created atomically —
        // see billService.createWalkInSale for why the two-step flow
        // used for admitted patients can't be used here.
        if (mode === 'online' && !gatewayRef) {
          setError('Enter the gateway reference for an online payment');
          setSubmitting(false);
          return;
        }
        await createWalkInSale({
          outletId: appUser.outlet_id,
          billSerial: trimmedSerial,
          billAmount: Number(billAmount),
          mode,
          gatewayReference: mode === 'online' ? gatewayRef : undefined,
          createdBy: appUser.id,
        });
        setDone(true);
        return;
      }

      const billId = await createBill({
        outletId: appUser.outlet_id,
        billSerial: trimmedSerial,
        billType,
        admissionId: admissionId,
        billAmount: Number(billAmount),
        createdBy: appUser.id,
      });

      if (effectivePayment && Number(effectivePayment) > 0) {
        await recordPayment({
          billId,
          outletId: appUser.outlet_id,
          amount: Number(effectivePayment),
          mode,
          gatewayReference: mode === 'online' ? gatewayRef : undefined,
          receivedBy: appUser.id,
        });
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create bill');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto mt-12 bg-white rounded-xl shadow p-8 text-center">
        <h2 className="text-xl font-semibold text-green-700 mb-2">Bill recorded</h2>
        <p className="text-slate-500 mb-6">Serial {billSerial}</p>
        <button
          onClick={() => {
            setDone(false);
            setBillSerial('');
            setBillAmount('');
            setPaymentAmount('');
            setAdmissionId('');
          }}
          className="bg-slate-800 text-white rounded-lg py-3 px-6 font-medium"
        >
          New Bill
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">New Bill</h2>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setBillType('walk_in')}
          className={`flex-1 py-3 rounded-lg font-medium ${billType === 'walk_in' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          Walk-in
        </button>
        <button
          onClick={() => setBillType('admitted_patient')}
          className={`flex-1 py-3 rounded-lg font-medium ${billType === 'admitted_patient' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          Admitted Patient
        </button>
      </div>

      {billType === 'admitted_patient' && (
        <>
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
        </>
      )}

      <label className="block text-sm font-medium text-slate-700 mb-1">Bill serial</label>
      <input
        className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-4"
        value={billSerial}
        onChange={(e) => setBillSerial(e.target.value)}
        placeholder="From POS"
      />

      <label className="block text-sm font-medium text-slate-700 mb-1">Bill amount</label>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-4"
        value={billAmount}
        onChange={(e) => setBillAmount(e.target.value)}
        placeholder="0.00"
      />

      {billType === 'admitted_patient' && (
        <>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Amount being paid now (leave blank if none)
          </label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-4"
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
            placeholder="0.00"
          />
        </>
      )}

      {Number(effectivePayment) > 0 && (
        <>
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
        </>
      )}

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <button
        disabled={submitting || !billAmount || !billSerial}
        onClick={() => void handleSubmit()}
        className="w-full bg-slate-800 text-white font-medium rounded-lg py-3 disabled:opacity-40"
      >
        {submitting ? 'Saving…' : 'Save Bill'}
      </button>
    </div>
  );
}
