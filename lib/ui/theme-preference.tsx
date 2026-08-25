import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { sessionStorage } from '@/lib/session/storage';

const STORAGE_KEY = 'citinet-theme-preference';

export type ThemePreference = 'system' | 'light' | 'dark';

type ThemePreferenceContextValue = {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    sessionStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw === 'light' || raw === 'dark') setPreferenceState(raw);
    });
  }, []);

  const value = useMemo<ThemePreferenceContextValue>(
    () => ({
      preference,
      setPreference(next) {
        setPreferenceState(next);
        if (next === 'system') {
          sessionStorage.deleteItem(STORAGE_KEY);
        } else {
          sessionStorage.setItem(STORAGE_KEY, next);
        }
      },
    }),
    [preference]
  );

  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>;
}

// Falls back to 'system' (no-op passthrough) if rendered outside the provider,
// so hooks/use-color-scheme.ts can call this unconditionally.
export function useThemePreference(): ThemePreferenceContextValue {
  const ctx = useContext(ThemePreferenceContext);
  return ctx ?? { preference: 'system', setPreference: () => {} };
}
