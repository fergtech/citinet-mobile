import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// A real native Stack.Screen header, styled to match this app's own custom
// ScreenHeader (transparent background, left-aligned title at the same
// fontSize/weight, no shadow) instead of looking like a stock default
// header. The point is the back button: rendered as genuine native chrome
// (gets Liquid Glass on iOS) in a way a custom Pressable/IconSymbol never
// can, since that only applies inside an actual native navigation bar.
// Render as `<Stack.Screen options={useNativeHeaderOptions('Title')} />`
// inside the screen itself (not in a parent _layout.tsx) so the theme-aware
// colors below can use hooks.
export function useNativeHeaderOptions(title: string) {
  const colorScheme = useColorScheme() ?? 'light';
  return {
    headerShown: true,
    headerTransparent: true,
    headerShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal' as const,
    headerTintColor: Colors[colorScheme].text,
    headerTitle: title,
    headerTitleAlign: 'left' as const,
    headerTitleStyle: {
      fontSize: 17,
      fontWeight: '600' as const,
      color: Colors[colorScheme].text,
    },
  };
}
