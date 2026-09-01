import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getSessionStatus, loginUser, registerUser, type RegisterInput } from '@/lib/api/hubService';
import type { LoginResponse } from '@/lib/api/types';
import {
  getActiveHubSlug,
  getAllHubSessions,
  getHubSession,
  migrateLegacySessionIfNeeded,
  removeHubSession,
  saveHubSession,
  setActiveHubSlug,
} from '@/lib/session/multi-hub-storage';
import type { HubSummary, PendingAccount, StoredSession } from '@/lib/session/types';

// 'pending' covers both a pending-approval and a rejected account — both are
// "not into the app yet" states, distinguished within pendingAccount.accountStatus
// rather than as separate top-level statuses, since app/_layout.tsx's
// Stack.Protected guard only needs to route them to the same waiting screen.
type SessionStatus = 'loading' | 'signedOut' | 'pending' | 'signedIn';

type SessionContextValue = {
  status: SessionStatus;
  session: StoredSession | null;
  // Every other hub this device has a saved, still-stored session for
  // (everything but the active one) — powers the "You're also signed into"
  // switcher (see HubInfoModal). Multi-hub sessions all just live in
  // SecureStore; this is only ever out of date for the instant between a
  // mutation and its refresh below.
  otherSessions: StoredSession[];
  // Only set while status === 'pending' — kept in memory only (not persisted
  // like StoredSession), so a pending/rejected wait doesn't survive an app
  // restart. Re-opening the app after quitting mid-wait drops back to
  // hub-select rather than resuming the waiting screen; logging back in
  // picks the wait back up (loginUser tolerates a non-approved account the
  // same way registerUser does).
  pendingAccount: PendingAccount | null;
  // Returns which way the account landed — a caller reached from an already-
  // active session (see hub-select.tsx's cameFromActiveSession) needs this
  // to know whether to navigate itself away: a same-status 'signedIn' ->
  // 'signedIn' switch (new hub, was already signed into another) never
  // trips app/_layout.tsx's Stack.Protected guard the way a real status
  // change does, so only that case needs an explicit redirect.
  signIn: (hub: HubSummary, credentials: { username: string; password: string }) => Promise<'signedIn' | 'pending'>;
  signUp: (hub: HubSummary, input: RegisterInput) => Promise<'signedIn' | 'pending'>;
  /** Polls session-status; returns true (and transitions to signedIn) once approved. */
  checkPendingStatus: () => Promise<boolean>;
  /** "Back to onboarding" — drops the pending account and returns to hub-select. */
  cancelPending: () => void;
  /** Instantly makes an already-signed-in hub the active one — no network
   *  call, no re-authentication. Silently no-ops if `slug` doesn't have a
   *  stored session (shouldn't happen from the switcher UI, which only ever
   *  offers hubs already in `otherSessions`). */
  switchToHub: (slug: string) => Promise<void>;
  /** Signs out of the ACTIVE hub only — other stored hub sessions are left
   *  untouched. If any remain, the most recently active of them becomes the
   *  new active hub (status stays 'signedIn'); only drops to 'signedOut'
   *  once no stored sessions are left. Mirrors citinet-web's leaveHub(). */
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<StoredSession | null>(null);
  const [otherSessions, setOtherSessions] = useState<StoredSession[]>([]);
  const [pendingAccount, setPendingAccount] = useState<PendingAccount | null>(null);

  // Refreshes otherSessions from storage, excluding whichever slug is (about
  // to be) active. Called after every mutation instead of derived inline so
  // switchToHub/signOut/applyAuthResult all share one source of truth.
  async function refreshOtherSessions(activeSlug: string | null) {
    const all = await getAllHubSessions();
    setOtherSessions(activeSlug ? all.filter((s) => s.hub.slug !== activeSlug) : all);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateLegacySessionIfNeeded();
      const activeSlug = await getActiveHubSlug();
      const active = activeSlug ? await getHubSession(activeSlug) : null;
      if (cancelled) return;
      if (active) {
        setSession(active);
        setStatus('signedIn');
        await refreshOtherSessions(active.hub.slug);
      } else {
        setStatus('signedOut');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    // Shared by signIn/signUp — the server returns the identical shape (and
    // an immediate token) whether or not the account is approved yet, so
    // both entry points branch on result.status the same way.
    async function applyAuthResult(hub: HubSummary, result: LoginResponse): Promise<'signedIn' | 'pending'> {
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
        return 'pending';
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
      await saveHubSession(next);
      await setActiveHubSlug(hub.slug);
      setSession(next);
      setPendingAccount(null);
      setStatus('signedIn');
      await refreshOtherSessions(hub.slug);
      return 'signedIn';
    }

    return {
      status,
      session,
      otherSessions,
      pendingAccount,
      async signIn(hub, credentials) {
        const result = await loginUser(hub.tunnelUrl, credentials.username, credentials.password);
        return applyAuthResult(hub, result);
      },
      async signUp(hub, input) {
        const result = await registerUser(hub.tunnelUrl, input);
        return applyAuthResult(hub, result);
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
          await saveHubSession(next);
          await setActiveHubSlug(next.hub.slug);
          setSession(next);
          setPendingAccount(null);
          setStatus('signedIn');
          await refreshOtherSessions(next.hub.slug);
          return true;
        }
        if (accountStatus === 'rejected' && pendingAccount.accountStatus !== 'rejected') {
          setPendingAccount({ ...pendingAccount, accountStatus: 'rejected' });
        }
        return false;
      },
      cancelPending() {
        setPendingAccount(null);
        // `session` (the previously-active hub, if any) is never touched by
        // the pending flow — reaching pending while already signed into
        // another hub (signing up for/logging into a second, not-yet-
        // approved account) and then cancelling must land back on that hub,
        // not force a real sign-out of it.
        setStatus(session ? 'signedIn' : 'signedOut');
      },
      async switchToHub(slug) {
        const target = await getHubSession(slug);
        if (!target) return; // no stored session for this hub — nothing to switch to
        await setActiveHubSlug(slug);
        setSession(target);
        setStatus('signedIn');
        await refreshOtherSessions(slug);
      },
      async signOut() {
        const leavingSlug = session?.hub.slug ?? null;
        if (leavingSlug) await removeHubSession(leavingSlug);
        const remaining = await getAllHubSessions();
        const fallback = remaining[0] ?? null;
        if (fallback) {
          await setActiveHubSlug(fallback.hub.slug);
          setSession(fallback);
          setStatus('signedIn');
          await refreshOtherSessions(fallback.hub.slug);
        } else {
          await setActiveHubSlug(null);
          setSession(null);
          setOtherSessions([]);
          setStatus('signedOut');
        }
      },
    };
  }, [status, session, otherSessions, pendingAccount]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
