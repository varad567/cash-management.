import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabaseClient';
import type { AppUser } from './types';

interface AuthState {
  appUser: AppUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  appUser: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      const { data: sessionData } = await supabase.auth.getSession();
      const authUser = sessionData.session?.user;
      if (!authUser) {
        setAppUser(null);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('app_users')
        .select('*')
        .eq('id', authUser.id)
        .single();
      if (!error) setAppUser(data as AppUser);
      setLoading(false);
    }
    void loadUser();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void loadUser();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setAppUser(null);
  };

  return (
    <AuthContext.Provider value={{ appUser, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
