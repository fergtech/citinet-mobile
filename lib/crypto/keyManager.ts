import * as ExpoCrypto from 'expo-crypto';

import { getKeyBackup, getPeerPublicKey, registerPublicKey, storeKeyBackup } from '@/lib/api/hubService';
import { unwrapBackup, wrapBackup } from './backup';
import { generateIdentityKeyPair } from './ecdh';
import {
  EcPublicJwk,
  jwkToRawAesKey,
  jwkToRawPrivateKey,
  jwkToRawPublicKey,
  rawAesKeyToJwk,
  rawPrivateKeyToJwk,
  rawPublicKeyToJwk,
} from './jwk';
import { generateRecoveryPhrase } from './recoveryPhrase';
import { clearLocalKeys, loadLocalKeys, LocalIdentityKeys, saveLocalKeys } from './storage';

export type KeyStatus =
  | { status: 'has-keys' }
  | { status: 'has-keys-new-backup'; recoveryPhrase: string }
  | { status: 'needs-recovery' }
  | { status: 'no-backup' };

export type HubContext = { tunnelUrl: string; token: string; hubSlug: string; userId: string };

async function backupCurrentKeys(
  ctx: HubContext,
  local: LocalIdentityKeys,
  onProgress?: (fraction: number) => void
): Promise<string | null> {
  try {
    const phrase = generateRecoveryPhrase();
    const keys = {
      ecdh_private: rawPrivateKeyToJwk(local.ecdhSecretKey, local.ecdhPublicKey),
      content_key: rawAesKeyToJwk(local.contentKey),
    };
    const payload = await wrapBackup(phrase, keys, onProgress);
    const ok = await storeKeyBackup(ctx.tunnelUrl, ctx.token, payload);
    return ok ? phrase : null;
  } catch (err) {
    console.error('[e2e] backupCurrentKeys failed', err);
    return null;
  }
}

/**
 * Mirrors citinet's hubService.ensureUserKeys() state machine exactly:
 *  - 'has-keys' — this device is set up, public key re-synced.
 *  - 'has-keys-new-backup' — this device has keys but the account had no
 *    server-side backup at all; one is created right here (still while the
 *    keys exist locally) under a fresh recovery phrase the caller must show.
 *  - 'needs-recovery' — a backup exists but this device has no local keys;
 *    caller must prompt for the passphrase and call restoreFromBackup().
 *  - 'no-backup' — brand new, nothing anywhere; caller should invoke
 *    setupNewAccountKeys() once the user proceeds.
 */
export async function ensureUserKeys(ctx: HubContext): Promise<KeyStatus> {
  try {
    const local = await loadLocalKeys(ctx.hubSlug, ctx.userId);
    if (local) {
      const publicJwk = rawPublicKeyToJwk(local.ecdhPublicKey);
      await registerPublicKey(ctx.tunnelUrl, ctx.token, JSON.stringify(publicJwk));

      const backup = await getKeyBackup(ctx.tunnelUrl, ctx.token);
      if (!backup) {
        const recoveryPhrase = await backupCurrentKeys(ctx, local);
        return recoveryPhrase ? { status: 'has-keys-new-backup', recoveryPhrase } : { status: 'has-keys' };
      }
      return { status: 'has-keys' };
    }

    const backup = await getKeyBackup(ctx.tunnelUrl, ctx.token);
    return { status: backup ? 'needs-recovery' : 'no-backup' };
  } catch (err) {
    console.error('[e2e] ensureUserKeys failed', err); // never block Messages, but never hide it either
    return { status: 'no-backup' };
  }
}

/** First-ever setup for an account with no backup at all: fresh keys, registered, backed up immediately. */
export async function setupNewAccountKeys(
  ctx: HubContext,
  onProgress?: (fraction: number) => void
): Promise<string | null> {
  const identity = generateIdentityKeyPair();
  const contentKey = ExpoCrypto.getRandomValues(new Uint8Array(32));
  const local: LocalIdentityKeys = { ecdhSecretKey: identity.secretKey, ecdhPublicKey: identity.publicKey, contentKey };

  await saveLocalKeys(ctx.hubSlug, ctx.userId, local);
  await registerPublicKey(ctx.tunnelUrl, ctx.token, JSON.stringify(rawPublicKeyToJwk(local.ecdhPublicKey)));
  return backupCurrentKeys(ctx, local, onProgress);
}

/**
 * Unlocks the server-side passphrase backup and loads the keys onto this
 * device, then re-registers the public key — the user just proved (via
 * passphrase) this is the key that should be active, so this device's
 * registration should reflect it going forward. Confirmed live against
 * zee's real account that a backup and the server's currently-registered
 * key CAN diverge in practice (real multi-session use before this app
 * existed) — a message encrypted under a since-replaced key stays
 * permanently undecryptable, same as it would be on citinet's own web
 * client in the same situation; re-registering here is what lets *future*
 * messages resolve correctly again.
 */
export async function restoreFromBackup(
  ctx: HubContext,
  passphrase: string,
  onProgress?: (fraction: number) => void
): Promise<boolean> {
  const backup = await getKeyBackup(ctx.tunnelUrl, ctx.token);
  if (!backup) return false;

  const keys = await unwrapBackup(backup, passphrase, onProgress);
  if (!keys) return false;

  const local: LocalIdentityKeys = {
    ecdhSecretKey: jwkToRawPrivateKey(keys.ecdh_private),
    ecdhPublicKey: jwkToRawPublicKey(keys.ecdh_private),
    contentKey: jwkToRawAesKey(keys.content_key),
  };
  await saveLocalKeys(ctx.hubSlug, ctx.userId, local);
  await registerPublicKey(ctx.tunnelUrl, ctx.token, JSON.stringify(rawPublicKeyToJwk(local.ecdhPublicKey)));
  return true;
}

export async function getMyLocalKeys(hubSlug: string, userId: string): Promise<LocalIdentityKeys | null> {
  return loadLocalKeys(hubSlug, userId);
}

export async function clearKeys(hubSlug: string, userId: string): Promise<void> {
  await clearLocalKeys(hubSlug, userId);
}

// peerId (scoped by tunnelUrl) -> resolved raw public key, or null if known-absent.
// Avoids re-fetching GET /api/keys/{peerId} on every send in a conversation.
const peerKeyCache = new Map<string, Uint8Array | null>();

export async function resolvePeerPublicKey(
  ctx: Pick<HubContext, 'tunnelUrl' | 'token'>,
  peerId: string
): Promise<Uint8Array | null> {
  const cacheKey = `${ctx.tunnelUrl}::${peerId}`;
  if (peerKeyCache.has(cacheKey)) return peerKeyCache.get(cacheKey) ?? null;

  const jwkStr = await getPeerPublicKey(ctx.tunnelUrl, ctx.token, peerId);
  if (!jwkStr) {
    peerKeyCache.set(cacheKey, null);
    return null;
  }
  try {
    const raw = jwkToRawPublicKey(JSON.parse(jwkStr) as EcPublicJwk);
    peerKeyCache.set(cacheKey, raw);
    return raw;
  } catch {
    peerKeyCache.set(cacheKey, null);
    return null;
  }
}
