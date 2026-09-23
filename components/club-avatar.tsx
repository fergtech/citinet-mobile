import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { clubBannerUrl } from '@/lib/api/hubService';
import { Club } from '@/lib/api/types';
import { clubMonogramColor } from '@/lib/clubs/meta';

// Base spec: "clubs appear as 38px rounded-square monograms — first letter
// of name in serif over a color derived from the club's banner fields —
// ... Never an uploaded image." That's still the default (and still what
// the other-member profile's "Shared clubs" strip uses). The Profile tab's
// own "Your clubs" strip opts into `showBanner` instead — a real banner
// visual (gradient/solid/image) rather than just its derived flat color,
// and no letter at all once a real image exists to show instead.
export function ClubAvatar({
  club,
  size = 38,
  showBanner = false,
  tunnelUrl,
}: {
  club: Club;
  size?: number;
  showBanner?: boolean;
  // Only needed when showBanner is true (to build the real image URL) —
  // optional otherwise so every existing plain-monogram call site is unaffected.
  tunnelUrl?: string;
}) {
  const dimensionStyle = { width: size, height: size, borderRadius: size * (11 / 38) };
  const hasImage = showBanner && club.banner_mode === 'image' && !!club.banner_image_file_name && !!tunnelUrl;
  const hasGradient = showBanner && club.banner_mode === 'gradient' && !!club.banner_gradient_from && !!club.banner_gradient_to;

  return (
    <View style={[styles.tile, dimensionStyle, !hasImage && !hasGradient && { backgroundColor: clubMonogramColor(club) }]}>
      {hasImage && (
        <Image source={{ uri: clubBannerUrl(tunnelUrl!, club.slug) }} style={[StyleSheet.absoluteFill, dimensionStyle]} contentFit="cover" />
      )}
      {hasGradient && (
        <LinearGradient
          colors={[club.banner_gradient_from!, club.banner_gradient_to!]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, dimensionStyle]}
        />
      )}
      {!hasImage && (
        <ThemedText style={[styles.initial, { fontSize: size * 0.5 }]} lightColor="#fff" darkColor="#fff">
          {(club.name || '?').charAt(0).toUpperCase()}
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
