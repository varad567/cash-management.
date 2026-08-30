import { queueAction } from './offlineQueue';
import { supabase } from './supabaseClient';
import type { Bill, BillStatus, BillType, PaymentMode } from './types';

interface CreateWalkInSaleParams {
  outletId: string;
  billSerial: string;
  billAmount: number;
  mode: PaymentMode;
  gatewayReference?: string;
  createdBy: string;
}

// Walk-in bills must be paid in full — bill + payment are created in
// one atomic DB transaction (see migration 0009). Do NOT use
// createBill + recordPayment for walk-ins: two separate inserts can
// never satisfy the full-payment constraint, since the bill would
// briefly exist with balance_due > 0 before the payment attaches.
export async function createWalkInSale(params: CreateWalkInSaleParams) {
  if (params.mode === 'online' && !params.gatewayReference) {
    throw new Error('Online payments require a gateway reference');
  }
  return queueAction('record_walk_in_sale', 'rpc', {
    p_outlet_id: params.outletId,
    p_bill_serial: params.billSerial,
    p_bill_amount: params.billAmount,
    p_payment_amount: params.billAmount, // walk-in: payment must equal the bill in full
    p_payment_mode: params.mode,
    p_gateway_reference: params.gatewayReference ?? null,
    p_created_by: params.createdBy,
  });
}

interface CreateBillParams {
  outletId: string;
  billSerial: string;
  billType: BillType;
  admissionId: string | null;
  billAmount: number;
  createdBy: string;
}

// Only for admitted-patient bills, which are allowed to carry a
// balance — walk-in sales must use createWalkInSale instead (see
// migration 0009 for why the two-step insert doesn't work for those).
//
// Returns the bill's id (client-generated, not the offline-queue
// local_id) so a same-screen payment can reference it immediately —
// bills.id has no other default that would collide, so supplying it
// client-side works identically online and offline, and the payment
// insert doesn't need to wait for the bill to actually sync first.
export async function createBill(params: CreateBillParams): Promise<string> {
  const billId = crypto.randomUUID();
  await queueAction('bills', 'insert', {
    id: billId,
    outlet_id: params.outletId,
    bill_serial: params.billSerial,
    bill_type: params.billType,
    admission_id: params.admissionId,
    bill_amount: params.billAmount,
    register_date: new Date().toISOString().slice(0, 10),
    created_by: params.createdBy,
  });
  return billId;
}

interface RecordPaymentParams {
  billId: string;
  outletId: string;
  amount: number;
  mode: PaymentMode;
  gatewayReference?: string;
  receivedBy: string;
}

export async function recordPayment(params: RecordPaymentParams) {
  if (params.mode === 'online' && !params.gatewayReference) {
    throw new Error('Online payments require a gateway reference');
  }
  return queueAction('payments', 'insert', {
    bill_id: params.billId,
    outlet_id: params.outletId,
    amount: params.amount,
    mode: params.mode,
    gateway_reference: params.gatewayReference ?? null,
    register_date: new Date().toISOString().slice(0, 10),
    received_by: params.receivedBy,
  });
}

// Admitted-patient bills carrying a balance from an earlier shift —
// the actual UI for the "carried forward 2-3 days, paid off later"
// case. Excludes fully paid/cancelled bills so a cashier can only
// ever select something that genuinely still owes money.
export async function getPayableBillsForAdmission(admissionId: string): Promise<Bill[]> {
  const { data, error } = await supabase
    .from('bills')
    .select('*')
    .eq('admission_id', admissionId)
    .in('status', ['open', 'partial'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as Bill[];
}

// Searchable bill browsing — outlet-scoped for cashier/manager
// (via RLS), cross-outlet for HQ/audit automatically. Supersedes the
// old getRecentBills, which was written in Phase 1 and never
// actually wired to any screen.
interface SearchBillsParams {
  serial?: string;
  status?: BillStatus;
  limit?: number;
}

export async function searchBills(params: SearchBillsParams = {}): Promise<Bill[]> {
  let query = supabase
    .from('bills')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 30);

  if (params.serial) {
    query = query.ilike('bill_serial', `%${params.serial.trim()}%`);
  }
  if (params.status) {
    query = query.eq('status', params.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as Bill[];
}
