import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { router, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';

import { ScreenHeader } from '@/components/screen-header';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { deleteFile, getMediaUrl, getMember, listFiles, setFileVisibility } from '@/lib/api/hubService';
import { FileVisibility, HubFile, HubMember } from '@/lib/api/types';
import { useE2EKeys } from '@/lib/crypto/e2e-context';
import { ENCRYPTION_SIZE_LIMIT } from '@/lib/crypto/files';
import { FILE_KIND_META, fileKind, formatBytes, isPreviewable } from '@/lib/files/kind';
import { saveFileToDevice } from '@/lib/files/save-to-device';
import { useSession } from '@/lib/session/session-context';
import { confirmDestructive } from '@/lib/ui/confirm';
import { goBack } from '@/lib/ui/go-back';
import { goToProfile } from '@/lib/ui/navigate-to-profile';
import { timeAgo } from '@/lib/ui/time-ago';

const VISIBILITY_CYCLE: FileVisibility[] = ['private', 'hub', 'web'];
const VISIBILITY_META: Record<FileVisibility, { icon: IconSymbolName; label: string; hint: string }> = {
  private: { icon: 'lock.fill', label: 'Private', hint: 'Only you can see this file.' },
  hub: { icon: 'person.2.fill', label: 'Hub shared', hint: 'Any signed-in hub member can see this file.' },
  web: { icon: 'globe', label: 'Public link', hint: 'Anyone with the share link can open this file — no hub account needed.' },
};

function visibilityOf(file: HubFile): FileVisibility {
  if (file.web_public) return 'web';
  if (file.is_public) return 'hub';
  return 'private';
}

// A private file is only actually ciphertext server-side if it was under
// ENCRYPTION_SIZE_LIMIT at upload time (see app/files/upload.tsx's
// toUploadPart) — above that, upload silently skips client-side encryption,
// matching citinet-web's own identical size cap. Gating decrypt-buffering
// purely on visibility (ignoring size) meant a large private file — plaintext
// on the server, "private" only in name — still got fully buffered into
// memory for a decrypt check that was always going to be a no-op. Confirmed
// on a real device: a 288 MB private-but-unencrypted video crashed with
// "RangeError: String length exceeds limit" doing exactly that.
function needsDecrypt(file: HubFile): boolean {
  return visibilityOf(file) === 'private' && file.size_bytes <= ENCRYPTION_SIZE_LIMIT;
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Real playback UI (play/pause, elapsed/duration, progress) rather than a
// bare native-controls surface — expo-video's VideoView works for audio
// technically, but shows a blank black video surface with no obvious "this
// is an audio file" affordance. expo-audio's dedicated player gives a real
// play button and live position/duration instead.
function AudioPlayerCard({ uri, name }: { uri: string; name: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;

  return (
    <View style={styles.audioCard}>
      <Pressable
        onPress={() => (status.playing ? player.pause() : player.play())}
        style={styles.audioPlayButton}
        accessibilityLabel={status.playing ? 'Pause' : 'Play'}>
        <IconSymbol name={status.playing ? 'pause.fill' : 'play.fill'} size={22} color="#fff" />
      </Pressable>
      <View style={styles.audioInfo}>
        <ThemedText type="defaultSemiBold" numberOfLines={1} style={styles.audioName}>
          {name}
        </ThemedText>
        <View style={styles.audioTrack}>
          <View style={[styles.audioTrackFill, { width: `${Math.min(100, progress * 100)}%` }]} />
        </View>
        <ThemedText style={styles.audioTime}>
          {formatSeconds(status.currentTime)} / {status.duration ? formatSeconds(status.duration) : '…'}
        </ThemedText>
      </View>
    </View>
  );
}

// Fetches a private file's (encrypted) bytes, decrypts them, and writes the
// plaintext to a local cache file — expo-audio/expo-video/expo-image and the
// PDF WebView all need a real local or streamable source, and a private
// file's network URL only ever serves ciphertext server-side (see
// lib/crypto/e2e-context.tsx's encryptFile/decryptFile). A public/hub file
// skips this entirely and previews straight from its network URL, unchanged.
async function resolveDecryptedPreviewUri(
  url: string,
  file: HubFile,
  decryptFile: (data: Uint8Array) => Promise<Uint8Array | null>,
  onProgress?: (percent: number) => void
): Promise<string> {
  // XHR, not fetch: a private preview has to fully buffer before it can be
  // decrypted (no progressive/streaming decrypt), and on a slow link — e.g.
  // this hub's tunnel is exposed via Tailscale Funnel, which always relays
  // through the public internet even for two devices on the same LAN, never
  // a local shortcut — that buffering can take a real amount of time with
  // nothing else to show for it. fetch() has neither a built-in timeout nor
  // download-progress events; without both, a slow-but-working transfer and
  // a truly stuck one look identical (an infinite spinner, no error, no
  // percent). XHR gives both.
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    // A STALL timeout, not a flat one: rearmed on every progress tick. A flat
    // wall-clock timeout would kill a connection that's merely slow but still
    // making progress (weak/congested wifi, a big file on a mediocre link) —
    // exactly the kind of connection this has to tolerate, since there's no
    // resume once it's cut. Only a connection that goes fully silent for this
    // long — no bytes at all — gets aborted.
    const STALL_MS = 20_000;
    let stallTimer: ReturnType<typeof setTimeout>;
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => xhr.abort(), STALL_MS);
    };
    armStallTimer();
    xhr.onprogress = (e) => {
      armStallTimer();
      if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onabort = () => reject(new Error('Connection stalled while loading this file — check your network and try again.'));
    xhr.onerror = () => {
      clearTimeout(stallTimer);
      reject(new Error("Couldn't reach this hub. Check that it's online and try again."));
    };
    xhr.onload = () => {
      clearTimeout(stallTimer);
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as ArrayBuffer);
      else reject(new Error(`Couldn't load this file (${xhr.status}).`));
    };
    xhr.send();
  });
  onProgress?.(100);
  const plain = await decryptFile(new Uint8Array(buf));
  if (!plain) throw new Error("Couldn't decrypt this file on this device.");
  const dest = new File(Paths.cache, `preview-${file.file_id}-${file.file_name}`);
  dest.create({ overwrite: true });
  dest.write(plain);
  return dest.uri;
}

export default function FileDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ensure: ensureE2EKeys, decryptFile } = useE2EKeys();

  useEffect(() => {
    ensureE2EKeys();
  }, [ensureE2EKeys]);

  const [file, setFile] = useState<HubFile | null>(null);
  const [owner, setOwner] = useState<HubMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<FileVisibility>('private');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const [format, setFormat] = useState<string | null>(null);
  const [imageAspect, setImageAspect] = useState(1);
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [downloading, setDownloading] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !id) return;
    let cancelled = false;
    listFiles(session.hub.tunnelUrl, session.token)
      .then((files) => {
        if (cancelled) return;
        const found = files.find((f) => f.file_id === id) ?? null;
        if (!found) {
          setError('File not found.');
          return;
        }
        setFile(found);
        setVisibility(visibilityOf(found));
        getMember(session.hub.tunnelUrl, session.token, found.owner_id)
          .then((m) => !cancelled && setOwner(m))
          .catch(() => {});
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Couldn't load this file."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session, id]);

  const kind = file ? fileKind(file.file_name, file.mime_type) : 'other';
  const meta = FILE_KIND_META[kind];
  const previewable = isPreviewable(kind);
  const isOwner = !!(session && file && file.owner_id === session.userId);

  // Tapping into a file from the list means "show it," not "show a button
  // that shows it" — resolve the token-gated preview URL as soon as the file
  // itself loads, for every previewable kind, no extra tap required.
  useEffect(() => {
    if (!session || !file || !previewable) return;
    let cancelled = false;
    setPreviewError(null);
    setPreviewProgress(null);
    const isPrivate = needsDecrypt(file);
    getMediaUrl(session.hub.tunnelUrl, session.token, file.file_name)
      .then(async (url) => {
        if (cancelled) return;
        if (!isPrivate) {
          setPreviewUrl(url);
          return;
        }
        setPreviewProgress(0);
        const localUri = await resolveDecryptedPreviewUri(url, file, decryptFile, (percent) => {
          if (!cancelled) setPreviewProgress(percent);
        });
        if (!cancelled) setPreviewUrl(localUri);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Couldn't load this file.";
        // Surfaces the exact stored file_name alongside the error — the
        // fastest way to tell a real "the blob is gone" 404 apart from a
        // name-matching bug (the /token route looks the file up by this
        // exact string) without needing server-side log access.
        if (!cancelled) setPreviewError(`${message} (file_name: "${file.file_name}")`);
      });
    return () => {
      cancelled = true;
    };
  }, [session, file, previewable, decryptFile]);

  useEffect(() => {
    if (kind === 'image' && previewUrl) {
      Image.loadAsync(previewUrl)
        .then((ref) => {
          setFormat(`${ref.width} × ${ref.height}`);
          if (ref.width && ref.height) setImageAspect(ref.width / ref.height);
        })
        .catch(() => {});
    }
    if (kind === 'pdf') setFormat('PDF document');
  }, [kind, previewUrl]);

  // expo-video needs a player instance unconditionally — pass null until a
  // video preview URL has actually resolved.
  const player = useVideoPlayer(kind === 'video' ? previewUrl : null, (p) => {
    p.muted = false;
  });

  useEffect(() => {
    if (!player || kind !== 'video') return;
    const sub = player.addListener('sourceLoad', ({ duration }) => {
      if (duration) setFormat(formatSeconds(duration));
    });
    return () => sub.remove();
  }, [player, kind]);

  // Video tracks' reported size ignores rotation metadata (AVFoundation's
  // `naturalSize`, which expo-video's `sourceLoad` event exposes, is
  // explicitly the pre-rotation encoded frame — Apple's own docs note it
  // "does not reflect properties in preferredTransform"), so a portrait
  // phone video reports as its underlying landscape frame and the preview
  // box came out short/letterboxed even though VideoView itself renders the
  // content correctly rotated. A generated thumbnail frame doesn't have that
  // problem — both platforms' thumbnail generators bake rotation into the
  // output image — so this measures the real displayed aspect ratio the same
  // trusted way the image preview already does (Image.loadAsync), rather
  // than trusting the video track's unreliable metadata.
  useEffect(() => {
    if (kind !== 'video' || !previewUrl) return;
    // Skip this for a remote (network) previewUrl — it opens its own
    // independent AVURLAsset against the same URL the player itself is
    // streaming, and over a slow connection that's a second fetch racing the
    // actual playback for the same limited bandwidth. Confirmed on a real
    // device: a 275 MB video over this hub's ~1 MB/s Funnel connection sat
    // stuck at 0:00 for several seconds after pressing play, competing with
    // this. previewUrl is only ever local (file://) for a private file under
    // the decrypt-buffering size cap — see needsDecrypt() — where this read
    // is free (already-local bytes), so this still fires for those.
    if (!previewUrl.startsWith('file://')) return;
    let cancelled = false;
    VideoThumbnails.getThumbnailAsync(previewUrl, { time: 0 })
      .then(({ width, height }) => {
        if (!cancelled && width && height) setVideoAspect(width / height);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kind, previewUrl]);

  useEffect(() => {
    if (!savedMessage) return;
    const timeout = setTimeout(() => setSavedMessage(null), 2500);
    return () => clearTimeout(timeout);
  }, [savedMessage]);

  async function handleDownload() {
    if (!session || !file || downloading) return;
    setDownloading(true);
    setError(null);
    setSavedMessage(null);
    try {
      const isPrivate = needsDecrypt(file);
      // previewUrl is already a local file:// uri holding the decrypted
      // bytes once a private file's preview has resolved — reuse it instead
      // of re-fetching and re-decrypting the same file over again.
      const preDecryptedUri = isPrivate && previewUrl?.startsWith('file://') ? previewUrl : undefined;
      const url = preDecryptedUri ? '' : await getMediaUrl(session.hub.tunnelUrl, session.token, file.file_name);
      const destination = await saveFileToDevice(url, file.file_name, kind, isPrivate ? decryptFile : undefined, preDecryptedUri);
      setSavedMessage(destination === 'photos' ? 'Saved to Photos' : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't download that file.");
    } finally {
      setDownloading(false);
    }
  }

  function handleCycleVisibility() {
    if (!session || !file) return;
    const currentIdx = VISIBILITY_CYCLE.indexOf(visibility);
    const next = VISIBILITY_CYCLE[(currentIdx + 1) % VISIBILITY_CYCLE.length];
    const prev = visibility;
    setVisibility(next);
    setFileVisibility(session.hub.tunnelUrl, session.token, file.file_name, next).catch(() => setVisibility(prev));
  }

  function handleDelete() {
    if (!session || !file) return;
    confirmDestructive('Delete this file?', 'Delete', () => {
      deleteFile(session.hub.tunnelUrl, session.token, file.file_name)
        .then(() => goBack('/files'))
        .catch((err) => setError(err instanceof Error ? err.message : "Couldn't delete that file."));
    });
  }

  if (!session) return null;

  const vis = VISIBILITY_META[visibility];

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="File" />

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {file && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.previewBlock}>
            {!previewable ? (
              <>
                <View style={[styles.previewIconWrap, { backgroundColor: meta.color }]}>
                  <IconSymbol name={meta.icon} size={40} color="#fff" />
                </View>
                <ThemedText style={styles.formatLine}>{meta.label}</ThemedText>
                <ThemedText style={styles.noPreview}>No in-app preview for {meta.label.toLowerCase()} files — download to open.</ThemedText>
              </>
            ) : previewError ? (
              <>
                <View style={[styles.previewIconWrap, { backgroundColor: meta.color }]}>
                  <IconSymbol name={meta.icon} size={40} color="#fff" />
                </View>
                <ThemedText style={styles.noPreview}>{previewError}</ThemedText>
              </>
            ) : !previewUrl ? (
              <>
                <ActivityIndicator style={styles.previewLoading} />
                {previewProgress !== null && (
                  <ThemedText style={styles.formatLine}>
                    {previewProgress < 100 ? `Loading… ${previewProgress}%` : 'Decrypting…'}
                  </ThemedText>
                )}
              </>
            ) : kind === 'image' ? (
              <>
                <Image source={{ uri: previewUrl }} style={[styles.previewImage, { aspectRatio: imageAspect }]} contentFit="contain" />
                {format && <ThemedText style={styles.formatLine}>{format}</ThemedText>}
              </>
            ) : kind === 'video' ? (
              <>
                <VideoView player={player} style={[styles.previewMedia, { aspectRatio: videoAspect }]} nativeControls contentFit="contain" />
                {format && <ThemedText style={styles.formatLine}>{format}</ThemedText>}
              </>
            ) : kind === 'audio' ? (
              <AudioPlayerCard uri={previewUrl} name={file.file_name} />
            ) : (
              <>
                <WebView source={{ uri: previewUrl }} style={styles.previewPdf} />
                <Pressable onPress={() => Linking.openURL(previewUrl)} style={styles.openExternalLink}>
                  <ThemedText style={[styles.openExternalLabel, { color: Brand }]}>Open in browser</ThemedText>
                </Pressable>
              </>
            )}
          </View>

          <View style={styles.actionsRow}>
            <Pressable onPress={handleDownload} disabled={downloading} style={[styles.actionButton, downloading && styles.actionButtonBusy]}>
              {downloading ? (
                <ActivityIndicator size="small" />
              ) : (
                <IconSymbol name="arrow.down.circle.fill" size={18} color={Colors[colorScheme].text} />
              )}
              <ThemedText style={styles.actionLabel}>{downloading ? 'Saving…' : 'Download'}</ThemedText>
            </Pressable>
            <Pressable onPress={() => router.push({ pathname: '/files/share', params: { id: file.file_id } })} style={styles.actionButton}>
              <IconSymbol name="square.and.arrow.up" size={18} color={Colors[colorScheme].text} />
              <ThemedText style={styles.actionLabel}>Share</ThemedText>
            </Pressable>
          </View>
          {savedMessage && <ThemedText style={styles.savedMessage}>{savedMessage}</ThemedText>}

          <View style={styles.detailsList}>
            <Pressable
              onPress={() => owner && goToProfile(owner.user_id, session.userId)}
              disabled={!owner}
              style={styles.detailRow}>
              <IconSymbol name="person.fill" size={18} color={Colors[colorScheme].icon} />
              <View style={styles.detailText}>
                <ThemedText style={styles.detailLabel}>{owner?.display_name || owner?.username || 'Unknown'}</ThemedText>
                <ThemedText style={styles.detailMeta}>Uploaded {timeAgo(file.uploaded_at)}</ThemedText>
              </View>
              {owner && <IconSymbol name="chevron.right" size={15} color={Colors[colorScheme].icon} />}
            </Pressable>

            <View style={styles.detailRow}>
              <IconSymbol name={meta.icon} size={18} color={Colors[colorScheme].icon} />
              <View style={styles.detailText}>
                <ThemedText style={styles.detailLabel}>{meta.label}</ThemedText>
                <ThemedText style={styles.detailMeta}>{formatBytes(file.size_bytes)}</ThemedText>
              </View>
            </View>

            <Pressable onPress={isOwner ? handleCycleVisibility : undefined} disabled={!isOwner} style={styles.detailRow}>
              <IconSymbol name={vis.icon} size={18} color={Colors[colorScheme].icon} />
              <View style={styles.detailText}>
                <ThemedText style={styles.detailLabel}>{vis.label}</ThemedText>
                <ThemedText style={styles.detailMeta}>{vis.hint}</ThemedText>
              </View>
              {isOwner && <IconSymbol name="chevron.right" size={15} color={Colors[colorScheme].icon} />}
            </Pressable>
          </View>

          {isOwner && (
            <Pressable onPress={handleDelete} style={styles.deleteRow}>
              <IconSymbol name="trash.fill" size={18} color="#b0392f" />
              <ThemedText style={styles.deleteLabel}>Delete file</ThemedText>
            </Pressable>
          )}
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  spinner: {
    marginTop: 40,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginTop: 12,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 48,
  },
  previewBlock: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 10,
  },
  previewLoading: {
    marginVertical: 40,
  },
  previewIconWrap: {
    width: 84,
    height: 84,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Full width, real aspect ratio (computed from the resolved image/video
  // dimensions) — no more forced 4:3 cropping.
  previewImage: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: '#8882',
  },
  previewMedia: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: '#8882',
  },
  previewPdf: {
    width: '100%',
    height: 480,
    borderRadius: 14,
    backgroundColor: '#8882',
  },
  openExternalLink: {
    paddingVertical: 4,
  },
  openExternalLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  formatLine: {
    fontSize: 13,
    opacity: 0.6,
  },
  audioCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#8881',
  },
  audioPlayButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioInfo: {
    flex: 1,
    gap: 6,
  },
  audioName: {
    fontSize: 14.5,
  },
  audioTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#8883',
    overflow: 'hidden',
  },
  audioTrackFill: {
    height: '100%',
    backgroundColor: Brand,
    borderRadius: 3,
  },
  audioTime: {
    fontSize: 11.5,
    opacity: 0.6,
  },
  noPreview: {
    fontSize: 12.5,
    opacity: 0.55,
    textAlign: 'center',
    lineHeight: 17,
    paddingHorizontal: 20,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#8884',
  },
  actionButtonBusy: {
    opacity: 0.7,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  savedMessage: {
    textAlign: 'center',
    fontSize: 12.5,
    color: '#1f9e5c',
    marginTop: -4,
    marginBottom: 8,
  },
  detailsList: {
    marginTop: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  detailText: {
    flex: 1,
    gap: 2,
  },
  detailLabel: {
    fontSize: 15,
  },
  detailMeta: {
    fontSize: 12.5,
    opacity: 0.6,
    lineHeight: 17,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    marginTop: 8,
  },
  deleteLabel: {
    fontSize: 15,
    color: '#b0392f',
  },
});
