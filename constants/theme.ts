/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#2164f3';
const tintColorDark = '#fff';

// A fixed accent used for text/icon/border colors (where a two-tone fill isn't
// renderable) — deliberately does NOT flip with theme like `Colors[].tint` does
// (tint is white in dark mode, for icon contrast against dark backgrounds; using
// it as a fill color would make white-on-white content disappear).
export const Brand = tintColorLight;

// The same brand identity as an actual gradient, for solid-fill surfaces
// (buttons, FAB, avatars, badges) — see components/brand-gradient.tsx. A
// plain linear gradient (expo-linear-gradient), top-left to bottom-right.
export const BrandGradientColors = [
  '#300feb', // deep blue
  '#0d5adf', // blue
] as const;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: readonly [number, number, number]): string {
  return '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

// Solid fill for the person-icon glyph drawn over a BrandGradient avatar
// fallback (see components/hub-avatar.tsx) — the gradient's own midpoint,
// darkened, so the icon reads as one shade deeper within the same brand
// color rather than a foreign accent color dropped on top of it.
const [r1, g1, b1] = hexToRgb(BrandGradientColors[0]);
const [r2, g2, b2] = hexToRgb(BrandGradientColors[1]);
const AVATAR_ICON_DARKEN = 0.3;
export const AvatarIconColor = toHex([
  ((r1 + r2) / 2) * (1 - AVATAR_ICON_DARKEN),
  ((g1 + g2) / 2) * (1 - AVATAR_ICON_DARKEN),
  ((b1 + b2) / 2) * (1 - AVATAR_ICON_DARKEN),
]);

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
