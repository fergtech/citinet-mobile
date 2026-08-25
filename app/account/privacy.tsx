import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';
import { router, type Href } from 'expo-router';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getMember, updateProfile } from '@/lib/api/hubService';
import { useE2EKeys } from '@/lib/crypto/e2e-context';
import { useSession } from '@/lib/session/session-context';

const VISIBILITY_OPTIONS: { value: 'public' | 'hub' | 'private'; label: string; description: string; icon: 'globe' | 'person.2.fill' | 'lock.fill' }[] = [
  { value: 'public', label: 'Public', description: 'Anyone can view your profile', icon: 'globe' },
  { value: 'hub', label: 'Hub members', description: 'Only members of this hub can view your profile', icon: 'person.2.fill' },
  { value: 'private', label: 'Private', description: 'Only you can view your profile', icon: 'lock.fill' },
];

// Real settings, not a stub: profile/location visibility save immediately
// (PATCH /api/auth/profile, same optimistic-then-rollback pattern as Dark
// Mode) and the encryption rows route into the E2E flows that already exist
// (app/e2e-unlock.tsx, app/e2e-setup.tsx) — this screen is a manual entry
// point into them, not new crypto UI.
export default function PrivacyScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { status, ensure } = useE2EKeys();

  const [visibility, setVisibility] = useState<'public' | 'hub' | 'private'>('hub');
  const [locationVisible, setLocationVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Same trigger app/(tabs)/messages.tsx and app/conversation/[id].tsx use —
  // without this, `status` just sits at its uninitialized 'idle' value
  // forever if this screen is opened before either of those ever ran.
  useEffect(() => {
    ensure();
  }, [ensure]);

  useEffect(() => {
    if (!session) return;
    getMember(session.hub.tunnelUrl, session.token, session.userId)
      .then((member) => {
        setVisibility(member.profile_visibility);
        setLocationVisible(member.location_visible);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [session]);

  function saveVisibility(next: 'public' | 'hub' | 'private') {
    if (!session) return;
    const prev = visibility;
    setVisibility(next);
    updateProfile(session.hub.tunnelUrl, session.token, { profileVisibility: next }).catch(() => setVisibility(prev));
  }

  function saveLocationVisible(next: boolean) {
    if (!session) return;
    setLocationVisible(next);
    updateProfile(session.hub.tunnelUrl, session.token, { locationVisible: next }).catch(() => setLocationVisible(!next));
  }

  if (!session) return null;

  const encryptionState =
    status === 'ready'
      ? { label: 'Ready', detail: 'This device can send and receive encrypted messages.', color: '#1f9e5c', icon: 'checkmark.circle.fill' as const }
      : status === 'needs-recovery'
        ? { label: 'Locked', detail: 'Enter your recovery phrase below to unlock encrypted messages on this device.', color: '#c9821a', icon: 'exclamationmark.triangle.fill' as const }
        : status === 'needs-setup'
          ? { label: 'Not set up', detail: 'No recovery phrase exists yet for this account.', color: Colors[colorScheme].icon, icon: 'lock.fill' as const }
          : { label: 'Checking…', detail: '', color: Colors[colorScheme].icon, icon: 'lock.shield.fill' as const };

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Privacy & Security" />

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {!loading && (
        <View style={styles.body}>
          <ThemedText style={styles.sectionLabel}>Profile visibility</ThemedText>
          <View style={styles.section}>
            {VISIBILITY_OPTIONS.map((opt) => {
              const selected = visibility === opt.value;
              return (
                <Pressable key={opt.value} onPress={() => saveVisibility(opt.value)} style={styles.row}>
                  <IconSymbol name={opt.icon} size={20} color={selected ? Brand : Colors[colorScheme].icon} />
                  <View style={styles.rowText}>
                    <ThemedText style={[styles.rowLabel, selected && { color: Brand, fontWeight: '600' }]}>{opt.label}</ThemedText>
                    <ThemedText style={styles.rowMeta}>{opt.description}</ThemedText>
                  </View>
                  {selected && <IconSymbol name="checkmark.circle.fill" size={18} color={Brand} />}
                </Pressable>
              );
            })}
          </View>

          <ThemedText style={styles.sectionLabel}>Location</ThemedText>
          <View style={styles.section}>
            <View style={styles.row}>
              <IconSymbol name="mappin.and.ellipse" size={20} color={Colors[colorScheme].icon} />
              <ThemedText style={styles.rowLabel}>Show my location on my profile</ThemedText>
              <Switch value={locationVisible} onValueChange={saveLocationVisible} trackColor={{ true: Brand }} />
            </View>
          </View>

          <ThemedText style={styles.sectionLabel}>Encryption</ThemedText>
          <View style={styles.section}>
            <View style={styles.row}>
              <IconSymbol name="lock.shield.fill" size={20} color={encryptionState.color} />
              <View style={styles.rowText}>
                <ThemedText style={styles.rowLabel}>This device</ThemedText>
                {!!encryptionState.detail && <ThemedText style={styles.rowMeta}>{encryptionState.detail}</ThemedText>}
              </View>
              <View style={[styles.statusPill, { backgroundColor: encryptionState.color + '22' }]}>
                <IconSymbol name={encryptionState.icon} size={13} color={encryptionState.color} />
                <ThemedText style={[styles.statusPillLabel, { color: encryptionState.color }]}>{encryptionState.label}</ThemedText>
              </View>
            </View>
            <Pressable onPress={() => router.push('/e2e-unlock' as Href)} style={styles.row}>
              <IconSymbol name="key.fill" size={20} color={Colors[colorScheme].icon} />
              <ThemedText style={styles.rowLabel}>Register this device</ThemedText>
            </Pressable>
            {status === 'needs-setup' && (
              <Pressable onPress={() => router.push('/e2e-setup' as Href)} style={styles.row}>
                <IconSymbol name="key.fill" size={20} color={Colors[colorScheme].icon} />
                <ThemedText style={styles.rowLabel}>Generate a recovery phrase</ThemedText>
              </Pressable>
            )}
            <ThemedText style={styles.footnote}>
              Enter your recovery phrase here to read and send encrypted messages on this device.
              {status !== 'needs-setup' && ' A recovery phrase already exists for this account — generating a new one would lock out any device that only has the old one, so that option is hidden once one exists.'}
            </ThemedText>
          </View>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  spinner: {
    marginTop: 40,
  },
  error: {
    color: '#b0392f',
    paddingHorizontal: 20,
    marginTop: 12,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 20,
  },
  section: {
    gap: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
  },
  rowMeta: {
    opacity: 0.6,
    fontSize: 12.5,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusPillLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  footnote: {
    opacity: 0.5,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
});
