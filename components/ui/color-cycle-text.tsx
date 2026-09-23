import { useEffect } from 'react';
import type { TextProps } from 'react-native';
import Animated, { Easing, interpolateColor, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

// Same brand trio as components/ambient-glow.tsx's ORBS, and the same
// pacing app-drawer.tsx's "citinet" wordmark originated this effect with.
export const DEFAULT_COLOR_CYCLE_PALETTE = ['#ff9f43', '#8b5cf6', '#ef4444'];
const DEFAULT_CYCLE_MS = 6000;

type Props = TextProps & {
  children: string;
  colors?: string[];
  cycleMs?: number;
};

// A plain Text whose color continuously cycles through `colors`
// (interpolateColor) instead of resting on one fixed shade — originally
// components/app-drawer.tsx's own CitinetWordmark, pulled out here once
// Home's greeting (app/(tabs)/index.tsx) wanted the same effect on the
// signed-in user's name, so the animation only has one real implementation.
// Animated.Text directly (not a wrapped ThemedText), matching the
// wordmark's own reasoning: Text is a real host component Reanimated
// forwards a ref to safely, unlike e.g. an SVG <Defs> child, which doesn't
// render a host view at all and crashes on unmount when wrapped with
// Animated.createAnimatedComponent.
export function ColorCycleText({ children, style, colors = DEFAULT_COLOR_CYCLE_PALETTE, cycleMs = DEFAULT_CYCLE_MS, ...rest }: Props) {
  const hue = useSharedValue(0);
  const inputRange = [...Array(colors.length + 1).keys()]; // [0,1,...,colors.length]
  const outputRange = [...colors, colors[0]]; // loop back matches start

  useEffect(() => {
    hue.value = withRepeat(withTiming(colors.length, { duration: cycleMs, easing: Easing.linear }), -1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    color: interpolateColor(hue.value % colors.length, inputRange, outputRange),
  }));

  return (
    <Animated.Text style={[style, animatedStyle]} {...rest}>
      {children}
    </Animated.Text>
  );
}
