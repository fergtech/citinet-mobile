import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ZoomableImage } from '@/components/atlas/zoomable-image';
import { HubMedia } from '@/components/hub-media';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { downloadMediaToCache } from '@/lib/media/download-to-cache';
import { setLightboxOpen } from '@/lib/media/video-playback-slots';

type Props = {
  visible: boolean;
  onClose: () => void;
  fileName: string;
  kind: 'image' | 'video';
  tunnelUrl: string;
  token: string;
};

// Confirmed via on-device diagnostic logging: a plain fetch() of this same
// authenticated URL reliably completes in 1-3 seconds, even for a 6+ MB
// file. 20s leaves real margin for a large file on a slow connection without
// leaving a truly stuck download spinning forever.
const DOWNLOAD_TIMEOUT_MS = 20_000;

// Full-screen tap target for a chat image/video attachment. Bubbles show
// media cropped to a small square (HubMedia's default "cover" thumbnail) —
// this shows the same file "contain"-fit instead, at its own original size
// and orientation, scaled only as needed to fit the screen. Images get
// pinch/pan via ZoomableImage (same component atlas's photo viewer uses);
// video gets native playback controls, unmuted (the inline bubble preview
// stays silent — see hub-media.tsx's own note on that).
//
// Downloads the file itself first (downloadMediaToCache) rather than handing
// <Image>/<VideoView> the remote {uri, headers} source directly the way
// hub-media.tsx's own thumbnail does — see that function's own comment for
// why. (The bug that surfaced while chasing this down — a photo going blank
// with no error, no matter the source — actually turned out to be this
// screen's own container using alignItems: 'center', which collapsed
// ZoomableImage's <Image> to zero width; see the container style below.)
export function MediaLightbox({ visible, onClose, fileName, kind, tunnelUrl, token }: Props) {
  const insets = useSafeAreaInsets();
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Every other HubMedia instance in the app (chat bubbles, feed previews)
  // releases its own video playback slot for as long as this is true, since
  // none of them are visible while this covers the screen — see
  // setLightboxOpen's own comment in video-playback-slots.ts for the exact
  // bug this fixes (this screen's own video otherwise finding both slots
  // already held by backgrounded previews, including its own file's bubble
  // still mounted right underneath it).
  useEffect(() => {
    setLightboxOpen(visible);
    return () => setLightboxOpen(false);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLocalUri(null);
    setError(null);

    const timeout = setTimeout(() => {
      cancelled = true;
      setError(kind === 'video' ? 'This video is taking too long to load.' : 'This photo is taking too long to load.');
    }, DOWNLOAD_TIMEOUT_MS);

    downloadMediaToCache(tunnelUrl, token, fileName)
      .then((uri) => {
        if (cancelled) return;
        clearTimeout(timeout);
        setLocalUri(uri);
      })
      .catch(() => {
        if (cancelled) return;
        clearTimeout(timeout);
        setError(kind === 'video' ? "Couldn't load this video." : "Couldn't load this photo.");
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [visible, kind, tunnelUrl, token, fileName, retryCount]);

  const errorBlock = error && (
    <View style={styles.errorBlock}>
      <ThemedText style={styles.errorText} lightColor="#fff" darkColor="#fff">
        {error}
      </ThemedText>
      <Pressable onPress={() => setRetryCount((n) => n + 1)} style={styles.retryButton}>
        <ThemedText style={styles.retryLabel} lightColor="#fff" darkColor="#fff">
          Try again
        </ThemedText>
      </Pressable>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* RN's own Modal renders in a separate native window on iOS/Android,
          outside the GestureHandlerRootView mounted once at the app root
          (app/_layout.tsx) — without its own root here, ZoomableImage's
          pinch/pan GestureDetector has nothing to attach to and the image
          never renders at all (a silent failure: no crash, no error, just
          this screen staying blank forever). */}
      <GestureHandlerRootView style={styles.container}>
        {errorBlock ? (
          errorBlock
        ) : !localUri ? (
          <ActivityIndicator color="#fff" />
        ) : kind === 'image' ? (
          <ZoomableImage uri={localUri} onError={() => setError("Couldn't load this photo.")} />
        ) : (
          // isLightbox: exempts this instance from the "stand down while a
          // lightbox is open" rule above — it IS the lightbox. localUri: the
          // file already downloaded above, so this only has to decode/play
          // it, not fetch it over the network itself.
          <HubMedia
            key={retryCount}
            fileName={fileName}
            tunnelUrl={tunnelUrl}
            token={token}
            localUri={localUri}
            isLightbox
            style={styles.video}
            contentFit="contain"
            muted={false}
            onError={() => setError("Couldn't load this video.")}
          />
        )}

        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={[styles.closeButton, { top: insets.top + 12 }]}
          accessibilityLabel="Close"
          accessibilityRole="button">
          <IconSymbol name="xmark" size={20} color="#fff" />
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    // NOT alignItems: 'center' — that governs the cross axis, and a plain
    // `flex: 1` child (ZoomableImage's <Image>, which has no explicit width)
    // only grows along the *main* axis. With 'center' instead of the
    // default 'stretch', it collapsed to zero width and never got a chance
    // to render anything — which looked exactly like a silent load failure
    // (no onLoad, no onError, just blank) since <Image> had nothing to
    // actually decode into. Confirmed real bug: the video branch has an
    // explicit width: '100%' below and was never affected; the *other* place
    // ZoomableImage is used (app/atlas/panoramax-view.tsx) has never set
    // alignItems on its own container and has always worked fine.
    justifyContent: 'center',
  },
  video: {
    flex: 1,
    width: '100%',
    aspectRatio: undefined,
  },
  errorBlock: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 32,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.85,
  },
  retryButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fff8',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  retryLabel: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
