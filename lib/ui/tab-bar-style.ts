import { StyleSheet, type ViewStyle } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';

// Named constants (not just inlined below) so anything else that ever needs
// to line up with the bar's own box — a scroll-hide wrapper, an overlay,
// etc. — reads the same numbers instead of a second hardcoded copy.
export const TAB_BAR_HEIGHT = 60;
// Keep a compact margin from the phone edges without the previous wide gap
// that made the floating bar feel detached from the screen.
export const TAB_BAR_MARGIN_HORIZONTAL = 6;
export const TAB_BAR_RADIUS = 28;

// The tab bar's own base look (floating pill, background/border/shadow) —
// used by app/(tabs)/_layout.tsx's screenOptions.tabBarStyle. Scroll-driven
// hiding (see lib/ui/tab-bar-visibility.ts / components/animated-tab-bar.tsx)
// is a separate transform applied to a wrapper around the rendered bar, not
// a property of this style — this stays a single static style regardless of
// visibility state.
export function getTabBarStyle(insets: EdgeInsets, isDark: boolean): ViewStyle {
  const borderColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)';
  return {
    backgroundColor: 'transparent',
    position: 'absolute',
    marginHorizontal: TAB_BAR_MARGIN_HORIZONTAL,
    bottom: Math.max(insets.bottom, 16),
    height: TAB_BAR_HEIGHT,
    paddingBottom: 0,
    paddingTop: 0,
    borderRadius: TAB_BAR_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor,
    overflow: 'hidden',
    elevation: 8,
  };
}
