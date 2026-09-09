import { BottomTabBar, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useTabBarVisibility } from '@/lib/ui/tab-bar-visibility';

// Wraps the library's own BottomTabBar (unchanged — same icons/create-button/
// haptics/badge already configured via app/(tabs)/_layout.tsx's
// screenOptions) in an Animated.View, so a screen can slide it off/on
// screen on scroll (see lib/ui/tab-bar-visibility.ts) via a real Reanimated
// transform instead of the abrupt, unanimated navigation.setOptions swap
// this replaced — React Navigation re-renders tabBarStyle changes with no
// transition of its own, which is why that first attempt just snapped.
//
// (A sliding active-tab highlight pill lived here briefly too, inspired by
// davidmokos/expo-glass-tabs — pulled back out after a device screenshot
// showed it rendering far too wide, more like a smear across several tabs
// than a focused highlight, and the visual wasn't wanted regardless once
// seen live. Just the plain tint-color active state remains.)
//
// The absoluteFillObject wrapper isn't optional: BottomTabBar's own
// tabBarStyle (lib/ui/tab-bar-style.ts) is itself position:'absolute' with
// a `bottom` offset, resolved relative to its nearest positioned ancestor —
// every RN View defaults to position:'relative' (there's no 'static'), so
// wrapping it in a plain, undersized Animated.View would make THAT wrapper
// the new reference frame instead. An absolutely-positioned child doesn't
// contribute to its parent's intrinsic size, so an unstyled wrapper would
// collapse to zero height, and "bottom: X" would then resolve against that
// zero-height box instead of the actual screen edge — the bar would render
// in the wrong place entirely. absoluteFillObject gives this wrapper the
// same full-screen bounds the unwrapped bar used to size against, so
// BottomTabBar's own positioning is unaffected by being wrapped at all.
// pointerEvents="box-none" lets touches on the large empty area above the
// actual pill fall through to the screen content behind it — same pattern
// as components/comms/broadcast-overlay.tsx's own overlay layers.
export function AnimatedTabBar(props: BottomTabBarProps) {
  const { translateY } = useTabBarVisibility();
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFillObject, animatedStyle]} pointerEvents="box-none">
      <BottomTabBar {...props} />
    </Animated.View>
  );
}
