import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AmbientGlow } from '@/components/ambient-glow';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ActionItem = {
  key: string;
  icon: IconSymbolName;
  title: string;
  onPress?: () => void;
};

type ActionSection = {
  label: string;
  items: ActionItem[];
};

// A launcher, not a container — the sheet itself never holds any creation
// UI. This app spans a lot more than a social-post feed (a post, a
// marketplace listing, and an Atlas pin are three genuinely distinct,
// independently real features, not "post types"), so leading with a
// post-composer + attachment chips misrepresented the app's actual scope.
// Each item instead routes straight to the real, standalone editor for that
// thing — the same editor reached from that feature's own "+" elsewhere
// (Atlas's header, Marketplace's header), so there's exactly one
// implementation per editor, never a sheet-only duplicate.
//
// Grouped by intent rather than a flat list — "what am I trying to do"
// (share something, organize the community, deal with something local)
// reads faster on a phone than eight unrelated rows in a row. Section
// labels carry the "why", so individual tiles need only an icon + name,
// not a repeated explanatory sentence.
const SECTIONS: ActionSection[] = [
  {
    label: 'Share',
    items: [
      { key: 'post', icon: 'pencil', title: 'Write a post', onPress: () => router.push('/compose-post') },
      {
        key: 'file',
        icon: 'externaldrive.fill',
        title: 'Upload a file',
        onPress: () => router.push({ pathname: '/files/upload', params: { from: 'compose' } }),
      },
    ],
  },
  {
    label: 'Community',
    items: [
      {
        key: 'event',
        icon: 'calendar',
        title: 'Create an event',
        onPress: () => router.push({ pathname: '/event-editor', params: { from: 'compose' } }),
      },
      { key: 'initiative', icon: 'target', title: 'Start an initiative', onPress: () => router.push('/initiatives/create') },
      { key: 'space', icon: 'building.2.fill', title: 'Create a space', onPress: () => router.push('/spaces/create') },
    ],
  },
  {
    label: 'Local',
    items: [
      {
        key: 'listing',
        icon: 'tag.fill',
        title: 'Sell or give something',
        onPress: () => router.push({ pathname: '/marketplace/editor', params: { from: 'compose' } }),
      },
      {
        key: 'pin',
        icon: 'mappin.and.ellipse',
        title: 'Drop a pin',
        onPress: () => router.push({ pathname: '/atlas/editor', params: { from: 'compose' } }),
      },
    ],
  },
];

// Kept apart from the grouped grid above and given a distinct (tinted,
// full-width) treatment — moderation/report actions carry a different
// weight than "make a post" or "sell an item" and shouldn't visually
// compete with them for attention.
//
// No onPress — there is no report/flag endpoint anywhere in citinet's
// real server (confirmed via a full grep of api/server.js), so unlike the
// items above this one has nothing real to route to yet. Listed per spec,
// inert until that server-side piece exists — same "build what's real,
// disclose what isn't" rule as every other stub in this app.
const REPORT_ACTION: ActionItem = {
  key: 'report',
  icon: 'exclamationmark.triangle.fill',
  title: 'Report an issue',
};

export default function ComposeLauncherScreen() {
  const colorScheme = useColorScheme() ?? 'light';

  return (
    <ThemedView style={styles.container}>
      {/* Ambient candlelight-style header: drifting, breathing radial-
          gradient glows (AmbientGlow) sitting directly on the screen's own
          themed background — no forced dark backdrop of its own — with a
          glass scrim in that same background color layered on top to
          diffuse them, like light through smoked glass. Text/icons stay
          theme-colored as normal since the background is just this screen's
          usual one, not a special dark surface. A bottom fade (transparent
          → fully opaque background) dissolves the glow into the rest of the
          screen instead of a hard clipped rectangle — the previous version's
          `overflow:'hidden'` box edge read as an obvious cutoff line right
          where the action list begins, which is exactly the "dancing along
          the top, not boxed in" look this was supposed to avoid. */}
      <View style={styles.heroHeader}>
        <AmbientGlow />
        <View style={[styles.glassScrim, { backgroundColor: Colors[colorScheme].background + '8c' }]} />
        {/* The literal 'transparent' keyword interpolates as black-at-zero-
            alpha on iOS's native gradient layer (CAGradientLayer) — RGB ramps
            from (0,0,0) toward the target color while alpha ramps 0→1, so
            the midpoint reads as a visibly dark/black band. Web's CSS
            gradients don't have this problem, which is exactly why this
            looked fine in a browser but showed a hard dark bar on a real
            iPhone via Orbit. Fixed by using the *same* RGB as the target
            color at 0 alpha (`+ '00'` hex suffix) instead, so only alpha
            ramps and the fade is colorless (never darker-than-either-end)
            on every platform. */}
        <LinearGradient
          colors={[Colors[colorScheme].background + '00', Colors[colorScheme].background]}
          locations={[0, 0.92]}
          style={styles.bottomFade}
          pointerEvents="none"
        />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close" accessibilityRole="button">
            <IconSymbol name="xmark" size={22} color={Colors[colorScheme].text} />
          </Pressable>
          <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
            Create
          </ThemedText>
          <View style={styles.headerSpacer} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {SECTIONS.map((section) => (
          <View key={section.label} style={styles.section}>
            <ThemedText style={[styles.sectionLabel, { color: Colors[colorScheme].icon }]}>{section.label}</ThemedText>
            <View style={styles.grid}>
              {section.items.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={item.onPress}
                  style={[styles.tile, { backgroundColor: Colors[colorScheme].icon + '14' }]}>
                  <IconSymbol name={item.icon} size={22} color={Colors[colorScheme].text} />
                  <ThemedText type="defaultSemiBold" style={styles.tileLabel}>
                    {item.title}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Pressable disabled style={[styles.reportRow, styles.reportRowDisabled]}>
          <View style={styles.iconTileDanger}>
            <IconSymbol name={REPORT_ACTION.icon} size={18} color="#b0392f" />
          </View>
          <ThemedText type="defaultSemiBold" style={styles.reportLabel}>
            {REPORT_ACTION.title}
          </ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heroHeader: {
    height: 130,
    overflow: 'hidden',
  },
  glassScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  // Sized to only cover the gap below the header row's own bottom edge
  // (paddingTop 60 + ~22px content + paddingBottom 16 ≈ 98 of the 130-tall
  // hero) — the previous 75px version reached up into the row itself,
  // darkening a band directly behind the header title and X button, which
  // read as an obvious boxed rectangle rather than a smooth dissolve.
  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 36,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 16,
  },
  headerSpacer: {
    width: 22,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 22,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  // Fixed-width tiles (not flex-grow) so every tile in a section reads at
  // the same visual weight regardless of how many share the row — no
  // single action should look "bigger" or more important than another.
  tile: {
    width: '48%',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 8,
  },
  tileLabel: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 17,
  },
  // Deliberately distinct from the grid tiles above — full-width, tinted
  // red, no icon-tile background match — so moderation/report actions
  // read as a different category of thing, not just another option.
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(176,57,47,0.08)',
  },
  reportRowDisabled: {
    opacity: 0.55,
  },
  iconTileDanger: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(176,57,47,0.15)',
  },
  reportLabel: {
    fontSize: 14.5,
    color: '#b0392f',
  },
});
