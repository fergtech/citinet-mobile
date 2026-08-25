import { StyleSheet, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

// Android (and web) fallback: no real blur, since Android's own bottom nav
// bar isn't a floating glass overlay — it's an in-flow, elevated Material
// surface. This mostly-opaque tonal tint + a top elevation shadow is that
// idiom, rather than forcing the iOS glass look onto a platform that doesn't
// use it.
export function TabBarBackground() {
  const colorScheme = useColorScheme() ?? 'light';
  const backgroundColor = colorScheme === 'dark' ? 'rgba(24,26,27,0.97)' : 'rgba(255,255,255,0.97)';
  return <View style={[StyleSheet.absoluteFill, styles.surface, { backgroundColor }]} />;
}

const styles = StyleSheet.create({
  surface: {
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
});
