// Private-file encryption: a binary wire format (not JSON like messages/notes),
// magic-byte-prefixed so isFileEncrypted() can tell an encrypted file apart
// from a plain one without a key. Byte-compatible with citinet-web's own
// encryptFileBuffer/decryptFileBuffer (same magic, same [magic][iv][ct+tag]
// layout) since both clients read/write the same server-stored files.
//
// Uses react-native-quick-crypto's WebCrypto-compatible subtle.encrypt/decrypt
// (JSI, OpenSSL-backed — same class of hardware-accelerated AES-GCM the
// browser's own crypto.subtle gives citinet-web) rather than a pure-JS cipher.
// Measured on a real device: the previous pure-JS implementation
// (@noble/ciphers) took ~29 seconds to decrypt a 27 MB file — about
// 0.97 MB/s, squarely "software AES with no hardware acceleration" territory.
import QuickCrypto from 'react-native-quick-crypto';

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

function importAesKey(contentKey: Uint8Array) {
  return QuickCrypto.subtle.importKey('raw', contentKey.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Wire format: [4-byte magic][12-byte iv][ciphertext+tag]. */
export async function encryptFileBuffer(contentKey: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await importAesKey(contentKey);
  const iv = QuickCrypto.getRandomValues(new Uint8Array(12)) as Uint8Array;
  const ct = new Uint8Array(await QuickCrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(FILE_ENC_MAGIC, 0);
  out.set(iv, 4);
  out.set(ct, 16);
  return out;
}

export async function decryptFileBuffer(contentKey: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (!isFileEncrypted(data)) throw new Error('Not an encrypted file (missing magic header)');
  const key = await importAesKey(contentKey);
  // subarray, not slice: a view over the same buffer instead of a full copy
  // of the (potentially tens-of-MB) ciphertext before decryption even starts.
  const iv = data.subarray(4, 16);
  const ct = data.subarray(16);
  const plain = await QuickCrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new Uint8Array(plain);
}
