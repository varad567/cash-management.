export type UserRole = 'cashier' | 'manager' | 'audit' | 'hq';

export interface Outlet {
  id: string;
  name: string;
  address: string | null;
  is_active: boolean;
}

export interface AppUser {
  id: string;
  outlet_id: string | null;
  full_name: string;
  role: UserRole;
  is_active: boolean;
}

export type AdmissionStatus = 'admitted' | 'discharged';

export interface Admission {
  id: string;
  outlet_id: string;
  patient_name: string;
  ward_bed: string | null;
  referring_doctor: string | null;
  admitted_at: string;
  discharged_at: string | null;
  status: AdmissionStatus;
}

export type BillType = 'admitted_patient' | 'walk_in';
export type BillStatus = 'open' | 'partial' | 'paid' | 'cancelled';

export interface Bill {
  id: string;
  outlet_id: string;
  bill_serial: string;
  bill_type: BillType;
  admission_id: string | null;
  bill_amount: number;
  amount_paid: number;
  balance_due: number;
  status: BillStatus;
  register_date: string;
}

export type PaymentMode = 'cash' | 'online';

export interface Payment {
  id: string;
  bill_id: string;
  outlet_id: string;
  amount: number;
  mode: PaymentMode;
  gateway_reference: string | null;
  register_date: string;
  received_at: string;
}

export type RegisterStatus = 'open' | 'pending_sync' | 'closed' | 'flagged';

export interface DailyRegister {
  id: string;
  outlet_id: string;
  register_date: string;
  opening_balance: number;
  cash_sales: number;
  cash_collected_old_bills: number;
  online_received: number;
  expenses_paid: number;
  deposits_made: number;
  expected_closing: number | null;
  counted_closing: number | null;
  mismatch: number | null;
  status: RegisterStatus;
}

// --- Offline queue item ---
// Any create/update made while offline is stored here first,
// then replayed against Supabase once connectivity returns.
export interface QueuedAction {
  local_id: string;
  table: 'bills' | 'payments' | 'expenses' | 'admissions' | 'cash_deposits';
  operation: 'insert' | 'update';
  payload: Record<string, unknown>;
  created_offline_at: string; // actual event time — used for register_date, never sync time
  device_id: string;
  synced: boolean;
}
