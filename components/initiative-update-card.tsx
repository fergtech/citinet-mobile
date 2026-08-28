import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { initiativeBannerUrl } from '@/lib/api/hubService';
import { InitiativeActivityEntry } from '@/lib/api/types';
import { initiativeCategoryMeta, initiativeColor } from '@/lib/initiatives/meta';
import { timeAgo } from '@/lib/ui/time-ago';

// One activity row from a hub's initiatives, paired with enough of its
// parent Initiative to render a card without a second lookup — the entry
// itself has no category/color/banner, only the Initiative does. Lives here
// (not lib/api/types.ts) since it's a view-model shape this card owns, not a
// real API response type; app/(tabs)/index.tsx's fetchInitiativeUpdates
// builds these by merging listInitiatives()+getInitiativeActivity().
export type InitiativeUpdateRow = {
  entry: InitiativeActivityEntry;
  initiativeId: string;
  initiativeTitle: string;
  initiativeCategory: string;
  initiativeColorName: string;
  hasBannerImage: boolean;
  taskId?: string;
};

// The FeaturedCard equivalent for Initiatives — same full-bleed
// image/gradient-scrim/white-text language as components/featured-carousel.tsx,
// just narrower (3:5 vs Featured's 4:5) and shorter in absolute height since
// this is a Home preview strip, not the main draw. When the initiative has no
// uploaded banner (Initiative.banner_mode !== 'image'), the category's own
// color fills the card instead of a photo — the scrim still applies over it
// so the text block reads identically either way.
export function InitiativeUpdateCard({
  row,
  tunnelUrl,
  onPress,
  style,
}: {
  row: InitiativeUpdateRow;
  tunnelUrl: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { entry, initiativeId, initiativeTitle, initiativeCategory, initiativeColorName, hasBannerImage } = row;
  const category = initiativeCategoryMeta(initiativeCategory);
  const color = initiativeColor(initiativeColorName);

  return (
    <Pressable style={[styles.card, style]} onPress={onPress}>
      {hasBannerImage ? (
        <Image source={{ uri: initiativeBannerUrl(tunnelUrl, initiativeId) }} style={styles.fullBleedMedia} contentFit="cover" />
      ) : (
        <View style={[styles.fullBleedMedia, { backgroundColor: color }]} />
      )}

      <View style={styles.iconBadgeRow}>
        <View style={styles.iconBadge}>
          <IconSymbol name={category.icon} size={18} color="#fff" />
        </View>
      </View>

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']}
        locations={[0, 0.45, 1]}
        style={styles.scrim}>
        <ThemedText type="defaultSemiBold" numberOfLines={2} style={styles.updateText} lightColor="#fff" darkColor="#fff">
          {entry.text}
        </ThemedText>
        <ThemedText numberOfLines={1} style={styles.initiativeTitle}>
          {initiativeTitle}
        </ThemedText>
        <ThemedText style={styles.timeAgo}>{timeAgo(entry.created_at)}</ThemedText>
      </LinearGradient>
    </Pressable>
  );
}

const CARD_WIDTH = 150;

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    aspectRatio: 3 / 5,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
    overflow: 'hidden',
    position: 'relative',
  },
  fullBleedMedia: {
    ...StyleSheet.absoluteFillObject,
  },
  // Floats over the art itself (photo or solid category color), well above
  // the text scrim — the category glyph reads as the card's "cover icon"
  // rather than a corner badge, per the product sketch this mirrors.
  iconBadgeRow: {
    position: 'absolute',
    top: 28,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    zIndex: 1,
    justifyContent: 'flex-end',
    padding: 10,
  },
  updateText: {
    fontSize: 13,
    lineHeight: 17,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  initiativeTitle: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#fff',
    opacity: 0.85,
    marginTop: 3,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  timeAgo: {
    fontSize: 10,
    color: '#fff',
    opacity: 0.65,
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
