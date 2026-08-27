import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { spaceBannerUrl } from '@/lib/api/hubService';
import { Space } from '@/lib/api/types';
import { spaceMonogramColor } from '@/lib/spaces/meta';

// Base spec: "spaces appear as 38px rounded-square monograms — first letter
// of name in serif over a color derived from the space's banner fields —
// ... Never an uploaded image." That's still the default (and still what
// the other-member profile's "Shared spaces" strip uses). The Profile tab's
// own "Your spaces" strip opts into `showBanner` instead — a real banner
// visual (gradient/solid/image) rather than just its derived flat color,
// and no letter at all once a real image exists to show instead.
export function SpaceAvatar({
  space,
  size = 38,
  showBanner = false,
  tunnelUrl,
}: {
  space: Space;
  size?: number;
  showBanner?: boolean;
  // Only needed when showBanner is true (to build the real image URL) —
  // optional otherwise so every existing plain-monogram call site is unaffected.
  tunnelUrl?: string;
}) {
  const dimensionStyle = { width: size, height: size, borderRadius: size * (11 / 38) };
  const hasImage = showBanner && space.banner_mode === 'image' && !!space.banner_image_file_name && !!tunnelUrl;
  const hasGradient = showBanner && space.banner_mode === 'gradient' && !!space.banner_gradient_from && !!space.banner_gradient_to;

  return (
    <View style={[styles.tile, dimensionStyle, !hasImage && !hasGradient && { backgroundColor: spaceMonogramColor(space) }]}>
      {hasImage && (
        <Image source={{ uri: spaceBannerUrl(tunnelUrl!, space.slug) }} style={[StyleSheet.absoluteFill, dimensionStyle]} contentFit="cover" />
      )}
      {hasGradient && (
        <LinearGradient
          colors={[space.banner_gradient_from!, space.banner_gradient_to!]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, dimensionStyle]}
        />
      )}
      {!hasImage && (
        <ThemedText style={[styles.initial, { fontSize: size * 0.5 }]} lightColor="#fff" darkColor="#fff">
          {(space.name || '?').charAt(0).toUpperCase()}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    fontFamily: Fonts?.serif,
    fontWeight: '600',
  },
});
