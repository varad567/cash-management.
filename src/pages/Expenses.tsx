import { useEffect, useState } from 'react';
import { createExpense, getReceiptSignedUrl, getRecentExpenses, uploadReceipt } from '../lib/expenseService';
import { useAuth } from '../lib/AuthContext';
import type { Expense } from '../lib/types';

// Expenses above this are flagged for HQ approval rather than treated
// as routine outlet spend. Kept as a single named constant so it's
// one place to change later, not a magic number buried in the submit
// handler.
const HQ_APPROVAL_THRESHOLD = 5000;

export default function Expenses() {
  const { appUser } = useAuth();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [recent, setRecent] = useState<Expense[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (appUser?.outlet_id) void getRecentExpenses(appUser.outlet_id).then(setRecent);
  }, [appUser?.outlet_id]);

  async function handleSubmit() {
    if (!appUser?.outlet_id || !amount || !reason || !receiptFile) return;
    if (Number(amount) <= 0) {
      setError('Amount must be greater than zero');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const receiptPath = await uploadReceipt(appUser.outlet_id, receiptFile);
      await createExpense({
        outletId: appUser.outlet_id,
        amount: Number(amount),
        reason,
        receiptPath,
        requiresHqApproval: Number(amount) >= HQ_APPROVAL_THRESHOLD,
        createdBy: appUser.id,
      });
      setAmount('');
      setReason('');
      setReceiptFile(null);
      setRecent(await getRecentExpenses(appUser.outlet_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save expense');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleViewReceipt(receiptPath: string | null) {
    if (!receiptPath) return;
    try {
      const url = await getReceiptSignedUrl(receiptPath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open receipt');
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Log Cash Expense</h2>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-3"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-3"
          placeholder="Reason / vendor"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Receipt photo (required)
        </label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="w-full mb-4"
          onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
        />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <button
          disabled={!amount || !reason || !receiptFile || submitting}
          onClick={() => void handleSubmit()}
          className="w-full bg-slate-800 text-white font-medium rounded-lg py-3 disabled:opacity-40"
        >
          {submitting ? 'Saving…' : 'Save Expense'}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Recent Expenses</h2>
        {recent.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
        <ul className="space-y-2">
          {recent.map((e) => (
            <li key={e.id} className="flex justify-between items-center text-sm border-b border-slate-100 pb-2">
              <span>{e.reason}</span>
              <div className="flex items-center gap-3">
                <span className="font-medium">₹{e.amount.toFixed(2)}</span>
                {e.receipt_url && (
                  <button
                    onClick={() => void handleViewReceipt(e.receipt_url)}
                    className="text-xs text-slate-500 underline"
                  >
                    Receipt
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
