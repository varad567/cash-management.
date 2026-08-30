import { supabase } from './supabaseClient';
import type { QueuedAction } from './types';

const DB_NAME = 'cash_mgmt_offline';
const STORE_NAME = 'queued_actions';
const DB_VERSION = 1;

// Postgres error codes (and the SQLSTATE Postgres uses for a plain
// `raise exception` in a trigger/function, P0001) that mean the
// write is fundamentally invalid — retrying with the exact same
// payload will fail identically every time. Anything else (network
// drop, a momentary RLS mismatch, a foreign key waiting on a
// still-unsynced row) is left retryable, since it may genuinely
// resolve on its own.
const PERMANENT_ERROR_CODES = new Set([
  '23505', // unique_violation — e.g. a bill serial that already exists
  '23514', // check_violation — e.g. a negative amount slipping past client validation
  'P0001', // raise exception — every custom business-rule check in this schema
]);

function isPermanentError(code: string | undefined): boolean {
  return !!code && PERMANENT_ERROR_CODES.has(code);
}

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
      // "Pending" means still trying — a failed item has stopped
      // retrying and needs a human decision, so it's counted
      // separately (see getFailedActions) rather than inflating the
      // "still syncing" number forever.
      const pending = (req.result as QueuedAction[]).filter((a) => !a.synced && !a.failed);
      resolve(pending.length);
    };
    req.onerror = () => reject(req.error);
  });
}

// Items that permanently failed and will never be retried
// automatically — surfaced so a person can fix or discard them.
export async function getFailedActions(): Promise<QueuedAction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      resolve((req.result as QueuedAction[]).filter((a) => a.failed));
    };
    req.onerror = () => reject(req.error);
  });
}

// Removes a failed item from the queue permanently — for entries the
// person has reviewed and decided not to re-attempt (e.g. a genuine
// duplicate bill number that should just be re-entered correctly).
export async function discardFailedAction(local_id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(local_id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Replays queued actions in the order they were created.
// A register cannot be closed (see registerService.closeRegister) while
// this returns any pending items for that outlet/date.
//
// Guarded by isSyncing: queueAction fires this in the background on
// every write without awaiting it, so two writes made in quick
// succession (e.g. a bill then its payment) could otherwise trigger
// two overlapping passes that both try to process the same
// not-yet-synced item — risking a duplicate insert or a
// double-counted register total.
let isSyncing = false;

export async function syncPendingActions(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;
  try {
    await runSyncPass();
  } finally {
    isSyncing = false;
  }
}

async function runSyncPass(): Promise<void> {
  const db = await openDb();
  const actions: QueuedAction[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as QueuedAction[]);
    req.onerror = () => reject(req.error);
  });

  const pending = actions
    .filter((a) => !a.synced && !a.failed)
    .sort((a, b) => a.created_offline_at.localeCompare(b.created_offline_at));

  for (const action of pending) {
    try {
      let error: { message: string; code?: string } | null = null;
      let outletId: unknown;

      if (action.operation === 'rpc') {
        ({ error } = await supabase.rpc(action.table, action.payload));
        // RPC params are named p_* to match the Postgres function
        // signature, so pull outlet id from there for the sync_log row.
        outletId = action.payload.p_outlet_id ?? action.payload.outlet_id;
      } else {
        const table = supabase.from(action.table);
        ({ error } =
          action.operation === 'insert'
            ? await table.insert(action.payload)
            : await table.update(action.payload).eq('id', action.payload.id as string));
        outletId = action.payload.outlet_id;
      }

      if (error) {
        if (isPermanentError(error.code)) {
          // Stop retrying — this exact payload will never succeed.
          // Flag it so the UI can show the person what happened and
          // let them discard it or fix it manually, instead of
          // silently retrying an impossible write every 30 seconds.
          console.error('Permanent sync failure for', action.local_id, error.message);
          const markDb = await openDb();
          const tx = markDb.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put({ ...action, failed: true, error_message: error.message });
        } else {
          // Leave it queued; will retry on next sync pass (network flap,
          // a momentary RLS mismatch, or a foreign key waiting on a
          // still-unsynced row from earlier in the queue).
          console.error('Sync failed for', action.local_id, error.message);
        }
        continue;
      }

      // Record the mapping + mark synced
      await supabase.from('sync_log').insert({
        local_id: action.local_id,
        table_name: action.table,
        outlet_id: outletId,
        device_id: action.device_id,
        created_offline_at: action.created_offline_at,
        synced_at: new Date().toISOString(),
      });

      // Fully done with this item now — delete rather than flag
      // synced:true and keep it forever. There's nothing in this app
      // that reads back a synced item's history from this local
      // store, so leaving it here indefinitely would just grow
      // IndexedDB without bound over the life of the device.
      const markDb = await openDb();
      const tx = markDb.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(action.local_id);
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
