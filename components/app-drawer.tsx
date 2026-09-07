import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { useDrawerCoordinator } from '@/lib/ui/drawer-coordinator';

// Only this strip at the physical left edge can start opening it. Wider on
// Android: a narrow strip there loses the touch to Android's own system
// back-gesture (edge-swipe-to-go-back in gesture-navigation mode) before our
// own Pan gesture ever gets a chance to recognize it — the system claims
// roughly the outer ~24dp of the edge for itself, so matching that width
// meant our gesture and the system's were fighting over the exact same
// pixels and the system usually won. Widening past that zone doesn't
// eliminate the conflict in the innermost pixels, but it gives a swipe
// starting just past the system's own strip (still visually "from the edge"
// to the user) a real chance of being recognized as ours instead of nothing
// happening at all. iOS has no equivalent system-level gesture competing on
// this screen (no NativeStack back gesture on the tab root), so it keeps the
// narrower, more precise strip.
const EDGE_WIDTH = Platform.OS === 'android' ? 40 : 24;
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
      citinet
    </Animated.Text>
  );
}

type AppDrawerContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

const AppDrawerContext = createContext<AppDrawerContextValue | null>(null);

// Lets any screen mounted inside <AppDrawer> open/close it programmatically —
// Home's own top-left menu button uses this as a tap-to-open fallback,
// important on Android where the edge-swipe can lose to the system back
// gesture (see EDGE_WIDTH's own comment) and shouldn't be the only way in.
export function useAppDrawer(): AppDrawerContextValue {
  const ctx = useContext(AppDrawerContext);
  if (!ctx) throw new Error('useAppDrawer must be used within AppDrawer');
  return ctx;
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
 * (Atlas, Initiatives, Events, Feed, Files, Spaces, About) -- Home/Discover/Messages/
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
  const { activeDrawer, notifyOpened, notifyClosed, canOpen } = useDrawerCoordinator();
  const [open, setOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const translateX = useSharedValue(0);

  function setOpenJS(next: boolean) {
    if (next !== open && Platform.OS === 'ios') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen(next);
    if (next) notifyOpened('app');
    else notifyClosed('app');
  }

  // DiscoverDrawer (right edge) opening while this one is already open --
  // force it shut so the two can never both be visible/mid-gesture at once
  // (mutual exclusion is otherwise just "whoever's edge gesture fires
  // second wins", which is how the overlapping-backdrops bug happened).
  useEffect(() => {
    if (activeDrawer === 'discover' && open) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrawer]);

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

  // Named openDrawer (not `open`) to avoid shadowing the `open` state
  // variable above — plain-JS counterpart to close(), for the menu button
  // and useAppDrawer() context consumers rather than a gesture callback.
  function openDrawer() {
    translateX.value = withTiming(DRAWER_WIDTH, { duration: SETTLE_DURATION_MS, easing: Easing.out(Easing.cubic) });
    setOpenJS(true);
  }
  function toggleDrawer() {
    if (open) close();
    else openDrawer();
  }

  function go(href: Href) {
    // No refetch/remount hazard here the way a full tab-swap gesture had --
    // this is a plain stack push (see app/_layout.tsx), which plays its own
    // full-screen transition over everything, so the drawer/content just
    // needs to be out of the way underneath it, not perfectly choreographed.
    translateX.value = withTiming(0, { duration: 150 });
    setOpen(false);
    notifyClosed('app');
    router.push(href);
  }

  // Narrow edge strip, always mounted -- its own layout bounds (not the
  // full screen) are what restrict where this gesture can start, same
  // technique every edge-swipe-drawer implementation uses. activeOffsetX(10)
  // (positive-only) means it only ever recognizes a rightward drag --
  // opening, never closing -- so it can't fight the close gesture below.
  // .enabled(canOpen('app')) additionally shuts this off entirely while
  // DiscoverDrawer is open, so a left-edge swipe can't fight its way in
  // mid-gesture on the other drawer.
  const edgePan = Gesture.Pan()
    .activeOffsetX(10)
    .failOffsetY([-15, 15])
    .enabled(canOpen('app'))
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

  const contextValue = useMemo<AppDrawerContextValue>(
    () => ({ isOpen: open, open: openDrawer, close, toggle: toggleDrawer }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open]
  );

  return (
    <AppDrawerContext.Provider value={contextValue}>
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
        <DrawerRow icon={<IconSymbol name="newspaper.fill" size={26} color={rowColor} />} label="Feed" onPress={() => go('/feed')} />
        <DrawerRow icon={<CustomIcon name="filesGlyph" size={26} color={rowColor} />} label="Files" onPress={() => go('/files')} />
        {/* `as Href` — expo-router's generated route types (.expo/types)
            haven't picked up this new index route as the bare `/spaces` yet,
            only `/spaces/index`; same situation initiatives/index.tsx notes
            for its own not-yet-typed push. Drop the cast once the dev
            server's next typegen pass resolves it. */}
        <DrawerRow icon={<IconSymbol name="square.grid.2x2" size={26} color={rowColor} />} label="Spaces" onPress={() => go('/spaces' as Href)} />
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
        {/* activeDrawer === 'app' on top of `open` (not just `open` alone) --
            when DiscoverDrawer takes over, the coordinator's activeDrawer
            flips to 'discover' in the same render that triggers this
            drawer's own close effect, one render ahead of `open` itself
            catching up. Gating on both means this overlay unmounts in that
            same render instead of lagging an extra frame behind, so the two
            drawers' overlays can never both be mounted at once. */}
        {open && activeDrawer === 'app' && (
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
    </AppDrawerContext.Provider>
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
  // top starts below Home's header row, not at 0 -- this catcher always
  // paints above {children} (see the JSX below, it's the last sibling) so
  // it can win the edge-swipe gesture over whatever content sits beneath it
  // there, but that same "always on top" is what let it start swallowing
  // taps on Home's own top-left menu button once EDGE_WIDTH widened enough
  // (see EDGE_WIDTH's own comment) to reach that button's screen position —
  // Android hit-tests overlapping views strictly by paint order, so the
  // button never saw the touch at all. Clipping the catcher to start below
  // the header band excludes that button's row from its hit region entirely
  // rather than trying to out-stack it, which isn't possible without also
  // breaking the catcher's actual job (it has to stay on top of {children}
  // everywhere else it does cover). Costs only the ability to start a swipe
  // from within the header row itself -- an imperceptible trade-off given
  // how little of the screen that band is, and Home's header uses a flat
  // paddingTop rather than insets.top, so this flat offset tracks it the
  // same way across devices instead of needing its own insets math.
  edgeCatcher: {
    position: 'absolute',
    top: 112,
    bottom: 0,
    left: 0,
    width: EDGE_WIDTH,
    zIndex: 10,
    elevation: 10,
  },
});
