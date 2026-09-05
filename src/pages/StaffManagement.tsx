import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { resetStaffPassword } from '../lib/staffService';
import type { AppUser, Outlet, UserRole } from '../lib/types';

const ROLES: UserRole[] = ['cashier', 'manager', 'audit', 'hq'];

interface StaffRow extends AppUser {
  outlet_name: string | null;
}

export default function StaffManagement() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterOutlet, setFilterOutlet] = useState('');
  const [filterRole, setFilterRole] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('cashier');
  const [editOutletId, setEditOutletId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [resetLink, setResetLink] = useState<{ email: string; link: string } | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: users, error: usersError }, { data: outletRows }] = await Promise.all([
      supabase.from('app_users').select('*, outlets(name)').order('full_name'),
      supabase.from('outlets').select('*').order('name'),
    ]);
    if (usersError) setError(usersError.message);
    else {
      setStaff(
        ((users as (AppUser & { outlets: { name: string } | null })[]) ?? []).map((u) => ({
          ...u,
          outlet_name: u.outlets?.name ?? null,
        }))
      );
    }
    setOutlets((outletRows as Outlet[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function startEdit(u: StaffRow) {
    setEditingId(u.id);
    setEditRole(u.role);
    setEditOutletId(u.outlet_id ?? '');
  }

  async function saveEdit(id: string) {
    if (editRole !== 'hq' && !editOutletId) {
      setError('Select an outlet for this role');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('app_users')
      .update({
        role: editRole,
        outlet_id: editRole === 'hq' ? null : editOutletId,
      })
      .eq('id', id);
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setEditingId(null);
    void load();
  }

  async function toggleActive(u: StaffRow) {
    setError(null);
    const { error: updateError } = await supabase
      .from('app_users')
      .update({ is_active: !u.is_active })
      .eq('id', u.id);
    if (updateError) setError(updateError.message);
    else void load();
  }

  async function handleReset(u: StaffRow) {
    setResettingId(u.id);
    setError(null);
    try {
      const { email, action_link } = await resetStaffPassword(u.id);
      setResetLink({ email, link: action_link });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate reset link');
    } finally {
      setResettingId(null);
    }
  }

  const filtered = staff.filter(
    (u) =>
      (!filterOutlet || u.outlet_id === filterOutlet) && (!filterRole || u.role === filterRole)
  );

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Staff</h2>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {resetLink && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 text-sm">
          <p className="font-medium text-slate-800 mb-1">
            Reset link for {resetLink.email}
          </p>
          <p className="text-slate-600 mb-2">
            Share this with them directly (WhatsApp, SMS) — it's a one-time link, not sent by email
            automatically.
          </p>
          <input
            readOnly
            className="w-full border border-slate-300 rounded px-3 py-2 text-xs bg-white"
            value={resetLink.link}
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button
            onClick={() => setResetLink(null)}
            className="mt-2 text-xs text-slate-500 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex gap-3 mb-4">
        <select
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          value={filterOutlet}
          onChange={(e) => setFilterOutlet(e.target.value)}
        >
          <option value="">All outlets</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        {filtered.map((u) => (
          <div key={u.id} className="bg-white rounded-xl shadow p-4">
            {editingId === u.id ? (
              <div className="space-y-3">
                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {editRole !== 'hq' && (
                  <select
                    className="w-full border border-slate-300 rounded-lg px-3 py-2"
                    value={editOutletId}
                    onChange={(e) => setEditOutletId(e.target.value)}
                  >
                    <option value="">Select outlet…</option>
                    {outlets.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex gap-2">
                  <button
                    disabled={submitting}
                    onClick={() => void saveEdit(u.id)}
                    className="flex-1 bg-slate-800 text-white rounded-lg py-2 font-medium"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="flex-1 border border-slate-300 rounded-lg py-2 font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="font-medium text-slate-800">
                    {u.full_name}{' '}
                    {!u.is_active && (
                      <span className="text-xs text-red-600 font-normal">(inactive)</span>
                    )}
                  </p>
                  <p className="text-sm text-slate-500">
                    {u.role} · {u.outlet_name ?? 'All outlets'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(u)} className="text-sm text-slate-600 underline">
                      Edit
                    </button>
                    <button
                      onClick={() => void toggleActive(u)}
                      className={`text-sm underline ${u.is_active ? 'text-red-600' : 'text-green-700'}`}
                    >
                      {u.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                  <button
                    disabled={resettingId === u.id}
                    onClick={() => void handleReset(u)}
                    className="text-xs text-slate-500 underline disabled:opacity-40"
                  >
                    {resettingId === u.id ? 'Generating…' : 'Reset password'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
