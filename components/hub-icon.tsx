import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { BrandGradient } from '@/components/brand-gradient';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import type { HubIconFields } from '@/lib/api/types';

// Mirrors citinet web's HubIcon (src/app/components/HubIcon.tsx) — same three
// tiers (uploaded image > custom symbol/color badge > fallback), just mapped
// onto this app's own icon set. Web's curated Lucide symbols don't have 1:1
// SF Symbol equivalents already proven safe in this app's MAPPING (icon-
// symbol.tsx only whitelists names confirmed to render on both platforms), so
// this reuses the closest existing icon rather than risking an unverified SF
// Symbol name rendering blank.
const HUB_ICON_SYMBOLS: Record<string, IconSymbolName> = {
  hexagon: 'globe',
  network: 'globe',
  globe: 'globe',
  wifi: 'wifi',
  radio: 'antenna.radiowaves.left.and.right',
  share: 'square.and.arrow.up',
  users: 'person.2.fill',
  'map-pin': 'mappin.and.ellipse',
  building: 'building.2.fill',
  home: 'house.fill',
  waypoints: 'mappin.and.ellipse',
  antenna: 'antenna.radiowaves.left.and.right',
  signal: 'wifi',
  'circuit-board': 'gearshape.fill',
};

const DEFAULT_GRADIENT: readonly [string, string] = ['#2563eb', '#9333ea'];

// True whenever the hub's admin has touched the icon customizer at all — a
// hub that never has (the common case for most registry entries, see
// registry.json) carries none of these fields, and should fall through to
// the caller's own default look rather than a generic hexagon badge.
function hasCustomIcon(hub: HubIconFields | null | undefined): boolean {
  if (!hub) return false;
  return !!(
    hub.hub_icon_mode ||
    hub.hub_icon_symbol ||
    hub.hub_icon_bg_mode ||
    hub.hub_icon_gradient_from ||
    hub.hub_icon_gradient_to ||
    hub.hub_icon_solid_color ||
    hub.hub_icon_image_file_name
  );
}

type Props = {
  hub: HubIconFields | null | undefined;
  // The hub's own tunnel_url — uploaded icon images are served from
  // `/api/public/files/:name` on the hub itself (unauthenticated, unlike the
  // rest of this app's media, since this renders before login exists).
  tunnelUrl: string | undefined;
  size: number;
  style?: StyleProp<ViewStyle>;
  // Shown instead of the generic hexagon badge when the hub has no custom
  // icon at all — callers already have their own fallback (e.g. a letter
  // avatar) that's nicer than a one-size-fits-all default.
  fallback: ReactNode;
};

export function HubIcon({ hub, tunnelUrl, size, style, fallback }: Props) {
  const badgeStyle = { width: size, height: size, borderRadius: size * 0.27 };

  if (hub?.hub_icon_mode === 'image' && hub.hub_icon_image_file_name && tunnelUrl) {
    const url = `${tunnelUrl.replace(/\/$/, '')}/api/public/files/${encodeURIComponent(hub.hub_icon_image_file_name)}`;
    return <Image source={{ uri: url }} style={[badgeStyle, style]} contentFit="cover" />;
  }

  if (!hasCustomIcon(hub)) {
    return <View style={style}>{fallback}</View>;
  }

  const symbolId = hub?.hub_icon_symbol ?? 'hexagon';
  const iconName = HUB_ICON_SYMBOLS[symbolId] ?? 'globe';
  const iconSize = size * 0.45;

  if (hub?.hub_icon_bg_mode === 'solid' && hub.hub_icon_solid_color) {
    return (
      <View style={[badgeStyle, styles.center, { backgroundColor: hub.hub_icon_solid_color }, style]}>
        <IconSymbol name={iconName} size={iconSize} color="#fff" />
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[hub?.hub_icon_gradient_from || DEFAULT_GRADIENT[0], hub?.hub_icon_gradient_to || DEFAULT_GRADIENT[1]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[badgeStyle, styles.center, style]}>
      <IconSymbol name={iconName} size={iconSize} color="#fff" />
    </LinearGradient>
  );
}

// Convenience default for callers with nothing better — a letter tile using
// this app's own brand gradient (see hub-select.tsx / login.tsx call sites).
export function HubLetterFallback({ letter, size }: { letter: string; size: number }) {
  return (
    <BrandGradient style={[{ width: size, height: size, borderRadius: size * 0.27 }, styles.center]}>
      <ThemedText style={{ color: '#fff', fontSize: size * 0.42, fontWeight: '600' }} lightColor="#fff" darkColor="#fff">
        {letter}
      </ThemedText>
    </BrandGradient>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
