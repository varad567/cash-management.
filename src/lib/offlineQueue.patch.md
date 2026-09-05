# Patch: offlineQueue.ts

Apply this by hand — it's a small, surgical change to the existing
`runSyncPass()` function, not a full file replacement (so it doesn't
clobber anything else in the file).

## 1. Add outlet_id extraction before the try/catch (already present)

`outletId` is already computed earlier in the loop — no change needed there.

## 2. Replace this block:

```ts
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
```

## with this:

```ts
if (isPermanentError(error.code)) {
  // Stop retrying — this exact payload will never succeed.
  // Flag it so the UI can show the person what happened and
  // let them discard it or fix it manually, instead of
  // silently retrying an impossible write every 30 seconds.
  //
  // Also log it server-side (sync_failures) so HQ actually finds
  // out — previously this only went to console.error, which nobody
  // is ever watching on a cashier's phone. A trigger on that table
  // (migration 0021) fires an SMS alert automatically.
  console.error('Permanent sync failure for', action.local_id, error.message);
  try {
    await supabase.from('sync_failures').insert({
      outlet_id: (outletId as string | undefined) ?? null,
      device_id: action.device_id,
      table_name: action.table,
      error_message: error.message,
      payload: action.payload,
    });
  } catch (logErr) {
    // Logging the failure failed too (e.g. fully offline) — the item
    // is still flagged `failed` locally below, so nothing is lost;
    // it just won't alert until the device is back online and the
    // person opens the app again to trigger a fresh sync pass.
    console.error('Could not log sync_failures row for', action.local_id, logErr);
  }
  const markDb = await openDb();
  const tx = markDb.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put({ ...action, failed: true, error_message: error.message });
} else {
```

No other changes needed — `supabase` is already imported at the top
of the file.
