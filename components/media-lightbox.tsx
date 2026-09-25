import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ZoomableImage } from '@/components/atlas/zoomable-image';
import { HubMedia } from '@/components/hub-media';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { getMediaUrl } from '@/lib/api/hubService';

type Props = {
  visible: boolean;
  onClose: () => void;
  fileName: string;
  kind: 'image' | 'video';
  tunnelUrl: string;
  token: string;
};

// Full-screen tap target for a chat image/video attachment. Bubbles show
// media cropped to a small square (HubMedia's default "cover" thumbnail) —
// this shows the same file "contain"-fit instead, at its own original size
// and orientation, scaled only as needed to fit the screen. Images get
// pinch/pan via ZoomableImage (same component atlas's photo viewer uses);
// video gets native playback controls, unmuted (the inline bubble preview
// stays silent — see hub-media.tsx's own note on that).
export function MediaLightbox({ visible, onClose, fileName, kind, tunnelUrl, token }: Props) {
  const insets = useSafeAreaInsets();
  // Only needed for the image path — ZoomableImage takes a plain resolved
  // uri, unlike HubMedia (used below for video) which resolves its own.
  // getMediaUrl caches by fileName, so this is normally an instant hit: the
  // bubble's own HubMedia thumbnail already resolved the same file.
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the effect below without waiting on any props to
  // change — the only way to retry a getMediaUrl() call that already failed
  // once (a plain re-render wouldn't re-fire a useEffect with the same deps).
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!visible || kind !== 'image') return;
    let cancelled = false;
    setUri(null);
    setError(null);
    getMediaUrl(tunnelUrl, token, fileName)
      .then((resolved) => {
        if (!cancelled) setUri(resolved);
      })
      .catch((err) => {
        // This was missing entirely before — a rejected fetch (expired
        // token, dropped connection, the hub's Funnel lapsing) left uri
        // permanently null with nothing on screen to explain why, forever.
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load this photo.");
      });
    return () => {
      cancelled = true;
    };
  }, [visible, kind, tunnelUrl, token, fileName, retryCount]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* RN's own Modal renders in a separate native window on iOS/Android,
          outside the GestureHandlerRootView mounted once at the app root
          (app/_layout.tsx) — without its own root here, ZoomableImage's
          pinch/pan GestureDetector has nothing to attach to and the image
          never renders at all (a silent failure: no crash, no error, just
          this screen staying blank forever). */}
      <GestureHandlerRootView style={styles.container}>
        {kind === 'image' ? (
          error ? (
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
          ) : uri ? (
            <ZoomableImage uri={uri} />
          ) : (
            <ActivityIndicator color="#fff" />
          )
        ) : (
          <HubMedia fileName={fileName} tunnelUrl={tunnelUrl} token={token} style={styles.video} contentFit="contain" muted={false} />
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
    alignItems: 'center',
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
