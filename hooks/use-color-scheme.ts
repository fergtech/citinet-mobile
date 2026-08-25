import { useColorScheme as useRNColorScheme } from 'react-native';

import { useThemePreference } from '@/lib/ui/theme-preference';

// Layers the user's manual Appearance override (see AccountSheet) on top of
// the OS scheme — 'system' (the default) just passes RN's value through.
export function useColorScheme() {
  const { preference } = useThemePreference();
  const systemScheme = useRNColorScheme();
  return preference === 'system' ? systemScheme : preference;
}
