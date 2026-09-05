import { supabase } from './supabaseClient';

export async function resetStaffPassword(
  userId: string
): Promise<{ email: string; action_link: string }> {
  const { data, error } = await supabase.functions.invoke('reset-user-password', {
    body: { user_id: userId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { email: string; action_link: string };
}
