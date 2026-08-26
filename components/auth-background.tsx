import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, View } from 'react-native';

import { BrandGradient } from '@/components/brand-gradient';

const videoSource = require('../assets/videos/video-background.mp4');

// Looping, muted, dimmed video background shared by the whole (auth) flow
// (hub-select, login) — mirrors citinet web's OnboardingBackground (same
// footage, same brand-gradient tint) so the mobile entry point reads as the
// same product as the web portal's. Bundled locally (not streamed) since
// there's no centralized citinet.cloud server this app talks to — only
// per-hub LAN servers — so there's nowhere to stream it from at runtime.
export function AuthBackground() {
  const player = useVideoPlayer(videoSource, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      {/* Plain alpha tint, not a blend mode — matches the web version's own reasoning:
          a blend mode multiplies shadows/screens highlights and distorts the footage's
          color, a translucent layer just tints it. */}
      <BrandGradient style={[StyleSheet.absoluteFill, styles.tint]} />
      <View style={styles.dim} />
    </View>
  );
}

const styles = StyleSheet.create({
  tint: {
    opacity: 0.7,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    opacity: 0.15,
  },
});
