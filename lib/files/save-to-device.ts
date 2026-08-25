import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
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
export async function saveFileToDevice(url: string, fileName: string, kind: FileKind): Promise<SaveDestination> {
  const downloaded = await File.downloadFileAsync(url, Paths.cache, { idempotent: true });

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
