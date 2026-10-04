import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../lib/firebase';

interface AuthState {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, loading: false })), []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/** For use inside routes guarded by RequireAuth. */
export function useCurrentUser() {
  const { user } = useContext(AuthContext);
  if (!user) throw new Error('useCurrentUser called without a signed-in user');
  return user;
}
