import { useEffect, useState } from 'react';
import { getPendingCount } from '../lib/offlineQueue';

export default function OfflineIndicator() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    const interval = setInterval(() => {
      void getPendingCount().then(setPending);
    }, 5000);

    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      clearInterval(interval);
    };
  }, []);

  if (online && pending === 0) return null;

  return (
    <div
      className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow text-sm font-medium ${
        online ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
      }`}
    >
      {online
        ? `Syncing… ${pending} entr${pending === 1 ? 'y' : 'ies'} pending`
        : `Offline — ${pending} entr${pending === 1 ? 'y' : 'ies'} queued`}
    </div>
  );
}
