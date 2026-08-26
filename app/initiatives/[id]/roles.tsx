import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import { ScreenHeader } from '@/components/screen-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { listInitiativeRoles, stepDownFromRole, volunteerForRole } from '@/lib/api/hubService';
import { InitiativeRole } from '@/lib/api/types';
import { useSession } from '@/lib/session/session-context';

// Unlike Team/Tasks, there's no roles data embedded in GET /api/initiatives/:id
// (only a bare `open_roles_count`) — this has to hit the separate /roles
// endpoint, whose response shape hasn't been confirmed against a live hub.
// listInitiativeRoles already degrades to an empty list rather than throwing
// if the envelope key doesn't match, so a shape mismatch shows "no roles"
// here instead of crashing — but that also means an empty list could mean
// either "genuinely no roles" or "wrong field name," and there's no way to
// tell without seeing a real response.
export default function InitiativeRolesScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { session } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [roles, setRoles] = useState<InitiativeRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session || !id) return;
    setLoading(true);
    setError(null);
    listInitiativeRoles(session.hub.tunnelUrl, session.token, id)
      .then(setRoles)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load open roles."))
      .finally(() => setLoading(false));
  }, [session, id]);

  useFocusEffect(load);

  function handleVolunteer(roleId: string) {
    if (!session || actingOn) return;
    setActingOn(roleId);
    volunteerForRole(session.hub.tunnelUrl, session.token, roleId)
      .then(load)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't claim that role."))
      .finally(() => setActingOn(null));
  }

  function handleStepDown(roleId: string) {
    if (!session || actingOn) return;
    setActingOn(roleId);
    stepDownFromRole(session.hub.tunnelUrl, session.token, roleId)
      .then(load)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't step down from that role."))
      .finally(() => setActingOn(null));
  }

  if (!session) return null;

  return (
    <ThemedView style={styles.flex}>
      <ScreenHeader title="Open roles" />

      {loading && roles.length === 0 && <ActivityIndicator style={styles.spinner} />}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <FlatList
        data={roles}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <ThemedText style={styles.intro}>
            Claim a role and the organizer sees your name on the team. You can step down any time.
          </ThemedText>
        }
        renderItem={({ item }) => {
          const isMine = !!session && item.holder_user_id === session.userId;
          const busy = actingOn === item.id;
          return (
            <View style={styles.row}>
              <View style={styles.rowHeader}>
                <View style={[styles.statusDot, { backgroundColor: item.filled ? Colors[colorScheme].icon : '#059669' }]} />
                <ThemedText style={[styles.statusLabel, { color: item.filled ? Colors[colorScheme].icon : '#059669' }]}>
                  {item.filled ? 'FILLED' : 'OPEN'}
                </ThemedText>
              </View>
              <ThemedText type="defaultSemiBold" style={styles.roleName}>
                {item.name}
              </ThemedText>
              {!!item.skills && <ThemedText style={styles.skills}>{item.skills}</ThemedText>}

              {!item.filled && (
                <Pressable style={[styles.volunteerButton, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => handleVolunteer(item.id)}>
                  <IconSymbol name="hand.raised.fill" size={14} color="#fff" />
                  <ThemedText style={styles.volunteerLabel} lightColor="#fff" darkColor="#fff">
                    Volunteer
                  </ThemedText>
                </Pressable>
              )}
              {item.filled && isMine && (
                <Pressable style={[styles.stepDownButton, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => handleStepDown(item.id)}>
                  <ThemedText style={styles.stepDownLabel}>You claimed this — step down</ThemedText>
                </Pressable>
              )}
              {item.filled && !isMine && (
                <ThemedText style={styles.holder}>{item.holder_display_name ?? item.holder_username ?? 'Filled'}</ThemedText>
              )}
            </View>
          );
        }}
        ListEmptyComponent={!loading ? <ThemedText style={styles.empty}>No open roles right now.</ThemedText> : null}
        ListFooterComponent={
          roles.length > 0 ? (
            <ThemedText style={styles.footerNote}>Volunteering also joins you to the initiative</ThemedText>
          ) : null
        }
      />
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
    marginVertical: 8,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  intro: {
    fontSize: 13,
    opacity: 0.6,
    lineHeight: 18,
    marginBottom: 10,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#8884',
  },
  row: {
    paddingVertical: 14,
    gap: 4,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  roleName: {
    fontSize: 15,
  },
  skills: {
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.7,
  },
  volunteerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 38,
    borderRadius: 999,
    backgroundColor: Brand,
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
  },
  volunteerLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  stepDownButton: {
    height: 38,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8884',
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  stepDownLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  holder: {
    fontSize: 12.5,
    opacity: 0.6,
    marginTop: 4,
  },
  empty: {
    opacity: 0.6,
    fontSize: 13.5,
    marginTop: 32,
    textAlign: 'center',
  },
  footerNote: {
    fontSize: 12,
    opacity: 0.55,
    textAlign: 'center',
    marginTop: 20,
  },
});
