// Notes use the same {_citinet_enc:1,ct,iv} envelope as DM messages, just
// keyed by the account's content key instead of a per-conversation derived
// key, and with an extra JSON layer inside (citinet stores both a "rich" and
// a "plain" body per note).
import { decryptEnvelope, encryptEnvelope, isEncryptedBody } from './aesgcm';

export type NoteBody = { rich: object | null; plain: string };

export function encryptNoteBody(contentKey: Uint8Array, body: NoteBody): { body_plain: string; body_rich: null } {
  return { body_plain: encryptEnvelope(contentKey, JSON.stringify(body)), body_rich: null };
}

export function decryptNoteBody(contentKey: Uint8Array, bodyPlain: string): NoteBody {
  if (!isEncryptedBody(bodyPlain)) throw new Error('Note body is not encrypted');
  return JSON.parse(decryptEnvelope(contentKey, bodyPlain)) as NoteBody;
}
