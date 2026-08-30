import { queueAction } from './offlineQueue';
import { supabase } from './supabaseClient';

export type CreditStatus = 'held' | 'adjusted' | 'refunded';

export interface CustomerCredit {
  id: string;
  outlet_id: string;
  bill_id: string | null;
  amount: number;
  reason: string;
  status: CreditStatus;
  used_against_bill_id: string | null;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
}

interface CreateCreditParams {
  outletId: string;
  billId?: string;
  amount: number;
  reason: string;
  createdBy: string;
}

export async function createCredit(params: CreateCreditParams) {
  return queueAction('customer_credits', 'insert', {
    outlet_id: params.outletId,
    bill_id: params.billId ?? null,
    amount: params.amount,
    reason: params.reason,
    created_by: params.createdBy,
  });
}

export async function getHeldCredits(outletId: string): Promise<CustomerCredit[]> {
  const { data, error } = await supabase
    .from('customer_credits')
    .select('*')
    .eq('outlet_id', outletId)
    .eq('status', 'held')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as CustomerCredit[];
}

// Direct, awaited call (not offline-queued) — this touches a bill's
// balance atomically via the DB function and should surface success
// or a cap violation immediately, the same reasoning as approvals
// and discharge elsewhere in this app.
export async function applyCreditToBill(creditId: string, billId: string, usedBy: string) {
  const { error } = await supabase.rpc('use_customer_credit', {
    p_credit_id: creditId,
    p_bill_id: billId,
    p_used_by: usedBy,
  });
  if (error) throw error;
}

export async function refundCredit(creditId: string) {
  const { error } = await supabase
    .from('customer_credits')
    .update({ status: 'refunded' })
    .eq('id', creditId);
  if (error) throw error;
}
