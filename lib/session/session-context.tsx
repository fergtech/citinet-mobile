import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { loginUser } from '@/lib/api/hubService';
import { sessionStorage } from '@/lib/session/storage';
import type { HubSummary, StoredSession } from '@/lib/session/types';

const STORAGE_KEY = 'citinet-session';

type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

type SessionContextValue = {
  status: SessionStatus;
  session: StoredSession | null;
  signIn: (hub: HubSummary, credentials: { username: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<StoredSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    sessionStorage.getItem(STORAGE_KEY).then((raw) => {
      if (cancelled) return;
      if (raw) {
        setSession(JSON.parse(raw));
        setStatus('signedIn');
      } else {
        setStatus('signedOut');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      session,
      async signIn(hub, credentials) {
        const result = await loginUser(hub.tunnelUrl, credentials.username, credentials.password);
        const next: StoredSession = {
          hub,
          userId: result.userId,
          username: result.username,
          displayName: result.display_name,
          avatarUrl: result.avatar_url,
          isAdmin: result.isAdmin,
          token: result.token,
        };
        await sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setSession(next);
        setStatus('signedIn');
      },
      async signOut() {
        await sessionStorage.deleteItem(STORAGE_KEY);
        setSession(null);
        setStatus('signedOut');
      },
    }),
    [status, session]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
