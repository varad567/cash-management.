import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  async function handleResetRequest(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) {
      setError(error.message);
    } else {
      setResetSent(true);
    }
    setLoading(false);
  }

  if (resetMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <form
          onSubmit={handleResetRequest}
          className="w-full max-w-sm bg-white p-8 rounded-lg shadow border border-slate-200"
        >
          <h1 className="text-xl font-semibold mb-2 text-slate-800">Reset password</h1>
          {resetSent ? (
            <p className="text-sm text-slate-600 mb-4">
              If an account exists for {email}, a reset link has been sent. Check your email.
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-500 mb-4">
                Enter your email and we'll send a link to reset your password.
              </p>
              <label className="block text-sm text-slate-600 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2 mb-4"
                required
              />
              {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-slate-800 text-white rounded py-2 font-medium disabled:opacity-50 mb-3"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setResetMode(false);
              setResetSent(false);
              setError(null);
            }}
            className="w-full text-sm text-slate-500 underline"
          >
            Back to sign in
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white p-8 rounded-lg shadow border border-slate-200"
      >
        <h1 className="text-xl font-semibold mb-6 text-slate-800">Cash Management — Sign in</h1>
        <label className="block text-sm text-slate-600 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-slate-300 rounded px-3 py-2 mb-4"
          required
        />
        <label className="block text-sm text-slate-600 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-slate-300 rounded px-3 py-2 mb-2"
          required
        />
        <button
          type="button"
          onClick={() => {
            setResetMode(true);
            setError(null);
          }}
          className="text-xs text-slate-500 underline mb-4 block"
        >
          Forgot password?
        </button>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-slate-800 text-white rounded py-2 font-medium disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
