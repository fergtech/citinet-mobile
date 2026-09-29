import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

// Per-device (not per-hub, not synced) — how a device chimes is a property of
// the device, like the ringer volume, so it lives in local storage only.
export type AlertPrefs = { sound: boolean; haptics: boolean };

const KEY = 'notification-alert-prefs';
const DEFAULTS: AlertPrefs = { sound: true, haptics: true };

let current: AlertPrefs = DEFAULTS;
const listeners = new Set<() => void>();

const loaded = AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (!raw) return;
    const parsed = JSON.parse(raw);
    current = { sound: parsed.sound !== false, haptics: parsed.haptics !== false };
    listeners.forEach((l) => l());
  })
  .catch(() => {});

export function getAlertPrefs(): AlertPrefs {
  return current;
}

export async function ensureAlertPrefsLoaded(): Promise<void> {
  await loaded;
}

export function setAlertPref(key: keyof AlertPrefs, value: boolean): void {
  current = { ...current, [key]: value };
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => {});
}

export function useAlertPrefs(): AlertPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getAlertPrefs,
    getAlertPrefs
  );
}
