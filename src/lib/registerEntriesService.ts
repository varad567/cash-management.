import { supabase } from './supabaseClient';

export interface RegisterEntry {
  register_id: string;
  outlet_id: string;
  entry_type: 'bill' | 'payment' | 'expense' | 'deposit' | 'return' | 'credit_refund';
  amount: number;
  description: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
}

export async function getRegisterEntries(registerId: string): Promise<RegisterEntry[]> {
  const { data, error } = await supabase
    .from('register_entries')
    .select('*')
    .eq('register_id', registerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as RegisterEntry[];
}
