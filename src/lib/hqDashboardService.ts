import { supabase } from './supabaseClient';
import type { Outlet, ShiftRegister } from './types';

export interface OutletOverview {
  outlet: Outlet;
  openRegister: ShiftRegister | null;
}

// Only a handful of outlets in practice, so N+1 queries here are
// simpler and clearer than a view — not worth the extra indirection
// at this scale.
export async function getOutletsOverview(): Promise<OutletOverview[]> {
  const { data: outlets, error } = await supabase
    .from('outlets')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;

  const overview: OutletOverview[] = [];
  for (const outlet of outlets as Outlet[]) {
    const { data: reg } = await supabase
      .from('shift_registers')
      .select('*')
      .eq('outlet_id', outlet.id)
      .eq('status', 'open')
      .maybeSingle();
    overview.push({ outlet, openRegister: reg as ShiftRegister | null });
  }
  return overview;
}
