import { supabase } from './supabaseClient';
import type { QueuedAction } from './types';

const DB_NAME = 'cash_mgmt_offline';
const STORE_NAME = 'queued_actions';
const DB_VERSION = 1;

// Stable per-browser device id, used to detect duplicate syncs
function getDeviceId(): string {
  let id = localStorage.getItem('device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('device_id', id);
  }
  return id;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'local_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Queue an action locally. Call this INSTEAD of calling supabase directly
// for any bill/payment/expense/admission/deposit write, so the app works
// identically online or offline.
export async function queueAction(
  table: QueuedAction['table'],
  operation: QueuedAction['operation'],
  payload: Record<string, unknown>
): Promise<string> {
  const local_id = crypto.randomUUID();
  const action: QueuedAction = {
    local_id,
    table,
    operation,
    payload,
    created_offline_at: new Date().toISOString(), // real event time, preserved through sync
    device_id: getDeviceId(),
    synced: false,
  };

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(action);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Try immediate sync if online; otherwise it waits for the next sync pass.
  if (navigator.onLine) {
    void syncPendingActions();
  }
  return local_id;
}

export async function getPendingCount(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const pending = (req.result as QueuedAction[]).filter((a) => !a.synced);
      resolve(pending.length);
    };
    req.onerror = () => reject(req.error);
  });
}

// Replays queued actions in the order they were created.
// A register cannot be closed (see registerService.closeRegister) while
// this returns any pending items for that outlet/date.
export async function syncPendingActions(): Promise<void> {
  const db = await openDb();
  const actions: QueuedAction[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as QueuedAction[]);
    req.onerror = () => reject(req.error);
  });

  const pending = actions
    .filter((a) => !a.synced)
    .sort((a, b) => a.created_offline_at.localeCompare(b.created_offline_at));

  for (const action of pending) {
    try {
      const table = supabase.from(action.table);
      const { error } =
        action.operation === 'insert'
          ? await table.insert(action.payload)
          : await table.update(action.payload).eq('id', action.payload.id as string);

      if (error) {
        // Leave it queued; will retry on next sync pass (e.g. network flap, RLS issue).
        // A true conflict (same bill touched offline + online) surfaces here for manual review.
        console.error('Sync failed for', action.local_id, error.message);
        continue;
      }

      // Record the mapping + mark synced
      await supabase.from('sync_log').insert({
        local_id: action.local_id,
        table_name: action.table,
        outlet_id: action.payload.outlet_id,
        device_id: action.device_id,
        created_offline_at: action.created_offline_at,
        synced_at: new Date().toISOString(),
      });

      const markDb = await openDb();
      const tx = markDb.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ ...action, synced: true });
    } catch (err) {
      console.error('Sync error for', action.local_id, err);
    }
  }
}

// Call once at app startup to retry sync whenever connectivity returns.
export function initOfflineSync(): void {
  window.addEventListener('online', () => void syncPendingActions());
  // Also retry periodically in case 'online' event is unreliable on the device
  setInterval(() => {
    if (navigator.onLine) void syncPendingActions();
  }, 30_000);
}
