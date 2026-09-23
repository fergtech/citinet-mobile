import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { initiativeBannerUrl } from '@/lib/api/hubService';
import { Initiative, InitiativeActivityEntry } from '@/lib/api/types';
import {
  initiativeCategoryMeta,
  initiativeCategoryPresetImage,
  initiativeColor,
  initiativeOpenRoleCount,
  initiativeStatusMeta,
  initiativeTaskCounts,
} from '@/lib/initiatives/meta';
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

// Shared chrome behind both cards below — full-bleed image/gradient-scrim/
// white-text language, same as components/featured-carousel.tsx, just
// narrower (3:5 vs Featured's 4:5) and shorter in absolute height. When the
// initiative has no uploaded banner (Initiative.banner_mode !== 'image'), a
// preset photo for its category fills the card instead (see
// initiativeCategoryPresetImage) — the plain solid-color tile is now only a
// last-resort fallback for a category outside the four presets cover. The
// scrim applies over all three cases identically, so the text block reads
// the same regardless of source. `primaryText` is always shown (the card's
// main point — an activity sentence for InitiativeUpdateCard below, the
// initiative's own title for ClubInitiativeCard); secondary/tertiary are
// each optional since what's worth surfacing differs by caller.
function InitiativeCoverCard({
  category: categoryRaw,
  colorName,
  hasBannerImage,
  tunnelUrl,
  initiativeId,
  primaryText,
  secondaryText,
  tertiaryText,
  onPress,
  style,
}: {
  category: string;
  colorName: string;
  hasBannerImage: boolean;
  tunnelUrl: string;
  initiativeId: string;
  primaryText: string;
  secondaryText?: string;
  tertiaryText?: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const category = initiativeCategoryMeta(categoryRaw);
  const color = initiativeColor(colorName);
  const presetImage = initiativeCategoryPresetImage(categoryRaw);

  return (
    <Pressable style={[styles.card, style]} onPress={onPress}>
      {hasBannerImage ? (
        <Image source={{ uri: initiativeBannerUrl(tunnelUrl, initiativeId) }} style={styles.fullBleedMedia} contentFit="cover" />
      ) : presetImage ? (
        <Image source={presetImage} style={styles.fullBleedMedia} contentFit="cover" />
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
          {primaryText}
        </ThemedText>
        {!!secondaryText && (
          <ThemedText numberOfLines={1} style={styles.initiativeTitle}>
            {secondaryText}
          </ThemedText>
        )}
        {!!tertiaryText && <ThemedText style={styles.timeAgo}>{tertiaryText}</ThemedText>}
      </LinearGradient>
    </Pressable>
  );
}

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
  return (
    <InitiativeCoverCard
      category={row.initiativeCategory}
      colorName={row.initiativeColorName}
      hasBannerImage={row.hasBannerImage}
      tunnelUrl={tunnelUrl}
      initiativeId={row.initiativeId}
      primaryText={row.entry.text}
      secondaryText={row.initiativeTitle}
      tertiaryText={timeAgo(row.entry.created_at)}
      onPress={onPress}
      style={style}
    />
  );
}

// The same card, retargeted at a Club's own "Initiatives" tab (app/clubs/
// [slug].tsx) — listing the initiatives themselves, not their activity, so
// the meta actually shown is different: there's no activity sentence to lead
// with, so the initiative's own title takes the primary line instead, and
// status/category/progress (the same facts SpaceInitiativeRow-era rows
// showed) fill the two lines under it rather than an initiative title +
// timestamp.
export function ClubInitiativeCard({
  initiative,
  tunnelUrl,
  onPress,
  style,
}: {
  initiative: Initiative;
  tunnelUrl: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const status = initiativeStatusMeta(initiative.status);
  const category = initiativeCategoryMeta(initiative.category);
  const counts = initiativeTaskCounts(initiative);
  const openRoles = initiativeOpenRoleCount(initiative);
  const tertiaryText =
    counts.total > 0
      ? `${counts.done}/${counts.total} tasks done`
      : openRoles > 0
        ? `${openRoles} open ${openRoles === 1 ? 'role' : 'roles'}`
        : undefined;

  return (
    <InitiativeCoverCard
      category={initiative.category}
      colorName={initiative.color}
      hasBannerImage={initiative.banner_mode === 'image' && !!initiative.banner_image_file_name}
      tunnelUrl={tunnelUrl}
      initiativeId={initiative.id}
      primaryText={initiative.title}
      secondaryText={`${status.label} · ${category.label}`}
      tertiaryText={tertiaryText}
      onPress={onPress}
      style={style}
    />
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
