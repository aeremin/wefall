import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { parseRoles, type Role } from '../lib/roles';

interface AuthState {
  user: User | null;
  /** From the `roles` custom claim of the user's ID token. */
  roles: Role[];
  loading: boolean;
}

const AuthContext = createContext<AuthState>({ user: null, roles: [], loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, roles: [], loading: true });

  // onIdTokenChanged also fires on the hourly token refresh, which picks up changed roles.
  useEffect(
    () =>
      onIdTokenChanged(auth, async (user) => {
        let roles: Role[] = [];
        if (user) {
          try {
            roles = parseRoles((await user.getIdTokenResult()).claims.roles);
          } catch {
            // Offline with an expired token: no roles rather than no app.
          }
        }
        setState({ user, roles, loading: false });
      }),
    [],
  );

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

export function useRoles() {
  return useContext(AuthContext).roles;
}
