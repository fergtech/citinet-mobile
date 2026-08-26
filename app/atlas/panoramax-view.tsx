import { Alert, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { ZoomableImage } from '@/components/atlas/zoomable-image';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { panoramaxWebViewerUrl } from '@/lib/atlas/panoramax';

// Was originally the real @panoramax/web-viewer's <pnx-photo-viewer> web
// component (a full WebGL 360° renderer) loaded inside a WebView — reported
// hanging indefinitely on its own internal picture-loading step (its own
// loading screen would show and just never finish), even after switching to
// its lighter bundle, which ruled out bundle size as the cause. Replaced
// entirely with a native pinch/pan viewer on the flat "sd" image
// (ZoomableImage) — no WebView, no external JS bundle, nothing that can get
// stuck loading. Real tradeoff, not hidden: this shows the flat equirectangular
// image as-is (visibly stretched/warped, especially near the top and bottom —
// that's inherent to the source projection, not a bug here), not a de-warped
// spherical wraparound. A "View full 360°" link opens the real picture in
// Panoramax's own hosted web viewer (their production site) for anyone who
// wants that — offloads the immersive rendering to infrastructure that isn't
// this app's problem to keep reliable.
export default function PanoramaxViewScreen() {
  const { image, picture } = useLocalSearchParams<{ image: string; picture: string }>();

  // The URL itself is confirmed valid (see lib/atlas/panoramax.ts) — this
  // guards against Linking.openURL rejecting for environmental reasons
  // (seen on the iOS Simulator without a default browser association) that
  // have nothing to do with the URL being wrong. Unhandled, that rejection
  // surfaced as an uncaught-promise red-screen error instead of anything a
  // user could act on.
  async function handleOpenWebViewer() {
    try {
      await Linking.openURL(panoramaxWebViewerUrl(picture));
    } catch {
      const message = "Couldn't open that link right now.";
      if (Platform.OS === 'web') {
        window.alert(message);
      } else {
        Alert.alert(message);
      }
    }
  }

  return (
    <ThemedView style={styles.flex}>
      <ZoomableImage uri={image} />

      <Pressable onPress={() => router.back()} hitSlop={12} style={styles.closeButton} accessibilityLabel="Close" accessibilityRole="button">
        <IconSymbol name="xmark" size={20} color="#fff" />
      </Pressable>

      <Pressable onPress={handleOpenWebViewer} style={styles.webLinkButton}>
        <IconSymbol name="view.3d" size={14} color="#fff" />
        <ThemedText style={styles.webLinkLabel} lightColor="#fff" darkColor="#fff">
          View full 360° on panoramax.fr
        </ThemedText>
      </Pressable>

      <View style={styles.hint} pointerEvents="none">
        <ThemedText style={styles.hintLabel} lightColor="#fff" darkColor="#fff">
          Pinch to zoom · drag to pan
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#000',
  },
  closeButton: {
    position: 'absolute',
    top: 56,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webLinkButton: {
    position: 'absolute',
    top: 56,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  webLinkLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  hint: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  hintLabel: {
    fontSize: 12.5,
    opacity: 0.9,
  },
});
