import { BlurView } from 'expo-blur';
import { StyleSheet } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

// iOS "Liquid Glass" tab bar: real blur, content scrolls visibly behind it
// (see tabBarStyle's position:'absolute' in app/(tabs)/_layout.tsx).
export function TabBarBackground() {
  const colorScheme = useColorScheme() ?? 'light';
  return <BlurView intensity={78} tint={colorScheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />;
}
