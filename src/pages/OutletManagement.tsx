import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Outlet } from '../lib/types';

export default function OutletManagement() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('outlets')
      .select('*')
      .order('name');
    if (fetchError) setError(fetchError.message);
    else setOutlets((data as Outlet[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function startEdit(o: Outlet) {
    setEditingId(o.id);
    setName(o.name);
    setAddress(o.address ?? '');
  }

  async function saveEdit(id: string) {
    setSubmitting(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('outlets')
      .update({ name, address: address || null })
      .eq('id', id);
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setEditingId(null);
    void load();
  }

  async function toggleActive(o: Outlet) {
    setError(null);
    const { error: updateError } = await supabase
      .from('outlets')
      .update({ is_active: !o.is_active })
      .eq('id', o.id);
    if (updateError) setError(updateError.message);
    else void load();
  }

  async function createOutlet() {
    if (!newName.trim()) return;
    setSubmitting(true);
    setError(null);
    const { error: insertError } = await supabase
      .from('outlets')
      .insert({ name: newName.trim(), address: newAddress || null });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setNewName('');
    setNewAddress('');
    setAddingNew(false);
    void load();
  }

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Outlets</h2>
        <button
          onClick={() => setAddingNew(!addingNew)}
          className="text-sm bg-slate-800 text-white rounded-lg px-4 py-2 font-medium"
        >
          {addingNew ? 'Cancel' : '+ Add Outlet'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {addingNew && (
        <div className="bg-white rounded-xl shadow p-4 mb-4 space-y-3">
          <input
            className="w-full border border-slate-300 rounded-lg px-4 py-3"
            placeholder="Outlet name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="w-full border border-slate-300 rounded-lg px-4 py-3"
            placeholder="Address (optional)"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
          />
          <button
            disabled={!newName.trim() || submitting}
            onClick={() => void createOutlet()}
            className="w-full bg-slate-800 text-white font-medium rounded-lg py-3 disabled:opacity-40"
          >
            {submitting ? 'Creating…' : 'Create Outlet'}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {outlets.map((o) => (
          <div key={o.id} className="bg-white rounded-xl shadow p-4">
            {editingId === o.id ? (
              <div className="space-y-3">
                <input
                  className="w-full border border-slate-300 rounded-lg px-4 py-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <input
                  className="w-full border border-slate-300 rounded-lg px-4 py-2"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Address"
                />
                <div className="flex gap-2">
                  <button
                    disabled={submitting}
                    onClick={() => void saveEdit(o.id)}
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
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium text-slate-800">
                    {o.name}{' '}
                    {!o.is_active && (
                      <span className="text-xs text-red-600 font-normal">(inactive)</span>
                    )}
                  </p>
                  {o.address && <p className="text-sm text-slate-500">{o.address}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => startEdit(o)} className="text-sm text-slate-600 underline">
                    Edit
                  </button>
                  <button
                    onClick={() => void toggleActive(o)}
                    className={`text-sm underline ${o.is_active ? 'text-red-600' : 'text-green-700'}`}
                  >
                    {o.is_active ? 'Deactivate' : 'Reactivate'}
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
