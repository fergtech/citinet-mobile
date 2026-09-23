// expo-document-picker doesn't always resolve a real mimeType — notably for a
// photo/video reached via Android's Files/SAF picker rather than the photo
// library — and a naive fallback straight to application/octet-stream is
// what then gets stored server-side, making every client (this app's own
// fileKind() included, before it grew an extension-based rescue — see
// lib/files/kind.ts) render it as a generic file instead of media. Guess from
// the extension first; only fall back to octet-stream when even that fails.
const MIME_FOR_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm',
  // Same audio set as lib/files/kind.ts's EXT_KIND — a document picker that
  // doesn't resolve a real mimeType for these (WAV's UTI in particular often
  // has no "preferred MIME type" mapping on iOS) previously fell all the way
  // through to application/octet-stream, which the server then stores as the
  // file's permanent mime_type and serves back verbatim on every route —
  // breaking native audio playback (expo-audio/AVFoundation needs a correct
  // Content-Type for a streamed URL with no file extension in its path,
  // unlike a browser's more lenient content-sniffing <audio> element).
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  aac: 'audio/aac', m4a: 'audio/mp4', wma: 'audio/x-ms-wma', opus: 'audio/opus',
  pdf: 'application/pdf',
};

// A photo reached via iOS's Files app -> Photos bridge (rather than the
// direct photo library picker) can come back with a mimeType that's present
// but useless — a generic placeholder, not actually absent — which the old
// `if (given) return given` let through unquestioned. Confirmed against a
// real upload: three .png files landed on the server with mime_type
// "application/octet-stream" despite the extension-based table above always
// having had a `png` entry, because `given` was truthy junk, not falsy.
const GENERIC_MIME_TYPES = new Set(['application/octet-stream', 'binary/octet-stream']);

export function guessMimeType(name: string, given: string | undefined | null): string {
  if (given && !GENERIC_MIME_TYPES.has(given.toLowerCase())) return given;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_FOR_EXT[ext] ?? given ?? 'application/octet-stream';
}
