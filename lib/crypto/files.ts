// Private-file encryption: a binary wire format (not JSON like messages/notes),
// magic-byte-prefixed so isFileEncrypted() can tell an encrypted file apart
// from a plain one without a key. No private-file-upload UI exists in this
// app yet — the post media it already renders is all public and was never
// encrypted. Exists so the crypto layer is genuinely complete.
import { gcm } from '@noble/ciphers/aes.js';
import * as ExpoCrypto from 'expo-crypto';

const FILE_ENC_MAGIC = new Uint8Array([0xc1, 0x7e, 0xe7, 0x01]); // "citinet-enc v1"

export function isFileEncrypted(data: Uint8Array): boolean {
  return (
    data.length >= 4 + 12 + 16 &&
    data[0] === FILE_ENC_MAGIC[0] &&
    data[1] === FILE_ENC_MAGIC[1] &&
    data[2] === FILE_ENC_MAGIC[2] &&
    data[3] === FILE_ENC_MAGIC[3]
  );
}

/** Wire format: [4-byte magic][12-byte iv][ciphertext+tag]. */
export function encryptFileBuffer(contentKey: Uint8Array, data: Uint8Array): Uint8Array {
  const iv = ExpoCrypto.getRandomValues(new Uint8Array(12));
  const ct = gcm(contentKey, iv).encrypt(data);
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(FILE_ENC_MAGIC, 0);
  out.set(iv, 4);
  out.set(ct, 16);
  return out;
}

export function decryptFileBuffer(contentKey: Uint8Array, data: Uint8Array): Uint8Array {
  if (!isFileEncrypted(data)) throw new Error('Not an encrypted file (missing magic header)');
  return gcm(contentKey, data.slice(4, 16)).decrypt(data.slice(16));
}
