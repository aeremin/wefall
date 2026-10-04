import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { subscribeJumps } from '../lib/jumps';
import type { Jump } from '../lib/types';
import { useCurrentUser } from './AuthContext';

interface JumpsState {
  /** Sorted by jump number, highest first. */
  jumps: Jump[];
  loading: boolean;
  error: string | null;
}

const JumpsContext = createContext<JumpsState | null>(null);

export function JumpsProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const [state, setState] = useState<JumpsState>({ jumps: [], loading: true, error: null });

  useEffect(
    () =>
      subscribeJumps(
        user.uid,
        (jumps) => setState({ jumps, loading: false, error: null }),
        (err) => setState((s) => ({ ...s, loading: false, error: err.message })),
      ),
    [user.uid],
  );

  return <JumpsContext.Provider value={state}>{children}</JumpsContext.Provider>;
}

export function useJumps() {
  const ctx = useContext(JumpsContext);
  if (!ctx) throw new Error('useJumps must be used inside JumpsProvider');
  return ctx;
}
