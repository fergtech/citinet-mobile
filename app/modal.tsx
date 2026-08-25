import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AmbientGlow } from '@/components/ambient-glow';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ActionRow = {
  icon: IconSymbolName;
  title: string;
  subtitle: string;
  onPress?: () => void;
  danger?: boolean;
};

// A launcher, not a container — the sheet itself never holds any creation
// UI. This app spans a lot more than a social-post feed (a post, a
// marketplace listing, and an Atlas pin are three genuinely distinct,
// independently real features, not "post types"), so leading with a
// post-composer + attachment chips misrepresented the app's actual scope.
// Each row instead routes straight to the real, standalone editor for that
// thing — the same editor reached from that feature's own "+" elsewhere
// (Atlas's header, Marketplace's header), so there's exactly one
// implementation per editor, never a sheet-only duplicate.
const ACTIONS: ActionRow[] = [
  {
    icon: 'pencil',
    title: 'Write a post',
    subtitle: 'Share an update with your neighbors.',
    onPress: () => router.push('/compose-post'),
  },
  {
    icon: 'tag.fill',
    title: 'Sell or give something',
    subtitle: 'List an item or service for the neighborhood.',
    onPress: () => router.push({ pathname: '/marketplace/editor', params: { from: 'compose' } }),
  },
  {
    icon: 'mappin.and.ellipse',
    title: 'Drop a pin',
    subtitle: 'Mark a spot on the map for others to find.',
    onPress: () => router.push({ pathname: '/atlas/editor', params: { from: 'compose' } }),
  },
  {
    icon: 'calendar',
    title: 'Create an event',
    subtitle: 'Set a date and time for neighbors to join.',
    onPress: () => router.push({ pathname: '/event-editor', params: { from: 'compose' } }),
  },
  {
    icon: 'externaldrive.fill',
    title: 'Upload a file',
    subtitle: 'Share a document, photo, or other file with the hub.',
    onPress: () => router.push({ pathname: '/files/upload', params: { from: 'compose' } }),
  },
  {
    icon: 'exclamationmark.triangle.fill',
    title: 'Report an issue',
    subtitle: 'Flag something for hub admins to review.',
    danger: true,
    // No onPress — there is no report/flag endpoint anywhere in citinet's
    // real server (confirmed via a full grep of api/server.js), so unlike
    // the four rows above this one has nothing real to route to yet. Listed
    // per spec, inert until that server-side piece exists — same "build
    // what's real, disclose what isn't" rule as every other stub in this app.
  },
];

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
            What would you like to do?
          </ThemedText>
          <View style={styles.headerSpacer} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {ACTIONS.map((action, index) => (
          <Pressable
            key={action.title}
            disabled={!action.onPress}
            onPress={action.onPress}
            style={[styles.row, index === ACTIONS.length - 1 && styles.rowLast, !action.onPress && styles.rowDisabled]}>
            <View style={[styles.iconTile, action.danger ? styles.iconTileDanger : styles.iconTileNeutral]}>
              <IconSymbol name={action.icon} size={20} color={action.danger ? '#b0392f' : Colors[colorScheme].text} />
            </View>
            <View style={styles.rowText}>
              <ThemedText type="defaultSemiBold" style={styles.rowTitle}>
                {action.title}
              </ThemedText>
              <ThemedText style={styles.rowSubtitle}>{action.subtitle}</ThemedText>
            </View>
            {action.onPress && <IconSymbol name="chevron.right" size={16} color={Colors[colorScheme].icon} />}
          </Pressable>
        ))}
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
  // darkening a band directly behind the "What would you like to do?" text
  // and X button, which read as an obvious boxed rectangle rather than a
  // smooth dissolve.
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  iconTile: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTileNeutral: {
    backgroundColor: '#8881',
  },
  iconTileDanger: {
    backgroundColor: 'rgba(176,57,47,0.15)',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15.5,
  },
  rowSubtitle: {
    fontSize: 12.5,
    opacity: 0.6,
    lineHeight: 17,
  },
});
