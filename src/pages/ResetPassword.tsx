import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
    } else {
      setDone(true);
    }
    setLoading(false);
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-full max-w-sm bg-white p-8 rounded-lg shadow border border-slate-200 text-center">
          <h1 className="text-xl font-semibold mb-2 text-slate-800">Password updated</h1>
          <p className="text-sm text-slate-500 mb-4">You can now sign in with your new password.</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-slate-800 text-white rounded py-2 font-medium"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white p-8 rounded-lg shadow border border-slate-200"
      >
        <h1 className="text-xl font-semibold mb-6 text-slate-800">Set a new password</h1>
        <label className="block text-sm text-slate-600 mb-1">New password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-slate-300 rounded px-3 py-2 mb-4"
          required
        />
        <label className="block text-sm text-slate-600 mb-1">Confirm password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full border border-slate-300 rounded px-3 py-2 mb-4"
          required
        />
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-slate-800 text-white rounded py-2 font-medium disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Set password'}
        </button>
      </form>
    </div>
  );
}
