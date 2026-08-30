import { useEffect, useState } from 'react';
import { createStaffUser } from '../lib/hqUserService';
import { supabase } from '../lib/supabaseClient';
import type { Outlet, UserRole } from '../lib/types';

const ROLES: UserRole[] = ['cashier', 'manager', 'audit', 'hq'];

export default function AddUser() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('cashier');
  const [outletId, setOutletId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void supabase
      .from('outlets')
      .select('*')
      .eq('is_active', true)
      .then(({ data }) => setOutlets((data as Outlet[]) ?? []));
  }, []);

  async function handleSubmit() {
    if (!email || !password || !fullName) return;
    if (role !== 'hq' && !outletId) {
      setError('Select an outlet for this role');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createStaffUser({
        email,
        password,
        fullName,
        role,
        outletId: role === 'hq' ? undefined : outletId,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create user');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto mt-12 bg-white rounded-xl shadow p-8 text-center">
        <h2 className="text-xl font-semibold text-green-700 mb-2">User created</h2>
        <p className="text-slate-500 mb-6">{fullName} can now sign in with the email and password you set.</p>
        <button
          onClick={() => {
            setDone(false);
            setEmail('');
            setPassword('');
            setFullName('');
            setOutletId('');
          }}
          className="bg-slate-800 text-white rounded-lg py-3 px-6 font-medium"
        >
          Add Another
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Add Staff User</h2>

      <input
        type="email"
        className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-3"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-3"
        placeholder="Temporary password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-3"
        placeholder="Full name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />

      <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
      <select
        className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-3"
        value={role}
        onChange={(e) => setRole(e.target.value as UserRole)}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>

      {role !== 'hq' && (
        <>
          <label className="block text-sm font-medium text-slate-700 mb-1">Outlet</label>
          <select
            className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-3"
            value={outletId}
            onChange={(e) => setOutletId(e.target.value)}
          >
            <option value="">Select outlet…</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </>
      )}

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <button
        disabled={!email || !password || !fullName || submitting}
        onClick={() => void handleSubmit()}
        className="w-full bg-slate-800 text-white font-medium rounded-lg py-3 disabled:opacity-40"
      >
        {submitting ? 'Creating…' : 'Create User'}
      </button>
    </div>
  );
}
