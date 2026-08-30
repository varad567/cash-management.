import { supabase } from './supabaseClient';
import type { UserRole } from './types';

interface CreateUserParams {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  outletId?: string;
}

export async function createStaffUser(params: CreateUserParams): Promise<void> {
  const { data, error } = await supabase.functions.invoke('create-user', {
    body: {
      email: params.email,
      password: params.password,
      full_name: params.fullName,
      role: params.role,
      outlet_id: params.outletId ?? null,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}
