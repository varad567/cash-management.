import { useEffect, useState } from 'react';
import { dischargePatient, getActiveAdmissions, registerAdmission } from '../lib/admissionService';
import { useAuth } from '../lib/AuthContext';
import type { Admission } from '../lib/types';

export default function Admissions() {
  const { appUser } = useAuth();
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [patientName, setPatientName] = useState('');
  const [wardBed, setWardBed] = useState('');
  const [doctor, setDoctor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    if (!appUser?.outlet_id) return;
    setAdmissions(await getActiveAdmissions(appUser.outlet_id));
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUser?.outlet_id]);

  async function handleRegister() {
    if (!appUser?.outlet_id || !patientName) return;
    setSubmitting(true);
    setError(null);
    try {
      await registerAdmission({
        outletId: appUser.outlet_id,
        patientName,
        wardBed: wardBed || undefined,
        referringDoctor: doctor || undefined,
        createdBy: appUser.id,
      });
      setPatientName('');
      setWardBed('');
      setDoctor('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register patient');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDischarge(id: string, patientName: string) {
    if (!window.confirm(`Discharge ${patientName}? This can't be easily undone.`)) return;
    setError(null);
    try {
      await dischargePatient(id);
      await refresh();
    } catch (err) {
      // Most likely cause: an outstanding bill balance — the server
      // trigger blocks this regardless of what the UI shows.
      setError(err instanceof Error ? err.message : 'Could not discharge patient');
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Register Patient</h2>
        <input
          className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-3"
          placeholder="Patient name"
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
        />
        <input
          className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-3"
          placeholder="Ward / bed (optional)"
          value={wardBed}
          onChange={(e) => setWardBed(e.target.value)}
        />
        <input
          className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-4"
          placeholder="Referring doctor (optional)"
          value={doctor}
          onChange={(e) => setDoctor(e.target.value)}
        />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <button
          disabled={!patientName || submitting}
          onClick={() => void handleRegister()}
          className="w-full bg-slate-800 text-white font-medium rounded-lg py-3 disabled:opacity-40"
        >
          {submitting ? 'Registering…' : 'Register'}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Currently Admitted</h2>
        {admissions.length === 0 && <p className="text-sm text-slate-500">No admitted patients.</p>}
        <ul className="space-y-3">
          {admissions.map((a) => (
            <li
              key={a.id}
              className="flex justify-between items-center border border-slate-200 rounded-lg px-4 py-3"
            >
              <div>
                <p className="font-medium text-slate-800">{a.patient_name}</p>
                <p className="text-xs text-slate-500">{a.ward_bed ?? 'No ward assigned'}</p>
              </div>
              <button
                onClick={() => void handleDischarge(a.id, a.patient_name)}
                className="text-sm border border-slate-300 rounded-lg px-3 py-2"
              >
                Discharge
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
