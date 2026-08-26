import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Path, Svg } from 'react-native-svg';

import { HapticTab } from '@/components/haptic-tab';
import { ICON_PATHS } from '@/components/ui/custom-icon';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Fast enough to read as a flourish, not a loading spinner, and to finish
// well before /modal's own slide-up transition does — triggered on
// press-IN (finger-down), not onPress (finger-up/tap-complete), since the
// screen transition starts the moment the tab is pressed and there'd be
// nothing left to see the spin play against if it waited for a full tap.
const SPIN_DURATION_MS = 220;
const COLOR_IN_MS = 120;
const COLOR_HOLD_MS = 150;
const COLOR_OUT_MS = 320;

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function CreateTabButton(props: BottomTabBarButtonProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const tint = Colors[colorScheme].tint;
  // "Create" never actually becomes the focused tab (tabPress cancels the
  // real navigation and pushes /modal instead — see (tabs)/_layout.tsx), so
  // unlike the other 4 tabs it should never sit at the active tint at rest;
  // it only reads as "on" for the moment it's actually being pressed,
  // otherwise it'd look permanently active with nothing behind that claim.
  const inactiveColor = Colors[colorScheme].tabIconDefault;
  const rotation = useSharedValue(0);
  const active = useSharedValue(0);

  function handlePressIn() {
    // Adds a full turn from wherever it currently sits, rather than
    // resetting to 0 first — a rapid re-tap (before the previous spin has
    // visually settled) keeps rotating forward instead of snapping back.
    rotation.value = withTiming(rotation.value + 360, {
      duration: SPIN_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
    // Flashes to the active tint alongside the spin, holds briefly, then
    // eases back to the resting inactive color — a quick rise/fall rather
    // than a toggle, since this never has a real "stay highlighted" state
    // to switch to the way a genuinely focused tab would. One sequence, not
    // two separate assignments — a second assignment to a shared value
    // replaces whatever animation the first one was still running.
    active.value = withSequence(
      withTiming(1, { duration: COLOR_IN_MS, easing: Easing.out(Easing.cubic) }),
      withDelay(COLOR_HOLD_MS, withTiming(0, { duration: COLOR_OUT_MS, easing: Easing.out(Easing.cubic) }))
    );
  }

  const rotateStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const animatedProps = useAnimatedProps(() => ({
    fill: interpolateColor(active.value, [0, 1], [inactiveColor, tint]),
  }));

  return (
    <HapticTab
      {...props}
      style={[props.style, styles.button]}
      onPressIn={handlePressIn}
      accessibilityLabel="Create"
      accessibilityRole="button">
      <Animated.View style={rotateStyle}>
        <Svg width={30} height={30} viewBox="0 0 24 24">
          <AnimatedPath d={ICON_PATHS.plus} animatedProps={animatedProps} />
        </Svg>
      </Animated.View>
    </HapticTab>
  );
}

const styles = StyleSheet.create({
  button: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
