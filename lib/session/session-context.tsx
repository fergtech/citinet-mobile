import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getSessionStatus, loginUser, registerUser, type RegisterInput } from '@/lib/api/hubService';
import type { LoginResponse } from '@/lib/api/types';
import { sessionStorage } from '@/lib/session/storage';
import type { HubSummary, PendingAccount, StoredSession } from '@/lib/session/types';

const STORAGE_KEY = 'citinet-session';

// 'pending' covers both a pending-approval and a rejected account — both are
// "not into the app yet" states, distinguished within pendingAccount.accountStatus
// rather than as separate top-level statuses, since app/_layout.tsx's
// Stack.Protected guard only needs to route them to the same waiting screen.
type SessionStatus = 'loading' | 'signedOut' | 'pending' | 'signedIn';

type SessionContextValue = {
  status: SessionStatus;
  session: StoredSession | null;
  // Only set while status === 'pending' — kept in memory only (not persisted
  // like StoredSession), so a pending/rejected wait doesn't survive an app
  // restart. Re-opening the app after quitting mid-wait drops back to
  // hub-select rather than resuming the waiting screen; logging back in
  // picks the wait back up (loginUser tolerates a non-approved account the
  // same way registerUser does).
  pendingAccount: PendingAccount | null;
  signIn: (hub: HubSummary, credentials: { username: string; password: string }) => Promise<void>;
  signUp: (hub: HubSummary, input: RegisterInput) => Promise<void>;
  /** Polls session-status; returns true (and transitions to signedIn) once approved. */
  checkPendingStatus: () => Promise<boolean>;
  /** "Back to onboarding" — drops the pending account and returns to hub-select. */
  cancelPending: () => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<StoredSession | null>(null);
  const [pendingAccount, setPendingAccount] = useState<PendingAccount | null>(null);

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

  const value = useMemo<SessionContextValue>(() => {
    // Shared by signIn/signUp — the server returns the identical shape (and
    // an immediate token) whether or not the account is approved yet, so
    // both entry points branch on result.status the same way.
    async function applyAuthResult(hub: HubSummary, result: LoginResponse) {
      if (result.status !== 'approved') {
        setPendingAccount({
          hub,
          token: result.token,
          userId: result.userId,
          username: result.username,
          displayName: result.display_name,
          avatarUrl: result.avatar_url,
          isAdmin: result.isAdmin,
          role: result.role,
          accountStatus: result.status === 'rejected' ? 'rejected' : 'pending',
        });
        setStatus('pending');
        return;
      }
      const next: StoredSession = {
        hub,
        userId: result.userId,
        username: result.username,
        displayName: result.display_name,
        avatarUrl: result.avatar_url,
        isAdmin: result.isAdmin,
        role: result.role,
        token: result.token,
      };
      await sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSession(next);
      setPendingAccount(null);
      setStatus('signedIn');
    }

    return {
      status,
      session,
      pendingAccount,
      async signIn(hub, credentials) {
        const result = await loginUser(hub.tunnelUrl, credentials.username, credentials.password);
        await applyAuthResult(hub, result);
      },
      async signUp(hub, input) {
        const result = await registerUser(hub.tunnelUrl, input);
        await applyAuthResult(hub, result);
      },
      async checkPendingStatus() {
        if (!pendingAccount) return false;
        const accountStatus = await getSessionStatus(pendingAccount.hub.tunnelUrl, pendingAccount.token);
        if (accountStatus === 'approved') {
          const next: StoredSession = {
            hub: pendingAccount.hub,
            userId: pendingAccount.userId,
            username: pendingAccount.username,
            displayName: pendingAccount.displayName,
            avatarUrl: pendingAccount.avatarUrl,
            isAdmin: pendingAccount.isAdmin,
            role: pendingAccount.role,
            token: pendingAccount.token,
          };
          await sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          setSession(next);
          setPendingAccount(null);
          setStatus('signedIn');
          return true;
        }
        if (accountStatus === 'rejected' && pendingAccount.accountStatus !== 'rejected') {
          setPendingAccount({ ...pendingAccount, accountStatus: 'rejected' });
        }
        return false;
      },
      cancelPending() {
        setPendingAccount(null);
        setStatus('signedOut');
      },
      async signOut() {
        await sessionStorage.deleteItem(STORAGE_KEY);
        setSession(null);
        setStatus('signedOut');
      },
    };
  }, [status, session, pendingAccount]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
