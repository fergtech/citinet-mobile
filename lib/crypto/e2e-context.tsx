import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import { useSession } from '@/lib/session/session-context';
import { decryptEnvelope, encryptEnvelope, isEncryptedBody } from './aesgcm';
import { deriveConversationKey } from './ecdh';
import * as keyManager from './keyManager';
import type { HubContext } from './keyManager';
import { decryptNoteBody, encryptNoteBody, type NoteBody } from './notes';

type E2EStatus = 'idle' | 'checking' | 'ready' | 'needs-recovery' | 'needs-setup';

// What, if anything, the UI should interrupt the user for right now:
// 'unlock' -> prompt for the passphrase (a backup exists, this device lacks keys).
// 'setup'  -> show a recovery phrase once (either freshly generated for a
//             brand-new account, or one ensureUserKeys() already generated
//             because this device had keys but the server had no backup at all).
type E2EAttention = 'unlock' | 'setup' | null;

type E2EContextValue = {
  status: E2EStatus;
  attention: E2EAttention;
  recoveryPhrase: string | null;
  ensure: () => Promise<void>;
  restore: (passphrase: string, onProgress?: (fraction: number) => void) => Promise<boolean>;
  setupNew: (onProgress?: (fraction: number) => void) => Promise<void>;
  acknowledgeRecoveryPhrase: () => void;
  /** Returns the plaintext, or null if the body was encrypted and couldn't be decrypted. */
  decryptForConversation: (conversationId: string, peerId: string | null, body: string) => Promise<string | null>;
  /** Returns ciphertext when a peer key is resolvable, otherwise the plaintext itself (matches citinet's silent fallback). */
  encryptForConversation: (conversationId: string, peerId: string | null, plaintext: string) => Promise<string>;
  /** Throws if this device has no local keys yet — callers should only reach this once `status === 'ready'`. */
  encryptNote: (body: NoteBody) => Promise<{ body_plain: string; body_rich: null }>;
  /** Returns null if the body can't be decrypted with this device's keys (or none exist yet). */
  decryptNote: (bodyPlain: string) => Promise<NoteBody | null>;
};

const E2EKeysContext = createContext<E2EContextValue | null>(null);

export function E2EKeysProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [status, setStatus] = useState<E2EStatus>('idle');
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);

  const ensurePromiseRef = useRef<Promise<void> | null>(null);
  const conversationKeyCache = useRef<Map<string, Uint8Array>>(new Map());

  const hubContext = useCallback((): HubContext => {
    if (!session) throw new Error('No active session');
    return { tunnelUrl: session.hub.tunnelUrl, token: session.token, hubSlug: session.hub.slug, userId: session.userId };
  }, [session]);

  const ensure = useCallback((): Promise<void> => {
    if (ensurePromiseRef.current) return ensurePromiseRef.current;
    if (!session) return Promise.resolve();

    setStatus('checking');
    const promise = keyManager
      .ensureUserKeys(hubContext())
      .then((result) => {
        if (result.status === 'has-keys') {
          setStatus('ready');
        } else if (result.status === 'has-keys-new-backup') {
          setRecoveryPhrase(result.recoveryPhrase);
          setStatus('ready');
        } else if (result.status === 'needs-recovery') {
          setStatus('needs-recovery');
        } else {
          setStatus('needs-setup');
        }
      })
      .catch((err) => {
        console.error('[e2e] ensure() failed', err);
        setStatus('needs-setup');
      });
    ensurePromiseRef.current = promise;
    return promise;
  }, [session, hubContext]);

  const restore = useCallback(
    async (passphrase: string, onProgress?: (fraction: number) => void): Promise<boolean> => {
      const ok = await keyManager.restoreFromBackup(hubContext(), passphrase, onProgress);
      if (ok) {
        conversationKeyCache.current.clear();
        setStatus('ready');
      }
      return ok;
    },
    [hubContext]
  );

  const setupNew = useCallback(
    async (onProgress?: (fraction: number) => void): Promise<void> => {
      const phrase = await keyManager.setupNewAccountKeys(hubContext(), onProgress);
      setRecoveryPhrase(phrase);
      setStatus('ready');
    },
    [hubContext]
  );

  const acknowledgeRecoveryPhrase = useCallback(() => {
    setRecoveryPhrase(null);
  }, []);

  const getConversationKey = useCallback(
    async (conversationId: string, peerId: string): Promise<Uint8Array | null> => {
      const cached = conversationKeyCache.current.get(conversationId);
      if (cached) return cached;
      if (!session) return null;

      const myKeys = await keyManager.getMyLocalKeys(session.hub.slug, session.userId);
      if (!myKeys) return null;

      const peerPublicKey = await keyManager.resolvePeerPublicKey(hubContext(), peerId);
      if (!peerPublicKey) return null;

      const key = deriveConversationKey(myKeys.ecdhSecretKey, peerPublicKey, conversationId);
      conversationKeyCache.current.set(conversationId, key);
      return key;
    },
    [session, hubContext]
  );

  const decryptForConversation = useCallback(
    async (conversationId: string, peerId: string | null, body: string): Promise<string | null> => {
      if (!isEncryptedBody(body)) return body;
      if (!peerId) return null;
      const key = await getConversationKey(conversationId, peerId);
      if (!key) return null;
      try {
        return decryptEnvelope(key, body);
      } catch {
        return null;
      }
    },
    [getConversationKey]
  );

  const encryptForConversation = useCallback(
    async (conversationId: string, peerId: string | null, plaintext: string): Promise<string> => {
      if (!peerId) return plaintext;
      const key = await getConversationKey(conversationId, peerId);
      if (!key) return plaintext; // no registered peer key -> plaintext, matches citinet's own silent fallback
      return encryptEnvelope(key, plaintext);
    },
    [getConversationKey]
  );

  // Notes use the account-wide content key (bundled into the same passphrase
  // backup as the DM identity key), not a per-conversation derived one.
  const encryptNote = useCallback(
    async (body: NoteBody): Promise<{ body_plain: string; body_rich: null }> => {
      if (!session) throw new Error('No active session');
      const myKeys = await keyManager.getMyLocalKeys(session.hub.slug, session.userId);
      if (!myKeys) throw new Error('Encryption is not set up on this device yet.');
      return encryptNoteBody(myKeys.contentKey, body);
    },
    [session]
  );

  const decryptNote = useCallback(
    async (bodyPlain: string): Promise<NoteBody | null> => {
      if (!isEncryptedBody(bodyPlain)) return { rich: null, plain: bodyPlain };
      if (!session) return null;
      const myKeys = await keyManager.getMyLocalKeys(session.hub.slug, session.userId);
      if (!myKeys) return null;
      try {
        return decryptNoteBody(myKeys.contentKey, bodyPlain);
      } catch {
        return null;
      }
    },
    [session]
  );

  const attention: E2EAttention =
    status === 'needs-recovery' ? 'unlock' : status === 'needs-setup' || (status === 'ready' && !!recoveryPhrase) ? 'setup' : null;

  const value = useMemo<E2EContextValue>(
    () => ({
      status,
      attention,
      recoveryPhrase,
      ensure,
      restore,
      setupNew,
      acknowledgeRecoveryPhrase,
      decryptForConversation,
      encryptForConversation,
      encryptNote,
      decryptNote,
    }),
    [
      status,
      attention,
      recoveryPhrase,
      ensure,
      restore,
      setupNew,
      acknowledgeRecoveryPhrase,
      decryptForConversation,
      encryptForConversation,
      encryptNote,
      decryptNote,
    ]
  );

  return <E2EKeysContext.Provider value={value}>{children}</E2EKeysContext.Provider>;
}

export function useE2EKeys(): E2EContextValue {
  const ctx = useContext(E2EKeysContext);
  if (!ctx) throw new Error('useE2EKeys must be used within an E2EKeysProvider');
  return ctx;
}
