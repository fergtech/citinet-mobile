import { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

// A breathing-opacity placeholder for a media container still waiting on its
// URL (the token round-trip in hub-media.tsx's Files-section fallback path —
// the isPublic path resolves synchronously now and never shows this at all).
// Reanimated, not Animated.Value, matching how the rest of this app already
// does UI-thread animation (app-drawer.tsx, etc.).
export function MediaSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[style, animatedStyle]} />;
}
