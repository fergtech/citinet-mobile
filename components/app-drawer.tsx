import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CitinetAboutModal } from '@/components/citinet-about-modal';
import { ThemedText } from '@/components/themed-text';
import { CustomIcon } from '@/components/ui/custom-icon';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/lib/session/session-context';

const EDGE_WIDTH = 24; // only this strip at the physical left edge can start opening it
const DRAWER_WIDTH = 280;
const COMMIT_RATIO = 0.4;
const FLING_VELOCITY = 800;
const SETTLE_DURATION_MS = 240;

// Same trio as components/ambient-glow.tsx's ORBS — reused here (rather than
// the blue/purple/cyan/teal/pink first floated) so the wordmark pulls from
// the same brand palette as the rest of the app's ambient motion.
const WORDMARK_PALETTE = ['#ff9f43', '#8b5cf6', '#ef4444'];
const WORDMARK_INPUT_RANGE = [...Array(WORDMARK_PALETTE.length + 1).keys()]; // [0,1,2,3]
const WORDMARK_OUTPUT_RANGE = [...WORDMARK_PALETTE, WORDMARK_PALETTE[0]]; // loop back matches start
const WORDMARK_CYCLE_MS = 6000;

// The "Citinet" header label's animated counterpart to a plain ThemedText —
// its color continuously cycles through WORDMARK_PALETTE (interpolateColor)
// rather than resting on one fixed brand color. Uses Reanimated's own
// Animated.Text directly (not a wrapped ThemedText, and nothing inside an
// SVG <Defs> the way the About row icon almost got animated) — Text is a
// real host component Reanimated forwards a ref to safely, unlike SVG's
// Stop/LinearGradient defs, which don't render a host view at all and crash
// on unmount ("Cannot find host instance for this component") when wrapped
// with Animated.createAnimatedComponent.
function CitinetWordmark() {
  const hue = useSharedValue(0);

  useEffect(() => {
    hue.value = withRepeat(
      withTiming(WORDMARK_PALETTE.length, { duration: WORDMARK_CYCLE_MS, easing: Easing.linear }),
      -1,
      false
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    color: interpolateColor(hue.value % WORDMARK_PALETTE.length, WORDMARK_INPUT_RANGE, WORDMARK_OUTPUT_RANGE),
  }));

  return (
    <Animated.Text style={[styles.logoLabel, animatedStyle]} accessibilityRole="header">
      citinet.
    </Animated.Text>
  );
}

/**
 * A custom edge-swipe drawer -- not @react-navigation/drawer, hand-built on
 * gesture-handler/reanimated (both already project dependencies, no new
 * native module). Deliberately not a panel sliding OVER the content:
 * dragging from the left edge shifts the current screen's content to the
 * right, revealing the drawer sitting behind it (same idea as old Facebook
 * Paper / several native productivity apps), rather than a traditional
 * Android-style hamburger overlay.
 *
 * Scoped to wrap just the (tabs) experience (see app/(tabs)/_layout.tsx),
 * not the whole app -- an edge-swipe would be unwelcome mid auth flow or on
 * a full-screen modal like call setup.
 *
 * Holds only destinations that don't already have bottom-tab real estate
 * (Atlas, Initiatives, Events, Feed, Files, About) -- Home/Discover/Messages/
 * Profile staying out of here is deliberate, so this doesn't become a
 * second, redundant navigation surface. "About" opens CitinetAboutModal
 * (about Citinet itself, not this hub) instead of a route -- there's no
 * dedicated about screen. Hub-specific info (icon/description/QR) stays on
 * HubInfoModal, reachable by tapping the hub name on Home -- duplicating
 * that here would just be the same info in two places.
 */
export function AppDrawer({ children }: { children: ReactNode }) {
  const colorScheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const translateX = useSharedValue(0);

  function setOpenJS(next: boolean) {
    if (next !== open && Platform.OS === 'ios') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen(next);
  }

  // withTiming + a plain ease-out, not withSpring -- a spring here (even a
  // fairly damped one) still overshoots past its target and settles back,
  // which read as the whole drawer "rocking"/shaking briefly after opening.
  // A timing curve reaches DRAWER_WIDTH/0 once and stops, so open and close
  // both read as one smooth slide with no bounce-back.
  function settle(next: boolean) {
    'worklet';
    translateX.value = withTiming(next ? DRAWER_WIDTH : 0, { duration: SETTLE_DURATION_MS, easing: Easing.out(Easing.cubic) });
    runOnJS(setOpenJS)(next);
  }

  function close() {
    translateX.value = withTiming(0, { duration: SETTLE_DURATION_MS, easing: Easing.out(Easing.cubic) });
    setOpenJS(false);
  }

  function go(href: Href) {
    // No refetch/remount hazard here the way a full tab-swap gesture had --
    // this is a plain stack push (see app/_layout.tsx), which plays its own
    // full-screen transition over everything, so the drawer/content just
    // needs to be out of the way underneath it, not perfectly choreographed.
    translateX.value = withTiming(0, { duration: 150 });
    setOpen(false);
    router.push(href);
  }

  // Narrow edge strip, always mounted -- its own layout bounds (not the
  // full screen) are what restrict where this gesture can start, same
  // technique every edge-swipe-drawer implementation uses. activeOffsetX(10)
  // (positive-only) means it only ever recognizes a rightward drag --
  // opening, never closing -- so it can't fight the close gesture below.
  const edgePan = Gesture.Pan()
    .activeOffsetX(10)
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      translateX.value = Math.min(DRAWER_WIDTH, Math.max(0, e.translationX));
    })
    .onEnd((e) => {
      const draggedRatio = translateX.value / DRAWER_WIDTH;
      const committed = draggedRatio >= COMMIT_RATIO || e.velocityX >= FLING_VELOCITY;
      settle(committed);
    });

  // Covers the shifted content once open -- drag left from anywhere on it,
  // or a plain tap, both close. Gesture.Race so a quick tap resolves as a
  // tap and a real drag resolves as a pan, instead of the two competing.
  const closePan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .onUpdate((e) => {
      translateX.value = Math.min(DRAWER_WIDTH, Math.max(0, DRAWER_WIDTH + e.translationX));
    })
    .onEnd((e) => {
      const closedRatio = (DRAWER_WIDTH - translateX.value) / DRAWER_WIDTH;
      const committedToClose = closedRatio >= COMMIT_RATIO || e.velocityX <= -FLING_VELOCITY;
      settle(!committedToClose);
    });
  const closeTap = Gesture.Tap().onEnd(() => {
    runOnJS(close)();
  });
  const closeGesture = Gesture.Race(closePan, closeTap);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(translateX.value, [0, DRAWER_WIDTH], [-40, 0]) }],
  }));
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, DRAWER_WIDTH], [0, 0.25]),
  }));

  const rowColor = Colors[colorScheme].text;

  return (
    <View style={styles.root}>
      <Animated.View
        style={[
          styles.drawer,
          { paddingTop: insets.top + 24, backgroundColor: Colors[colorScheme].background },
          drawerStyle,
        ]}>
        <View style={styles.logoRow}>
          <CitinetWordmark />
        </View>
        <DrawerRow icon={<CustomIcon name="landLayerLocation" size={26} color={rowColor} />} label="Atlas" onPress={() => go('/atlas')} />
        <DrawerRow icon={<CustomIcon name="bullseyeArrow" size={26} color={rowColor} />} label="Initiatives" onPress={() => go('/initiatives')} />
        <DrawerRow icon={<IconSymbol name="calendar" size={26} color={rowColor} />} label="Events" onPress={() => go('/events')} />
        <DrawerRow icon={<CustomIcon name="feedGlyph" size={26} color={rowColor} />} label="Feed" onPress={() => go('/feed')} />
        <DrawerRow icon={<IconSymbol name="folder.fill" size={26} color={rowColor} />} label="Files" onPress={() => go('/files')} />
        <View style={styles.divider} />
        <DrawerRow
          icon={<IconSymbol name="info.circle" size={26} color={rowColor} />}
          label="About"
          onPress={() => {
            close();
            setShowAbout(true);
          }}
        />
      </Animated.View>

      <Animated.View style={[styles.flex, contentStyle]}>
        {children}
        {open && (
          <GestureDetector gesture={closeGesture}>
            <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]} />
          </GestureDetector>
        )}
      </Animated.View>

      <GestureDetector gesture={edgePan}>
        <View style={styles.edgeCatcher} />
      </GestureDetector>

      {session && <CitinetAboutModal visible={showAbout} onClose={() => setShowAbout(false)} hubName={session.hub.name} />}
    </View>
  );
}

function DrawerRow({ icon, label, onPress }: { icon: ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={styles.rowIcon}>{icon}</View>
      <ThemedText style={styles.rowLabel}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: DRAWER_WIDTH,
    paddingHorizontal: 12,
  },
  logoRow: {
    marginLeft: 12,
    marginBottom: 20,
  },
  logoLabel: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#8884',
    marginVertical: 12,
    marginHorizontal: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 16,
    borderRadius: 12,
  },
  rowIcon: {
    width: 28,
    alignItems: 'center',
  },
  rowLabel: {
    fontSize: 19,
    fontWeight: '600',
  },
  overlay: {
    backgroundColor: '#000',
    zIndex: 5,
    elevation: 5,
  },
  edgeCatcher: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: EDGE_WIDTH,
    zIndex: 10,
    elevation: 10,
  },
});
