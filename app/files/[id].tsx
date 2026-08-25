import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
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
import { FILE_KIND_META, fileKind, formatBytes, isPreviewable } from '@/lib/files/kind';
import { saveFileToDevice } from '@/lib/files/save-to-device';
import { useSession } from '@/lib/session/session-context';
import { confirmDestructive } from '@/lib/ui/confirm';
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

export default function FileDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [file, setFile] = useState<HubFile | null>(null);
  const [owner, setOwner] = useState<HubMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<FileVisibility>('private');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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
    getMediaUrl(session.hub.tunnelUrl, session.token, file.file_name).then((url) => {
      if (!cancelled) setPreviewUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [session, file, previewable]);

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
      const url = await getMediaUrl(session.hub.tunnelUrl, session.token, file.file_name);
      const destination = await saveFileToDevice(url, file.file_name, kind);
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
        .then(() => router.back())
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
            ) : !previewUrl ? (
              <ActivityIndicator style={styles.previewLoading} />
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
