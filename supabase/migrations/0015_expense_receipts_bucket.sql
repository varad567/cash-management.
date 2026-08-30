-- ============================================================
-- Expense receipts storage bucket
-- ============================================================
-- Private, not public — these are financial documents. Access is
-- scoped by outlet folder (uploadReceipt in expenseService.ts stores
-- each file at "<outlet_id>/<uuid>.<ext>"), same pattern as every
-- other outlet-scoped table in this schema. HQ/audit see everything,
-- same as elsewhere.

insert into storage.buckets (id, name, public)
values ('expense-receipts', 'expense-receipts', false)
on conflict (id) do nothing;

create policy "receipts_insert_own_outlet" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'expense-receipts'
  and (
    (auth.jwt() ->> 'app_role') in ('hq', 'audit')
    or (storage.foldername(name))[1] = (auth.jwt() ->> 'app_outlet_id')
  )
);

create policy "receipts_select_own_outlet" on storage.objects
for select to authenticated
using (
  bucket_id = 'expense-receipts'
  and (
    (auth.jwt() ->> 'app_role') in ('hq', 'audit')
    or (storage.foldername(name))[1] = (auth.jwt() ->> 'app_outlet_id')
  )
);
