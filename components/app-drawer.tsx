import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HubInfoModal } from '@/components/hub-info-modal';
import { ThemedText } from '@/components/themed-text';
import { CustomIcon } from '@/components/ui/custom-icon';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { isLocalConnection } from '@/lib/ui/is-local-connection';
import { useSession } from '@/lib/session/session-context';

const EDGE_WIDTH = 24; // only this strip at the physical left edge can start opening it
const DRAWER_WIDTH = 280;
const COMMIT_RATIO = 0.4;
const FLING_VELOCITY = 800;

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
 * (Atlas, Initiatives, Events, About) -- Home/Discover/Messages/Profile
 * staying out of here is deliberate, so this doesn't become a second,
 * redundant navigation surface. "About" opens the existing HubInfoModal
 * (icon/name/description/QR) instead of a route -- there's no dedicated
 * about screen, and that modal already covers exactly this.
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

  function settle(next: boolean) {
    'worklet';
    translateX.value = withSpring(next ? DRAWER_WIDTH : 0, { damping: 22, stiffness: 220 });
    runOnJS(setOpenJS)(next);
  }

  function close() {
    translateX.value = withSpring(0, { damping: 22, stiffness: 220 });
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
        {/* icon-512x512.png's "C" is a pale lavender-gray -- the same asset
            used (composited onto a solid #151718 chip) for the app's own
            home-screen icon, for the same reason: it needs a dark backdrop
            for real contrast, which the drawer's own background can't
            guarantee (white in light mode). */}
        <View style={styles.logoRow}>
          <View style={styles.logoWrap}>
            <Image source={require('@/assets/images/icon-512x512.png')} style={styles.logo} contentFit="contain" />
          </View>
          <ThemedText type="title" style={styles.logoLabel}>
            Citinet
          </ThemedText>
        </View>
        <DrawerRow icon={<CustomIcon name="landLayerLocation" size={26} color={rowColor} />} label="Atlas" onPress={() => go('/atlas')} />
        <DrawerRow icon={<CustomIcon name="bullseyeArrow" size={26} color={rowColor} />} label="Initiatives" onPress={() => go('/initiatives')} />
        <DrawerRow icon={<IconSymbol name="calendar" size={26} color={rowColor} />} label="Events" onPress={() => go('/events')} />
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

      {session && (
        <HubInfoModal
          visible={showAbout}
          onClose={() => setShowAbout(false)}
          hub={session.hub}
          isLocalConnection={isLocalConnection(session.hub.tunnelUrl)}
        />
      )}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 12,
    marginBottom: 20,
  },
  logoWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#151718',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLabel: {
    fontSize: 20,
  },
  logo: {
    width: 36,
    height: 36,
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
