import { useEffect, useState } from 'react';
import { getAuditLog, AUDITED_TABLES, type AuditLogEntry } from '../lib/auditLogService';

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [tableFilter, setTableFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    void getAuditLog({ tableName: tableFilter || undefined })
      .then(setEntries)
      .finally(() => setLoading(false));
  }, [tableFilter]);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-slate-800">Audit Log</h2>
        <select
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
        >
          <option value="">All tables</option>
          {AUDITED_TABLES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && entries.length === 0 && <p className="text-sm text-slate-500">No entries.</p>}

      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.id} className="bg-white rounded-lg shadow">
            <button
              onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
              className="w-full text-left px-4 py-3 flex justify-between items-center"
            >
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {e.action} on {e.table_name}
                  {e.outlet_name && ` — ${e.outlet_name}`}
                </p>
                <p className="text-xs text-slate-500">
                  {new Date(e.created_at).toLocaleString()} · {e.changed_by_name}
                </p>
              </div>
              <span className="text-xs text-slate-400">{expandedId === e.id ? 'Hide' : 'Details'}</span>
            </button>
            {expandedId === e.id && (
              <div className="border-t border-slate-100 px-4 py-3 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="font-medium text-slate-600 mb-1">Before</p>
                  <pre className="bg-slate-50 rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap">
                    {e.before_data ? JSON.stringify(e.before_data, null, 2) : '—'}
                  </pre>
                </div>
                <div>
                  <p className="font-medium text-slate-600 mb-1">After</p>
                  <pre className="bg-slate-50 rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap">
                    {e.after_data ? JSON.stringify(e.after_data, null, 2) : '—'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
