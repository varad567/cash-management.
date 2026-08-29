import { useEffect } from 'react';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { initOfflineSync } from './lib/offlineQueue';
import Login from './pages/Login';
import OfflineIndicator from './components/OfflineIndicator';

function Shell() {
  const { appUser, loading, signOut } = useAuth();

  useEffect(() => {
    initOfflineSync();
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }

  if (!appUser) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
        <div>
          <h1 className="font-semibold text-slate-800">Cash Management</h1>
          <p className="text-sm text-slate-500">
            {appUser.full_name} — {appUser.role}
          </p>
        </div>
        <button onClick={() => void signOut()} className="text-sm text-slate-600 underline">
          Sign out
        </button>
      </header>
      <main className="p-6">
        <p className="text-slate-500">
          Phase 1 complete: schema, auth, and offline-sync foundation are live.
          Phase 2 (daily register + patient admission) plugs in here next.
        </p>
      </main>
      <OfflineIndicator />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
