import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';

import type { FileKind } from '@/lib/api/types';

export type SaveDestination = 'photos' | 'shared';

// Real on-device save, not a browser-tab download — a plain
// `Linking.openURL()` on the token URL just opened a browser tab pointed at
// the hub's own tunnel domain (which happens to live under citinet.cloud,
// see [[citinet-hub-networking]]), which isn't what "Download" should mean
// on a phone. This downloads the actual bytes locally first (expo-file-
// system's newer File.downloadFileAsync, SDK 54's replacement for the old
// FileSystem.downloadAsync), then routes by kind: images/videos go straight
// into the Photos library (expo-media-library, matching where a camera roll
// download normally lands), everything else opens the native share sheet
// (expo-sharing) so the user can pick "Save to Files" (iOS) or a file
// manager/Drive target (Android) — there's no direct "save to Files app" API
// reachable from Expo Go without a Storage Access Framework dev client.
export async function saveFileToDevice(
  url: string,
  fileName: string,
  kind: FileKind,
  // A private file is stored server-side as opaque ciphertext (see
  // lib/crypto/e2e-context.tsx's encryptFile/decryptFile) — this module stays
  // crypto-agnostic like hubService.ts does, so the caller (app/files/[id].tsx)
  // passes its own decryptFile in. Omit for a public/hub file, where the bytes
  // on disk are already the real file and no decrypt step is needed.
  decrypt?: (data: Uint8Array) => Promise<Uint8Array | null>,
  // If the caller already has a decrypted local copy on disk (e.g. this file
  // was just previewed), pass its file:// uri here to skip re-fetching AND
  // re-decrypting the same bytes from scratch — on this pure-JS crypto
  // backend a full-file AES-GCM pass is the single most expensive step in
  // this whole flow, so redoing it for Download right after preview already
  // did it is pure waste. `url`/`decrypt` are ignored when this is set.
  preDecryptedUri?: string
): Promise<SaveDestination> {
  if (Platform.OS !== 'web' && preDecryptedUri) {
    // The cached copy is named for its own internal purposes
    // (preview-<file_id>-<fileName> — see app/files/[id].tsx), not the real
    // download filename. Copy it under the real name before sharing/saving,
    // otherwise that internal name is what lands in Photos/Files (a real
    // regression this fixes: it previously reused the cached file as-is).
    const named = new File(Paths.cache, fileName);
    if (named.exists) named.delete(); // copy() has no overwrite option — clear a stale prior download first
    new File(preDecryptedUri).copy(named);
    const downloaded = named;
    if (kind === 'image' || kind === 'video') {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        throw new Error('Photo library permission is needed to save this file.');
      }
      await MediaLibrary.saveToLibraryAsync(downloaded.uri);
      return 'photos';
    }
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      throw new Error("Saving files isn't supported on this device.");
    }
    await Sharing.shareAsync(downloaded.uri);
    return 'shared';
  }
  // expo-file-system's new File/Directory/Paths API has no web implementation at all —
  // its web module is a bare stub whose downloadFileAsync just warns and resolves
  // undefined, which then blows up as "this.validatePath is not a function" trying to
  // build a File around that undefined result. The browser already has its own native
  // download mechanism, so use that instead of going through expo-file-system. Fetching
  // into a blob: URL first (rather than pointing <a download> straight at `url`) matters
  // because the hub's tunnel domain is cross-origin from the app — browsers silently
  // ignore the `download` filename hint on a cross-origin href, so without this the file
  // would save under whatever name the browser derives from the URL instead of fileName.
  if (Platform.OS === 'web') {
    const res = await fetch(url);
    let blob = await res.blob();
    if (decrypt) {
      const plain = await decrypt(new Uint8Array(await blob.arrayBuffer()));
      if (!plain) throw new Error("Couldn't decrypt this file on this device.");
      blob = new Blob([plain.buffer as ArrayBuffer], { type: blob.type });
    }
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
    return 'shared';
  }

  // A File destination (not the bare cache Directory) so the saved copy keeps the real
  // file name/extension. Left to infer it, native falls back to the response's
  // Content-Disposition header or the URL's last path segment — and our download URL's
  // last segment is literally "download" (see hubService.getMediaUrl's
  // `/api/files/<name>/download?token=...`), so an unheadered response landed with no
  // extension at all. That's what made MediaLibrary.saveToLibraryAsync below fail with
  // "Unknown error" — it can't tell what kind of asset an extension-less file is.
  const destination = new File(Paths.cache, fileName);
  const downloaded = await File.downloadFileAsync(url, destination, { idempotent: true });

  // A private file downloads as ciphertext (see decrypt's doc comment above)
  // — decrypt it in place before it ever reaches Photos or the share sheet,
  // otherwise the saved copy has the right name/size but isn't actually the
  // real file, which is exactly the bug this fixes (a downloaded audio file
  // that "shows size and format" but has no play button because its bytes
  // are still encrypted noise).
  if (decrypt) {
    const plain = await decrypt(await downloaded.bytes());
    if (!plain) throw new Error("Couldn't decrypt this file on this device.");
    downloaded.write(plain);
  }

  if (kind === 'image' || kind === 'video') {
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) {
      throw new Error('Photo library permission is needed to save this file.');
    }
    await MediaLibrary.saveToLibraryAsync(downloaded.uri);
    return 'photos';
  }

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error("Saving files isn't supported on this device.");
  }
  await Sharing.shareAsync(downloaded.uri);
  return 'shared';
}
