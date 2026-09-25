import { File, Paths } from 'expo-file-system';

import { getMediaSource } from '@/lib/api/hubService';

// Downloads a private file to a local cache file and returns its local
// file:// uri, used by media-lightbox.tsx instead of handing <Image>/
// <VideoView> the remote {uri, headers} source directly the way hub-media.tsx's
// own thumbnail does. A plain authenticated fetch (what this does, and what
// diagnostic logging confirmed reliably completes in 1-3 seconds even for a
// multi-MB file) is a much more common, better-tested code path than
// expo-image/expo-video's own header-authenticated network loading — worth
// keeping even after the actual lightbox bug turned out to be an unrelated
// layout issue (see media-lightbox.tsx's container style), since it also
// means the file only needs to be fetched once per open regardless of
// zoom/pan re-renders.
export async function downloadMediaToCache(tunnelUrl: string, token: string, fileName: string): Promise<string> {
  const { uri, headers } = getMediaSource(tunnelUrl, token, fileName);
  // Keyed by file name (not a random temp name) so reopening the same file's
  // lightbox later in the same session can reuse the already-downloaded
  // copy — idempotent: true lets a fresh download overwrite a stale one
  // without erroring.
  const destination = new File(Paths.cache, `lightbox-${fileName}`);
  const downloaded = await File.downloadFileAsync(uri, destination, { idempotent: true, headers });
  return downloaded.uri;
}
