import type { ViewProps } from 'react-native';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { BrandGradientColors } from '@/constants/theme';

// Drop-in replacement for a `View` with `backgroundColor: Brand` on solid-fill
// surfaces (buttons, FAB, avatar fallbacks, badges/dots) — renders the real
// two-color brand gradient instead of a flat color, top-left to bottom-right.
export function BrandGradient({ style, children, ...rest }: ViewProps) {
  return (
    <LinearGradient
      colors={BrandGradientColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[style, styles.clip]}
      {...rest}>
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
});
