import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { useThemePreference } from '@/lib/ui/theme-preference';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const { preference } = useThemePreference();
  const systemScheme = useRNColorScheme();

  if (!hasHydrated) return 'light';

  return preference === 'system' ? systemScheme : preference;
}
