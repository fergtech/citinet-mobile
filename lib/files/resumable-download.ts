import { File } from 'expo-file-system';

// expo-file-system's File.downloadFileAsync is all-or-nothing: if the socket
// drops at 90% of a 116 MB APK (a flaky mobile link, or hub1's Tailscale
// Funnel relay hiccuping — see [[project_hub1_funnel_throughput_ceiling]]) it
// rejects with "SocketException: Software caused connection abort" and every
// byte already received is thrown away. This downloads in 4 MB Range chunks
// instead: each chunk is its own small request, so a drop only costs the
// chunk in flight, and a failed chunk is retried from the exact byte offset
// already on disk. The hub's file routes all honour Range, and the download
// token is multi-use for an hour (see api/server.js's downloadTokens).
const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_ATTEMPTS_PER_CHUNK = 6;
const FALLBACK_ATTEMPTS = 3;

export type DownloadProgress = { received: number; total: number | null };

class NonRetryableError extends Error {}
class RangeUnsupportedError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const backoffMs = (attempt: number) => Math.min(1000 * 2 ** attempt, 8000);

function parseTotal(contentRange: string | null): number | null {
  const match = contentRange?.match(/\/(\d+)\s*$/);
  return match ? parseInt(match[1], 10) : null;
}

async function fetchChunk(
  url: string,
  headers: Record<string, string>,
  start: number,
  end: number
): Promise<{ bytes: Uint8Array; total: number | null } | 'empty'> {
  const res = await fetch(url, { headers: { ...headers, Range: `bytes=${start}-${end}` } });
  if (res.status === 200) throw new RangeUnsupportedError('Server ignored Range');
  if (res.status === 416) return 'empty';
  if (res.status !== 206) {
    const message = `Download failed (${res.status})`;
    // 4xx (expired token, deleted file, no access) won't fix itself on retry.
    if (res.status >= 400 && res.status < 500) throw new NonRetryableError(message);
    throw new Error(message);
  }
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    total: parseTotal(res.headers.get('content-range')),
  };
}

async function downloadWithoutRange(
  url: string,
  destination: File,
  headers: Record<string, string>
): Promise<File> {
  let lastError: unknown;
  for (let attempt = 0; attempt < FALLBACK_ATTEMPTS; attempt++) {
    try {
      await File.downloadFileAsync(url, destination, { idempotent: true, headers });
      return destination;
    } catch (err) {
      lastError = err;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}

export async function downloadResumable(
  url: string,
  destination: File,
  options: { headers?: Record<string, string>; onProgress?: (p: DownloadProgress) => void } = {}
): Promise<File> {
  const headers = options.headers ?? {};
  if (destination.exists) destination.delete(); // never resume onto a stale copy from an earlier call
  destination.create();

  const handle = destination.open();
  let offset = 0;
  let total: number | null = null;
  try {
    while (total === null || offset < total) {
      const end = total === null ? offset + CHUNK_BYTES - 1 : Math.min(offset + CHUNK_BYTES, total) - 1;

      let chunk: Awaited<ReturnType<typeof fetchChunk>> | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          chunk = await fetchChunk(url, headers, offset, end);
          break;
        } catch (err) {
          if (err instanceof NonRetryableError || err instanceof RangeUnsupportedError) throw err;
          if (attempt + 1 >= MAX_ATTEMPTS_PER_CHUNK) {
            throw new Error(
              `Download interrupted at ${Math.round(offset / 1024 / 1024)} MB — check your connection and try again.`
            );
          }
          await sleep(backoffMs(attempt));
        }
      }

      if (chunk === 'empty') break; // 416: nothing at this offset — a zero-byte file, or already complete
      if (total === null) total = chunk.total;
      if (chunk.bytes.length === 0) break;

      handle.offset = offset;
      handle.writeBytes(chunk.bytes);
      offset += chunk.bytes.length;
      options.onProgress?.({ received: offset, total });
    }

    if (total !== null && offset !== total) {
      throw new Error('Download was incomplete — please try again.');
    }
  } catch (err) {
    handle.close();
    if (err instanceof RangeUnsupportedError) {
      // Server (or a proxy in front of it) doesn't do partial content: no way to resume,
      // so fall back to a whole-file download that at least retries from scratch.
      return downloadWithoutRange(url, destination, headers);
    }
    throw err;
  }
  handle.close();
  return destination;
}
