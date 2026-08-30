import { supabase } from './supabaseClient';

export interface AuditLogEntry {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  changed_by: string;
  changed_by_name: string;
  reason: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  outlet_id: string | null;
  outlet_name: string | null;
  created_at: string;
}

export const AUDITED_TABLES = [
  'bills',
  'payments',
  'expenses',
  'cash_deposits',
  'admissions',
  'shift_registers',
  'returns',
] as const;

interface GetAuditLogParams {
  tableName?: string;
  limit?: number;
}

export async function getAuditLog(params: GetAuditLogParams = {}): Promise<AuditLogEntry[]> {
  let query = supabase
    .from('audit_log_readable')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 50);

  if (params.tableName) {
    query = query.eq('table_name', params.tableName);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as AuditLogEntry[];
}
